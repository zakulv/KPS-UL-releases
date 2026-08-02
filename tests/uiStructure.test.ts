import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("state controls retain accessible names and output radio semantics", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(source, /aria-label="Snap key movement to grid"/);
  assert.match(source, /aria-label="Show KPS counter"/);
  assert.match(source, /aria-label="Auto-switch profiles"/);
  assert.match(source, /role="radiogroup"/);
  assert.match(source, /onKeyDown=\{\(event\) => handleOutputModeKeyDown/);
});

test("settings writes are centralized in the persistence service", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const persistence = await readFile(new URL("../src/settingsPersistence.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /invoke(?:<[^>]+>)?\("save_settings"/);
  assert.doesNotMatch(source, /command(?:Checked)?\("save_settings"/);
  assert.doesNotMatch(source, /scheduleSettingsSave|commitSettingsSave/);
  assert.match(persistence, /invoke<SettingsSnapshot>\("apply_settings_mutation", \{ mutation \}\)/);
});

test("output editing actions keep usable pointer targets", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.output-edit-toolbar button \{ min-height: 36px;/);
  assert.match(
    styles,
    /\.output-edit-toolbar button, \.settings-save-status button \{ min-height: 44px; \}/,
  );
});

test("output editing exposes keyboard movement and throttles pointer updates", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(source, /onKeyDown=\{\(event\) => void moveWindowWithKeyboard\(event\)\}/);
  assert.match(source, /tabIndex=\{0\}/);
  assert.match(source, /Use arrow keys, or hold Shift for larger steps/);
  assert.match(source, /window\.requestAnimationFrame/);
  assert.match(source, /type: "moveKey"/);
  assert.match(source, /onKeyUp=\{finishKeyboardNudge\}/);
});

test("confirmation results are announced and return focus deliberately", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(source, /role="status" aria-live="polite">\{editorMessage\}/);
  assert.match(source, /role="status" aria-live="polite">\{profileMessage\}/);
  assert.match(source, /clearKeysButtonRef\.current\?\.focus\(\)/);
  assert.match(source, /selectedKeyLabelRef\.current\?\.focus\(\)/);
  assert.match(source, /removeProfileButtonRef\.current\?\.focus\(\)/);
});

test("the control panel reflows at high zoom and supports forced colors", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.doesNotMatch(styles, /^body \{[^}]*min-width:/m);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /\.control-grid \{ grid-template-columns: 1fr;/);
  assert.match(styles, /@media \(forced-colors: active\)/);
  assert.match(styles, /\.toggle::before \{\s*border: 2px solid ButtonText;/);
  assert.match(styles, /button:focus-visible, input:focus-visible, select:focus-visible/);
  assert.match(styles, /\.configured-key span \{ color: var\(--muted\);/);
  assert.match(styles, /\.profile-list-item\.active \.profile-list-copy small \{ color: var\(--muted\);/);
  assert.match(styles, /\.mode-option\.selected small \{ color: var\(--muted\);/);
});

test("coarse-pointer controls and semantic surfaces remain systemized", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.toggle \{[^}]*height: 44px;/);
  assert.match(styles, /input\[type="range"\] \{[^}]*height: 44px;/);
  assert.match(styles, /\.custom-size-toggle \{[^}]*min-height: 44px;/);
  assert.match(styles, /\.color-setting input, \.color-input, \.key-color-setting input \{ width: 44px; height: 44px; \}/);
  assert.match(styles, /--accent-ink: #182015;/);
  assert.match(styles, /--control-surface: #13191c;/);
  assert.doesNotMatch(styles, /color: #182015/);
  assert.doesNotMatch(styles, /background: #13191c/);
  assert.doesNotMatch(styles, /background: #11171a/);
});

test("output edit mode draws every resize edge inside the transparent viewport", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(
    styles,
    /\.output-canvas\.is-positioning::after \{[^}]*inset: 0;[^}]*pointer-events: none;[^}]*box-shadow: inset 0 0 0 2px/,
  );
  assert.doesNotMatch(styles, /\.output-canvas\.is-positioning \{[^}]*border:/);
});

test("profile text fields keep local drafts until blur", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(source, /value=\{profileNameDraft\}/);
  assert.match(source, /onChange=\{\(event\) => setProfileNameDraft\(event\.target\.value\)\}/);
  assert.match(source, /onBlur=\{commitProfileName\}/);
  assert.match(source, /value=\{processNameDraft\}/);
  assert.match(source, /onBlur=\{commitProcessName\}/);
});

test("updater failures expose diagnostics and a recovery action", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(source, /setUpdateError\(updaterErrorMessage\(error\)\)/);
  assert.match(source, /className="update-error-detail"/);
  assert.match(source, />Retry update<\/button>/);
  assert.match(styles, /\.update-error-detail \{[^}]*overflow-wrap: anywhere;/);
});

test("OBS output uses a chroma-key-safe color with contextual setup instructions", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const config = await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8");

  assert.match(source, /className="obs-setup"/);
  assert.match(source, />Window Capture</);
  assert.match(source, /Capture Method/);
  assert.match(source, /Windows 10 \(1903 and up\)/);
  assert.match(source, /Capture Cursor/);
  assert.match(source, /Window Match Priority/);
  assert.match(source, /Window title must match/);
  assert.match(source, />Chroma Key</);
  assert.match(source, /Key Color Type/);
  assert.match(source, />Green</);
  assert.match(source, /Similarity.*>1</);
  assert.match(source, /settings\.outputMode === "obs" \|\| settings\.outputMode === "both"/);
  assert.match(styles, /\.output-canvas\.obs \{ background: var\(--obs-key-color, #00ff00\); \}/);
  assert.match(styles, /\.output-canvas\.obs \.keycap:not\(\.is-pressed\) \{[^}]*box-shadow:/);
  assert.match(styles, /\.output-canvas\.obs \.keycap span \{[^}]*text-shadow:/);
  assert.match(
    styles,
    /\.output-canvas\.overlay\.is-positioning \{ background: rgba\(16,20,23,.1\); \}/,
  );
  assert.match(config, /"label": "obs"[\s\S]*?"transparent": false/);
});

test("appearance controls expose profile typography and press feedback settings", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const rust = await readFile(new URL("../src-tauri/src/input_core.rs", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(source, /const FONT_PRESETS =/);
  assert.match(source, /id="key-font-preset"/);
  assert.match(source, /id="kps-font-preset"/);
  assert.match(source, /id="minimum-highlight"/);
  assert.match(source, /minimumHighlightMs: 0/);
  assert.match(source, /remainingMinimumHighlightMs/);
  assert.match(source, /listen<KeyPressPulse>\("key-press-pulse"/);
  assert.match(source, /showVisualPressPulse\(event\.payload\.physicalCode\)/);
  assert.match(source, /At 0 ms, KPS still shows every detected press for one brief visual pulse\./);
  assert.match(rust, /self\.app\.emit\("key-press-pulse", pulse\)/);
  assert.match(rust, /\.then_some\(KeyPressPulse/);
  assert.match(styles, /font-family: var\(--key-font-family/);
  assert.match(styles, /font-family: var\(--kps-font-family/);
  assert.match(styles, /transform: translateY\(var\(--press-depth/);
  assert.match(
    styles,
    /\.output-canvas \.keycap\.is-pressed \{[^}]*border-color: var\(--pressed-border\);[^}]*background-color: var\(--accent\);[^}]*color: var\(--pressed-text\);/,
  );
});

test("press response explains when Windows reduced motion overrides its movement controls", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(source, /usePrefersReducedMotion/);
  assert.match(source, /window\.matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(source, /Windows animation effects are off/);
  assert.match(source, /Press depth, pressed scale, and animation duration will not change the output\./);
  assert.match(source, /Animation effects in Windows Accessibility/);
  assert.match(styles, /\.reduced-motion-notice \{[^}]*border: 1px solid rgba\(255,207,112,\.32\);/);
});

test("individual keys can override every key-specific global appearance setting", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const types = await readFile(new URL("../src/types.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(types, /export interface KeyAppearance/);
  assert.match(types, /appearance: KeyAppearance \| null/);
  assert.match(source, /function appearanceFromSettings\(settings: AppSettings\): KeyAppearance/);
  assert.match(source, /aria-label="Use custom appearance for this key"/);
  assert.match(source, />\s*Copy global style\s*</);
  assert.match(source, /key\.appearance/);
  assert.match(source, /appearance\?\.minimumHighlightMs \?\? settingsRef\.current\?\.minimumHighlightMs/);
  assert.match(source, /const keyStyle = appearance \?\? settings/);
  assert.match(styles, /\.key-appearance-controls \{/);
  assert.match(styles, /\.key-color-grid \{/);
});

test("selected key settings reset only after explicit inline confirmation", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(source, />\s*Reset settings\s*</);
  assert.match(source, /disabled=\{!selectedKeyHasCustomSettings\}/);
  assert.match(source, /aria-label=\{`Confirm resetting settings for \$\{selectedKey\.label\}`\}/);
  assert.match(source, /label: defaultLabel,[\s\S]*?width: null,[\s\S]*?height: null,[\s\S]*?appearance: null/);
  assert.match(source, /Its position will stay the same\./);
  assert.match(source, /onClick=\{resetSelectedKeySettings\} autoFocus>Reset key</);
  assert.match(styles, /\.reset-key-confirmation \{/);
  assert.match(styles, /\.quiet-button:disabled \{/);
});

test("layout keys are added only through physical key capture", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(source, /capturingKey \? "Listening…" : "Press a key"/);
  assert.match(source, /physicalKeyLabel\(event\.code\)/);
  assert.doesNotMatch(source, /KEY_CATALOG|key-search|key-catalog|visibleCatalog/);
  assert.doesNotMatch(styles, /\.key-search|\.key-catalog|\.catalog-key|\.catalog-empty/);
});

test("clearing all configured keys requires an explicit inline confirmation", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(source, /onClick=\{\(\) => setClearConfirmationCount\(settings\.layoutKeys\.length\)\}[\s\S]*?Clear all/);
  assert.match(source, /onClick=\{clearAllKeys\} autoFocus>Clear all keys</);
  assert.match(source, /aria-label="Confirm clearing all configured keys"/);
  assert.match(source, /type: "clearKeys"/);
  assert.match(source, /disabled=\{settings\.layoutKeys\.length === 0\}/);
  assert.match(source, /setClearConfirmationCount\(null\)/);
  assert.match(styles, /\.clear-keys-confirmation \{/);
  assert.match(styles, /\.danger-button:disabled \{/);
});

test("destructive layout and appearance resets require inline confirmation", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(source, /aria-label="Confirm resetting the key layout"/);
  assert.match(source, />Reset key layout</);
  assert.match(source, /aria-label="Confirm resetting the global style"/);
  assert.match(source, />Reset global style</);
  assert.match(source, /Global style restored to defaults\./);
});

test("closing the main window flushes backend-authoritative settings before Rust exits", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const rust = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

  assert.match(source, /await commitSettingsMutations\(\)/);
  assert.match(source, /await invoke<void>\("exit_app"\)/);
  assert.doesNotMatch(source, /exit_app", \{ settings:/);
  assert.match(source, /listen\("app-close-requested"/);
  assert.match(rust, /api\.prevent_close\(\)/);
  assert.match(rust, /window\.emit\("app-close-requested", \(\)\)/);
  assert.match(rust, /fn exit_app\(/);
  assert.match(rust, /fn exit_app\([\s\S]*?state\.settings\.mutate\([\s\S]*?app\.exit\(0\)/);
});

test("installing an update downloads, prepares settings, then installs", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const downloadIndex = source.indexOf("await availableUpdate.download()");
  const flushIndex = source.indexOf("await commitSettingsMutations()", downloadIndex);
  const prepareIndex = source.indexOf('invoke<SettingsSnapshot>("prepare_update"', flushIndex);
  const installIndex = source.indexOf("await availableUpdate.install()", prepareIndex);

  assert.notEqual(downloadIndex, -1);
  assert.notEqual(flushIndex, -1);
  assert.notEqual(prepareIndex, -1);
  assert.notEqual(installIndex, -1);
  assert.ok(downloadIndex < flushIndex);
  assert.ok(flushIndex < prepareIndex);
  assert.ok(prepareIndex < installIndex);
  assert.doesNotMatch(source, /downloadAndInstall|relaunch/);
});

test("all windows load revisioned backend snapshots and never write frontend defaults", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(source, /useState<AppSettings \| null>\(null\)/);
  assert.match(source, /get_settings_snapshot/);
  assert.match(source, /listen<SettingsSnapshot>\("settings-changed"/);
  assert.match(source, /shouldAcceptSettingsRevision\(settingsRevisionRef\.current, event\.payload\.revision\)/);
  assert.match(source, /KPS will not replace your file with defaults/);
});

test("backend state is managed before Tauri setup can start the webviews", async () => {
  const source = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const runSource = source.slice(source.indexOf("pub fn run()"));
  const manageIndex = runSource.indexOf(".manage(shared.clone())");
  const setupIndex = runSource.indexOf(".setup(|app|");

  assert.notEqual(manageIndex, -1);
  assert.notEqual(setupIndex, -1);
  assert.ok(manageIndex < setupIndex);
  assert.match(runSource, /input: OnceLock::new\(\)/);
});

test("the title bar shows the packaged application version beside updates", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const packageInfo = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };

  assert.match(source, /import packageInfo from "\.\.\/package\.json"/);
  assert.match(source, /const APP_VERSION = packageInfo\.version/);
  assert.match(source, /aria-label=\{`KPS version \$\{APP_VERSION\}`\}>v\{APP_VERSION\}/);
  assert.match(styles, /\.app-version \{/);
  assert.match(packageInfo.version, /^\d+\.\d+\.\d+$/);
});
