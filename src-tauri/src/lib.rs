mod input_core;
mod models;
mod windows_input;

use input_core::InputEngine;
use models::{
    AppSettings, KeyStateSnapshot, OutputMode, SettingsMutation, WindowPosition, WindowSize,
};
use serde::{Serialize, Serializer};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{ReplaceFileW, REPLACE_FILE_FLAGS};

struct SharedState {
    settings: SettingsStore,
    input: OnceLock<Arc<InputEngine>>,
    outputs_open: Mutex<bool>,
    editing_outputs: Mutex<bool>,
    settings_warning: Option<String>,
}

impl SharedState {
    fn input(&self) -> Result<&Arc<InputEngine>, String> {
        self.input
            .get()
            .ok_or_else(|| "Keyboard capture is still initializing".to_string())
    }
}

struct SettingsStore {
    current: Mutex<AppSettings>,
    revision: AtomicU64,
    path: PathBuf,
}

impl SettingsStore {
    fn new(settings: AppSettings) -> Self {
        Self::with_path(settings, settings_path())
    }

    fn with_path(settings: AppSettings, path: PathBuf) -> Self {
        Self {
            current: Mutex::new(settings),
            revision: AtomicU64::new(1),
            path,
        }
    }

    fn lock(&self) -> std::sync::LockResult<MutexGuard<'_, AppSettings>> {
        self.current.lock()
    }

    fn snapshot(&self) -> Result<SettingsSnapshot, String> {
        let settings = self
            .current
            .lock()
            .map_err(|_| "Settings state unavailable".to_string())?
            .clone();
        Ok(SettingsSnapshot {
            revision: self.revision.load(Ordering::Acquire),
            settings,
        })
    }

    fn mutate<F>(&self, mutate: F) -> Result<SettingsSnapshot, String>
    where
        F: FnOnce(&mut AppSettings) -> Result<(), String>,
    {
        self.mutate_with_persist(mutate, |candidate| {
            persist_settings_at_path(candidate, &self.path)
        })
    }

    fn mutate_with_persist<F, P>(&self, mutate: F, persist: P) -> Result<SettingsSnapshot, String>
    where
        F: FnOnce(&mut AppSettings) -> Result<(), String>,
        P: FnOnce(&AppSettings) -> Result<(), String>,
    {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "Settings state unavailable".to_string())?;
        let mut candidate = current.clone();
        mutate(&mut candidate)?;
        let candidate = prepare_settings_for_persistence(candidate);
        persist(&candidate)?;
        *current = candidate.clone();
        let revision = self.revision.fetch_add(1, Ordering::AcqRel) + 1;
        Ok(SettingsSnapshot {
            revision,
            settings: candidate,
        })
    }

    fn flush(&self) -> Result<SettingsSnapshot, String> {
        let current = self
            .current
            .lock()
            .map_err(|_| "Settings state unavailable".to_string())?;
        persist_settings_at_path(&current, &self.path)?;
        Ok(SettingsSnapshot {
            revision: self.revision.load(Ordering::Acquire),
            settings: current.clone(),
        })
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsSnapshot {
    revision: u64,
    #[serde(serialize_with = "serialize_snapshot_settings")]
    settings: AppSettings,
}

fn serialize_snapshot_settings<S>(settings: &AppSettings, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SnapshotSettings<'a> {
        #[serde(flatten)]
        settings: &'a AppSettings,
        capture_enabled: bool,
        output_windows_open: bool,
    }

    SnapshotSettings {
        settings,
        capture_enabled: settings.capture_enabled,
        output_windows_open: settings.output_windows_open,
    }
    .serialize(serializer)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    platform: String,
    input_backend: String,
    network_enabled: bool,
    settings_warning: Option<String>,
}

struct LoadedSettings {
    settings: AppSettings,
    warning: Option<String>,
}

enum SettingsFileRead {
    Missing,
    Valid(Box<AppSettings>),
    Invalid(String),
}

fn settings_path() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("KPS")
        .join("settings.json")
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn pre_update_path(path: &Path) -> PathBuf {
    path.with_file_name("settings.pre-update.json")
}

fn temporary_path(path: &Path) -> PathBuf {
    path.with_extension("json.tmp")
}

fn read_settings_file(path: &Path) -> SettingsFileRead {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return SettingsFileRead::Missing
        }
        Err(error) => return SettingsFileRead::Invalid(error.to_string()),
    };
    match serde_json::from_str::<AppSettings>(&contents) {
        Ok(mut settings) => {
            settings.normalize();
            SettingsFileRead::Valid(Box::new(settings))
        }
        Err(error) => SettingsFileRead::Invalid(error.to_string()),
    }
}

fn corrupt_path(path: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("settings.json");
    path.with_file_name(format!("{name}.corrupt-{timestamp}"))
}

fn quarantine_file(path: &Path) -> Result<PathBuf, String> {
    let quarantine = corrupt_path(path);
    fs::rename(path, &quarantine).map_err(|error| error.to_string())?;
    Ok(quarantine)
}

fn write_synced_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(contents)
        .and_then(|_| file.sync_all())
        .map_err(|error| error.to_string())
}

fn wide_path(path: &Path) -> Vec<u16> {
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn replace_existing_file(
    destination: &Path,
    replacement: &Path,
    backup: Option<&Path>,
) -> Result<(), String> {
    let destination = wide_path(destination);
    let replacement = wide_path(replacement);
    let backup = backup.map(wide_path);
    let backup_pointer = backup
        .as_ref()
        .map_or(PCWSTR::null(), |path| PCWSTR(path.as_ptr()));
    // SAFETY: Both buffers are null-terminated and remain alive for the duration
    // of this synchronous Windows API call. The files share a directory.
    unsafe {
        ReplaceFileW(
            PCWSTR(destination.as_ptr()),
            PCWSTR(replacement.as_ptr()),
            backup_pointer,
            REPLACE_FILE_FLAGS(0),
            None,
            None,
        )
    }
    .map_err(|error| error.to_string())
}

fn install_staged_file(destination: &Path, staged: &Path) -> Result<(), String> {
    if destination.exists() {
        replace_existing_file(destination, staged, None)
    } else {
        fs::rename(staged, destination).map_err(|error| error.to_string())
    }
}

fn serialized_settings(settings: &AppSettings) -> Result<Vec<u8>, String> {
    let contents = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    serde_json::from_slice::<AppSettings>(&contents)
        .map_err(|error| format!("Settings validation failed: {error}"))?;
    Ok(contents)
}

fn restore_primary(path: &Path, settings: &AppSettings) -> Result<(), String> {
    let contents = serialized_settings(settings)?;
    let staged = temporary_path(path);
    write_synced_file(&staged, &contents)?;
    let result = install_staged_file(path, &staged);
    if result.is_err() {
        let _ = fs::remove_file(&staged);
    }
    result
}

fn restore_from_pre_update(path: &Path, reason: &str) -> Option<LoadedSettings> {
    let pre_update = pre_update_path(path);
    let SettingsFileRead::Valid(settings) = read_settings_file(&pre_update) else {
        return None;
    };
    let warning = match restore_primary(path, &settings) {
        Ok(()) => format!(
            "KPS restored your settings from its protected pre-update snapshot after {reason}."
        ),
        Err(error) => format!(
            "KPS loaded its protected pre-update snapshot after {reason}, but could not restore the main settings file: {error}"
        ),
    };
    Some(LoadedSettings {
        settings: *settings,
        warning: Some(warning),
    })
}

fn load_settings_from_path(path: &Path) -> LoadedSettings {
    let backup = backup_path(path);
    match read_settings_file(path) {
        SettingsFileRead::Valid(settings) => LoadedSettings {
            settings: *settings,
            warning: None,
        },
        SettingsFileRead::Missing => match read_settings_file(&backup) {
            SettingsFileRead::Valid(settings) => {
                let warning = match restore_primary(path, &settings) {
                    Ok(()) => {
                        "KPS restored your settings from its last-known-good backup.".to_string()
                    }
                    Err(error) => format!(
                        "KPS loaded your backup, but could not restore the main settings file: {error}"
                    ),
                };
                LoadedSettings {
                    settings: *settings,
                    warning: Some(warning),
                }
            }
            SettingsFileRead::Missing => {
                restore_from_pre_update(path, "the main settings and backup were missing")
                    .unwrap_or_else(|| LoadedSettings {
                        settings: AppSettings::default(),
                        warning: None,
                    })
            }
            SettingsFileRead::Invalid(error) => {
                let preserved = quarantine_file(&backup)
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|_| backup.display().to_string());
                restore_from_pre_update(
                    path,
                    &format!("the settings backup was unreadable and preserved at {preserved}"),
                )
                .unwrap_or_else(|| LoadedSettings {
                        settings: AppSettings::default(),
                        warning: Some(format!(
                            "KPS could not read the settings backup ({error}). It was preserved at {preserved}."
                        )),
                    })
            }
        },
        SettingsFileRead::Invalid(primary_error) => {
            let quarantine = quarantine_file(path);
            let preserved = quarantine
                .as_ref()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|_| path.display().to_string());
            match read_settings_file(&backup) {
                SettingsFileRead::Valid(settings) => {
                    let restore = if quarantine.is_ok() {
                        restore_primary(path, &settings)
                    } else {
                        Err("the damaged settings file could not be moved".to_string())
                    };
                    let warning = match restore {
                        Ok(()) => format!(
                            "KPS recovered your settings from backup. The damaged file was preserved at {preserved}."
                        ),
                        Err(error) => format!(
                            "KPS loaded your backup in memory, but could not repair the main settings file: {error}. The original remains at {preserved}."
                        ),
                    };
                    LoadedSettings {
                        settings: *settings,
                        warning: Some(warning),
                    }
                }
                SettingsFileRead::Missing => restore_from_pre_update(path, "the main settings were damaged and no backup was available")
                    .unwrap_or_else(|| LoadedSettings {
                        settings: AppSettings::default(),
                        warning: Some(format!(
                            "KPS could not read your settings ({primary_error}) and no backup was available. The damaged file was preserved at {preserved}."
                        )),
                    }),
                SettingsFileRead::Invalid(backup_error) => {
                    let backup_preserved = quarantine_file(&backup)
                        .map(|path| path.display().to_string())
                        .unwrap_or_else(|_| backup.display().to_string());
                    restore_from_pre_update(
                        path,
                        &format!(
                            "the main settings and backup were damaged; the backup was preserved at {backup_preserved}"
                        ),
                    )
                    .unwrap_or_else(|| LoadedSettings {
                        settings: AppSettings::default(),
                        warning: Some(format!(
                            "KPS could not read the settings file or its backup ({primary_error}; {backup_error}). The damaged files were preserved at {preserved} and {backup_preserved}."
                        )),
                    })
                }
            }
        }
    }
}

fn load_settings() -> LoadedSettings {
    load_settings_from_path(&settings_path())
}

fn prepare_settings_for_startup(mut settings: AppSettings) -> AppSettings {
    settings.capture_enabled = false;
    settings.output_windows_open = false;
    settings
}

fn prepare_settings_for_persistence(mut settings: AppSettings) -> AppSettings {
    settings.normalize();
    settings.sync_active_profile();
    settings
}

fn persist_settings_at_path(settings: &AppSettings, path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid settings path".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let contents = serialized_settings(settings)?;
    if fs::read(path).is_ok_and(|existing| existing == contents) {
        return Ok(());
    }
    let staged = temporary_path(path);
    let backup = backup_path(path);
    write_synced_file(&staged, &contents)?;

    let result = (|| -> Result<(), String> {
        match read_settings_file(path) {
            SettingsFileRead::Valid(_) => replace_existing_file(path, &staged, Some(&backup)),
            SettingsFileRead::Missing => {
                fs::rename(&staged, path).map_err(|error| error.to_string())?;
                match read_settings_file(&backup) {
                    SettingsFileRead::Valid(_) => Ok(()),
                    SettingsFileRead::Missing => match write_synced_file(&backup, &contents) {
                        Ok(()) => Ok(()),
                        Err(error) => {
                            let _ = fs::remove_file(path);
                            let _ = fs::remove_file(&backup);
                            Err(error)
                        }
                    },
                    SettingsFileRead::Invalid(_) => {
                        let quarantined_backup = quarantine_file(&backup).inspect_err(|_| {
                            let _ = fs::remove_file(path);
                        })?;
                        match write_synced_file(&backup, &contents) {
                            Ok(()) => Ok(()),
                            Err(error) => {
                                let _ = fs::remove_file(path);
                                let _ = fs::remove_file(&backup);
                                let _ = fs::rename(quarantined_backup, &backup);
                                Err(error)
                            }
                        }
                    }
                }
            }
            SettingsFileRead::Invalid(_) => {
                let quarantined_primary = quarantine_file(path)?;
                fs::rename(&staged, path).map_err(|error| {
                    let _ = fs::rename(&quarantined_primary, path);
                    error.to_string()
                })?;
                match read_settings_file(&backup) {
                    SettingsFileRead::Valid(_) => Ok(()),
                    SettingsFileRead::Missing => match write_synced_file(&backup, &contents) {
                        Ok(()) => Ok(()),
                        Err(error) => {
                            let _ = fs::remove_file(path);
                            let _ = fs::remove_file(&backup);
                            let _ = fs::rename(quarantined_primary, path);
                            Err(error)
                        }
                    },
                    SettingsFileRead::Invalid(_) => {
                        let quarantined_backup = quarantine_file(&backup).inspect_err(|_| {
                            let _ = fs::remove_file(path);
                            let _ = fs::rename(&quarantined_primary, path);
                        })?;
                        match write_synced_file(&backup, &contents) {
                            Ok(()) => Ok(()),
                            Err(error) => {
                                let _ = fs::remove_file(path);
                                let _ = fs::remove_file(&backup);
                                let _ = fs::rename(quarantined_primary, path);
                                let _ = fs::rename(quarantined_backup, &backup);
                                Err(error)
                            }
                        }
                    }
                }
            }
        }
    })();
    if result.is_err() {
        let _ = fs::remove_file(&staged);
    }
    result
}

fn persist_pre_update_at_path(settings: &AppSettings, path: &Path) -> Result<(), String> {
    restore_primary(&pre_update_path(path), settings)
}

fn persist_pre_update(settings: &AppSettings) -> Result<(), String> {
    persist_pre_update_at_path(settings, &settings_path())
}

#[tauri::command]
fn get_settings_snapshot(state: State<'_, Arc<SharedState>>) -> Result<SettingsSnapshot, String> {
    state.settings.snapshot()
}

#[tauri::command]
fn apply_settings_mutation(
    mutation: SettingsMutation,
    app: AppHandle,
    state: State<'_, Arc<SharedState>>,
) -> Result<SettingsSnapshot, String> {
    let snapshot = state
        .settings
        .mutate(|settings| settings.apply_mutation(mutation))?;
    if let Some(input) = state.input.get() {
        input.set_selected_keys(snapshot.settings.selected_keys.clone());
    }
    let _ = app.emit("settings-changed", snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
fn flush_settings(state: State<'_, Arc<SharedState>>) -> Result<SettingsSnapshot, String> {
    state.settings.flush()
}

#[tauri::command]
fn prepare_update(
    target_version: String,
    app: AppHandle,
    state: State<'_, Arc<SharedState>>,
) -> Result<SettingsSnapshot, String> {
    if target_version.trim().is_empty() {
        return Err("The update version is required".to_string());
    }
    let geometry = output_geometry(&app);
    let snapshot = state.settings.mutate(|settings| {
        apply_output_geometry(settings, geometry);
        Ok(())
    })?;
    persist_pre_update(&snapshot.settings)?;
    Ok(snapshot)
}

#[tauri::command]
fn exit_app(app: AppHandle, state: State<'_, Arc<SharedState>>) -> Result<(), String> {
    let geometry = output_geometry(&app);
    state.settings.mutate(|settings| {
        apply_output_geometry(settings, geometry);
        Ok(())
    })?;
    app.exit(0);
    Ok(())
}

fn activate_profile_state(
    profile_id: &str,
    app: &AppHandle,
    state: &Arc<SharedState>,
) -> Result<SettingsSnapshot, String> {
    let snapshot = state.settings.mutate(|settings| {
        settings.apply_mutation(SettingsMutation::ActivateProfile {
            id: profile_id.to_string(),
        })
    })?;
    if let Some(input) = state.input.get() {
        input.set_selected_keys(snapshot.settings.selected_keys.clone());
    }
    let _ = app.emit(
        "profile-changed",
        snapshot.settings.active_profile_id.clone(),
    );
    Ok(snapshot)
}

#[tauri::command]
fn set_capture(
    enabled: bool,
    app: AppHandle,
    state: State<'_, Arc<SharedState>>,
) -> Result<(), String> {
    let input = state.input()?;
    if enabled {
        input.start()?;
    } else {
        input.stop();
    }
    let snapshot = state.settings.mutate(|settings| {
        settings.capture_enabled = enabled;
        Ok(())
    })?;
    app.emit("settings-changed", snapshot)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn reset_capture(state: State<'_, Arc<SharedState>>) -> Result<(), String> {
    state.input()?.reset();
    Ok(())
}

#[tauri::command]
fn get_runtime_info(state: State<'_, Arc<SharedState>>) -> RuntimeInfo {
    RuntimeInfo {
        platform: "Windows".to_string(),
        input_backend: "Windows Raw Input".to_string(),
        network_enabled: false,
        settings_warning: state.settings_warning.clone(),
    }
}

#[tauri::command]
fn get_foreground_process() -> Option<String> {
    windows_input::foreground_process_name()
}

#[tauri::command]
fn get_last_snapshot(state: State<'_, Arc<SharedState>>) -> Result<KeyStateSnapshot, String> {
    Ok(state.input()?.snapshot())
}

#[tauri::command]
fn set_output_mode(
    mode: OutputMode,
    app: AppHandle,
    state: State<'_, Arc<SharedState>>,
) -> Result<(), String> {
    let snapshot = state.settings.mutate(|settings| {
        settings.apply_mutation(SettingsMutation::SetOutputMode { mode: mode.clone() })?;
        if matches!(mode, OutputMode::Off) {
            settings.output_windows_open = false;
            settings.capture_enabled = false;
        }
        Ok(())
    })?;
    if matches!(mode, OutputMode::Off) {
        if let Ok(input) = state.input() {
            input.stop();
        }
    }
    let click_through = snapshot.settings.click_through;
    let outputs_open = if matches!(mode, OutputMode::Off) {
        *state
            .outputs_open
            .lock()
            .map_err(|_| "Output state unavailable".to_string())? = false;
        false
    } else {
        state.outputs_open.lock().map(|open| *open).unwrap_or(false)
    };
    *state
        .editing_outputs
        .lock()
        .map_err(|_| "Output edit state unavailable".to_string())? = false;
    configure_output_windows(&app, &mode, click_through, outputs_open)?;
    let _ = app.emit("output-edit-mode", false);
    app.emit("settings-changed", snapshot)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_output_visibility(
    open: bool,
    app: AppHandle,
    state: State<'_, Arc<SharedState>>,
) -> Result<(), String> {
    let (mode, click_through) = {
        let settings = state
            .settings
            .lock()
            .map_err(|_| "Settings state unavailable".to_string())?;
        (settings.output_mode.clone(), settings.click_through)
    };
    if open && matches!(mode, OutputMode::Off) {
        return Err("Choose an output mode before opening an output window".to_string());
    }
    let geometry = (!open).then(|| output_geometry(&app));
    let snapshot = state.settings.mutate(|settings| {
        set_output_visibility_state(settings, open, geometry);
        Ok(())
    })?;
    if !open {
        if let Ok(input) = state.input() {
            input.stop();
        }
        *state
            .editing_outputs
            .lock()
            .map_err(|_| "Output edit state unavailable".to_string())? = false;
    }
    *state
        .outputs_open
        .lock()
        .map_err(|_| "Output state unavailable".to_string())? = open;
    configure_output_windows(&app, &mode, click_through, open)?;
    if !open {
        let _ = app.emit("output-edit-mode", false);
    }
    app.emit("settings-changed", snapshot)
        .map_err(|error| error.to_string())?;
    app.emit("output-visibility", open)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_output_edit_mode(
    enabled: bool,
    app: AppHandle,
    state: State<'_, Arc<SharedState>>,
) -> Result<(), String> {
    let (mode, click_through) = {
        let settings = state
            .settings
            .lock()
            .map_err(|_| "Settings state unavailable".to_string())?;
        (settings.output_mode.clone(), settings.click_through)
    };
    if enabled && matches!(mode, OutputMode::Off) {
        return Err("Choose an output mode before editing output positions".to_string());
    }

    if enabled {
        let snapshot = state.settings.mutate(|settings| {
            settings.output_windows_open = true;
            Ok(())
        })?;
        *state
            .editing_outputs
            .lock()
            .map_err(|_| "Output edit state unavailable".to_string())? = true;
        *state
            .outputs_open
            .lock()
            .map_err(|_| "Output state unavailable".to_string())? = true;
        configure_output_windows(&app, &mode, false, true)?;
        let _ = app.emit("settings-changed", snapshot);
        let _ = app.emit("output-visibility", true);
    } else {
        let snapshot = state.settings.mutate(|settings| {
            apply_output_geometry(settings, output_geometry(&app));
            Ok(())
        })?;
        let _ = app.emit("settings-changed", snapshot);
        *state
            .editing_outputs
            .lock()
            .map_err(|_| "Output edit state unavailable".to_string())? = false;
        for label in ["overlay", "obs"] {
            if let Some(window) = app.get_webview_window(label) {
                window
                    .set_ignore_cursor_events(label == "overlay" && click_through)
                    .map_err(|error| error.to_string())?;
            }
        }
    }

    app.emit("output-edit-mode", enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_target_filter(
    enabled: bool,
    process_name: Option<String>,
    app: AppHandle,
    state: State<'_, Arc<SharedState>>,
) -> Result<(), String> {
    let snapshot = state.settings.mutate(|settings| {
        settings.apply_mutation(SettingsMutation::SetTargetFilter {
            enabled,
            process_name,
        })
    })?;
    app.emit("settings-changed", snapshot)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_click_through(
    click_through: bool,
    app: AppHandle,
    state: State<'_, Arc<SharedState>>,
) -> Result<(), String> {
    let snapshot = state.settings.mutate(|settings| {
        settings.apply_mutation(SettingsMutation::SetClickThrough {
            enabled: click_through,
        })
    })?;
    for label in ["overlay", "obs"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .set_ignore_cursor_events(label == "overlay" && click_through)
                .map_err(|error| error.to_string())?;
        }
    }
    app.emit("settings-changed", snapshot)
        .map_err(|error| error.to_string())
}

fn configure_output_windows(
    app: &AppHandle,
    mode: &OutputMode,
    click_through: bool,
    visible: bool,
) -> Result<(), String> {
    let wants_overlay = matches!(mode, OutputMode::Overlay | OutputMode::Both);
    let wants_obs = matches!(mode, OutputMode::Obs | OutputMode::Both);

    for (label, should_show) in [("overlay", wants_overlay), ("obs", wants_obs)] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .set_ignore_cursor_events(label == "overlay" && click_through)
                .map_err(|error| error.to_string())?;
            if visible && should_show {
                window.show().map_err(|error| error.to_string())?;
            } else {
                window.hide().map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

struct OutputGeometry {
    overlay_position: Option<WindowPosition>,
    obs_position: Option<WindowPosition>,
    overlay_size: Option<WindowSize>,
    obs_size: Option<WindowSize>,
}

fn output_geometry(app: &AppHandle) -> OutputGeometry {
    let overlay_position = app
        .get_webview_window("overlay")
        .and_then(|window| logical_window_position(&window));
    let obs_position = app
        .get_webview_window("obs")
        .and_then(|window| logical_window_position(&window));
    let overlay_size = app
        .get_webview_window("overlay")
        .and_then(|window| logical_window_size(&window));
    let obs_size = app
        .get_webview_window("obs")
        .and_then(|window| logical_window_size(&window));
    OutputGeometry {
        overlay_position,
        obs_position,
        overlay_size,
        obs_size,
    }
}

fn apply_output_geometry(settings: &mut AppSettings, geometry: OutputGeometry) {
    settings.overlay_position = geometry.overlay_position;
    settings.obs_position = geometry.obs_position;
    settings.overlay_size = geometry.overlay_size;
    settings.obs_size = geometry.obs_size;
}

fn set_output_visibility_state(
    settings: &mut AppSettings,
    open: bool,
    geometry: Option<OutputGeometry>,
) {
    settings.output_windows_open = open;
    if !open {
        settings.capture_enabled = false;
    }
    if let Some(geometry) = geometry {
        apply_output_geometry(settings, geometry);
    }
}

fn logical_window_position(window: &tauri::WebviewWindow) -> Option<WindowPosition> {
    let physical = window.outer_position().ok()?;
    let scale_factor = window.scale_factor().ok()?;
    let logical = physical.to_logical::<f64>(scale_factor);
    Some(WindowPosition {
        x: logical.x,
        y: logical.y,
    })
}

fn logical_window_size(window: &tauri::WebviewWindow) -> Option<WindowSize> {
    let physical = window.outer_size().ok()?;
    let scale_factor = window.scale_factor().ok()?;
    let logical = physical.to_logical::<f64>(scale_factor);
    Some(WindowSize {
        width: logical.width,
        height: logical.height,
    })
}

fn opaque_webview_color(value: &str) -> tauri::webview::Color {
    let hex = value.trim().trim_start_matches('#');
    if hex.len() == 6 {
        let red = u8::from_str_radix(&hex[0..2], 16);
        let green = u8::from_str_radix(&hex[2..4], 16);
        let blue = u8::from_str_radix(&hex[4..6], 16);
        if let (Ok(red), Ok(green), Ok(blue)) = (red, green, blue) {
            return tauri::webview::Color(red, green, blue, 255);
        }
    }
    tauri::webview::Color(0, 255, 0, 255)
}

fn spawn_target_monitor(app: AppHandle, state: Arc<SharedState>) {
    thread::spawn(move || loop {
        let foreground = windows_input::foreground_process_name();
        let profile_to_activate = match state.settings.lock() {
            Ok(settings) if settings.profile_auto_switch => {
                foreground.as_deref().and_then(|foreground_name| {
                    settings
                        .profiles
                        .iter()
                        .find(|profile| {
                            !profile.process_name.is_empty()
                                && profile.process_name.eq_ignore_ascii_case(foreground_name)
                        })
                        .and_then(|profile| {
                            (settings.active_profile_id.as_deref() != Some(profile.id.as_str()))
                                .then(|| profile.id.clone())
                        })
                })
            }
            _ => None,
        };
        if let Some(profile_id) = profile_to_activate {
            if let Ok(snapshot) = activate_profile_state(&profile_id, &app, &state) {
                let _ = app.emit("settings-changed", snapshot);
            }
        }

        let (enabled, target, mode, outputs_open, editing_outputs) = match state.settings.lock() {
            Ok(settings) => (
                settings.show_when_target_active,
                settings.target_process.clone(),
                settings.output_mode.clone(),
                state.outputs_open.lock().map(|open| *open).unwrap_or(false),
                state
                    .editing_outputs
                    .lock()
                    .map(|editing| *editing)
                    .unwrap_or(false),
            ),
            Err(_) => break,
        };

        let overlay_should_show = outputs_open
            && if editing_outputs {
                matches!(mode, OutputMode::Overlay | OutputMode::Both)
            } else if enabled {
                let target_active = target.as_deref().is_some_and(|target_name| {
                    foreground
                        .is_some_and(|foreground| foreground.eq_ignore_ascii_case(target_name))
                });
                target_active && matches!(mode, OutputMode::Overlay | OutputMode::Both)
            } else {
                matches!(mode, OutputMode::Overlay | OutputMode::Both)
            };
        if let Some(window) = app.get_webview_window("overlay") {
            let _ = if overlay_should_show {
                window.show()
            } else {
                window.hide()
            };
        }

        thread::sleep(Duration::from_millis(250));
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let loaded = load_settings();
    let settings = prepare_settings_for_startup(loaded.settings);
    let shared = Arc::new(SharedState {
        settings: SettingsStore::new(settings),
        input: OnceLock::new(),
        outputs_open: Mutex::new(false),
        editing_outputs: Mutex::new(false),
        settings_warning: loaded.warning,
    });

    tauri::Builder::default()
        .manage(shared.clone())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let shared = app.state::<Arc<SharedState>>().inner().clone();
            let settings = shared
                .settings
                .snapshot()
                .map_err(std::io::Error::other)?
                .settings;
            let input = InputEngine::new(app.handle().clone(), settings.selected_keys.clone());
            shared
                .input
                .set(input)
                .map_err(|_| std::io::Error::other("Keyboard capture was initialized twice"))?;
            let selected_keys = shared
                .settings
                .snapshot()
                .map_err(std::io::Error::other)?
                .settings
                .selected_keys;
            shared
                .input()
                .map_err(std::io::Error::other)?
                .set_selected_keys(selected_keys);
            let overlay_position = settings.overlay_position.clone();
            let obs_position = settings.obs_position.clone();
            let overlay_size = settings.overlay_size.clone();
            let obs_size = settings.obs_size.clone();
            let obs_key_color = settings.obs_key_color.clone();
            for label in ["overlay", "obs"] {
                if let Some(window) = app.get_webview_window(label) {
                    let background = if label == "overlay" {
                        tauri::webview::Color(0, 0, 0, 0)
                    } else {
                        opaque_webview_color(&obs_key_color)
                    };
                    window.set_background_color(Some(background))?;
                    let saved_position = if label == "overlay" {
                        overlay_position.as_ref()
                    } else {
                        obs_position.as_ref()
                    };
                    if let Some(position) = saved_position {
                        window.set_position(tauri::LogicalPosition::new(position.x, position.y))?;
                    }
                    let saved_size = if label == "overlay" {
                        overlay_size.as_ref()
                    } else {
                        obs_size.as_ref()
                    };
                    if let Some(size) = saved_size {
                        window.set_size(tauri::LogicalSize::new(size.width, size.height))?;
                    }
                    window.hide()?;
                }
            }
            spawn_target_monitor(app.handle().clone(), shared);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.emit("app-close-requested", ());
                }
            } else if matches!(window.label(), "overlay" | "obs") {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    for label in ["overlay", "obs"] {
                        if let Some(output) = window.app_handle().get_webview_window(label) {
                            let _ = output.hide();
                        }
                    }
                    let state = window.state::<Arc<SharedState>>();
                    let geometry = output_geometry(window.app_handle());
                    if let Ok(input) = state.input() {
                        input.stop();
                    }
                    let snapshot = state.settings.mutate(|settings| {
                        set_output_visibility_state(settings, false, Some(geometry));
                        Ok(())
                    });
                    if let Ok(mut outputs_open) = state.outputs_open.lock() {
                        *outputs_open = false;
                    }
                    if let Ok(mut editing_outputs) = state.editing_outputs.lock() {
                        *editing_outputs = false;
                    }
                    if let Ok(snapshot) = snapshot {
                        let _ = window.app_handle().emit("settings-changed", snapshot);
                    }
                    let _ = window.app_handle().emit("output-visibility", false);
                    let _ = window.app_handle().emit("output-edit-mode", false);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings_snapshot,
            apply_settings_mutation,
            flush_settings,
            prepare_update,
            exit_app,
            set_capture,
            reset_capture,
            get_runtime_info,
            get_foreground_process,
            get_last_snapshot,
            set_output_mode,
            set_output_visibility,
            set_output_edit_mode,
            set_target_filter,
            set_click_through
        ])
        .run(tauri::generate_context!())
        .expect("error while running KPS");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_settings_path(test_name: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "kps-{test_name}-{}-{timestamp}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("test directory should be created");
        directory.join("settings.json")
    }

    fn remove_test_settings(path: &Path) {
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    #[test]
    fn prepares_the_default_layout_for_shutdown_persistence() {
        let mut settings = AppSettings::default();
        settings.normalize();
        settings.layout_keys.clear();
        settings.selected_keys.clear();

        let prepared = prepare_settings_for_persistence(settings);

        assert!(prepared.layout_keys.is_empty());
        assert!(prepared.selected_keys.is_empty());
        assert!(prepared
            .default_profile
            .as_ref()
            .expect("the internal default profile should exist")
            .layout_keys
            .is_empty());

        let serialized = serde_json::to_string(&prepared).expect("settings should serialize");
        let mut restored: AppSettings =
            serde_json::from_str(&serialized).expect("settings should deserialize");
        restored.normalize();

        assert!(restored.layout_keys.is_empty());
        assert!(restored
            .default_profile
            .as_ref()
            .expect("the internal default profile should survive restart")
            .layout_keys
            .is_empty());
    }

    #[test]
    fn startup_always_stops_capture_and_hides_output_windows() {
        let settings = AppSettings {
            capture_enabled: true,
            output_windows_open: true,
            output_mode: OutputMode::Both,
            ..AppSettings::default()
        };

        let prepared = prepare_settings_for_startup(settings);

        assert!(!prepared.capture_enabled);
        assert!(!prepared.output_windows_open);
        assert_eq!(prepared.output_mode, OutputMode::Both);
    }

    #[test]
    fn transient_runtime_state_is_not_serialized() {
        let settings = AppSettings {
            capture_enabled: true,
            output_windows_open: true,
            ..AppSettings::default()
        };

        let serialized = serde_json::to_value(settings).expect("settings should serialize");

        assert!(serialized.get("captureEnabled").is_none());
        assert!(serialized.get("outputWindowsOpen").is_none());
    }

    #[test]
    fn runtime_snapshots_include_live_capture_and_output_state() {
        let path = test_settings_path("runtime-snapshot-state");
        let mut settings = AppSettings::default();
        settings.capture_enabled = true;
        settings.output_windows_open = true;
        let store = SettingsStore::with_path(settings, path.clone());

        let serialized = serde_json::to_value(store.snapshot().expect("snapshot should succeed"))
            .expect("snapshot should serialize");

        assert_eq!(serialized["settings"]["captureEnabled"], true);
        assert_eq!(serialized["settings"]["outputWindowsOpen"], true);
        remove_test_settings(&path);
    }

    #[test]
    fn closing_output_state_also_disables_capture() {
        let mut settings = AppSettings {
            capture_enabled: true,
            output_windows_open: true,
            ..AppSettings::default()
        };

        set_output_visibility_state(&mut settings, false, None);

        assert!(!settings.capture_enabled);
        assert!(!settings.output_windows_open);
    }

    #[test]
    fn atomic_saves_keep_the_previous_valid_settings_as_backup() {
        let path = test_settings_path("backup-rotation");
        let first = AppSettings {
            key_size: 111,
            ..AppSettings::default()
        };
        let second = AppSettings {
            key_size: 177,
            ..AppSettings::default()
        };

        persist_settings_at_path(&first, &path).expect("first save should succeed");
        persist_settings_at_path(&second, &path).expect("second save should succeed");

        let SettingsFileRead::Valid(primary) = read_settings_file(&path) else {
            panic!("primary settings should be valid");
        };
        let SettingsFileRead::Valid(backup) = read_settings_file(&backup_path(&path)) else {
            panic!("backup settings should be valid");
        };
        assert_eq!(primary.key_size, 177);
        assert_eq!(backup.key_size, 111);
        remove_test_settings(&path);
    }

    #[test]
    fn a_corrupt_primary_is_preserved_and_restored_from_backup() {
        let path = test_settings_path("backup-recovery");
        let settings = AppSettings {
            key_size: 143,
            ..AppSettings::default()
        };
        persist_settings_at_path(&settings, &path).expect("initial save should succeed");
        fs::write(&path, b"{not valid json").expect("primary should be corrupted for the test");

        let loaded = load_settings_from_path(&path);

        assert_eq!(loaded.settings.key_size, 143);
        assert!(loaded.warning.is_some());
        let SettingsFileRead::Valid(restored) = read_settings_file(&path) else {
            panic!("primary settings should have been restored");
        };
        assert_eq!(restored.key_size, 143);
        let parent = path.parent().expect("settings should have a parent");
        assert!(fs::read_dir(parent)
            .expect("test directory should be readable")
            .flatten()
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("settings.json.corrupt-")));
        remove_test_settings(&path);
    }

    #[test]
    fn corrupt_settings_without_a_backup_are_never_overwritten_by_defaults() {
        let path = test_settings_path("corrupt-preservation");
        fs::write(&path, b"{still not valid").expect("corrupt settings should be written");

        let loaded = load_settings_from_path(&path);

        assert!(loaded.warning.is_some());
        assert!(!path.exists());
        let parent = path.parent().expect("settings should have a parent");
        let preserved = fs::read_dir(parent)
            .expect("test directory should be readable")
            .flatten()
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("settings.json.corrupt-")
            })
            .expect("damaged settings should be preserved");
        assert_eq!(
            fs::read(preserved.path()).expect("preserved settings should be readable"),
            b"{still not valid"
        );
        remove_test_settings(&path);
    }

    #[test]
    fn a_missing_primary_is_restored_from_backup() {
        let path = test_settings_path("missing-primary");
        let settings = AppSettings {
            key_size: 129,
            ..AppSettings::default()
        };
        persist_settings_at_path(&settings, &path).expect("initial save should succeed");
        fs::remove_file(&path).expect("primary should be removed for the test");

        let loaded = load_settings_from_path(&path);

        assert_eq!(loaded.settings.key_size, 129);
        assert!(loaded.warning.is_some());
        assert!(path.exists());
        remove_test_settings(&path);
    }

    #[test]
    fn identical_writes_do_not_rotate_the_previous_distinct_backup() {
        let path = test_settings_path("identical-write");
        let first = AppSettings {
            key_size: 105,
            ..AppSettings::default()
        };
        let second = AppSettings {
            key_size: 155,
            ..AppSettings::default()
        };

        persist_settings_at_path(&first, &path).expect("first save should succeed");
        persist_settings_at_path(&second, &path).expect("second save should succeed");
        let backup_before =
            fs::read(backup_path(&path)).expect("the distinct backup should be readable");

        persist_settings_at_path(&second, &path).expect("identical save should succeed");

        assert_eq!(
            fs::read(backup_path(&path)).expect("backup should remain readable"),
            backup_before
        );
        remove_test_settings(&path);
    }

    #[test]
    fn protected_pre_update_snapshot_is_the_final_recovery_fallback() {
        let path = test_settings_path("pre-update-recovery");
        let protected = AppSettings {
            key_size: 191,
            accent: "#123456".to_string(),
            ..AppSettings::default()
        };
        persist_pre_update_at_path(&protected, &path)
            .expect("pre-update snapshot should be written");

        let loaded = load_settings_from_path(&path);

        assert_eq!(loaded.settings.key_size, 191);
        assert_eq!(loaded.settings.accent, "#123456");
        assert!(loaded
            .warning
            .as_deref()
            .is_some_and(|warning| warning.contains("pre-update")));
        assert!(path.exists());
        remove_test_settings(&path);
    }

    #[test]
    fn valid_backup_takes_priority_over_the_pre_update_snapshot() {
        let path = test_settings_path("backup-before-pre-update");
        let backup = AppSettings {
            key_size: 121,
            ..AppSettings::default()
        };
        let protected = AppSettings {
            key_size: 188,
            ..AppSettings::default()
        };
        restore_primary(&backup_path(&path), &backup).expect("backup should be written");
        persist_pre_update_at_path(&protected, &path)
            .expect("pre-update snapshot should be written");

        let loaded = load_settings_from_path(&path);

        assert_eq!(loaded.settings.key_size, 121);
        remove_test_settings(&path);
    }

    #[test]
    fn corrupt_primary_and_backup_are_preserved_before_pre_update_recovery() {
        let path = test_settings_path("corrupt-pair-pre-update");
        fs::write(&path, b"{bad primary").expect("corrupt primary should be written");
        fs::write(backup_path(&path), b"{bad backup").expect("corrupt backup should be written");
        let protected = AppSettings {
            key_size: 166,
            ..AppSettings::default()
        };
        persist_pre_update_at_path(&protected, &path)
            .expect("pre-update snapshot should be written");

        let loaded = load_settings_from_path(&path);

        assert_eq!(loaded.settings.key_size, 166);
        let preserved_count = fs::read_dir(path.parent().expect("settings should have a parent"))
            .expect("test directory should be readable")
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"))
            .count();
        assert_eq!(preserved_count, 2);
        remove_test_settings(&path);
    }

    #[test]
    fn failed_store_persistence_leaves_memory_revision_and_disk_unchanged() {
        let path = test_settings_path("transaction-failure");
        let initial = AppSettings {
            key_size: 109,
            ..AppSettings::default()
        };
        persist_settings_at_path(&initial, &path).expect("initial save should succeed");
        let primary_before = fs::read(&path).expect("primary should be readable");
        let backup_before = fs::read(backup_path(&path)).expect("backup should be readable");
        let store = SettingsStore::with_path(initial, path.clone());

        let result = store.mutate_with_persist(
            |settings| {
                settings.key_size = 199;
                Ok(())
            },
            |_| Err("simulated disk failure".to_string()),
        );

        assert!(result.is_err());
        let snapshot = store.snapshot().expect("store should remain available");
        assert_eq!(snapshot.revision, 1);
        assert_eq!(snapshot.settings.key_size, 109);
        assert_eq!(
            fs::read(&path).expect("primary should remain"),
            primary_before
        );
        assert_eq!(
            fs::read(backup_path(&path)).expect("backup should remain"),
            backup_before
        );
        remove_test_settings(&path);
    }

    #[test]
    fn narrow_mutations_from_multiple_windows_preserve_each_other() {
        let path = test_settings_path("multi-window-mutations");
        let mut initial = AppSettings::default();
        initial.normalize();
        let key_id = initial.layout_keys[0].id.clone();
        let store = SettingsStore::with_path(initial, path.clone());

        store
            .mutate(|settings| {
                settings.apply_mutation(SettingsMutation::MoveKey {
                    id: key_id.clone(),
                    x: 7.5,
                    y: 82.0,
                })
            })
            .expect("overlay mutation should succeed");
        let snapshot = store
            .mutate(|settings| {
                settings.apply_mutation(SettingsMutation::SetGlobalAppearance {
                    patch: models::AppearancePatch {
                        accent: Some("#ABCDEF".to_string()),
                        ..Default::default()
                    },
                })
            })
            .expect("main window mutation should succeed");

        let key = snapshot
            .settings
            .layout_keys
            .iter()
            .find(|key| key.id == key_id)
            .expect("moved key should remain");
        assert_eq!(key.x, 7.5);
        assert_eq!(key.y, 82.0);
        assert_eq!(snapshot.settings.accent, "#ABCDEF");
        assert_eq!(snapshot.revision, 3);
        remove_test_settings(&path);
    }

    #[test]
    fn pre_update_snapshot_preserves_default_layout_profiles_and_output_settings() {
        let path = test_settings_path("pre-update-complete");
        let mut initial = AppSettings::default();
        initial.normalize();
        initial.layout_keys[0].x = 3.25;
        initial.obs_key_color = "#00AA11".to_string();
        initial.output_mode = OutputMode::Both;
        initial.sync_active_profile();
        let store = SettingsStore::with_path(initial, path.clone());

        store
            .mutate(|settings| {
                settings.apply_mutation(SettingsMutation::CreateProfile {
                    name: Some("osu!".to_string()),
                    process_name: Some("osu!.exe".to_string()),
                })
            })
            .expect("first profile should be created");
        let snapshot = store
            .mutate(|settings| {
                settings.layout_keys[0].x = 96.5;
                settings.apply_mutation(SettingsMutation::CreateProfile {
                    name: Some("Second game".to_string()),
                    process_name: Some("second.exe".to_string()),
                })
            })
            .expect("second profile should be created");
        persist_pre_update_at_path(&snapshot.settings, &path)
            .expect("protected snapshot should be written");
        fs::remove_file(&path).expect("primary should be removed");
        fs::remove_file(backup_path(&path)).expect("backup should be removed");

        let recovered = load_settings_from_path(&path);

        assert_eq!(
            serde_json::to_value(&recovered.settings).expect("recovered settings should serialize"),
            serde_json::to_value(&snapshot.settings).expect("snapshot should serialize")
        );
        assert_eq!(recovered.settings.profiles.len(), 2);
        assert_eq!(
            recovered
                .settings
                .default_profile
                .as_ref()
                .expect("default profile should remain")
                .layout_keys[0]
                .x,
            3.25
        );
        remove_test_settings(&path);
    }
}
