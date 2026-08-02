# KPS

KPS is a customizable Windows keyboard visualizer for streamers and rhythm-game players. It turns selected physical key presses into a real-time overlay without remapping or injecting input.

## Availability

Official Windows installers are published on the [Releases page](https://github.com/zakulv/KPS-UL-releases/releases). KPS supports 64-bit Windows 10 and Windows 11.

> Windows may show a SmartScreen warning until the installer has an established reputation or is code-signed. Download installers only from this official repository and verify that the release notes match the version you intend to install.

## Features

- Transparent, always-on-top game overlay.
- Separate opaque OBS capture window with a configurable Chroma Key color.
- Game overlay, OBS only, both, or hidden output modes.
- Editable key layouts, including additional physical keyboard keys.
- Direct output editing: move keys and the KPS counter, then resize the output window.
- Global and per-key visual settings: colors, opacity, borders, radius, typography, and press feedback.
- Profiles that can switch automatically using the foreground executable name.
- Optional click-through overlay and target-game visibility filter.
- User-triggered, signed application updates.

## Getting started

1. Install and open KPS.
2. Choose the keys you want to display and configure their appearance.
3. Select an output mode:
   - **Game overlay** shows a transparent window over the game.
   - **OBS only** opens a separate window for OBS Window Capture.
   - **Overlay + OBS** enables both windows.
4. Open the output windows, then use **Edit output layout** to position keys and the KPS counter.
5. Enable capture when you are ready to show input.

For OBS, add a **Window Capture** source, select **KPS OBS Output**, then add OBS's **Chroma Key** filter and set its custom key color to the value shown in KPS.

## Privacy and keyboard access

KPS uses Windows Raw Input so it can display selected physical key transitions while a game has focus.

KPS:

- Keeps selected key state and the rolling KPS count in memory only.
- Does not store typed text or a typing history.
- Does not inject keyboard input, provide macros, or remap keys.
- Does not require administrator privileges, collect telemetry, or run a local web server.
- Reads only the foreground application's executable name to support optional profile switching and target-game visibility. That observed name is not persisted.
- Contacts GitHub only when you choose to check for or download an application update.

Your configured layout, appearance, output geometry, profile names, and configured target executable names are stored locally in:

```text
%APPDATA%\KPS\settings.json
```

## Updates

Use the **Updates** button inside KPS to check for a newer release. Update packages are verified using KPS's embedded updater public key before installation. This verification is separate from Windows publisher code-signing and SmartScreen reputation.

## Development

KPS is built with Rust, Tauri 2, React, TypeScript, and Windows Raw Input.

The native build requires Rust with the MSVC toolchain, Microsoft C++ Build Tools, and WebView2 on Windows. This project uses pnpm.

```powershell
pnpm install
pnpm build
pnpm tauri dev
```

## Known limitations

- Game overlays work best with windowed or borderless-windowed games.
- Exclusive fullscreen games and some anti-cheat systems can block external overlays.
- The current version supports keyboard keys only; mouse buttons are not included.
- Browser Source output, macros, remapping, and online statistics are not included.

## License

KPS is released under the [MIT License](LICENSE).

## Reporting issues

When reporting a bug, include the KPS version, Windows version, and steps to reproduce it. Do not include passwords, private messages, or other sensitive information.
