import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SettingsMutation, SettingsSnapshot } from "../src/types";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
}));

const snapshot: SettingsSnapshot = {
  revision: 1,
  settings: {} as SettingsSnapshot["settings"],
};

function profileMutation(): SettingsMutation {
  return { type: "createProfile", name: "New game", processName: "" };
}

function replacementMutation(): SettingsMutation {
  return {
    type: "replaceLayout",
    layoutKeys: [{
      id: "key-KeyD",
      physicalCode: "KeyD",
      label: "D",
      x: 50,
      y: 50,
      width: null,
      height: null,
      appearance: null,
    }],
    keySize: 100,
    kpsX: 50,
    kpsY: 90,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  tauriMocks.invoke.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("settings persistence queue", () => {
  test("keeps separate ordered actions while a save is in flight", async () => {
    let resolveFirst: ((value: SettingsSnapshot) => void) | undefined;
    tauriMocks.invoke
      .mockImplementationOnce(() => new Promise<SettingsSnapshot>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValue(snapshot);
    const persistence = await import("../src/settingsPersistence");

    const first = persistence.applySettingsMutation(profileMutation());
    const second = persistence.applySettingsMutation(profileMutation());
    resolveFirst?.(snapshot);

    await Promise.all([first, second]);

    expect(tauriMocks.invoke).toHaveBeenCalledTimes(2);
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(1, "apply_settings_mutation", {
      mutation: profileMutation(),
    });
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, "apply_settings_mutation", {
      mutation: profileMutation(),
    });
  });

  test("automatically retries failed work before a new mutation", async () => {
    tauriMocks.invoke
      .mockRejectedValueOnce(new Error("settings file is locked"))
      .mockResolvedValue(snapshot);
    const persistence = await import("../src/settingsPersistence");
    const first: SettingsMutation = { type: "setObsColor", color: "#00FF00" };
    const second: SettingsMutation = { type: "setClickThrough", enabled: true };

    persistence.scheduleSettingsMutation(first);
    await vi.advanceTimersByTimeAsync(120);
    persistence.scheduleSettingsMutation(second);
    await vi.advanceTimersByTimeAsync(120);

    expect(tauriMocks.invoke).toHaveBeenCalledTimes(3);
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(1, "apply_settings_mutation", { mutation: first });
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, "apply_settings_mutation", { mutation: first });
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(3, "apply_settings_mutation", { mutation: second });
  });

  test("keeps layout replacement ordered after pending edits", async () => {
    tauriMocks.invoke.mockResolvedValue(snapshot);
    const persistence = await import("../src/settingsPersistence");
    const edit: SettingsMutation = {
      type: "setLayoutOptions",
      patch: { keySize: 84 },
    };
    const replacement = replacementMutation();

    persistence.scheduleSettingsMutation(edit);
    await persistence.applySettingsMutation(replacement);

    expect(tauriMocks.invoke).toHaveBeenCalledTimes(2);
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(1, "apply_settings_mutation", { mutation: edit });
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, "apply_settings_mutation", { mutation: replacement });
  });
});
