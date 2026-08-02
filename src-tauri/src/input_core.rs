use crate::models::{KeyPressPulse, KeyStateSnapshot};
use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyAction {
    Down,
    Up,
}

#[derive(Debug)]
pub struct KeyStateMachine {
    selected_keys: HashSet<String>,
    pressed_keys: HashSet<String>,
    press_times: VecDeque<u64>,
    active: bool,
    error: Option<String>,
}

impl KeyStateMachine {
    pub fn new(selected_keys: impl IntoIterator<Item = String>) -> Self {
        Self {
            selected_keys: selected_keys.into_iter().collect(),
            pressed_keys: HashSet::new(),
            press_times: VecDeque::new(),
            active: false,
            error: None,
        }
    }

    pub fn set_selected_keys(&mut self, selected_keys: impl IntoIterator<Item = String>) {
        self.selected_keys = selected_keys.into_iter().collect();
        self.pressed_keys
            .retain(|key| self.selected_keys.contains(key));
    }

    pub fn set_active(&mut self, active: bool) {
        self.active = active;
        if !active {
            self.reset();
        }
    }

    pub fn set_error(&mut self, error: Option<String>) {
        self.error = error;
    }

    pub fn reset(&mut self) {
        self.pressed_keys.clear();
        self.press_times.clear();
    }

    pub fn handle_key(&mut self, key: String, action: KeyAction, timestamp_ms: u64) -> bool {
        if !self.active || !self.selected_keys.contains(&key) {
            return false;
        }

        let started_press = match action {
            KeyAction::Down => {
                // Raw Input can report repeats. Count only the transition from up to down.
                if self.pressed_keys.insert(key) {
                    self.press_times.push_back(timestamp_ms);
                    true
                } else {
                    false
                }
            }
            KeyAction::Up => {
                self.pressed_keys.remove(&key);
                false
            }
        };

        self.prune(timestamp_ms);
        started_press
    }

    pub fn snapshot(&mut self, timestamp_ms: u64) -> KeyStateSnapshot {
        self.prune(timestamp_ms);
        let mut pressed_keys: Vec<String> = self.pressed_keys.iter().cloned().collect();
        pressed_keys.sort();
        KeyStateSnapshot {
            pressed_keys,
            kps: self.press_times.len() as u32,
            timestamp_ms,
            capture_active: self.active,
            error: self.error.clone(),
        }
    }

    fn prune(&mut self, timestamp_ms: u64) {
        let cutoff = timestamp_ms.saturating_sub(1_000);
        while self.press_times.front().is_some_and(|time| *time <= cutoff) {
            self.press_times.pop_front();
        }
    }
}

pub struct InputEngine {
    state: Mutex<KeyStateMachine>,
    lifecycle: Mutex<()>,
    running: AtomicBool,
    session_id: AtomicU64,
    app: tauri::AppHandle,
}

impl InputEngine {
    pub fn new(app: tauri::AppHandle, selected_keys: Vec<String>) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(KeyStateMachine::new(selected_keys)),
            lifecycle: Mutex::new(()),
            running: AtomicBool::new(false),
            session_id: AtomicU64::new(0),
            app,
        })
    }

    pub fn start(self: &Arc<Self>) -> Result<(), String> {
        let _lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| "input lifecycle poisoned")?;
        if self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        let session_id = self.session_id.fetch_add(1, Ordering::SeqCst) + 1;
        {
            let mut state = self.state.lock().map_err(|_| "input state poisoned")?;
            state.set_active(true);
            state.set_error(None);
        }
        self.running.store(true, Ordering::SeqCst);

        let engine = Arc::clone(self);
        thread::spawn(move || {
            if let Err(error) = crate::windows_input::run(engine.clone(), session_id) {
                engine.fail_session(session_id, error);
            }
        });

        let engine = Arc::clone(self);
        thread::spawn(move || {
            let mut previous_snapshot = None;
            while engine.is_session_running(session_id) {
                let snapshot = engine.snapshot();
                if snapshot_state_changed(previous_snapshot.as_ref(), &snapshot) {
                    engine.emit_snapshot(snapshot.clone());
                    previous_snapshot = Some(snapshot);
                }
                thread::sleep(Duration::from_millis(16));
            }
            engine.emit_snapshot(engine.snapshot());
        });

        Ok(())
    }

    pub fn stop(&self) {
        let Ok(_lifecycle) = self.lifecycle.lock() else {
            return;
        };
        self.running.store(false, Ordering::SeqCst);
        self.session_id.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut state) = self.state.lock() {
            state.set_active(false);
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn is_session_running(&self, session_id: u64) -> bool {
        self.is_running() && self.session_id.load(Ordering::SeqCst) == session_id
    }

    pub fn set_selected_keys(&self, selected_keys: Vec<String>) {
        if let Ok(mut state) = self.state.lock() {
            state.set_selected_keys(selected_keys);
        }
    }

    pub fn handle_key_for_session(
        &self,
        session_id: u64,
        key: String,
        action: KeyAction,
        timestamp_ms: u64,
    ) {
        let pulse = if let Ok(mut state) = self.state.lock() {
            if self.is_session_running(session_id) {
                let physical_code = key.clone();
                state
                    .handle_key(key, action, timestamp_ms)
                    .then_some(KeyPressPulse {
                        physical_code,
                        timestamp_ms,
                    })
            } else {
                None
            }
        } else {
            None
        };
        if let Some(pulse) = pulse {
            let _ = self.app.emit("key-press-pulse", pulse);
        }
    }

    fn fail_session(&self, session_id: u64, error: String) {
        let Ok(_lifecycle) = self.lifecycle.lock() else {
            return;
        };
        if self.session_id.load(Ordering::SeqCst) != session_id {
            return;
        }
        self.running.store(false, Ordering::SeqCst);
        self.session_id.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut state) = self.state.lock() {
            state.set_active(false);
            state.set_error(Some(error));
        }
    }

    pub fn reset(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.reset();
        }
    }

    pub fn snapshot(&self) -> KeyStateSnapshot {
        let timestamp_ms = now_ms();
        self.state
            .lock()
            .map(|mut state| state.snapshot(timestamp_ms))
            .unwrap_or(KeyStateSnapshot {
                pressed_keys: Vec::new(),
                kps: 0,
                timestamp_ms,
                capture_active: false,
                error: Some("Input state unavailable".to_string()),
            })
    }

    fn emit_snapshot(&self, snapshot: KeyStateSnapshot) {
        let _ = self.app.emit("key-state", snapshot);
    }
}

fn snapshot_state_changed(previous: Option<&KeyStateSnapshot>, next: &KeyStateSnapshot) -> bool {
    previous.is_none_or(|previous| {
        previous.pressed_keys != next.pressed_keys
            || previous.kps != next.kps
            || previous.capture_active != next.capture_active
            || previous.error != next.error
    })
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::{snapshot_state_changed, KeyAction, KeyStateMachine};
    use crate::models::KeyStateSnapshot;

    fn machine() -> KeyStateMachine {
        KeyStateMachine::new(["KeyA".to_string(), "KeyS".to_string()])
    }

    #[test]
    fn counts_only_selected_key_down_transitions() {
        let mut state = machine();
        state.set_active(true);
        assert!(state.handle_key("KeyA".to_string(), KeyAction::Down, 100));
        assert!(!state.handle_key("KeyA".to_string(), KeyAction::Down, 120));
        assert!(state.handle_key("KeyS".to_string(), KeyAction::Down, 140));
        assert!(!state.handle_key("KeyX".to_string(), KeyAction::Down, 160));
        let snapshot = state.snapshot(160);
        assert_eq!(snapshot.kps, 2);
        assert_eq!(snapshot.pressed_keys, vec!["KeyA", "KeyS"]);
    }

    #[test]
    fn releases_keys_without_removing_the_press_from_kps_window() {
        let mut state = machine();
        state.set_active(true);
        state.handle_key("KeyA".to_string(), KeyAction::Down, 100);
        state.handle_key("KeyA".to_string(), KeyAction::Up, 200);
        let snapshot = state.snapshot(200);
        assert!(snapshot.pressed_keys.is_empty());
        assert_eq!(snapshot.kps, 1);
    }

    #[test]
    fn old_presses_leave_the_one_second_window() {
        let mut state = machine();
        state.set_active(true);
        state.handle_key("KeyA".to_string(), KeyAction::Down, 100);
        state.handle_key("KeyS".to_string(), KeyAction::Down, 1_100);
        let snapshot = state.snapshot(1_100);
        assert_eq!(snapshot.kps, 1);
    }

    #[test]
    fn snapshot_delivery_ignores_timestamp_only_changes() {
        let first = KeyStateSnapshot {
            pressed_keys: vec!["KeyA".to_string()],
            kps: 1,
            timestamp_ms: 100,
            capture_active: true,
            error: None,
        };
        let later = KeyStateSnapshot {
            timestamp_ms: 116,
            ..first.clone()
        };
        let released = KeyStateSnapshot {
            pressed_keys: Vec::new(),
            timestamp_ms: 120,
            ..later.clone()
        };

        assert!(snapshot_state_changed(None, &first));
        assert!(!snapshot_state_changed(Some(&first), &later));
        assert!(snapshot_state_changed(Some(&later), &released));
    }
}
