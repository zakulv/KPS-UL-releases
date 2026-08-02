import { invoke } from "@tauri-apps/api/core";
import type { SettingsMutation, SettingsSnapshot } from "./types";

export type SettingsSaveStatus = {
  state: "idle" | "saving" | "saved" | "error";
  message: string;
};

type StatusListener = (status: SettingsSaveStatus) => void;
type SnapshotListener = (snapshot: SettingsSnapshot) => void;

const listeners = new Set<StatusListener>();
const snapshotListeners = new Set<SnapshotListener>();
let status: SettingsSaveStatus = { state: "idle", message: "Settings ready" };
let queued: SettingsMutation[] = [];
let failed: SettingsMutation[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let drainPromise: Promise<SettingsSnapshot | null> | null = null;

function setStatus(next: SettingsSaveStatus) {
  status = next;
  listeners.forEach((listener) => listener(status));
}

function publishSnapshot(snapshot: SettingsSnapshot) {
  snapshotListeners.forEach((listener) => listener(snapshot));
}

function coalescingKey(mutation: SettingsMutation) {
  switch (mutation.type) {
    case "setGlobalAppearance":
    case "setLayoutOptions":
    case "moveKps":
    case "setProfileAutoSwitch":
    case "setOutputMode":
    case "setObsColor":
    case "setClickThrough":
    case "setTargetFilter":
      return mutation.type;
    case "setKeyLabel":
    case "setKeySize":
    case "clearKeySize":
    case "moveKey":
    case "setKeyAppearance":
    case "updateKeyAppearance":
    case "updateProfileDetails":
      return `${mutation.type}:${mutation.id}`;
    default:
      // Creation, deletion, reset, and activation operations are ordered actions.
      // Collapsing them can silently discard an intentional user action.
      return null;
  }
}

function mergeMutation(current: SettingsMutation, next: SettingsMutation): SettingsMutation {
  if (current.type === "setGlobalAppearance" && next.type === "setGlobalAppearance") {
    return { ...next, patch: { ...current.patch, ...next.patch } };
  }
  if (current.type === "updateKeyAppearance" && next.type === "updateKeyAppearance") {
    return { ...next, patch: { ...current.patch, ...next.patch } };
  }
  if (current.type === "setLayoutOptions" && next.type === "setLayoutOptions") {
    return { ...next, patch: { ...current.patch, ...next.patch } };
  }
  if (current.type === "updateProfileDetails" && next.type === "updateProfileDetails") {
    return { ...current, ...next };
  }
  return next;
}

function enqueue(mutation: SettingsMutation) {
  restoreFailedMutations();
  const key = coalescingKey(mutation);
  if (!key) {
    queued.push(mutation);
    return;
  }
  const existingIndex = queued.findIndex((item) => coalescingKey(item) === key);
  if (existingIndex >= 0) {
    queued[existingIndex] = mergeMutation(queued[existingIndex], mutation);
  } else {
    queued.push(mutation);
  }
}

function restoreFailedMutations() {
  if (failed.length === 0) return;
  queued = [...failed, ...queued];
  failed = [];
}

async function drain(): Promise<SettingsSnapshot | null> {
  if (drainPromise) return drainPromise;
  drainPromise = (async () => {
    let latest: SettingsSnapshot | null = null;
    while (queued.length > 0) {
      const mutation = queued.shift()!;
      try {
        latest = await invoke<SettingsSnapshot>("apply_settings_mutation", { mutation });
        publishSnapshot(latest);
      } catch (error) {
        failed = [mutation, ...queued];
        queued = [];
        const message = error instanceof Error ? error.message : String(error);
        setStatus({ state: "error", message: `Settings were not saved: ${message}` });
        throw error;
      }
    }
    failed = [];
    setStatus({ state: "saved", message: "Settings saved" });
    return latest;
  })();
  try {
    return await drainPromise;
  } finally {
    drainPromise = null;
  }
}

export function scheduleSettingsMutation(mutation: SettingsMutation) {
  enqueue(mutation);
  setStatus({ state: "saving", message: "Saving settings…" });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void drain().catch(() => undefined);
  }, 120);
}

export async function commitSettingsMutations(mutation?: SettingsMutation) {
  if (mutation) enqueue(mutation);
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queued.length === 0 && !drainPromise) {
    const snapshot = await invoke<SettingsSnapshot>("flush_settings");
    publishSnapshot(snapshot);
    return snapshot;
  }
  setStatus({ state: "saving", message: "Saving settings…" });
  return drain();
}

export async function applySettingsMutation(mutation: SettingsMutation) {
  return commitSettingsMutations(mutation);
}

export async function retrySettingsSave() {
  if (failed.length === 0) return null;
  restoreFailedMutations();
  setStatus({ state: "saving", message: "Retrying settings save…" });
  return drain();
}

export function subscribeSettingsSaveStatus(listener: StatusListener) {
  listeners.add(listener);
  listener(status);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeSettingsSnapshots(listener: SnapshotListener) {
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
}
