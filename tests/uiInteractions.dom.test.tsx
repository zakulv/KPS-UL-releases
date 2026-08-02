import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AppearancePanel, DEFAULT_SETTINGS, LayoutEditor, OutputSurface, ProfilesPanel } from "../src/App";
import type { AppSettings, GameProfile } from "../src/types";

const appStyles = readFileSync("src/styles.css", "utf8");
const OUTPUT_PRESSED_RULE = appStyles.match(
  /\.output-canvas\s+\.keycap\.is-pressed\s*\{[^}]+\}/,
)?.[0] ?? "";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  outerPosition: vi.fn(),
  setPosition: vi.fn(),
  startDragging: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (
    eventName: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    tauriMocks.listeners.set(eventName, handler);
    return () => tauriMocks.listeners.delete(eventName);
  }),
}));

vi.mock("@tauri-apps/api/window", () => {
  class PhysicalPosition {
    type = "Physical";

    constructor(
      public x: number,
      public y: number,
    ) {}
  }

  return {
    PhysicalPosition,
    getCurrentWindow: () => ({
      label: "overlay",
      outerPosition: tauriMocks.outerPosition,
      setPosition: tauriMocks.setPosition,
      startDragging: tauriMocks.startDragging,
    }),
  };
});

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

function copySettings(): AppSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

function profileFromSettings(settings: AppSettings): GameProfile {
  return {
    id: "profile-test",
    name: "Test game",
    processName: "test.exe",
    selectedKeys: structuredClone(settings.selectedKeys),
    layoutKeys: structuredClone(settings.layoutKeys),
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
    kpsFontPreset: settings.kpsFontPreset,
    kpsValueSize: settings.kpsValueSize,
    kpsLabelSize: settings.kpsLabelSize,
    kpsFontWeight: settings.kpsFontWeight,
    pressDepth: settings.pressDepth,
    pressScale: settings.pressScale,
    pressAnimationMs: settings.pressAnimationMs,
    minimumHighlightMs: settings.minimumHighlightMs,
    keySize: settings.keySize,
    keyGap: settings.keyGap,
    showKps: settings.showKps,
    kpsX: settings.kpsX,
    kpsY: settings.kpsY,
    snapToGrid: settings.snapToGrid,
    gridSize: settings.gridSize,
  };
}

function LayoutHarness() {
  const [settings, setSettings] = useState(copySettings);
  return <LayoutEditor settings={settings} setSettings={setSettings} />;
}

function ProfilesHarness() {
  const [settings, setSettings] = useState(() => {
    const settings = copySettings();
    const profile = profileFromSettings(settings);
    return { ...settings, profiles: [profile], activeProfileId: profile.id };
  });
  return <ProfilesPanel settings={settings} setSettings={setSettings} />;
}

function AppearanceHarness() {
  const [settings, setSettings] = useState(() => ({ ...copySettings(), accent: "#123456" }));
  return <AppearancePanel settings={settings} setSettings={setSettings} />;
}

beforeEach(() => {
  const style = document.createElement("style");
  style.dataset.kpsTestStyles = "true";
  style.textContent = OUTPUT_PRESSED_RULE;
  document.head.append(style);
  tauriMocks.listeners.clear();
  tauriMocks.invoke.mockResolvedValue(null);
  tauriMocks.outerPosition.mockResolvedValue({ x: 100, y: 200 });
  tauriMocks.setPosition.mockResolvedValue(undefined);
  tauriMocks.startDragging.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  document.head.querySelectorAll("[data-kps-test-styles]").forEach((style) => style.remove());
});

describe("layout confirmation focus management", () => {
  test("reset-layout cancel and completion preserve focus and announce replacement", async () => {
    const user = userEvent.setup();
    render(<LayoutHarness />);

    const resetKeys = screen.getByRole("button", { name: "Reset keys" });
    await user.click(resetKeys);
    expect(screen.getByRole("button", { name: "Reset key layout" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset keys" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Reset keys" }));
    await user.click(screen.getByRole("button", { name: "Reset key layout" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Reset keys" })).toHaveFocus());
    expect(screen.getByText("Default key set restored. Replaced 8 configured keys.")).toHaveAttribute("role", "status");
    expect(tauriMocks.invoke).toHaveBeenCalledWith("apply_settings_mutation", {
      mutation: { type: "resetKeys" },
    });
  });

  test("clear-all cancel and completion place focus on a stable action", async () => {
    const user = userEvent.setup();
    render(<LayoutHarness />);

    const clearAll = screen.getByRole("button", { name: "Clear all" });
    await user.click(clearAll);
    expect(screen.getByRole("button", { name: "Clear all keys" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(clearAll).toHaveFocus());

    await user.click(clearAll);
    await user.click(screen.getByRole("button", { name: "Clear all keys" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Reset keys" })).toHaveFocus());
    expect(screen.getByText("Removed all 8 configured keys.")).toHaveAttribute("role", "status");
    expect(tauriMocks.invoke).toHaveBeenCalledWith("apply_settings_mutation", {
      mutation: { type: "clearKeys" },
    });
  });

  test("reset-key cancel returns to reset and completion returns to the label", async () => {
    const user = userEvent.setup();
    render(<LayoutHarness />);

    const labelInput = screen.getByRole("textbox", { name: "Display label" });
    await user.clear(labelInput);
    await user.type(labelInput, "Custom");
    await user.tab();

    const resetSettings = screen.getByRole("button", { name: "Reset settings" });
    await user.click(resetSettings);
    expect(screen.getByRole("button", { name: "Reset key" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(resetSettings).toHaveFocus());

    await user.click(resetSettings);
    await user.click(screen.getByRole("button", { name: "Reset key" }));

    await waitFor(() => expect(labelInput).toHaveFocus());
    expect(labelInput).toHaveValue("A");
    expect(screen.getByText("A now follows the global key settings.")).toHaveAttribute("role", "status");
  });
});

test("global-style reset requires confirmation and restores focus after cancel or completion", async () => {
  const user = userEvent.setup();
  render(<AppearanceHarness />);

  const accent = screen.getByLabelText("Pressed accent color");
  const resetStyle = screen.getByRole("button", { name: "Reset style" });
  expect(accent).toHaveValue("#123456");

  await user.click(resetStyle);
  expect(screen.getByRole("button", { name: "Reset global style" })).toHaveFocus();

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Reset style" })).toHaveFocus());
  expect(screen.getByLabelText("Pressed accent color")).toHaveValue("#123456");

  await user.click(screen.getByRole("button", { name: "Reset style" }));
  await user.click(screen.getByRole("button", { name: "Reset global style" }));

  await waitFor(() => expect(screen.getByRole("button", { name: "Reset style" })).toHaveFocus());
  expect(screen.getByLabelText("Pressed accent color")).toHaveValue("#d8ff5c");
  expect(screen.getByText("Global style restored to defaults.")).toHaveAttribute("role", "status");
  expect(tauriMocks.invoke).toHaveBeenCalledWith("apply_settings_mutation", {
    mutation: { type: "resetGlobalAppearance" },
  });

  fireEvent.change(screen.getByLabelText("Pressed accent color"), { target: { value: "#112233" } });
  expect(screen.queryByText("Global style restored to defaults.")).not.toBeInTheDocument();
});

test("appearance preview uses the output key renderer and configured key dimensions", () => {
  render(<AppearanceHarness />);

  const preview = screen.getByLabelText("Key style preview");
  const keys = preview.querySelectorAll(".keycap");
  expect(keys).toHaveLength(2);
  expect(keys[0]).toHaveStyle({ width: "100px", height: "100px" });
  expect(keys[0]).toHaveStyle("--key-radius: 12px");
  expect(keys[1]).toHaveClass("is-pressed");
  expect(preview.querySelector(".kps-readout")).toHaveStyle({ width: "120px", height: "40px" });
  expect(preview.querySelector(".style-preview-key")).toBeNull();
});

test("profile deletion cancellation and completion preserve keyboard context", async () => {
  const user = userEvent.setup();
  render(<ProfilesHarness />);

  const newProfile = screen.getByRole("button", { name: "New profile" });
  const remove = screen.getByRole("button", { name: "Remove" });
  await user.click(remove);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(remove).toHaveFocus());

  await user.click(remove);
  await user.click(screen.getByRole("button", { name: "Confirm removal" }));
  await waitFor(() => expect(newProfile).toHaveFocus());
});

test("the output toolbar moves a frameless window with keyboard arrows", async () => {
  const user = userEvent.setup();
  const settings = copySettings();
  tauriMocks.invoke.mockImplementation(async (name: string) => {
    if (name === "get_settings_snapshot") return { revision: 1, settings };
    if (name === "get_last_snapshot") {
      return {
        pressedKeys: [],
        kps: 0,
        timestampMs: Date.now(),
        captureActive: false,
        error: null,
      };
    }
    return null;
  });

  render(<OutputSurface surface="overlay" />);

  await waitFor(() => expect(tauriMocks.listeners.has("output-edit-mode")).toBe(true));
  act(() => {
    tauriMocks.listeners.get("output-edit-mode")?.({ payload: true });
  });

  const moveToolbar = await screen.findByRole("group", { name: /Move overlay window/ });
  moveToolbar.focus();
  await user.keyboard("{ArrowRight}");

  await waitFor(() => expect(tauriMocks.setPosition).toHaveBeenCalledTimes(1));
  expect(tauriMocks.setPosition.mock.calls[0][0]).toMatchObject({ x: 110, y: 200 });

  await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
  await waitFor(() => expect(tauriMocks.setPosition).toHaveBeenCalledTimes(2));
  expect(tauriMocks.setPosition.mock.calls[1][0]).toMatchObject({ x: 100, y: 150 });
});

test.each(["overlay", "obs"] as const)(
  "%s output renders global and per-key pressed colors after a physical press pulse",
  async (surface) => {
    const settings = copySettings();
    settings.accent = "#123456";
    settings.pressedText = "#FEDCBA";
    settings.pressedBorder = "#ABCDEF";
    settings.layoutKeys = settings.layoutKeys.slice(0, 2).map((key, index) => ({
      ...key,
      appearance: index === 0
        ? null
        : {
            accent: "#654321",
            keyBackground: "#111213",
            keyText: "#F0F1F2",
            keyBorder: "#212223",
            keyOpacity: 0.8,
            keyRadius: 8,
            keyBorderWidth: 3,
            pressedText: "#AABBCC",
            pressedBorder: "#CCDDEE",
            keyFontPreset: "compact",
            keyFontSize: 18,
            keyFontWeight: 800,
            pressDepth: 6,
            pressScale: 96,
            pressAnimationMs: 120,
            minimumHighlightMs: 70,
          },
    }));
    settings.selectedKeys = settings.layoutKeys.map((key) => key.physicalCode);

    tauriMocks.invoke.mockImplementation(async (name: string) => {
      if (name === "get_settings_snapshot") return { revision: 1, settings };
      if (name === "get_last_snapshot") {
        return {
          pressedKeys: [],
          kps: 0,
          timestampMs: Date.now(),
          captureActive: true,
          error: null,
        };
      }
      return null;
    });

    render(<OutputSurface surface={surface} />);

    await waitFor(() => expect(tauriMocks.listeners.has("key-press-pulse")).toBe(true));
    const globalKey = (await screen.findByText("A")).closest(".keycap");
    const customKey = (await screen.findByText("S")).closest(".keycap");
    expect(globalKey).not.toBeNull();
    expect(customKey).not.toBeNull();

    act(() => {
      tauriMocks.listeners.get("key-press-pulse")?.({
        payload: { physicalCode: "KeyA", timestampMs: Date.now() },
      });
      tauriMocks.listeners.get("key-press-pulse")?.({
        payload: { physicalCode: "KeyS", timestampMs: Date.now() },
      });
    });

    await waitFor(() => {
      expect(globalKey).toHaveClass("is-pressed");
      expect(customKey).toHaveClass("is-pressed");
    });

    expect((globalKey as HTMLElement).style.getPropertyValue("--accent")).toBe("#123456");
    expect((globalKey as HTMLElement).style.getPropertyValue("--pressed-text")).toBe("#FEDCBA");
    expect((globalKey as HTMLElement).style.getPropertyValue("--pressed-border")).toBe("#ABCDEF");
    expect((customKey as HTMLElement).style.getPropertyValue("--accent")).toBe("#654321");
    expect((customKey as HTMLElement).style.getPropertyValue("--pressed-text")).toBe("#AABBCC");
    expect((customKey as HTMLElement).style.getPropertyValue("--pressed-border")).toBe("#CCDDEE");

    expect(globalKey?.matches(".output-canvas .keycap.is-pressed")).toBe(true);
    expect(customKey?.matches(".output-canvas .keycap.is-pressed")).toBe(true);
    const pressedRule = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .find((rule) => "selectorText" in rule
        && (rule as CSSStyleRule).selectorText === ".output-canvas .keycap.is-pressed") as CSSStyleRule | undefined;
    expect(pressedRule).toBeDefined();
    expect(pressedRule?.style.getPropertyValue("background-color")).toBe("var(--accent)");
    expect(pressedRule?.style.getPropertyValue("color")).toBe("var(--pressed-text)");
    expect(pressedRule?.style.getPropertyValue("border-color")).toBe("var(--pressed-border)");
  },
);
