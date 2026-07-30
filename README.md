# KPS

KPS is a customizable keyboard visualizer for Windows, built for streamers and rhythm-game players. It shows selected key presses in real time without remapping, injecting, or recording what you type.

## Download

Download the newest Windows installer from the [Releases page](https://github.com/zakulv/KPS-UL-releases/releases/latest).

KPS currently supports 64-bit Windows 10 and Windows 11.

> **Windows may show a SmartScreen warning.** The installer is not currently signed with a paid Windows code-signing certificate, so Windows cannot display a verified publisher. Only download KPS from this official repository.

## Features

- Transparent, always-on-top game overlay.
- Dedicated transparent window for OBS Window Capture.
- Overlay, OBS, both, or disabled output modes.
- Visual key selector with support for adding additional keyboard keys.
- Drag-and-drop layout editing directly on the output window.
- Global key sizing with optional per-key width and height.
- Movable KPS counter that can be shown or hidden.
- Custom colors, opacity, corner radius, borders, and pressed-key appearance.
- Game profiles with automatic switching by executable name.
- Optional click-through overlay that keeps the game focused.
- Optional visibility filtering so the overlay appears only while a selected game is active.
- Built-in signed application updates.

## Getting started

1. Install and open KPS.
2. Select **Start capture** to begin listening for the configured physical keys.
3. Add the keys you want to display and customize their appearance.
4. Choose an output mode:
   - **Game overlay** displays the transparent window over your game.
   - **OBS only** opens a separate window intended for OBS Window Capture.
   - **Overlay + OBS** enables both windows.
5. Select **Edit output layout**, resize the output window to the area you want to use, and drag every key or the KPS counter into position.
6. Finish editing to restore the normal transparent or click-through output.

For OBS, add a **Window Capture** source and select **KPS OBS Output**.

## Privacy and keyboard access

KPS uses Windows Raw Input to observe selected physical key transitions while another window is focused. This is necessary for showing input while you are playing a game.

KPS:

- Processes selected key state only in memory.
- Does not store typed text or maintain a typing history.
- Does not inject keyboard input.
- Does not include macros or key remapping.
- Does not require administrator privileges.
- Does not include telemetry.
- Does not run a local web server.
- Connects to GitHub only when checking for application updates.

Settings and profiles are stored locally in:

```text
%APPDATA%\KPS\settings.json
```

## Updates

Use the **Updates** button inside KPS to check for a newer release. Update packages are verified using KPS's embedded updater public key before installation. This updater signature is separate from the Windows publisher certificate mentioned in the SmartScreen warning.

## Known limitations

- Game overlays work best with windowed or borderless-windowed games.
- Exclusive fullscreen games and some anti-cheat systems may block external overlays.
- The current version supports keyboard keys only; mouse buttons are not included.
- Browser Source output, macros, remapping, and online statistics are not included.

## Source code

KPS is built with Rust, Tauri 2, React, TypeScript, and Windows Raw Input.

If you find a bug, please report it with your Windows version, KPS version, and steps to reproduce the problem if possible. Never include passwords, private messages, or other sensitive information in a bug report.
