import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { check, type Update } from "@tauri-apps/plugin-updater";
import packageInfo from "../package.json";
import {
  CSSProperties,
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applySettingsMutation,
  commitSettingsMutations,
  retrySettingsSave,
  scheduleSettingsMutation,
  subscribeSettingsSnapshots,
  subscribeSettingsSaveStatus,
  type SettingsSaveStatus,
} from "./settingsPersistence";
import { LAYOUT_PRESETS, materializeLayoutPreset } from "./layoutPresets";
import type {
  AppearancePatch,
  AppSettings,
  GameProfile,
  KeyAppearance,
  KeyPressPulse,
  KeyStateSnapshot,
  LayoutKey,
  LayoutPreset,
  OutputMode,
  RuntimeInfo,
  SettingsMutation,
  SettingsSnapshot,
} from "./types";
import {
  contrastAcrossGameBackdrops,
  contrastRatio,
  finalizeProcessName,
  finalizeProfileName,
  formatRgb,
  nextRadioIndex,
  obsKeyColorConflicts,
  physicalKeyLabel,
  remainingMinimumHighlightMs,
  rgba,
  shouldAcceptSettingsRevision,
  updaterErrorMessage,
  windowMoveDelta,
} from "./uiLogic";

const APP_VERSION = packageInfo.version;

const DEFAULT_LAYOUT = materializeLayoutPreset(LAYOUT_PRESETS[0]);

const DEFAULT_KEYS = DEFAULT_LAYOUT.map((key) => key.physicalCode);
const KPS_ITEM_ID = "__kps-counter__";
const KPS_WIDTH = 120;
const KPS_HEIGHT = 40;
const OUTPUT_MODE_OPTIONS = [
  ["off", "Hidden", "Nothing is shown"],
  ["overlay", "Game overlay", "Always on top"],
  ["obs", "OBS only", "Dedicated capture window"],
  ["both", "Overlay + OBS", "Use both outputs"],
] as const;

const FONT_PRESETS = [
  ["system", "System", '"Segoe UI Variable", "Segoe UI", sans-serif'],
  ["compact", "Compact", 'Bahnschrift, "Arial Narrow", sans-serif'],
  ["technical", "Technical", 'Consolas, "Courier New", monospace'],
  ["classic", "Classic", 'Arial, Helvetica, sans-serif'],
] as const;

function fontStack(preset: string) {
  return FONT_PRESETS.find(([id]) => id === preset)?.[2] ?? FONT_PRESETS[0][2];
}

function appearanceFromSettings(settings: AppSettings): KeyAppearance {
  return {
    accent: settings.accent,
    keyBackground: settings.keyBackground,
    keyText: settings.keyText,
    keyBorder: settings.keyBorder,
    keyOpacity: settings.keyOpacity,
    keyRadius: settings.keyRadius,
    keyBorderWidth: settings.keyBorderWidth,
    pressedText: settings.pressedText,
    pressedBorder: settings.pressedBorder,
    keyFontPreset: settings.keyFontPreset,
    keyFontSize: settings.keyFontSize,
    keyFontWeight: settings.keyFontWeight,
    pressDepth: settings.pressDepth,
    pressScale: settings.pressScale,
    pressAnimationMs: settings.pressAnimationMs,
    minimumHighlightMs: settings.minimumHighlightMs,
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  settingsVersion: 9,
  selectedKeys: DEFAULT_KEYS,
  layoutKeys: DEFAULT_LAYOUT,
  outputMode: "off",
  outputWindowsOpen: false,
  captureEnabled: false,
  clickThrough: true,
  showWhenTargetActive: false,
  targetProcess: null,
  accent: "#D8FF5C",
  keyBackground: "#20282D",
  keyText: "#9BA7A8",
  keyBorder: "#303B40",
  keyOpacity: 0.92,
  keyRadius: 12,
  keyBorderWidth: 1,
  pressedText: "#182015",
  pressedBorder: "#E8FF9A",
  keyFontPreset: "system",
  keyFontSize: 14,
  keyFontWeight: 750,
  kpsFontPreset: "system",
  kpsValueSize: 24,
  kpsLabelSize: 10,
  kpsFontWeight: 750,
  pressDepth: 4,
  pressScale: 100,
  pressAnimationMs: 80,
  minimumHighlightMs: 0,
  keySize: 100,
  keyGap: 10,
  showKps: true,
  kpsX: 50,
  kpsY: 90,
  snapToGrid: true,
  gridSize: 4,
  obsKeyColor: "#00FF00",
  overlayPosition: null,
  obsPosition: null,
  overlaySize: null,
  obsSize: null,
  profiles: [],
  defaultProfile: null,
  activeProfileId: null,
  profileAutoSwitch: true,
};

const DEFAULT_APPEARANCE = {
  accent: "#D8FF5C",
  keyBackground: "#20282D",
  keyText: "#9BA7A8",
  keyBorder: "#303B40",
  keyOpacity: 0.92,
  keyRadius: 12,
  keyBorderWidth: 1,
  pressedText: "#182015",
  pressedBorder: "#E8FF9A",
  keyFontPreset: "system",
  keyFontSize: 14,
  keyFontWeight: 750,
  kpsFontPreset: "system",
  kpsValueSize: 24,
  kpsLabelSize: 10,
  kpsFontWeight: 750,
  pressDepth: 4,
  pressScale: 100,
  pressAnimationMs: 80,
  minimumHighlightMs: 0,
};

const EMPTY_SNAPSHOT: KeyStateSnapshot = {
  pressedKeys: [],
  kps: 0,
  timestampMs: Date.now(),
  captureActive: false,
  error: null,
};

const EMPTY_RUNTIME: RuntimeInfo = {
  platform: "Windows",
  inputBackend: "Windows Raw Input",
  networkEnabled: false,
  settingsWarning: null,
};

async function command<T>(name: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    return await invoke<T>(name, args);
  } catch (error) {
    console.error(`[KPS] ${name} failed`, error);
    return null;
  }
}

async function commandChecked(name: string, args?: Record<string, unknown>): Promise<string | null> {
  try {
    await invoke(name, args);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[KPS] ${name} failed`, error);
    return message;
  }
}

function windowSurface(): "main" | "overlay" | "obs" {
  const label = getCurrentWindow().label;
  return label === "overlay" || label === "obs" ? label : "main";
}

function keyClass(key: string, pressedKeys: string[]) {
  return pressedKeys.includes(key) ? "keycap is-pressed" : "keycap";
}

function sameVisualSnapshot(current: KeyStateSnapshot, next: KeyStateSnapshot) {
  return current.kps === next.kps
    && current.captureActive === next.captureActive
    && current.error === next.error
    && current.pressedKeys.length === next.pressedKeys.length
    && current.pressedKeys.every((key) => next.pressedKeys.includes(key));
}

function withLayout(settings: AppSettings, layoutKeys: LayoutKey[]): AppSettings {
  return {
    ...settings,
    layoutKeys,
    selectedKeys: layoutKeys.map((key) => key.physicalCode),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => (
    typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ));

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

function StatusDot({ active }: { active: boolean }) {
  return <span className={active ? "status-dot active" : "status-dot"} aria-hidden="true" />;
}

type OutputDragState = {
  id: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  itemWidth: number;
  itemHeight: number;
  canvasWidth: number;
  canvasHeight: number;
};

type PendingOutputPosition = {
  id: string;
  x: number;
  y: number;
};

function outputVisualStyle(
  settings: AppSettings,
  surface: "overlay" | "obs",
  appearance: KeyAppearance | null = null,
): CSSProperties {
  const keyStyle = appearance ?? settings;
  return {
    "--accent": keyStyle.accent,
    "--key-background": keyStyle.keyBackground,
    "--key-background-alpha": rgba(
      keyStyle.keyBackground,
      surface === "obs" ? 1 : keyStyle.keyOpacity,
    ),
    "--key-text": keyStyle.keyText,
    "--key-border": keyStyle.keyBorder,
    "--key-radius": `${keyStyle.keyRadius}px`,
    "--key-border-width": `${keyStyle.keyBorderWidth}px`,
    "--pressed-text": keyStyle.pressedText,
    "--pressed-border": keyStyle.pressedBorder,
    "--key-font-family": fontStack(keyStyle.keyFontPreset),
    "--key-font-size": `${keyStyle.keyFontSize}px`,
    "--key-font-weight": keyStyle.keyFontWeight,
    "--kps-font-family": fontStack(settings.kpsFontPreset),
    "--kps-value-size": `${settings.kpsValueSize}px`,
    "--kps-label-size": `${settings.kpsLabelSize}px`,
    "--kps-font-weight": settings.kpsFontWeight,
    "--press-depth": `${keyStyle.pressDepth}px`,
    "--press-scale": keyStyle.pressScale / 100,
    "--press-duration": `${keyStyle.pressAnimationMs}ms`,
  } as CSSProperties;
}

function outputItemStyle(
  x: number,
  y: number,
  width: number,
  height: number,
  settings: AppSettings,
  surface: "overlay" | "obs",
  appearance: KeyAppearance | null = null,
): CSSProperties {
  return {
    left: `calc((100% - ${width}px) * ${x / 100})`,
    top: `calc((100% - ${height}px) * ${y / 100})`,
    width: `${width}px`,
    height: `${height}px`,
    ...outputVisualStyle(settings, surface, appearance),
  };
}

export function OutputSurface({ surface }: { surface: "overlay" | "obs" }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [visualPressedKeys, setVisualPressedKeys] = useState<string[]>([]);
  const [editingPosition, setEditingPosition] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<OutputDragState | null>(null);
  const pendingPositionRef = useRef<PendingOutputPosition | null>(null);
  const positionFrameRef = useRef<number | null>(null);
  const settingsRef = useRef(settings);
  const settingsRevisionRef = useRef(0);
  const physicalPressedRef = useRef(new Set<string>());
  const visualPressedRef = useRef(new Set<string>());
  const pressStartedAtRef = useRef(new Map<string, number>());
  const releaseTimersRef = useRef(new Map<string, number>());
  const canvasStyle = {
    "--obs-key-color": settings?.obsKeyColor ?? "#00FF00",
  } as CSSProperties;

  function commitVisualPressed(next: Set<string>) {
    const current = visualPressedRef.current;
    if (current.size === next.size && [...current].every((key) => next.has(key))) return;
    visualPressedRef.current = next;
    setVisualPressedKeys([...next]);
  }

  function updateVisualPressed(pressedKeys: string[]) {
    const now = performance.now();
    const physicalPressed = new Set(pressedKeys);
    const next = new Set(visualPressedRef.current);
    physicalPressedRef.current = physicalPressed;

    for (const key of physicalPressed) {
      if (!pressStartedAtRef.current.has(key)) pressStartedAtRef.current.set(key, now);
      const timer = releaseTimersRef.current.get(key);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        releaseTimersRef.current.delete(key);
      }
      next.add(key);
    }

    for (const [key, startedAt] of pressStartedAtRef.current) {
      if (physicalPressed.has(key)) continue;
      const minimumHighlightMs = settingsRef.current?.layoutKeys.find(
        (layoutKey) => layoutKey.physicalCode === key,
      )?.appearance?.minimumHighlightMs ?? settingsRef.current?.minimumHighlightMs ?? 0;
      const remaining = remainingMinimumHighlightMs(
        startedAt,
        now,
        minimumHighlightMs,
      );
      if (remaining <= 0) {
        pressStartedAtRef.current.delete(key);
        const timer = releaseTimersRef.current.get(key);
        if (timer !== undefined) window.clearTimeout(timer);
        releaseTimersRef.current.delete(key);
        next.delete(key);
        continue;
      }
      if (releaseTimersRef.current.has(key)) continue;
      const timer = window.setTimeout(() => {
        releaseTimersRef.current.delete(key);
        if (physicalPressedRef.current.has(key)) return;
        pressStartedAtRef.current.delete(key);
        const current = new Set(visualPressedRef.current);
        current.delete(key);
        commitVisualPressed(current);
      }, remaining);
      releaseTimersRef.current.set(key, timer);
    }

    commitVisualPressed(next);
  }

  function showVisualPressPulse(physicalCode: string) {
    const timer = releaseTimersRef.current.get(physicalCode);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      releaseTimersRef.current.delete(physicalCode);
    }
    pressStartedAtRef.current.set(physicalCode, performance.now());
    const next = new Set(visualPressedRef.current);
    next.add(physicalCode);
    commitVisualPressed(next);
    updateVisualPressed([...physicalPressedRef.current]);
  }

  useEffect(() => {
    document.documentElement.classList.add("output-surface");
    document.body.classList.add("output-surface");
    const load = async () => {
      const saved = await command<SettingsSnapshot>("get_settings_snapshot");
      if (saved && shouldAcceptSettingsRevision(settingsRevisionRef.current, saved.revision)) {
        settingsRevisionRef.current = saved.revision;
        settingsRef.current = saved.settings;
        setSettings(saved.settings);
      }
      const current = await command<KeyStateSnapshot>("get_last_snapshot");
      if (current) {
        setSnapshot(current);
        updateVisualPressed(current.pressedKeys);
      }
    };
    void load();
    let unlistenKeys: (() => void) | undefined;
    let unlistenPressPulse: (() => void) | undefined;
    let unlistenSettings: (() => void) | undefined;
    let unlistenEditMode: (() => void) | undefined;
    void listen<KeyStateSnapshot>("key-state", (event) => {
      setSnapshot((current) => sameVisualSnapshot(current, event.payload) ? current : event.payload);
      updateVisualPressed(event.payload.pressedKeys);
    }).then((fn) => { unlistenKeys = fn; });
    void listen<KeyPressPulse>("key-press-pulse", (event) => {
      showVisualPressPulse(event.payload.physicalCode);
    }).then((fn) => { unlistenPressPulse = fn; });
    void listen<SettingsSnapshot>("settings-changed", (event) => {
      if (!shouldAcceptSettingsRevision(settingsRevisionRef.current, event.payload.revision)) return;
      settingsRevisionRef.current = event.payload.revision;
      settingsRef.current = event.payload.settings;
      setSettings(event.payload.settings);
      updateVisualPressed([...physicalPressedRef.current]);
    }).then((fn) => { unlistenSettings = fn; });
    const unsubscribeSnapshots = subscribeSettingsSnapshots((saved) => {
      if (!shouldAcceptSettingsRevision(settingsRevisionRef.current, saved.revision)) return;
      settingsRevisionRef.current = saved.revision;
      settingsRef.current = saved.settings;
      setSettings(saved.settings);
    });
    void listen<boolean>("output-edit-mode", (event) => {
      setEditingPosition(event.payload);
      if (!event.payload) setSelectedItemId(null);
    }).then((fn) => { unlistenEditMode = fn; });
    return () => {
      document.documentElement.classList.remove("output-surface");
      document.body.classList.remove("output-surface");
      unlistenKeys?.();
      unlistenPressPulse?.();
      unlistenSettings?.();
      unlistenEditMode?.();
      unsubscribeSnapshots();
      if (positionFrameRef.current !== null) window.cancelAnimationFrame(positionFrameRef.current);
      positionFrameRef.current = null;
      pendingPositionRef.current = null;
      for (const timer of releaseTimersRef.current.values()) window.clearTimeout(timer);
      releaseTimersRef.current.clear();
    };
  }, []);

  const startWindowDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    void getCurrentWindow().startDragging();
  };

  const moveWindowWithKeyboard = async (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const delta = windowMoveDelta(event.key, event.shiftKey);
    if (!delta) return;
    event.preventDefault();
    try {
      const appWindow = getCurrentWindow();
      const position = await appWindow.outerPosition();
      await appWindow.setPosition(new PhysicalPosition(position.x + delta[0], position.y + delta[1]));
    } catch (error) {
      console.error("[KPS] keyboard window movement failed", error);
    }
  };

  const updateItemPosition = (id: string, x: number, y: number, persist = false) => {
    const current = settingsRef.current;
    if (!current) return;
    const next = id === KPS_ITEM_ID
      ? { ...current, kpsX: x, kpsY: y }
      : withLayout(current, current.layoutKeys.map((key) => key.id === id ? { ...key, x, y } : key));
    settingsRef.current = next;
    setSettings(next);
    if (persist) {
      const mutation: SettingsMutation = id === KPS_ITEM_ID
        ? { type: "moveKps", x, y }
        : { type: "moveKey", id, x, y };
      void applySettingsMutation(mutation);
    }
  };

  const flushPendingItemPosition = () => {
    if (positionFrameRef.current !== null) {
      window.cancelAnimationFrame(positionFrameRef.current);
      positionFrameRef.current = null;
    }
    const pending = pendingPositionRef.current;
    pendingPositionRef.current = null;
    if (pending) updateItemPosition(pending.id, pending.x, pending.y);
  };

  const queueItemPosition = (id: string, x: number, y: number) => {
    pendingPositionRef.current = { id, x, y };
    if (positionFrameRef.current !== null) return;
    positionFrameRef.current = window.requestAnimationFrame(() => {
      positionFrameRef.current = null;
      const pending = pendingPositionRef.current;
      pendingPositionRef.current = null;
      if (pending) updateItemPosition(pending.id, pending.x, pending.y);
    });
  };

  const beginItemDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    id: string,
    startX: number,
    startY: number,
    itemWidth: number,
    itemHeight: number,
  ) => {
    if (!editingPosition || event.button !== 0 || !canvasRef.current) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const canvas = canvasRef.current.getBoundingClientRect();
    dragRef.current = {
      id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX,
      startY,
      itemWidth,
      itemHeight,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };
    setSelectedItemId(id);
  };

  const continueItemDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const availableWidth = Math.max(1, drag.canvasWidth - drag.itemWidth);
    const availableHeight = Math.max(1, drag.canvasHeight - drag.itemHeight);
    let left = (drag.startX / 100) * availableWidth + event.clientX - drag.startClientX;
    let top = (drag.startY / 100) * availableHeight + event.clientY - drag.startClientY;
    const currentSettings = settingsRef.current;
    if (!currentSettings) return;
    if (currentSettings.snapToGrid) {
      const snap = currentSettings.gridSize * 10;
      left = Math.round(left / snap) * snap;
      top = Math.round(top / snap) * snap;
    }
    queueItemPosition(
      drag.id,
      clamp((left / availableWidth) * 100, 0, 100),
      clamp((top / availableHeight) * 100, 0, 100),
    );
  };

  const finishItemDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    flushPendingItemPosition();
    const draggedId = dragRef.current.id;
    dragRef.current = null;
    const current = settingsRef.current;
    if (!current) return;
    const item = draggedId === KPS_ITEM_ID
      ? { x: current.kpsX, y: current.kpsY }
      : current.layoutKeys.find((key) => key.id === draggedId);
    if (!item) return;
    void applySettingsMutation(draggedId === KPS_ITEM_ID
      ? { type: "moveKps", x: item.x, y: item.y }
      : { type: "moveKey", id: draggedId, x: item.x, y: item.y });
  };

  const nudgeItem = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    id: string,
    itemWidth: number,
    itemHeight: number,
  ) => {
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!direction || !canvasRef.current) return;
    event.preventDefault();
    const current = settingsRef.current;
    if (!current) return;
    const item = id === KPS_ITEM_ID
      ? { x: current.kpsX, y: current.kpsY }
      : current.layoutKeys.find((key) => key.id === id);
    if (!item) return;
    const canvas = canvasRef.current.getBoundingClientRect();
    const availableWidth = Math.max(1, canvas.width - itemWidth);
    const availableHeight = Math.max(1, canvas.height - itemHeight);
    const step = (current.snapToGrid ? current.gridSize * 10 : 1) * (event.shiftKey ? 5 : 1);
    const left = (item.x / 100) * availableWidth + direction[0] * step;
    const top = (item.y / 100) * availableHeight + direction[1] * step;
    const x = clamp((left / availableWidth) * 100, 0, 100);
    const y = clamp((top / availableHeight) * 100, 0, 100);
    updateItemPosition(id, x, y);
    scheduleSettingsMutation(id === KPS_ITEM_ID
      ? { type: "moveKps", x, y }
      : { type: "moveKey", id, x, y });
  };

  const finishKeyboardNudge = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!windowMoveDelta(event.key)) return;
    void commitSettingsMutations();
  };

  const handleKeyEditing = (event: ReactKeyboardEvent<HTMLButtonElement>, key: LayoutKey, width: number, height: number) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (!settingsRef.current) return;
      const next = withLayout(settingsRef.current, settingsRef.current.layoutKeys.filter((item) => item.id !== key.id));
      settingsRef.current = next;
      setSettings(next);
      setSelectedItemId(null);
      void applySettingsMutation({ type: "removeKey", id: key.id });
      return;
    }
    nudgeItem(event, key.id, width, height);
  };

  if (!settings) {
    return <main className={`output-canvas ${surface}`} style={canvasStyle} aria-busy="true" />;
  }

  return (
    <main
      className={`output-canvas ${surface}${editingPosition ? " is-positioning" : ""}`}
      style={canvasStyle}
    >
      {editingPosition && (
        <div
          className="output-edit-toolbar"
          onPointerDown={startWindowDrag}
          onKeyDown={(event) => void moveWindowWithKeyboard(event)}
          role="group"
          tabIndex={0}
          aria-label={`Move ${surface === "obs" ? "OBS" : "overlay"} window. Use arrow keys, or hold Shift for larger steps.`}
        >
          <span className="drag-grip" aria-hidden="true">⠿</span>
          <span>Drag or use arrow keys to move {surface === "obs" ? "OBS" : "overlay"}</span>
          <button
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void command("set_output_edit_mode", { enabled: false })}
          >
            Done
          </button>
        </div>
      )}
      <div className="output-layout" ref={canvasRef} aria-label={`${surface} key layout`}>
        {settings.layoutKeys.map((key) => {
          const width = key.width ?? settings.keySize;
          const height = key.height ?? settings.keySize;
          const className = `${keyClass(key.physicalCode, visualPressedKeys)}${editingPosition ? " output-edit-item" : ""}${selectedItemId === key.id ? " selected" : ""}`;
          const style = outputItemStyle(
            key.x,
            key.y,
            width,
            height,
            settings,
            surface,
            key.appearance,
          );
          return editingPosition ? (
            <button
              type="button"
              className={className}
              style={style}
              key={key.id}
              onPointerDown={(event) => beginItemDrag(event, key.id, key.x, key.y, width, height)}
              onPointerMove={continueItemDrag}
              onPointerUp={finishItemDrag}
              onPointerCancel={finishItemDrag}
              onKeyDown={(event) => handleKeyEditing(event, key, width, height)}
              onKeyUp={finishKeyboardNudge}
              onBlur={() => void commitSettingsMutations()}
              aria-label={`${key.label}, drag to move`}
            >
              <span>{key.label}</span>
            </button>
          ) : (
            <div className={className} style={style} key={key.id}><span>{key.label}</span></div>
          );
        })}
        {(settings.showKps || editingPosition) && (
          editingPosition ? (
            <button
              type="button"
              className={`kps-readout output-edit-item${selectedItemId === KPS_ITEM_ID ? " selected" : ""}${settings.showKps ? "" : " is-hidden"}`}
              style={outputItemStyle(settings.kpsX, settings.kpsY, KPS_WIDTH, KPS_HEIGHT, settings, surface)}
              onPointerDown={(event) => beginItemDrag(event, KPS_ITEM_ID, settings.kpsX, settings.kpsY, KPS_WIDTH, KPS_HEIGHT)}
              onPointerMove={continueItemDrag}
              onPointerUp={finishItemDrag}
              onPointerCancel={finishItemDrag}
              onKeyDown={(event) => nudgeItem(event, KPS_ITEM_ID, KPS_WIDTH, KPS_HEIGHT)}
              onKeyUp={finishKeyboardNudge}
              onBlur={() => void commitSettingsMutations()}
              aria-label={`KPS counter, ${settings.showKps ? "visible" : "hidden"}, drag to move`}
            >
              <span className="kps-value">{snapshot.kps}</span><span className="kps-label">KPS</span>
            </button>
          ) : (
            <div
              className="kps-readout"
              style={outputItemStyle(settings.kpsX, settings.kpsY, KPS_WIDTH, KPS_HEIGHT, settings, surface)}
              aria-label="KPS counter"
            >
              <span className="kps-value">{snapshot.kps}</span><span className="kps-label">KPS</span>
            </div>
          )
        )}
        {editingPosition && settings.layoutKeys.length === 0 && (
          <div className="output-empty-state">Add keys from the main KPS window.</div>
        )}
      </div>
      {editingPosition && <div className="output-edit-hint">Tab to the move bar or a key · Arrow keys move · Shift moves farther · Delete removes a selected key</div>}
    </main>
  );
}

const DEFAULT_PRESET_PREVIEW_SIZE = { width: 1000, height: 450 } as const;

function presetPreviewOutputSize(settings: AppSettings) {
  const preferredSize = settings.outputMode === "obs" ? settings.obsSize : settings.overlaySize;
  const size = preferredSize ?? settings.overlaySize ?? settings.obsSize;
  if (
    !size
    || !Number.isFinite(size.width)
    || !Number.isFinite(size.height)
    || size.width <= 0
    || size.height <= 0
  ) {
    return DEFAULT_PRESET_PREVIEW_SIZE;
  }
  return size;
}

function PresetPreview({ preset, settings }: { preset: LayoutPreset; settings: AppSettings }) {
  const outputSize = presetPreviewOutputSize(settings);

  return (
    <span
      className="preset-preview"
      aria-hidden="true"
      style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}` }}
    >
      <svg
        className="preset-preview-canvas"
        viewBox={`0 0 ${outputSize.width} ${outputSize.height}`}
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
      >
        <foreignObject width={outputSize.width} height={outputSize.height}>
          <div
            className="output-canvas overlay preset-preview-stage"
            style={{ width: `${outputSize.width}px`, height: `${outputSize.height}px` }}
          >
            {preset.keys.map((key) => {
              const width = key.width ?? preset.keySize;
              const height = key.height ?? preset.keySize;
              const style = {
                ...outputItemStyle(key.x, key.y, width, height, settings, "overlay"),
                "--press-depth": "0px",
                "--press-duration": "0ms",
              } as CSSProperties;
              return <span className="keycap preset-preview-key" style={style} key={key.physicalCode}><span>{key.label}</span></span>;
            })}
            <span
              className="kps-readout preset-preview-kps"
              style={outputItemStyle(
                preset.kpsX,
                preset.kpsY,
                KPS_WIDTH,
                KPS_HEIGHT,
                settings,
                "overlay",
              )}
            >
              <span className="kps-value">0</span><span className="kps-label">KPS</span>
            </span>
          </div>
        </foreignObject>
      </svg>
    </span>
  );
}

type LayoutEditorProps = {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
};

export function LayoutEditor({ settings, setSettings }: LayoutEditorProps) {
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(settings.layoutKeys[0]?.id ?? null);
  const [capturingKey, setCapturingKey] = useState(false);
  const [clearConfirmationCount, setClearConfirmationCount] = useState<number | null>(null);
  const [resetKeysConfirmationCount, setResetKeysConfirmationCount] = useState<number | null>(null);
  const [resetKeyConfirmationId, setResetKeyConfirmationId] = useState<string | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState(LAYOUT_PRESETS[0].id);
  const [pendingPresetId, setPendingPresetId] = useState<string | null>(null);
  const [applyingPreset, setApplyingPreset] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [editorMessage, setEditorMessage] = useState("Select a key to change its label or size.");
  const settingsRef = useRef(settings);
  const browsePresetsButtonRef = useRef<HTMLButtonElement>(null);
  const applyPresetButtonRef = useRef<HTMLButtonElement>(null);
  const clearKeysButtonRef = useRef<HTMLButtonElement>(null);
  const resetKeysButtonRef = useRef<HTMLButtonElement>(null);
  const resetKeyButtonRef = useRef<HTMLButtonElement>(null);
  const selectedKeyLabelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    settingsRef.current = settings;
    if (selectedKeyId && !settings.layoutKeys.some((key) => key.id === selectedKeyId)) {
      setSelectedKeyId(settings.layoutKeys[0]?.id ?? null);
    }
  }, [selectedKeyId, settings]);

  useEffect(() => {
    setClearConfirmationCount(null);
    setResetKeysConfirmationCount(null);
    setPendingPresetId(null);
    setPresetError(null);
  }, [settings.activeProfileId, settings.layoutKeys.length]);

  useEffect(() => {
    setResetKeyConfirmationId(null);
  }, [selectedKeyId, settings.activeProfileId]);

  const setLocalLayout = (layoutKeys: LayoutKey[]) => {
    const next = withLayout(settingsRef.current, layoutKeys);
    settingsRef.current = next;
    setSettings(next);
  };

  const persistMutation = (mutation: SettingsMutation, immediate = false) => {
    if (immediate) void applySettingsMutation(mutation);
    else scheduleSettingsMutation(mutation);
  };

  const addKey = (physicalCode: string, label: string) => {
    const current = settingsRef.current;
    if (current.layoutKeys.some((key) => key.physicalCode === physicalCode)) {
      setEditorMessage(`${label} is already in this layout.`);
      return;
    }
    const index = current.layoutKeys.length;
    const nextKey: LayoutKey = {
      id: `key-${physicalCode}`,
      physicalCode,
      label,
      x: (index % 6) * 20,
      y: clamp(Math.floor(index / 6) * 25, 0, 100),
      width: null,
      height: null,
      appearance: null,
    };
    setLocalLayout([...current.layoutKeys, nextKey]);
    persistMutation({ type: "addKey", key: nextKey }, true);
    setSelectedKeyId(nextKey.id);
    setCapturingKey(false);
    setEditorMessage(`${label} added. Open the output editor to position it.`);
  };

  useEffect(() => {
    if (!capturingKey) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const label = physicalKeyLabel(event.code);
      if (!label) {
        setEditorMessage(`${event.code || "That key"} is not supported yet.`);
        return;
      }
      addKey(event.code, label);
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [capturingKey]);

  const removeKey = (id: string) => {
    const removed = settingsRef.current.layoutKeys.find((key) => key.id === id);
    setLocalLayout(settingsRef.current.layoutKeys.filter((key) => key.id !== id));
    persistMutation({ type: "removeKey", id }, true);
    setSelectedKeyId(null);
    setEditorMessage(`${removed?.label ?? "Key"} removed.`);
  };

  const clearAllKeys = () => {
    const keyCount = settingsRef.current.layoutKeys.length;
    if (keyCount === 0) {
      setClearConfirmationCount(null);
      return;
    }
    setLocalLayout([]);
    persistMutation({ type: "clearKeys" }, true);
    setSelectedKeyId(null);
    setCapturingKey(false);
    setClearConfirmationCount(null);
    setEditorMessage(`Removed all ${keyCount} configured keys.`);
    window.requestAnimationFrame(() => resetKeysButtonRef.current?.focus());
  };

  const cancelClearAllKeys = () => {
    setClearConfirmationCount(null);
    window.requestAnimationFrame(() => clearKeysButtonRef.current?.focus());
  };

  const resetKeys = () => {
    const previousCount = settingsRef.current.layoutKeys.length;
    const reset = DEFAULT_LAYOUT.map((key) => ({ ...key }));
    setLocalLayout(reset);
    persistMutation({ type: "resetKeys" }, true);
    setSelectedKeyId(reset[0]?.id ?? null);
    setCapturingKey(false);
    setResetKeysConfirmationCount(null);
    setEditorMessage(`Default key set restored. Replaced ${previousCount} configured ${previousCount === 1 ? "key" : "keys"}.`);
    window.requestAnimationFrame(() => resetKeysButtonRef.current?.focus());
  };

  const cancelResetKeys = () => {
    setResetKeysConfirmationCount(null);
    window.requestAnimationFrame(() => resetKeysButtonRef.current?.focus());
  };

  const selectedPreset = LAYOUT_PRESETS.find((preset) => preset.id === selectedPresetId)
    ?? LAYOUT_PRESETS[0];

  const togglePresetBrowser = () => {
    setPresetsOpen((open) => !open);
    setPendingPresetId(null);
    setPresetError(null);
  };

  const closePresetBrowser = () => {
    setPresetsOpen(false);
    setPendingPresetId(null);
    setPresetError(null);
    window.requestAnimationFrame(() => browsePresetsButtonRef.current?.focus());
  };

  const choosePreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    setPendingPresetId(null);
    setPresetError(null);
  };

  const applyPreset = async (preset: LayoutPreset) => {
    const current = settingsRef.current;
    const layoutKeys = materializeLayoutPreset(preset, current.layoutKeys);
    setApplyingPreset(true);
    setPresetError(null);
    try {
      const snapshot = await applySettingsMutation({
        type: "replaceLayout",
        layoutKeys,
        keySize: preset.keySize,
        kpsX: preset.kpsX,
        kpsY: preset.kpsY,
      });
      if (!snapshot) throw new Error("KPS did not return the saved layout.");
      settingsRef.current = snapshot.settings;
      setSettings(snapshot.settings);
      setSelectedKeyId(snapshot.settings.layoutKeys[0]?.id ?? null);
      setCapturingKey(false);
      setPendingPresetId(null);
      setPresetsOpen(false);
      setEditorMessage(`${preset.name} applied. Matching key styles were kept.`);
      window.requestAnimationFrame(() => browsePresetsButtonRef.current?.focus());
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setPresetError(`Could not apply ${preset.name}: ${detail}`);
      setEditorMessage(`${preset.name} was not applied. Use Retry after resolving the save problem.`);
    } finally {
      setApplyingPreset(false);
    }
  };

  const requestPresetApplication = () => {
    if (settingsRef.current.layoutKeys.length > 0) {
      setPendingPresetId(selectedPreset.id);
      return;
    }
    void applyPreset(selectedPreset);
  };

  const cancelPresetApplication = () => {
    setPendingPresetId(null);
    window.requestAnimationFrame(() => applyPresetButtonRef.current?.focus());
  };

  const updateSelectedKey = (changes: Partial<LayoutKey>, immediate = false) => {
    if (!selectedKeyId) return;
    const currentKey = settingsRef.current.layoutKeys.find((key) => key.id === selectedKeyId);
    if (!currentKey) return;
    const updatedKey = { ...currentKey, ...changes };
    setLocalLayout(
      settingsRef.current.layoutKeys.map((key) => key.id === selectedKeyId ? updatedKey : key),
    );
    if ("label" in changes) {
      persistMutation({ type: "setKeyLabel", id: selectedKeyId, label: updatedKey.label }, immediate);
    }
    if ("width" in changes || "height" in changes) {
      persistMutation(
        updatedKey.width === null || updatedKey.height === null
          ? { type: "clearKeySize", id: selectedKeyId }
          : {
              type: "setKeySize",
              id: selectedKeyId,
              width: updatedKey.width,
              height: updatedKey.height,
            },
        immediate,
      );
    }
    if ("appearance" in changes) {
      persistMutation({
        type: "setKeyAppearance",
        id: selectedKeyId,
        appearance: updatedKey.appearance,
      }, immediate);
    }
  };

  const selectedKey = settings.layoutKeys.find((key) => key.id === selectedKeyId) ?? null;
  const defaultSelectedKeyLabel = selectedKey
    ? physicalKeyLabel(selectedKey.physicalCode) ?? selectedKey.label
    : "";
  const selectedKeyHasCustomSettings = selectedKey !== null && (
    selectedKey.label !== defaultSelectedKeyLabel
    || selectedKey.width !== null
    || selectedKey.height !== null
    || selectedKey.appearance !== null
  );

  const resetSelectedKeySettings = () => {
    const currentKey = settingsRef.current.layoutKeys.find((key) => key.id === selectedKeyId);
    if (!currentKey) {
      setResetKeyConfirmationId(null);
      return;
    }
    const defaultLabel = physicalKeyLabel(currentKey.physicalCode) ?? currentKey.label;
    const nextKey = { ...currentKey, label: defaultLabel, width: null, height: null, appearance: null };
    setLocalLayout(settingsRef.current.layoutKeys.map((key) => key.id === currentKey.id ? nextKey : key));
    persistMutation({ type: "resetKeySettings", id: currentKey.id }, true);
    setResetKeyConfirmationId(null);
    setEditorMessage(`${defaultLabel} now follows the global key settings.`);
    window.requestAnimationFrame(() => selectedKeyLabelRef.current?.focus());
  };

  const cancelResetSelectedKey = () => {
    setResetKeyConfirmationId(null);
    window.requestAnimationFrame(() => resetKeyButtonRef.current?.focus());
  };

  const updateSelectedAppearance = (changes: Partial<KeyAppearance>, immediate = false) => {
    const currentKey = settingsRef.current.layoutKeys.find((key) => key.id === selectedKeyId);
    if (!currentKey?.appearance) return;
    const appearance = { ...currentKey.appearance, ...changes };
    setLocalLayout(settingsRef.current.layoutKeys.map((key) => key.id === currentKey.id
      ? { ...key, appearance }
      : key));
    persistMutation({
      type: "updateKeyAppearance",
      id: currentKey.id,
      patch: changes,
    }, immediate);
  };

  return (
    <div className="layout-editor">
      <div className="editor-toolbar">
        <div>
          <strong>Configured keys</strong>
          <span role="status" aria-live="polite">{editorMessage}</span>
        </div>
        {clearConfirmationCount === null && resetKeysConfirmationCount === null ? (
          <div className="editor-toolbar-actions">
            <button
              type="button"
              className={presetsOpen ? "quiet-button active" : "quiet-button"}
              ref={browsePresetsButtonRef}
              onClick={togglePresetBrowser}
              aria-expanded={presetsOpen}
              aria-controls="layout-preset-browser"
            >
              Browse presets
            </button>
            <button
              type="button"
              className="quiet-button"
              ref={resetKeysButtonRef}
              onClick={() => {
                setPresetsOpen(false);
                setResetKeysConfirmationCount(settings.layoutKeys.length);
              }}
            >
              Reset keys
            </button>
            <button
              type="button"
              className="danger-button"
              ref={clearKeysButtonRef}
              disabled={settings.layoutKeys.length === 0}
              onClick={() => {
                setPresetsOpen(false);
                setClearConfirmationCount(settings.layoutKeys.length);
              }}
            >
              Clear all
            </button>
          </div>
        ) : resetKeysConfirmationCount !== null ? (
          <div className="clear-keys-confirmation" role="group" aria-label="Confirm resetting the key layout">
            <span>Replace {resetKeysConfirmationCount} configured {resetKeysConfirmationCount === 1 ? "key" : "keys"} with the default layout?</span>
            <button type="button" className="quiet-button" onClick={cancelResetKeys}>Cancel</button>
            <button type="button" className="danger-button" ref={(button) => button?.focus()} onClick={resetKeys} autoFocus>Reset key layout</button>
          </div>
        ) : (
          <div className="clear-keys-confirmation" role="group" aria-label="Confirm clearing all configured keys">
            <span>Remove all {clearConfirmationCount} {clearConfirmationCount === 1 ? "key" : "keys"}?</span>
            <button type="button" className="quiet-button" onClick={cancelClearAllKeys}>Cancel</button>
            <button type="button" className="danger-button" onClick={clearAllKeys} autoFocus>Clear all keys</button>
          </div>
        )}
      </div>

      {presetsOpen && (
        <section className="preset-browser" id="layout-preset-browser" aria-labelledby="layout-preset-title">
          <div className="preset-browser-heading">
            <div>
              <strong id="layout-preset-title">Start from a preset</strong>
              <span>Choose a structure for the active layout. Your global style and output settings stay unchanged.</span>
            </div>
            <button type="button" className="quiet-button" onClick={closePresetBrowser}>Close</button>
          </div>

          <div className="preset-grid" role="group" aria-label="Built-in layout presets">
            {LAYOUT_PRESETS.map((preset) => (
              <button
                type="button"
                className={preset.id === selectedPreset.id ? "preset-option selected" : "preset-option"}
                key={preset.id}
                onClick={() => choosePreset(preset.id)}
                aria-pressed={preset.id === selectedPreset.id}
              >
                <span className="preset-option-heading">
                  <span><strong>{preset.name}</strong><small>{preset.category} · {preset.keys.length} keys</small></span>
                  <span className="preset-selection-mark" aria-hidden="true" />
                </span>
                <PresetPreview preset={preset} settings={settings} />
                <span className="preset-description">{preset.description}</span>
              </button>
            ))}
          </div>

          {presetError && <div className="preset-error" role="alert">{presetError} Use the settings Retry action below.</div>}

          {pendingPresetId === selectedPreset.id ? (
            <div className="preset-confirmation" role="group" aria-label={`Confirm applying ${selectedPreset.name}`}>
              <div>
                <strong>Replace {settings.layoutKeys.length} configured {settings.layoutKeys.length === 1 ? "key" : "keys"} with {selectedPreset.name}?</strong>
                <span>Positions, labels and sizes will change. Matching keys keep their individual appearance.</span>
              </div>
              <div className="preset-confirmation-actions">
                <button type="button" className="quiet-button" onClick={cancelPresetApplication} disabled={applyingPreset}>Cancel</button>
                <button type="button" className="danger-button" onClick={() => void applyPreset(selectedPreset)} disabled={applyingPreset} autoFocus>
                  {applyingPreset ? "Replacing…" : "Replace layout"}
                </button>
              </div>
            </div>
          ) : (
            <div className="preset-browser-actions">
              <span>{selectedPreset.name} will replace key geometry and KPS placement.</span>
              <button
                type="button"
                className="direct-edit-button"
                ref={applyPresetButtonRef}
                onClick={requestPresetApplication}
                disabled={applyingPreset}
              >
                {applyingPreset ? "Applying…" : "Apply preset"}
              </button>
            </div>
          )}
        </section>
      )}

      <div className="configured-key-list" aria-label="Configured keys">
        {settings.layoutKeys.map((key) => (
          <button
            className={`configured-key${selectedKeyId === key.id ? " selected" : ""}`}
            key={key.id}
            onClick={() => setSelectedKeyId(key.id)}
            aria-pressed={selectedKeyId === key.id}
          >
            <strong>{key.label}</strong><span>{key.physicalCode}</span>
          </button>
        ))}
        {settings.layoutKeys.length === 0 && (
          <div className="configured-keys-empty">No keys configured. Add one below to get started.</div>
        )}
      </div>

      <div className="editor-settings-grid">
        <div className="editor-settings-card">
          <div className="card-heading">
            <div><strong>Size and movement</strong><span>Position items directly inside the output editor.</span></div>
            <div className="inline-toggle">
              <span>Snap</span>
              <button
                className={settings.snapToGrid ? "toggle on" : "toggle"}
                onClick={() => {
                  const next = { ...settingsRef.current, snapToGrid: !settingsRef.current.snapToGrid };
                  settingsRef.current = next;
                  setSettings(next);
                  void applySettingsMutation({
                    type: "setLayoutOptions",
                    patch: { snapToGrid: next.snapToGrid },
                  });
                }}
                aria-pressed={settings.snapToGrid}
                aria-label="Snap key movement to grid"
              >
                <span />
              </button>
            </div>
          </div>
          <div className="slider-row">
            <label htmlFor="key-size">Global key size <output>{settings.keySize}px</output></label>
            <input
              id="key-size"
              type="range"
              min="40"
              max="200"
              value={settings.keySize}
              onChange={(event) => {
                const next = { ...settingsRef.current, keySize: Number(event.target.value) };
                settingsRef.current = next;
                setSettings(next);
                scheduleSettingsMutation({
                  type: "setLayoutOptions",
                  patch: { keySize: next.keySize },
                });
              }}
              onPointerUp={() => void commitSettingsMutations()}
              onKeyUp={() => void commitSettingsMutations()}
              onBlur={() => void commitSettingsMutations()}
            />
          </div>
          {settings.snapToGrid && (
            <div className="slider-row condensed">
              <label htmlFor="grid-size">Snap distance <output>{settings.gridSize * 10}px</output></label>
              <input
                id="grid-size"
                type="range"
                min="1"
                max="10"
                value={settings.gridSize}
                onChange={(event) => {
                  const next = { ...settingsRef.current, gridSize: Number(event.target.value) };
                  settingsRef.current = next;
                  setSettings(next);
                  scheduleSettingsMutation({
                    type: "setLayoutOptions",
                    patch: { gridSize: next.gridSize },
                  });
                }}
                onPointerUp={() => void commitSettingsMutations()}
                onKeyUp={() => void commitSettingsMutations()}
                onBlur={() => void commitSettingsMutations()}
              />
            </div>
          )}

          <div className="counter-visibility-setting">
            <div><strong>Show KPS counter</strong><span>Display the live one-second KPS value in every output.</span></div>
            <button
              className={settings.showKps ? "toggle on" : "toggle"}
              onClick={() => {
                const next = { ...settingsRef.current, showKps: !settingsRef.current.showKps };
                settingsRef.current = next;
                setSettings(next);
                void applySettingsMutation({
                  type: "setLayoutOptions",
                  patch: { showKps: next.showKps },
                });
              }}
              aria-pressed={settings.showKps}
              aria-label="Show KPS counter"
            >
              <span />
            </button>
          </div>

          {selectedKey ? (
            <div className="selected-key-settings">
              <div className="selected-key-title">
                <div><span>Selected key</span><strong>{selectedKey.label}</strong></div>
                <div className="selected-key-actions">
                  <button
                    type="button"
                    className="quiet-button"
                    ref={resetKeyButtonRef}
                    disabled={!selectedKeyHasCustomSettings}
                    onClick={() => setResetKeyConfirmationId(selectedKey.id)}
                  >
                    Reset settings
                  </button>
                  <button type="button" className="danger-button" onClick={() => removeKey(selectedKey.id)}>Remove</button>
                </div>
              </div>
              {resetKeyConfirmationId === selectedKey.id && (
                <div className="reset-key-confirmation" role="group" aria-label={`Confirm resetting settings for ${selectedKey.label}`}>
                  <div>
                    <strong>Reset this key?</strong>
                    <span>Its label, custom size, and appearance will return to defaults. Its position will stay the same.</span>
                  </div>
                  <div className="reset-key-confirmation-actions">
                    <button type="button" className="quiet-button" onClick={cancelResetSelectedKey}>Cancel</button>
                    <button type="button" className="danger-button" onClick={resetSelectedKeySettings} autoFocus>Reset key</button>
                  </div>
                </div>
              )}
              <label className="text-field">
                <span>Display label</span>
                <input
                  ref={selectedKeyLabelRef}
                  maxLength={14}
                  value={selectedKey.label}
                  onChange={(event) => updateSelectedKey({ label: event.target.value })}
                  onBlur={() => void commitSettingsMutations()}
                />
              </label>
              <label className="custom-size-toggle">
                <input
                  type="checkbox"
                  checked={selectedKey.width !== null || selectedKey.height !== null}
                  onChange={(event) => updateSelectedKey(event.target.checked
                    ? { width: settings.keySize, height: settings.keySize }
                    : { width: null, height: null }, true)}
                />
                <span>Use a custom size for this key</span>
              </label>
              {(selectedKey.width !== null || selectedKey.height !== null) && (
                <div className="dimension-grid">
                  <label>Width <input type="number" min="36" max="200" value={selectedKey.width ?? settings.keySize} onChange={(event) => updateSelectedKey({ width: clamp(Number(event.target.value), 36, 200) })} onBlur={() => void commitSettingsMutations()} /></label>
                  <label>Height <input type="number" min="36" max="200" value={selectedKey.height ?? settings.keySize} onChange={(event) => updateSelectedKey({ height: clamp(Number(event.target.value), 36, 200) })} onBlur={() => void commitSettingsMutations()} /></label>
                </div>
              )}
              <div className="key-appearance-setting">
                <div className="key-appearance-toggle-row">
                  <div>
                    <strong>Custom appearance</strong>
                    <span>Override this key only. Turn it off to follow the global style.</span>
                  </div>
                  <button
                    type="button"
                    className={selectedKey.appearance ? "toggle on" : "toggle"}
                    onClick={() => updateSelectedKey({
                      appearance: selectedKey.appearance
                        ? null
                        : appearanceFromSettings(settingsRef.current),
                    }, true)}
                    aria-pressed={selectedKey.appearance !== null}
                    aria-label="Use custom appearance for this key"
                  >
                    <span />
                  </button>
                </div>

                {selectedKey.appearance && (
                  <div className="key-appearance-controls">
                    <div className="key-appearance-heading">
                      <div>
                        <strong>Key colors</strong>
                        <span>Normal and pressed states</span>
                      </div>
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() => updateSelectedKey({
                          appearance: appearanceFromSettings(settingsRef.current),
                        }, true)}
                      >
                        Copy global style
                      </button>
                    </div>
                    <div className="key-color-grid">
                      <label className="key-color-setting"><span>Pressed accent</span><input type="color" value={selectedKey.appearance.accent} onChange={(event) => updateSelectedAppearance({ accent: event.target.value })} onBlur={() => void commitSettingsMutations()} /></label>
                      <label className="key-color-setting"><span>Key surface</span><input type="color" value={selectedKey.appearance.keyBackground} onChange={(event) => updateSelectedAppearance({ keyBackground: event.target.value })} onBlur={() => void commitSettingsMutations()} /></label>
                      <label className="key-color-setting"><span>Key text</span><input type="color" value={selectedKey.appearance.keyText} onChange={(event) => updateSelectedAppearance({ keyText: event.target.value })} onBlur={() => void commitSettingsMutations()} /></label>
                      <label className="key-color-setting"><span>Key border</span><input type="color" value={selectedKey.appearance.keyBorder} onChange={(event) => updateSelectedAppearance({ keyBorder: event.target.value })} onBlur={() => void commitSettingsMutations()} /></label>
                      <label className="key-color-setting"><span>Pressed text</span><input type="color" value={selectedKey.appearance.pressedText} onChange={(event) => updateSelectedAppearance({ pressedText: event.target.value })} onBlur={() => void commitSettingsMutations()} /></label>
                      <label className="key-color-setting"><span>Pressed border</span><input type="color" value={selectedKey.appearance.pressedBorder} onChange={(event) => updateSelectedAppearance({ pressedBorder: event.target.value })} onBlur={() => void commitSettingsMutations()} /></label>
                    </div>

                    <div className="key-appearance-group">
                      <div className="key-appearance-group-heading">
                        <strong>Type and shape</strong>
                        <span>Label, opacity, corners, and border</span>
                      </div>
                      <label className="preset-select" htmlFor="selected-key-font-preset">
                        <span>Font preset</span>
                        <select
                          id="selected-key-font-preset"
                          value={selectedKey.appearance.keyFontPreset}
                          onChange={(event) => updateSelectedAppearance({ keyFontPreset: event.target.value })}
                          onBlur={() => void commitSettingsMutations()}
                        >
                          {FONT_PRESETS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
                        </select>
                      </label>
                      <StyleRange id="selected-key-font-size" label="Label size" value={selectedKey.appearance.keyFontSize} min={8} max={64} suffix="px" onChange={(keyFontSize) => updateSelectedAppearance({ keyFontSize })} />
                      <StyleRange id="selected-key-font-weight" label="Label weight" value={selectedKey.appearance.keyFontWeight} min={400} max={900} step={50} suffix="" onChange={(keyFontWeight) => updateSelectedAppearance({ keyFontWeight })} />
                      <StyleRange id="selected-key-opacity" label="Overlay opacity" value={Math.round(selectedKey.appearance.keyOpacity * 100)} min={35} max={100} suffix="%" onChange={(keyOpacity) => updateSelectedAppearance({ keyOpacity: keyOpacity / 100 })} />
                      <StyleRange id="selected-key-radius" label="Corner radius" value={selectedKey.appearance.keyRadius} min={0} max={24} suffix="px" onChange={(keyRadius) => updateSelectedAppearance({ keyRadius })} />
                      <StyleRange id="selected-key-border-width" label="Border thickness" value={selectedKey.appearance.keyBorderWidth} min={0} max={8} suffix="px" onChange={(keyBorderWidth) => updateSelectedAppearance({ keyBorderWidth })} />
                    </div>

                    <div className="key-appearance-group">
                      <div className="key-appearance-group-heading">
                        <strong>Press response</strong>
                        <span>Motion and fast-tap visibility</span>
                      </div>
                      <StyleRange id="selected-key-press-depth" label="Press depth" value={selectedKey.appearance.pressDepth} min={0} max={16} suffix="px" onChange={(pressDepth) => updateSelectedAppearance({ pressDepth })} />
                      <StyleRange id="selected-key-press-scale" label="Pressed scale" value={selectedKey.appearance.pressScale} min={90} max={105} suffix="%" onChange={(pressScale) => updateSelectedAppearance({ pressScale })} />
                      <StyleRange id="selected-key-animation" label="Animation duration" value={selectedKey.appearance.pressAnimationMs} min={0} max={250} step={10} suffix="ms" onChange={(pressAnimationMs) => updateSelectedAppearance({ pressAnimationMs })} />
                      <StyleRange id="selected-key-highlight" label="Minimum highlight" value={selectedKey.appearance.minimumHighlightMs} min={0} max={250} step={10} suffix="ms" onChange={(minimumHighlightMs) => updateSelectedAppearance({ minimumHighlightMs })} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : <div className="no-selection">Select a configured key to edit or remove it.</div>}
        </div>

        <div className="editor-settings-card key-capture-card">
          <div className="card-heading">
            <div>
              <strong>Add a key</strong>
              <span>{capturingKey ? "Press the key you want to add." : "Add any supported physical keyboard key."}</span>
            </div>
            <button
              className={capturingKey ? "listen-button listening" : "listen-button"}
              onClick={() => {
                setCapturingKey(!capturingKey);
                setEditorMessage(capturingKey ? "Key capture cancelled." : "Press any supported key. Click Listening to cancel.");
              }}
              aria-pressed={capturingKey}
            >
              {capturingKey ? "Listening…" : "Press a key"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type ProfilesPanelProps = {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
};

export function ProfilesPanel({ settings, setSettings }: ProfilesPanelProps) {
  const [profileMessage, setProfileMessage] = useState("Create a profile to keep a dedicated setup for a game.");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [processNameDraft, setProcessNameDraft] = useState("");
  const newProfileButtonRef = useRef<HTMLButtonElement>(null);
  const removeProfileButtonRef = useRef<HTMLButtonElement>(null);
  const displayedProfileId = settings.activeProfileId ?? settings.profiles[0]?.id ?? null;
  const displayedProfile = settings.profiles.find((profile) => profile.id === displayedProfileId) ?? null;

  useEffect(() => {
    setPendingDeleteId(null);
    setProfileNameDraft(displayedProfile?.name ?? "");
    setProcessNameDraft(displayedProfile?.processName ?? "");
  }, [displayedProfileId]);

  const persist = (next: AppSettings, mutation: SettingsMutation, immediate = false) => {
    setSettings(next);
    if (immediate) void applySettingsMutation(mutation);
    else scheduleSettingsMutation(mutation);
  };

  const createProfile = () => {
    void applySettingsMutation({
      type: "createProfile",
      name: "New game",
      processName: "",
    });
    setProfileMessage("Add the game's executable name to enable auto-switching.");
  };

  const activateProfile = async (profileId: string) => {
    try {
      await applySettingsMutation({ type: "activateProfile", id: profileId });
      setProfileMessage("Profile activated. Layout settings now follow this game.");
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const updateProfile = (changes: Partial<GameProfile>, immediate = false) => {
    if (!displayedProfile) return;
    const profiles = settings.profiles.map((profile) => profile.id === displayedProfile.id ? { ...profile, ...changes } : profile);
    persist(
      { ...settings, profiles },
      {
        type: "updateProfileDetails",
        id: displayedProfile.id,
        ...("name" in changes ? { name: changes.name } : {}),
        ...("processName" in changes ? { processName: changes.processName } : {}),
      },
      immediate,
    );
  };

  const commitProfileName = () => {
    const name = finalizeProfileName(profileNameDraft);
    setProfileNameDraft(name);
    updateProfile({ name }, true);
  };

  const commitProcessName = () => {
    const processName = finalizeProcessName(processNameDraft);
    setProcessNameDraft(processName);
    updateProfile({ processName }, true);
  };

  const deleteProfile = () => {
    if (!displayedProfile) return;
    if (pendingDeleteId !== displayedProfile.id) {
      setPendingDeleteId(displayedProfile.id);
      setProfileMessage(`Remove “${displayedProfile.name}”? This cannot be undone.`);
      return;
    }
    const profiles = settings.profiles.filter((profile) => profile.id !== displayedProfile.id);
    // Preserve the active id through the save so the backend can detect its removal
    // and restore the internal default layout before clearing the id.
    persist(
      { ...settings, profiles },
      { type: "deleteProfile", id: displayedProfile.id },
      true,
    );
    setPendingDeleteId(null);
    setProfileMessage("Profile removed. The current setup remains active until another profile is selected.");
    window.requestAnimationFrame(() => newProfileButtonRef.current?.focus());
  };

  const cancelProfileDelete = () => {
    setPendingDeleteId(null);
    setProfileMessage("Removal cancelled.");
    window.requestAnimationFrame(() => removeProfileButtonRef.current?.focus());
  };

  const toggleAutoSwitch = () => {
    const enabled = !settings.profileAutoSwitch;
    persist(
      { ...settings, profileAutoSwitch: enabled },
      { type: "setProfileAutoSwitch", enabled },
      true,
    );
  };

  return (
    <section className="control-panel profiles-panel" id="profiles-section">
      <div className="section-heading compact-heading">
        <div><span className="section-kicker">PROFILES</span><h2>One setup for every game</h2></div>
        <button ref={newProfileButtonRef} className="quiet-button" onClick={() => void createProfile()}>New profile</button>
      </div>
      <div className="profiles-intro">
        <span className="profile-status-mark" aria-hidden="true">⌁</span>
        <span>Profiles remember the active layout, key sizes, accent and KPS position. Assign an executable name to switch automatically.</span>
      </div>
      <div className="profiles-layout">
        <div className="profile-list" aria-label="Game profiles">
          {settings.profiles.map((profile) => (
            <button
              className={profile.id === settings.activeProfileId ? "profile-list-item active" : "profile-list-item"}
              key={profile.id}
              onClick={() => void activateProfile(profile.id)}
            >
              <span className="profile-list-dot" aria-hidden="true" />
              <span className="profile-list-copy"><strong>{profile.name}</strong><small>{profile.processName || "No executable assigned"}</small></span>
              <span className="profile-list-state">{profile.id === settings.activeProfileId ? "Active" : "Use"}</span>
            </button>
          ))}
          {settings.profiles.length === 0 && <div className="profile-empty">No game profiles yet.</div>}
        </div>
        <div className="profile-editor">
          {displayedProfile ? (
            <>
              <div className="card-heading">
                <div><strong>Profile details</strong><span role="status" aria-live="polite">{profileMessage}</span></div>
                <div className="profile-delete-actions">
                  {pendingDeleteId === displayedProfile.id && (
                    <button
                      className="quiet-button"
                      onClick={cancelProfileDelete}
                    >
                      Cancel
                    </button>
                  )}
                  <button ref={removeProfileButtonRef} className="danger-button" onClick={deleteProfile}>
                    {pendingDeleteId === displayedProfile.id ? "Confirm removal" : "Remove"}
                  </button>
                </div>
              </div>
              <div className="profile-field-grid">
                <label className="text-field">
                  <span>Profile name</span>
                  <input
                    value={profileNameDraft}
                    onChange={(event) => setProfileNameDraft(event.target.value)}
                    onBlur={commitProfileName}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </label>
                <label className="text-field">
                  <span>Executable name</span>
                  <input
                    value={processNameDraft}
                    placeholder="game.exe"
                    onChange={(event) => setProcessNameDraft(event.target.value)}
                    onBlur={commitProcessName}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </label>
              </div>
              <div className="profile-auto-row">
                <div><strong>Auto-switch profiles</strong><span>{settings.profileAutoSwitch ? "KPS will match the active Windows executable." : "Profiles only change when you select them."}</span></div>
                <button className={settings.profileAutoSwitch ? "toggle on" : "toggle"} onClick={toggleAutoSwitch} aria-pressed={settings.profileAutoSwitch} aria-label="Auto-switch profiles"><span /></button>
              </div>
              <div className="profile-footnote">Edit the layout below while this profile is active. Changes are saved to it automatically.</div>
            </>
          ) : (
            <div className="profile-empty large"><strong>Start with a game profile</strong><span>Use “New profile” to copy the current layout and assign it to a game.</span></div>
          )}
        </div>
      </div>
    </section>
  );
}

type AppearancePanelProps = {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
};

type StyleRangeProps = {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
};

function StyleRange({ id, label, value, min, max, step = 1, suffix, onChange }: StyleRangeProps) {
  return (
    <div className="style-range">
      <label htmlFor={id}><span>{label}</span><output>{value}{suffix}</output></label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={() => void commitSettingsMutations()}
        onKeyUp={() => void commitSettingsMutations()}
        onBlur={() => void commitSettingsMutations()}
      />
    </div>
  );
}

export function AppearancePanel({ settings, setSettings }: AppearancePanelProps) {
  const [resetStyleConfirmation, setResetStyleConfirmation] = useState(false);
  const [appearanceMessage, setAppearanceMessage] = useState("");
  const resetStyleButtonRef = useRef<HTMLButtonElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    setResetStyleConfirmation(false);
    setAppearanceMessage("");
  }, [settings.activeProfileId]);

  const updateAppearance = (changes: AppearancePatch) => {
    const next = { ...settings, ...changes };
    setSettings(next);
    scheduleSettingsMutation({ type: "setGlobalAppearance", patch: changes });
    setAppearanceMessage("");
  };

  const resetAppearance = () => {
    const next = { ...settings, ...DEFAULT_APPEARANCE };
    setSettings(next);
    void applySettingsMutation({ type: "resetGlobalAppearance" });
    setResetStyleConfirmation(false);
    setAppearanceMessage("Global style restored to defaults.");
    window.requestAnimationFrame(() => resetStyleButtonRef.current?.focus());
  };

  const cancelResetAppearance = () => {
    setResetStyleConfirmation(false);
    window.requestAnimationFrame(() => resetStyleButtonRef.current?.focus());
  };

  const previewVisualStyle = outputVisualStyle(settings, "overlay");
  const previewKeyStyle = {
    width: `${settings.keySize}px`,
    height: `${settings.keySize}px`,
    ...previewVisualStyle,
  } as CSSProperties;
  const previewKpsStyle = {
    width: `${KPS_WIDTH}px`,
    height: `${KPS_HEIGHT}px`,
    ...previewVisualStyle,
  } as CSSProperties;
  const keyContrast = contrastAcrossGameBackdrops(settings.keyText, settings.keyBackground, settings.keyOpacity);
  const pressedContrast = contrastRatio(settings.pressedText, settings.accent);
  const contrastPasses = keyContrast.worst >= 4.5 && pressedContrast >= 4.5;

  return (
    <section className="control-panel appearance-panel" id="appearance-section">
      <div className="section-heading compact-heading">
        <div className="appearance-heading-copy">
          <span className="section-kicker">STYLE</span>
          <h2>Shape the signal</h2>
          {appearanceMessage && <span className="panel-status" role="status" aria-live="polite">{appearanceMessage}</span>}
        </div>
        {resetStyleConfirmation ? (
          <div className="clear-keys-confirmation" role="group" aria-label="Confirm resetting the global style">
            <span>Reset all global style settings?</span>
            <button type="button" className="quiet-button" onClick={cancelResetAppearance}>Cancel</button>
            <button type="button" className="danger-button" onClick={resetAppearance} autoFocus>Reset global style</button>
          </div>
        ) : (
          <button ref={resetStyleButtonRef} className="quiet-button" onClick={() => setResetStyleConfirmation(true)}>Reset style</button>
        )}
      </div>
      <div className="appearance-layout">
        <div className="appearance-controls">
          <div className="appearance-color-grid">
            <label className="color-setting"><span><strong>Pressed accent</strong><small>Active key and focus signal</small></span><input type="color" value={settings.accent} onChange={(event) => updateAppearance({ accent: event.target.value })} onBlur={() => void commitSettingsMutations()} aria-label="Pressed accent color" /></label>
            <label className="color-setting"><span><strong>Key surface</strong><small>Unpressed key fill</small></span><input type="color" value={settings.keyBackground} onChange={(event) => updateAppearance({ keyBackground: event.target.value })} onBlur={() => void commitSettingsMutations()} aria-label="Key surface color" /></label>
            <label className="color-setting"><span><strong>Key text</strong><small>Label contrast</small></span><input type="color" value={settings.keyText} onChange={(event) => updateAppearance({ keyText: event.target.value })} onBlur={() => void commitSettingsMutations()} aria-label="Key text color" /></label>
            <label className="color-setting"><span><strong>Key border</strong><small>Edge definition</small></span><input type="color" value={settings.keyBorder} onChange={(event) => updateAppearance({ keyBorder: event.target.value })} onBlur={() => void commitSettingsMutations()} aria-label="Key border color" /></label>
            <label className="color-setting"><span><strong>Pressed text</strong><small>Label on an active key</small></span><input type="color" value={settings.pressedText} onChange={(event) => updateAppearance({ pressedText: event.target.value })} onBlur={() => void commitSettingsMutations()} aria-label="Pressed key text color" /></label>
            <label className="color-setting"><span><strong>Pressed border</strong><small>Active key edge</small></span><input type="color" value={settings.pressedBorder} onChange={(event) => updateAppearance({ pressedBorder: event.target.value })} onBlur={() => void commitSettingsMutations()} aria-label="Pressed key border color" /></label>
          </div>
          <div className="appearance-slider-row">
            <label htmlFor="key-opacity"><span>Overlay key opacity</span><output>{Math.round(settings.keyOpacity * 100)}%</output></label>
            <input id="key-opacity" type="range" min="35" max="100" value={Math.round(settings.keyOpacity * 100)} onChange={(event) => updateAppearance({ keyOpacity: Number(event.target.value) / 100 })} onPointerUp={() => void commitSettingsMutations()} onKeyUp={() => void commitSettingsMutations()} onBlur={() => void commitSettingsMutations()} />
          </div>
          <div className="appearance-slider-row">
            <label htmlFor="key-radius"><span>Corner radius</span><output>{settings.keyRadius}px</output></label>
            <input id="key-radius" type="range" min="0" max="24" value={settings.keyRadius} onChange={(event) => updateAppearance({ keyRadius: Number(event.target.value) })} onPointerUp={() => void commitSettingsMutations()} onKeyUp={() => void commitSettingsMutations()} onBlur={() => void commitSettingsMutations()} />
          </div>
          <div className={contrastPasses ? "contrast-status passes" : "contrast-status warning"} role="status">
            <span className="contrast-status-mark" aria-hidden="true">{contrastPasses ? "✓" : "!"}</span>
            <div>
              <strong>{contrastPasses ? "Readable color pairing" : "Increase key contrast"}</strong>
              <span>Worst-case labels {keyContrast.worst.toFixed(1)}:1 · Active labels {pressedContrast.toFixed(1)}:1</span>
              <small>Dark scenes {keyContrast.onDark.toFixed(1)}:1 · Bright scenes {keyContrast.onBright.toFixed(1)}:1</small>
            </div>
          </div>
        </div>
        <div className="style-preview" aria-label="Key style preview">
          <div className="style-preview-heading"><span>OUTPUT PREVIEW</span><small>Unpressed / active</small></div>
          <div className="style-preview-stage output-key-preview overlay">
            <div className="style-preview-samples">
              <div className="keycap" style={previewKeyStyle}><span>A</span></div>
              <div className="keycap is-pressed" style={previewKeyStyle}><span>S</span></div>
              <div className="kps-readout" style={previewKpsStyle}>
                <span className="kps-value">12</span><span className="kps-label">KPS</span>
              </div>
            </div>
          </div>
          <p>Colors apply to both outputs. OBS keeps key surfaces opaque so Chroma Key can remove the background cleanly.</p>
        </div>
      </div>
      <div className="style-control-groups">
        <div className="style-control-group">
          <div className="style-control-heading"><h3>Key labels</h3><p>Keep short and long labels legible at the chosen key size.</p></div>
          <label className="preset-select" htmlFor="key-font-preset">
            <span>Font preset</span>
            <select id="key-font-preset" value={settings.keyFontPreset} onChange={(event) => updateAppearance({ keyFontPreset: event.target.value })} onBlur={() => void commitSettingsMutations()}>
              {FONT_PRESETS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
            </select>
          </label>
          <StyleRange id="key-font-size" label="Label size" value={settings.keyFontSize} min={8} max={48} suffix="px" onChange={(keyFontSize) => updateAppearance({ keyFontSize })} />
          <StyleRange id="key-font-weight" label="Label weight" value={settings.keyFontWeight} min={400} max={900} step={50} suffix="" onChange={(keyFontWeight) => updateAppearance({ keyFontWeight })} />
          <StyleRange id="key-border-width" label="Border thickness" value={settings.keyBorderWidth} min={0} max={8} suffix="px" onChange={(keyBorderWidth) => updateAppearance({ keyBorderWidth })} />
        </div>

        <div className="style-control-group">
          <div className="style-control-heading"><h3>KPS counter</h3><p>Typography is independent from the key labels.</p></div>
          <label className="preset-select" htmlFor="kps-font-preset">
            <span>Font preset</span>
            <select id="kps-font-preset" value={settings.kpsFontPreset} onChange={(event) => updateAppearance({ kpsFontPreset: event.target.value })} onBlur={() => void commitSettingsMutations()}>
              {FONT_PRESETS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
            </select>
          </label>
          <StyleRange id="kps-value-size" label="Number size" value={settings.kpsValueSize} min={12} max={96} suffix="px" onChange={(kpsValueSize) => updateAppearance({ kpsValueSize })} />
          <StyleRange id="kps-label-size" label="KPS label size" value={settings.kpsLabelSize} min={7} max={28} suffix="px" onChange={(kpsLabelSize) => updateAppearance({ kpsLabelSize })} />
          <StyleRange id="kps-font-weight" label="Counter weight" value={settings.kpsFontWeight} min={400} max={900} step={50} suffix="" onChange={(kpsFontWeight) => updateAppearance({ kpsFontWeight })} />
        </div>

        <div className="style-control-group">
          <div className="style-control-heading"><h3>Press response</h3><p>Tune movement and visibility for fast rhythm inputs.</p></div>
          {prefersReducedMotion && (
            <div className="reduced-motion-notice" role="status">
              <strong>Windows animation effects are off</strong>
              <span>Press depth, pressed scale, and animation duration will not change the output. Turn on Animation effects in Windows Accessibility &gt; Visual effects to use them.</span>
            </div>
          )}
          <StyleRange id="press-depth" label="Press depth" value={settings.pressDepth} min={0} max={12} suffix="px" onChange={(pressDepth) => updateAppearance({ pressDepth })} />
          <StyleRange id="press-scale" label="Pressed scale" value={settings.pressScale} min={90} max={105} suffix="%" onChange={(pressScale) => updateAppearance({ pressScale })} />
          <StyleRange id="press-animation" label="Animation duration" value={settings.pressAnimationMs} min={0} max={200} step={10} suffix="ms" onChange={(pressAnimationMs) => updateAppearance({ pressAnimationMs })} />
          <StyleRange id="minimum-highlight" label="Minimum highlight" value={settings.minimumHighlightMs} min={0} max={150} step={10} suffix="ms" onChange={(minimumHighlightMs) => updateAppearance({ minimumHighlightMs })} />
          <p className="minimum-highlight-note">Keeps quick taps visible for at least this long. At 0 ms, KPS still shows every detected press for one brief visual pulse.</p>
        </div>
      </div>
    </section>
  );
}

type ObsSetupGuideProps = {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
};

function ObsSetupGuide({ settings, setSettings }: ObsSetupGuideProps) {
  const [copyMessage, setCopyMessage] = useState("Copy");
  const colorValueRef = useRef<HTMLInputElement>(null);
  const colorConflict = obsKeyColorConflicts(settings.obsKeyColor, [
    settings.accent,
    settings.keyBackground,
    settings.keyText,
    settings.keyBorder,
    settings.pressedText,
    settings.pressedBorder,
  ]);

  const updateObsKeyColor = (value: string) => {
    const next = { ...settings, obsKeyColor: value.toUpperCase() };
    setSettings(next);
    scheduleSettingsMutation({ type: "setObsColor", color: next.obsKeyColor });
    setCopyMessage("Copy");
  };

  const copyObsKeyColor = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(settings.obsKeyColor);
      setCopyMessage("Copied");
    } catch {
      colorValueRef.current?.focus();
      colorValueRef.current?.select();
      setCopyMessage("Select the value");
    }
  };

  return (
    <section className="obs-setup" aria-labelledby="obs-setup-title">
      <div className="obs-setup-heading">
        <div>
          <span className="obs-setup-badge">ONE-TIME SETUP</span>
          <h3 id="obs-setup-title">Connect the OBS window</h3>
          <p>OBS removes this solid chroma color and keeps only your keys and KPS counter.</p>
        </div>
        <div className="obs-key-color-control">
          <label htmlFor="obs-key-color">Removal color</label>
          <div>
            <input
              id="obs-key-color"
              className="color-input"
              type="color"
              value={settings.obsKeyColor}
              onChange={(event) => updateObsKeyColor(event.target.value)}
              onBlur={() => void commitSettingsMutations()}
              aria-label="OBS removal color"
            />
            <input
              ref={colorValueRef}
              className="obs-key-color-value"
              value={settings.obsKeyColor}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              aria-label="OBS removal color hexadecimal value"
            />
            <button type="button" className="obs-copy-color" onClick={() => void copyObsKeyColor()}>
              {copyMessage}
            </button>
          </div>
          <small>RGB {formatRgb(settings.obsKeyColor)}</small>
        </div>
      </div>

      {colorConflict && (
        <div className="obs-color-warning" role="alert">
          <span aria-hidden="true">!</span>
          <p><strong>Choose a more distinct color.</strong> OBS may remove parts of the current key palette too.</p>
        </div>
      )}

      <ol className="obs-setup-steps">
        <li><span>1</span><p>In OBS, add <strong>Window Capture</strong> and select <strong>KPS OBS Output</strong>.</p></li>
        <li><span>2</span><p>Set <strong>Capture Method</strong> to <strong>Windows 10 (1903 and up)</strong>, then uncheck <strong>Capture Cursor</strong>.</p></li>
        <li><span>3</span><p>Set <strong>Window Match Priority</strong> to <strong>Window title must match</strong>.</p></li>
        <li><span>4</span><p>Right-click that source, open <strong>Filters</strong>, then add the <strong>Chroma Key</strong> effect filter.</p></li>
        <li><span>5</span><p>Set <strong>Key Color Type</strong> to <strong>Green</strong>. If you choose <strong>Custom</strong>, enter <code>{settings.obsKeyColor}</code>.</p></li>
        <li><span>6</span><p>Start <strong>Similarity</strong> at <strong>1</strong>. Raise until green disappears; modify Smoothness and Spill Reduction as needed.</p></li>
      </ol>

      <p className="obs-setup-note">
        Keep the KPS OBS Output window open while streaming. It can stay behind other windows, but do not minimize it. KPS restores it after restart if it was open when you closed the app.
      </p>
    </section>
  );
}

function ControlPanel() {
  const [settingsState, setSettingsState] = useState<AppSettings | null>(null);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState(EMPTY_RUNTIME);
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [editingOutputs, setEditingOutputs] = useState(false);
  const [outputError, setOutputError] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"capture" | "click-through" | "target-filter" | "output-mode" | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updateState, setUpdateState] = useState<"idle" | "checking" | "available" | "downloading" | "installing" | "error">("idle");
  const [updateMessage, setUpdateMessage] = useState("Check for updates");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<SettingsSaveStatus>({ state: "idle", message: "Settings ready" });
  const captureErrorRef = useRef<string | null>(null);
  const settingsRef = useRef<AppSettings | null>(null);
  const settingsRevisionRef = useRef(0);
  const closingAppRef = useRef(false);
  const settings = settingsState ?? DEFAULT_SETTINGS;
  const setSettings: Dispatch<SetStateAction<AppSettings>> = (update) => {
    setSettingsState((current) => {
      if (!current) return current;
      return typeof update === "function"
        ? (update as (previous: AppSettings) => AppSettings)(current)
        : update;
    });
  };
  const selectedLabel = useMemo(() => settings.layoutKeys.length === 0 ? "No keys selected" : `${settings.layoutKeys.length} keys in layout`, [settings.layoutKeys]);
  settingsRef.current = settingsState;

  const acceptSettingsSnapshot = (snapshot: SettingsSnapshot) => {
    if (!shouldAcceptSettingsRevision(settingsRevisionRef.current, snapshot.revision)) return;
    settingsRevisionRef.current = snapshot.revision;
    settingsRef.current = snapshot.settings;
    setSettingsState(snapshot.settings);
  };

  const closeApp = async () => {
    if (closingAppRef.current) return;
    closingAppRef.current = true;
    setControlError(null);
    try {
      await commitSettingsMutations();
      await invoke<void>("exit_app");
    } catch (error) {
      closingAppRef.current = false;
      const message = error instanceof Error ? error.message : String(error);
      setControlError(`Could not save settings before closing: ${message}. Try closing again.`);
    }
  };

  useEffect(() => subscribeSettingsSaveStatus(setSettingsSaveStatus), []);

  useEffect(() => {
    const load = async () => {
      try {
        const [saved, info, current] = await Promise.all([
          invoke<SettingsSnapshot>("get_settings_snapshot"),
          command<RuntimeInfo>("get_runtime_info"),
          command<KeyStateSnapshot>("get_last_snapshot"),
        ]);
        acceptSettingsSnapshot(saved);
        setOutputsOpen(saved.settings.outputWindowsOpen);
        if (info) setRuntime(info);
        if (current) {
          captureErrorRef.current = current.error;
          setCaptureError(current.error);
        }
        setSettingsLoadError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[KPS] settings load failed", error);
        setSettingsLoadError(message);
      }
    };
    void load();
    let unlistenKeys: (() => void) | undefined;
    let unlistenOutputs: (() => void) | undefined;
    let unlistenEditMode: (() => void) | undefined;
    let unlistenSettings: (() => void) | undefined;
    let unlistenCloseRequest: (() => void) | undefined;
    void listen<KeyStateSnapshot>("key-state", (event) => {
      if (captureErrorRef.current === event.payload.error) return;
      captureErrorRef.current = event.payload.error;
      setCaptureError(event.payload.error);
    }).then((fn) => { unlistenKeys = fn; });
    void listen<boolean>("output-visibility", (event) => setOutputsOpen(event.payload)).then((fn) => { unlistenOutputs = fn; });
    void listen<boolean>("output-edit-mode", (event) => setEditingOutputs(event.payload)).then((fn) => { unlistenEditMode = fn; });
    void listen<SettingsSnapshot>("settings-changed", (event) => {
      acceptSettingsSnapshot(event.payload);
    }).then((fn) => { unlistenSettings = fn; });
    const unsubscribeSnapshots = subscribeSettingsSnapshots(acceptSettingsSnapshot);
    void listen("app-close-requested", () => { void closeApp(); }).then((fn) => { unlistenCloseRequest = fn; });
    return () => {
      unlistenKeys?.();
      unlistenOutputs?.();
      unlistenEditMode?.();
      unlistenSettings?.();
      unlistenCloseRequest?.();
      unsubscribeSnapshots();
    };
  }, []);

  const toggleCapture = async () => {
    const enabled = !settings.captureEnabled;
    setPendingAction("capture");
    const error = await commandChecked("set_capture", { enabled });
    setPendingAction(null);
    if (error) {
      setControlError(`Could not ${enabled ? "start" : "stop"} capture: ${error}`);
      return;
    }
    setControlError(null);
    setSettings((current) => ({ ...current, captureEnabled: enabled }));
  };

  const changeMode = async (outputMode: OutputMode) => {
    const next = { ...settings, outputMode };
    setPendingAction("output-mode");
    const error = await commandChecked("set_output_mode", { mode: outputMode });
    if (error) {
      const saved = await command<SettingsSnapshot>("get_settings_snapshot");
      if (saved) acceptSettingsSnapshot(saved);
      setOutputError(error);
      setPendingAction(null);
      return;
    }
    setPendingAction(null);
    setSettings(next);
    setOutputError(null);
    if (outputMode === "off") {
      setOutputsOpen(false);
      setEditingOutputs(false);
      await commandChecked("set_output_visibility", { open: false });
    }
  };

  const handleOutputModeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const nextIndex = nextRadioIndex(event.key, currentIndex, OUTPUT_MODE_OPTIONS.length);
    if (nextIndex === null) return;
    event.preventDefault();
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons?.[nextIndex]?.focus();
    void changeMode(OUTPUT_MODE_OPTIONS[nextIndex][0]);
  };

  const toggleOutputs = async () => {
    if (!outputsOpen && settings.outputMode === "off") return;
    const open = !outputsOpen;
    const error = await commandChecked("set_output_visibility", { open });
    if (error) {
      setOutputError(error);
      return;
    }
    setOutputError(null);
    setOutputsOpen(open);
    if (!open) setEditingOutputs(false);
  };

  const toggleOutputEditing = async () => {
    if (settings.outputMode === "off") return;
    const enabled = !editingOutputs;
    const error = await commandChecked("set_output_edit_mode", { enabled });
    if (error) {
      setOutputError(error);
      return;
    }
    setOutputError(null);
    setEditingOutputs(enabled);
    if (enabled) setOutputsOpen(true);
  };

  const toggleClickThrough = async () => {
    const clickThrough = !settings.clickThrough;
    setPendingAction("click-through");
    const error = await commandChecked("set_click_through", { clickThrough });
    if (error) {
      const saved = await command<SettingsSnapshot>("get_settings_snapshot");
      if (saved) acceptSettingsSnapshot(saved);
      setControlError(`Could not change click-through: ${error}`);
      setPendingAction(null);
      return;
    }
    setPendingAction(null);
    setControlError(null);
    setSettings((current) => ({ ...current, clickThrough }));
  };

  const toggleTargetFilter = async () => {
    const processName = settings.targetProcess?.trim() || null;
    const enabled = !settings.showWhenTargetActive && Boolean(processName);
    setPendingAction("target-filter");
    const error = await commandChecked("set_target_filter", { enabled, processName });
    setPendingAction(null);
    if (error) {
      setControlError(`Could not change the game filter: ${error}`);
      return;
    }
    setControlError(null);
    setSettings((current) => ({ ...current, showWhenTargetActive: enabled, targetProcess: processName }));
  };

  const updateTargetProcess = (value: string) => {
    setSettings({ ...settings, targetProcess: value || null, showWhenTargetActive: false });
  };

  const persistTargetProcess = async () => {
    const processName = settings.targetProcess?.trim() || null;
    const error = await commandChecked("set_target_filter", { enabled: false, processName });
    if (error) {
      setControlError(`Could not save the target executable: ${error}`);
      return;
    }
    setControlError(null);
    setSettings((current) => ({ ...current, targetProcess: processName, showWhenTargetActive: false }));
  };

  const checkForUpdates = async () => {
    setUpdateState("checking");
    setUpdateMessage("Checking…");
    setUpdateError(null);
    try {
      const update = await check();
      if (!update) {
        setAvailableUpdate(null);
        setUpdateState("idle");
        setUpdateMessage("KPS is up to date");
        return;
      }
      setAvailableUpdate(update);
      setUpdateState("available");
      setUpdateMessage(`Update ${update.version} ready`);
    } catch (error) {
      console.error("[KPS] update check failed", error);
      setAvailableUpdate(null);
      setUpdateState("error");
      setUpdateMessage("Update check failed");
      setUpdateError(updaterErrorMessage(error));
    }
  };

  const installUpdate = async () => {
    if (!availableUpdate) return;
    setUpdateState("downloading");
    setUpdateMessage(`Downloading ${availableUpdate.version}…`);
    setUpdateError(null);
    try {
      await availableUpdate.download();
      setUpdateState("installing");
      setUpdateMessage(`Installing ${availableUpdate.version}…`);
      await commitSettingsMutations();
      const prepared = await invoke<SettingsSnapshot>("prepare_update", {
        targetVersion: availableUpdate.version,
      });
      acceptSettingsSnapshot(prepared);
      await availableUpdate.install();
    } catch (error) {
      console.error("[KPS] update install failed", error);
      setUpdateState("error");
      setUpdateMessage("Update installation failed");
      setUpdateError(updaterErrorMessage(error));
    }
  };

  const updateAction = () => {
    if (updateState === "available") {
      void installUpdate();
    } else {
      void checkForUpdates();
    }
  };

  if (!settingsState) {
    return (
      <div className="app-shell">
        <header className="titlebar">
          <div className="titlebar-context"><StatusDot active={false} /><span>Loading settings</span></div>
          <div className="titlebar-tools">
            <span className="app-version" aria-label={`KPS version ${APP_VERSION}`}>v{APP_VERSION}</span>
            <button className="update-button" disabled><span>Updates</span></button>
          </div>
        </header>
        <main className="settings-loading" aria-busy={!settingsLoadError}>
          {settingsLoadError ? (
            <div className="error-banner" role="alert">
              <span>!</span>
              <div className="error-banner-body">
                <strong>KPS could not load your settings</strong>
                <p>{settingsLoadError}</p>
                <p>KPS will not replace your file with defaults. Close the app and preserve the settings recovery files before trying again.</p>
              </div>
            </div>
          ) : (
            <p>Loading your saved layouts and profiles…</p>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="titlebar-context"><StatusDot active={settings.captureEnabled} /><span>{settings.captureEnabled ? "Capture is live" : "Capture is paused"}</span></div>
        <div className="titlebar-tools">
          <span className="app-version" aria-label={`KPS version ${APP_VERSION}`}>v{APP_VERSION}</span>
          <span className={`update-status ${updateState}`} aria-live="polite">{updateMessage}</span>
          <button className="update-button" onClick={updateAction} disabled={updateState === "checking" || updateState === "downloading" || updateState === "installing"}>
            <span className="update-button-mark" aria-hidden="true">↻</span>
            <span>{updateState === "available" ? "Install update" : "Updates"}</span>
          </button>
        </div>
      </header>
      <div className="shell-content">
        <main
          className={updateState === "installing" ? "main-content is-installing" : "main-content"}
          aria-busy={updateState === "installing"}
        >
          <section className="hero-row">
            <div>
              <span className="kicker">STREAMING TOOL / WINDOWS</span>
              <h1>Your input,<br /><em>made visible.</em></h1>
              <p className="hero-copy">A focused keyboard visualizer for rhythm games. Configure once, then let the keys speak for themselves.</p>
            </div>
            <div className="hero-actions">
            <button className={settings.captureEnabled ? "capture-button live" : "capture-button"} onClick={() => void toggleCapture()} disabled={pendingAction !== null} aria-busy={pendingAction === "capture"}>
              <span className="capture-button-icon">{settings.captureEnabled ? "■" : "▶"}</span>
              <span>{pendingAction === "capture" ? "Applying…" : settings.captureEnabled ? "Stop capture" : "Start capture"}</span>
              <span className="button-arrow">↗</span>
            </button>
            <button
              className={outputsOpen ? "quick-output-button open" : "quick-output-button"}
              onClick={() => void toggleOutputs()}
              disabled={settings.outputMode === "off"}
              title={settings.outputMode === "off" ? "Choose an output mode below first" : undefined}
            >
              <StatusDot active={outputsOpen} />
              <span>{outputsOpen ? "Close output" : "Open output"}</span>
              <span className="quick-output-arrow" aria-hidden="true">↗</span>
            </button>
            </div>
          </section>

          {updateError && (
            <div className="error-banner update-error-banner" role="alert">
              <span>!</span>
              <div className="error-banner-body">
                <strong>{updateMessage}</strong>
                <code className="update-error-detail">{updateError}</code>
                <div className="error-recovery">
                  <p>Try the update again. If it still fails, install the MSI manually and share these details.</p>
                  <button type="button" className="error-retry-button" onClick={updateAction}>Retry update</button>
                </div>
              </div>
            </div>
          )}
          {runtime.settingsWarning && (
            <div className="error-banner" role="status">
              <span>!</span>
              <div className="error-banner-body">
                <strong>Settings recovery notice</strong>
                <p>{runtime.settingsWarning}</p>
              </div>
            </div>
          )}
          {(captureError || controlError) && <div className="error-banner" role="alert"><span>!</span><div className="error-banner-body"><strong>KPS needs attention</strong><p>{controlError ?? captureError}</p></div></div>}

          <section className="control-grid">
            <div className="control-panel layout-panel" id="layout-section">
              <div className="section-heading compact-heading"><div><span className="section-kicker">LAYOUT</span><h2>Build your key layout</h2></div><span className="muted-meta">{selectedLabel}</span></div>
              <div className="direct-edit-card">
                <div className="direct-edit-copy">
                  <span className="direct-edit-icon" aria-hidden="true">↗</span>
                  <div>
                    <strong>Edit on the real output</strong>
                    <span>Resize the output window, then drag keys and KPS exactly where viewers will see them.</span>
                  </div>
                </div>
                <button
                  className={editingOutputs ? "direct-edit-button active" : "direct-edit-button"}
                  onClick={() => void toggleOutputEditing()}
                  disabled={settings.outputMode === "off"}
                >
                  {settings.outputMode === "off" ? "Choose an output first" : editingOutputs ? "Finish editing" : "Edit output layout"}
                </button>
              </div>
              <LayoutEditor settings={settings} setSettings={setSettings} />
            </div>
            <ProfilesPanel settings={settings} setSettings={setSettings} />
            <AppearancePanel settings={settings} setSettings={setSettings} />
            <div className="control-panel output-panel" id="output-section">
              <div className="section-heading compact-heading"><div><span className="section-kicker">OUTPUT</span><h2>Where should it appear?</h2></div></div>
              <div className="mode-list" role="radiogroup" aria-label="Output mode">
                {OUTPUT_MODE_OPTIONS.map(([mode, label, description], index) => (
                  <button className={settings.outputMode === mode ? "mode-option selected" : "mode-option"} key={mode} onClick={() => void changeMode(mode)} onKeyDown={(event) => handleOutputModeKeyDown(event, index)} role="radio" aria-checked={settings.outputMode === mode} tabIndex={settings.outputMode === mode ? 0 : -1} disabled={pendingAction !== null}>
                    <span className="mode-radio" aria-hidden="true" />
                    <span><strong>{label}</strong><small>{description}</small></span>
                  </button>
                ))}
              </div>
              <div className="output-action-row">
                <span>{editingOutputs ? "Drag keys inside each output; drag the top bar or focus it and use arrow keys to move the window" : outputsOpen ? "Output windows are open" : "Output windows are closed"}</span>
                <div className="output-buttons">
                  <button
                    className={editingOutputs ? "secondary-button active" : "secondary-button"}
                    onClick={() => void toggleOutputEditing()}
                    disabled={settings.outputMode === "off"}
                  >
                    {editingOutputs ? "Finish editing" : "Edit layout"}
                  </button>
                  <button className={outputsOpen ? "secondary-button active" : "secondary-button"} onClick={() => void toggleOutputs()} disabled={!outputsOpen && settings.outputMode === "off"}>{outputsOpen ? "Close windows" : "Open windows"}</button>
                </div>
              </div>
              {outputError && <div className="output-error" role="alert">Could not change output windows: {outputError}</div>}
              {(settings.outputMode === "obs" || settings.outputMode === "both") && (
                <ObsSetupGuide settings={settings} setSettings={setSettings} />
              )}
            </div>
          </section>

          <section className="footer-settings" id="privacy-section">
            <div className="setting-line"><div><strong>Click-through overlay</strong><span>Keep the game focused while the overlay is visible.</span></div><button className={settings.clickThrough ? "toggle on" : "toggle"} onClick={() => void toggleClickThrough()} disabled={pendingAction !== null} aria-pressed={settings.clickThrough} aria-label="Click-through overlay" aria-busy={pendingAction === "click-through"}><span /></button></div>
            <div className="target-setting"><div><strong>Show overlay only for this game</strong><span>Use the executable name, for example <code>osu!.exe</code>.</span></div><div className="target-controls"><input className="process-input" value={settings.targetProcess ?? ""} placeholder="game.exe" onChange={(event) => updateTargetProcess(event.target.value)} onBlur={(event) => {
              if ((event.relatedTarget as HTMLElement | null)?.dataset.targetFilterToggle === "true") return;
              void persistTargetProcess();
            }} aria-label="Target game executable" /><button className={settings.showWhenTargetActive ? "toggle on" : "toggle"} onClick={() => void toggleTargetFilter()} disabled={!settings.targetProcess?.trim() || pendingAction !== null} aria-pressed={settings.showWhenTargetActive} aria-label="Show overlay only for the target game" aria-busy={pendingAction === "target-filter"} data-target-filter-toggle="true"><span /></button></div></div>
          </section>

          <footer className="privacy-footer">
            <span className="privacy-icon">✓</span>
            <span><strong>Private by design.</strong> KPS observes selected physical keys in memory and never records, sends, or injects input.</span>
            <span className={`settings-save-status ${settingsSaveStatus.state}`} aria-live="polite">
              <span className="settings-save-dot" aria-hidden="true" />
              <span>{settingsSaveStatus.message}</span>
              {settingsSaveStatus.state === "error" && <button onClick={() => void retrySettingsSave()}>Retry</button>}
            </span>
            <span className="runtime-tag">{runtime.inputBackend} · offline</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const surface = windowSurface();
  return surface === "main" ? <ControlPanel /> : <OutputSurface surface={surface} />;
}
