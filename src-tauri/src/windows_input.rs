use crate::input_core::{now_ms, InputEngine, KeyAction};
use std::sync::Arc;

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use std::ffi::c_void;
    use std::mem::{size_of, MaybeUninit};
    use std::thread;
    use std::time::Duration;
    use windows::core::w;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{
        CloseHandle, HANDLE, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::{
        GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE,
        RAWINPUTHEADER, RAWKEYBOARD, RIDEV_INPUTSINK, RID_INPUT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetWindowLongPtrW,
        PeekMessageW, PostQuitMessage, RegisterClassW, SetWindowLongPtrW, TranslateMessage,
        CS_HREDRAW, CS_VREDRAW, GWLP_USERDATA, MSG, PM_REMOVE, WM_DESTROY, WM_INPUT, WM_NCDESTROY,
        WNDCLASSW, WS_EX_TOOLWINDOW, WS_POPUP,
    };

    const RI_KEY_BREAK_FLAG: u16 = 0x0001;
    const RI_KEY_E0_FLAG: u16 = 0x0002;
    const RI_KEY_E1_FLAG: u16 = 0x0004;

    struct WindowContext {
        engine: Arc<InputEngine>,
        session_id: u64,
    }

    struct OwnedProcessHandle(HANDLE);

    impl Drop for OwnedProcessHandle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    pub fn run(engine: Arc<InputEngine>, session_id: u64) -> Result<(), String> {
        unsafe {
            let module = GetModuleHandleW(None).map_err(|error| error.to_string())?;
            let instance = HINSTANCE(module.0);
            let class = WNDCLASSW {
                hInstance: instance,
                lpszClassName: w!("KPSRawInputWindow"),
                lpfnWndProc: Some(window_proc),
                style: CS_HREDRAW | CS_VREDRAW,
                ..Default::default()
            };
            RegisterClassW(&class);

            let hwnd = CreateWindowExW(
                WS_EX_TOOLWINDOW,
                w!("KPSRawInputWindow"),
                w!("KPS input sink"),
                WS_POPUP,
                0,
                0,
                1,
                1,
                None,
                None,
                Some(instance),
                None,
            )
            .map_err(|error| error.to_string())?;

            let context_ptr = Box::into_raw(Box::new(WindowContext {
                engine: engine.clone(),
                session_id,
            }));
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, context_ptr as isize);

            let device = RAWINPUTDEVICE {
                usUsagePage: 0x01,
                usUsage: 0x06,
                dwFlags: RIDEV_INPUTSINK,
                hwndTarget: hwnd,
            };
            if RegisterRawInputDevices(&[device], size_of::<RAWINPUTDEVICE>() as u32).is_err() {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                let _ = Box::from_raw(context_ptr);
                let _ = DestroyWindow(hwnd);
                return Err("Windows rejected keyboard Raw Input registration".to_string());
            }

            let mut message = MSG::default();
            while engine.is_session_running(session_id) {
                while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
                thread::sleep(Duration::from_millis(1));
            }

            SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            let _ = Box::from_raw(context_ptr);
            let _ = DestroyWindow(hwnd);
            Ok(())
        }
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_INPUT => {
                let pointer = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const WindowContext;
                if !pointer.is_null() {
                    let context = &*pointer;
                    process_raw_input(
                        &context.engine,
                        context.session_id,
                        HRAWINPUT(lparam.0 as *mut c_void),
                    );
                }
                LRESULT(0)
            }
            WM_NCDESTROY => {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                DefWindowProcW(hwnd, message, wparam, lparam)
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    unsafe fn process_raw_input(engine: &InputEngine, session_id: u64, input: HRAWINPUT) {
        let mut size = 0u32;
        let header_size = size_of::<RAWINPUTHEADER>() as u32;
        if GetRawInputData(input, RID_INPUT, None, &mut size, header_size) == u32::MAX || size == 0
        {
            return;
        }

        let buffer_units = (size as usize).div_ceil(size_of::<RAWINPUT>());
        let mut buffer = Vec::with_capacity(buffer_units);
        buffer.resize_with(buffer_units, MaybeUninit::<RAWINPUT>::uninit);
        let received = GetRawInputData(
            input,
            RID_INPUT,
            Some(buffer.as_mut_ptr().cast::<c_void>()),
            &mut size,
            header_size,
        );
        if received == u32::MAX || received > size {
            return;
        }

        let Some(keyboard) =
            keyboard_from_raw_input(buffer.as_ptr().cast::<RAWINPUT>(), received as usize)
        else {
            return;
        };

        let key = physical_key_name(keyboard.MakeCode, keyboard.Flags);
        if key == "Unknown" {
            return;
        }
        let action = if keyboard.Flags & RI_KEY_BREAK_FLAG != 0 {
            KeyAction::Up
        } else {
            KeyAction::Down
        };
        engine.handle_key_for_session(session_id, key, action, now_ms());
    }

    fn keyboard_from_raw_input(raw: *const RAWINPUT, received: usize) -> Option<RAWKEYBOARD> {
        let keyboard_packet_size = std::mem::offset_of!(RAWINPUT, data) + size_of::<RAWKEYBOARD>();
        if raw.is_null() || received < keyboard_packet_size {
            return None;
        }

        unsafe {
            let header = std::ptr::addr_of!((*raw).header).read();
            if header.dwType != 1 || header.dwSize as usize != received {
                return None;
            }

            Some(std::ptr::addr_of!((*raw).data.keyboard).read())
        }
    }

    fn physical_key_name(make_code: u16, flags: u16) -> String {
        let extended = flags & RI_KEY_E0_FLAG != 0;
        let e1 = flags & RI_KEY_E1_FLAG != 0;
        match (extended, e1, make_code) {
            (_, true, 0x45) => "Pause",
            (false, false, 0x01) => "Escape",
            (false, false, 0x02) => "Digit1",
            (false, false, 0x03) => "Digit2",
            (false, false, 0x04) => "Digit3",
            (false, false, 0x05) => "Digit4",
            (false, false, 0x06) => "Digit5",
            (false, false, 0x07) => "Digit6",
            (false, false, 0x08) => "Digit7",
            (false, false, 0x09) => "Digit8",
            (false, false, 0x0A) => "Digit9",
            (false, false, 0x0B) => "Digit0",
            (false, false, 0x0C) => "Minus",
            (false, false, 0x0D) => "Equal",
            (false, false, 0x0E) => "Backspace",
            (false, false, 0x0F) => "Tab",
            (false, false, 0x10) => "KeyQ",
            (false, false, 0x11) => "KeyW",
            (false, false, 0x12) => "KeyE",
            (false, false, 0x13) => "KeyR",
            (false, false, 0x14) => "KeyT",
            (false, false, 0x15) => "KeyY",
            (false, false, 0x16) => "KeyU",
            (false, false, 0x17) => "KeyI",
            (false, false, 0x18) => "KeyO",
            (false, false, 0x19) => "KeyP",
            (false, false, 0x1A) => "BracketLeft",
            (false, false, 0x1B) => "BracketRight",
            (false, false, 0x1C) => "Enter",
            (true, false, 0x1C) => "NumpadEnter",
            (false, false, 0x1D) => "ControlLeft",
            (true, false, 0x1D) => "ControlRight",
            (false, false, 0x1E) => "KeyA",
            (false, false, 0x1F) => "KeyS",
            (false, false, 0x20) => "KeyD",
            (false, false, 0x21) => "KeyF",
            (false, false, 0x22) => "KeyG",
            (false, false, 0x23) => "KeyH",
            (false, false, 0x24) => "KeyJ",
            (false, false, 0x25) => "KeyK",
            (false, false, 0x26) => "KeyL",
            (false, false, 0x27) => "Semicolon",
            (false, false, 0x28) => "Quote",
            (false, false, 0x29) => "Backquote",
            (false, false, 0x2A) => "ShiftLeft",
            (false, false, 0x2B) => "Backslash",
            (false, false, 0x2C) => "KeyZ",
            (false, false, 0x2D) => "KeyX",
            (false, false, 0x2E) => "KeyC",
            (false, false, 0x2F) => "KeyV",
            (false, false, 0x30) => "KeyB",
            (false, false, 0x31) => "KeyN",
            (false, false, 0x32) => "KeyM",
            (false, false, 0x33) => "Comma",
            (false, false, 0x34) => "Period",
            (false, false, 0x35) => "Slash",
            (true, false, 0x35) => "NumpadDivide",
            (false, false, 0x36) => "ShiftRight",
            (false, false, 0x37) => "NumpadMultiply",
            (true, false, 0x37) => "PrintScreen",
            (false, false, 0x38) => "AltLeft",
            (true, false, 0x38) => "AltRight",
            (false, false, 0x39) => "Space",
            (false, false, 0x3A) => "CapsLock",
            (false, false, 0x3B) => "F1",
            (false, false, 0x3C) => "F2",
            (false, false, 0x3D) => "F3",
            (false, false, 0x3E) => "F4",
            (false, false, 0x3F) => "F5",
            (false, false, 0x40) => "F6",
            (false, false, 0x41) => "F7",
            (false, false, 0x42) => "F8",
            (false, false, 0x43) => "F9",
            (false, false, 0x44) => "F10",
            (false, false, 0x45) => "NumLock",
            (false, false, 0x46) => "ScrollLock",
            (false, false, 0x47) => "Numpad7",
            (true, false, 0x47) => "Home",
            (false, false, 0x48) => "Numpad8",
            (true, false, 0x48) => "ArrowUp",
            (false, false, 0x49) => "Numpad9",
            (true, false, 0x49) => "PageUp",
            (false, false, 0x4A) => "NumpadSubtract",
            (false, false, 0x4B) => "Numpad4",
            (true, false, 0x4B) => "ArrowLeft",
            (false, false, 0x4C) => "Numpad5",
            (false, false, 0x4D) => "Numpad6",
            (true, false, 0x4D) => "ArrowRight",
            (false, false, 0x4E) => "NumpadAdd",
            (false, false, 0x4F) => "Numpad1",
            (true, false, 0x4F) => "End",
            (false, false, 0x50) => "Numpad2",
            (true, false, 0x50) => "ArrowDown",
            (false, false, 0x51) => "Numpad3",
            (true, false, 0x51) => "PageDown",
            (false, false, 0x52) => "Numpad0",
            (true, false, 0x52) => "Insert",
            (false, false, 0x53) => "NumpadDecimal",
            (true, false, 0x53) => "Delete",
            (false, false, 0x57) => "F11",
            (false, false, 0x58) => "F12",
            (true, false, 0x5B) => "MetaLeft",
            (true, false, 0x5C) => "MetaRight",
            (true, false, 0x5D) => "ContextMenu",
            _ => "Unknown",
        }
        .to_string()
    }

    pub fn foreground_process_name() -> Option<String> {
        unsafe {
            let hwnd = windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow();
            if hwnd.0.is_null() {
                return None;
            }

            let mut process_id = 0u32;
            windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
                hwnd,
                Some(&mut process_id),
            );
            if process_id == 0 {
                return None;
            }

            let process = OwnedProcessHandle(
                OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?,
            );
            let mut buffer = [0u16; 512];
            let mut length = buffer.len() as u32;
            QueryFullProcessImageNameW(
                process.0,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut length,
            )
            .ok()?;

            let path = String::from_utf16_lossy(&buffer[..length as usize]);
            std::path::Path::new(&path)
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{keyboard_from_raw_input, physical_key_name, RI_KEY_E0_FLAG, RI_KEY_E1_FLAG};
        use std::mem::{offset_of, size_of, MaybeUninit};
        use windows::Win32::UI::Input::{RAWINPUT, RAWINPUTHEADER, RAWKEYBOARD};

        #[test]
        fn parses_compact_keyboard_packet() {
            let keyboard_packet_size = offset_of!(RAWINPUT, data) + size_of::<RAWKEYBOARD>();
            assert!(keyboard_packet_size < size_of::<RAWINPUT>());

            let mut storage = MaybeUninit::<RAWINPUT>::zeroed();
            let raw = storage.as_mut_ptr();
            unsafe {
                std::ptr::addr_of_mut!((*raw).header).write(RAWINPUTHEADER {
                    dwType: 1,
                    dwSize: keyboard_packet_size as u32,
                    ..Default::default()
                });
                std::ptr::addr_of_mut!((*raw).data.keyboard).write(RAWKEYBOARD {
                    MakeCode: 0x1E,
                    ..Default::default()
                });

                let keyboard = keyboard_from_raw_input(raw, keyboard_packet_size)
                    .expect("a valid compact keyboard packet should parse");
                assert_eq!(keyboard.MakeCode, 0x1E);
                assert!(keyboard_from_raw_input(raw, keyboard_packet_size - 1).is_none());
            }
        }

        #[test]
        fn maps_letters_numbers_and_symbols() {
            assert_eq!(physical_key_name(0x1E, 0), "KeyA");
            assert_eq!(physical_key_name(0x02, 0), "Digit1");
            assert_eq!(physical_key_name(0x27, 0), "Semicolon");
        }

        #[test]
        fn distinguishes_extended_keys() {
            assert_eq!(physical_key_name(0x1D, 0), "ControlLeft");
            assert_eq!(physical_key_name(0x1D, RI_KEY_E0_FLAG), "ControlRight");
            assert_eq!(physical_key_name(0x50, RI_KEY_E0_FLAG), "ArrowDown");
            assert_eq!(physical_key_name(0x45, RI_KEY_E1_FLAG), "Pause");
        }
    }
}

#[cfg(windows)]
pub fn run(engine: Arc<InputEngine>, session_id: u64) -> Result<(), String> {
    windows_impl::run(engine, session_id)
}

#[cfg(windows)]
pub fn foreground_process_name() -> Option<String> {
    windows_impl::foreground_process_name()
}

#[cfg(not(windows))]
pub fn run(_engine: Arc<InputEngine>, _session_id: u64) -> Result<(), String> {
    Err("KPS Raw Input is only available on Windows".to_string())
}

#[cfg(not(windows))]
pub fn foreground_process_name() -> Option<String> {
    None
}
