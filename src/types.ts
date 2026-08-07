export type OutputMode = "off" | "overlay" | "obs" | "both";

export interface KeyAppearance {
  accent: string;
  keyBackground: string;
  keyText: string;
  keyBorder: string;
  keyOpacity: number;
  keyRadius: number;
  keyBorderWidth: number;
  pressedText: string;
  pressedBorder: string;
  keyFontPreset: string;
  keyFontSize: number;
  keyFontWeight: number;
  pressDepth: number;
  pressScale: number;
  pressAnimationMs: number;
  minimumHighlightMs: number;
}

export interface LayoutKey {
  id: string;
  physicalCode: string;
  label: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  appearance: KeyAppearance | null;
}

export interface LayoutPresetKey {
  physicalCode: string;
  label: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
}

export interface LayoutPreset {
  id: string;
  name: string;
  description: string;
  category: "Rhythm" | "Movement";
  keySize: number;
  kpsX: number;
  kpsY: number;
  keys: readonly LayoutPresetKey[];
}

export interface WindowPosition {
  x: number;
  y: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface GameProfile {
  id: string;
  name: string;
  processName: string;
  selectedKeys: string[];
  layoutKeys: LayoutKey[];
  accent: string;
  keyBackground: string;
  keyText: string;
  keyBorder: string;
  keyOpacity: number;
  keyRadius: number;
  keyBorderWidth: number;
  pressedText: string;
  pressedBorder: string;
  keyFontPreset: string;
  keyFontSize: number;
  keyFontWeight: number;
  kpsFontPreset: string;
  kpsValueSize: number;
  kpsLabelSize: number;
  kpsFontWeight: number;
  pressDepth: number;
  pressScale: number;
  pressAnimationMs: number;
  minimumHighlightMs: number;
  keySize: number;
  keyGap: number;
  showKps: boolean;
  kpsX: number;
  kpsY: number;
  snapToGrid: boolean;
  gridSize: number;
}

export interface AppSettings {
  settingsVersion: number;
  selectedKeys: string[];
  layoutKeys: LayoutKey[];
  outputMode: OutputMode;
  outputWindowsOpen: boolean;
  captureEnabled: boolean;
  clickThrough: boolean;
  showWhenTargetActive: boolean;
  targetProcess: string | null;
  accent: string;
  keyBackground: string;
  keyText: string;
  keyBorder: string;
  keyOpacity: number;
  keyRadius: number;
  keyBorderWidth: number;
  pressedText: string;
  pressedBorder: string;
  keyFontPreset: string;
  keyFontSize: number;
  keyFontWeight: number;
  kpsFontPreset: string;
  kpsValueSize: number;
  kpsLabelSize: number;
  kpsFontWeight: number;
  pressDepth: number;
  pressScale: number;
  pressAnimationMs: number;
  minimumHighlightMs: number;
  keySize: number;
  keyGap: number;
  showKps: boolean;
  kpsX: number;
  kpsY: number;
  snapToGrid: boolean;
  gridSize: number;
  obsKeyColor: string;
  overlayPosition: WindowPosition | null;
  obsPosition: WindowPosition | null;
  overlaySize: WindowSize | null;
  obsSize: WindowSize | null;
  profiles: GameProfile[];
  defaultProfile: GameProfile | null;
  activeProfileId: string | null;
  profileAutoSwitch: boolean;
}

export interface SettingsSnapshot {
  revision: number;
  settings: AppSettings;
}

export type AppearancePatch = Partial<Pick<
  AppSettings,
  | "accent"
  | "keyBackground"
  | "keyText"
  | "keyBorder"
  | "keyOpacity"
  | "keyRadius"
  | "keyBorderWidth"
  | "pressedText"
  | "pressedBorder"
  | "keyFontPreset"
  | "keyFontSize"
  | "keyFontWeight"
  | "kpsFontPreset"
  | "kpsValueSize"
  | "kpsLabelSize"
  | "kpsFontWeight"
  | "pressDepth"
  | "pressScale"
  | "pressAnimationMs"
  | "minimumHighlightMs"
>>;

export type SettingsMutation =
  | { type: "addKey"; key: LayoutKey }
  | { type: "removeKey"; id: string }
  | { type: "clearKeys" }
  | { type: "resetKeys" }
  | {
      type: "replaceLayout";
      layoutKeys: LayoutKey[];
      keySize: number;
      kpsX: number;
      kpsY: number;
    }
  | { type: "setKeyLabel"; id: string; label: string }
  | { type: "setKeySize"; id: string; width: number; height: number }
  | { type: "clearKeySize"; id: string }
  | { type: "moveKey"; id: string; x: number; y: number }
  | { type: "moveKps"; x: number; y: number }
  | {
      type: "setLayoutOptions";
      patch: Partial<Pick<AppSettings, "keySize" | "snapToGrid" | "gridSize" | "showKps">>;
    }
  | { type: "setGlobalAppearance"; patch: AppearancePatch }
  | { type: "resetGlobalAppearance" }
  | { type: "setKeyAppearance"; id: string; appearance: KeyAppearance | null }
  | { type: "updateKeyAppearance"; id: string; patch: AppearancePatch }
  | { type: "resetKeySettings"; id: string }
  | { type: "createProfile"; name?: string | null; processName?: string | null }
  | {
      type: "updateProfileDetails";
      id: string;
      name?: string | null;
      processName?: string | null;
    }
  | { type: "deleteProfile"; id: string }
  | { type: "activateProfile"; id: string }
  | { type: "setProfileAutoSwitch"; enabled: boolean }
  | { type: "setOutputMode"; mode: OutputMode }
  | { type: "setObsColor"; color: string }
  | { type: "setClickThrough"; enabled: boolean }
  | {
      type: "setTargetFilter";
      enabled: boolean;
      processName: string | null;
    };

export interface KeyStateSnapshot {
    pressedKeys: string[];
    kps: number;
  timestampMs: number;
  captureActive: boolean;
    error: string | null;
}

export interface KeyPressPulse {
  physicalCode: string;
  timestampMs: number;
}

export interface RuntimeInfo {
  platform: string;
  inputBackend: string;
  networkEnabled: boolean;
  settingsWarning: string | null;
}
