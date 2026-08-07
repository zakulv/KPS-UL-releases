import type { LayoutKey, LayoutPreset, LayoutPresetKey } from "./types";

function presetKey(
  physicalCode: string,
  label: string,
  x: number,
  y: number,
  width: number | null = null,
  height: number | null = null,
): LayoutPresetKey {
  return { physicalCode, label, x, y, width, height };
}

const rhythm8Keys = [
  ["KeyA", "A"],
  ["KeyS", "S"],
  ["KeyD", "D"],
  ["KeyF", "F"],
  ["KeyJ", "J"],
  ["KeyK", "K"],
  ["KeyL", "L"],
  ["Semicolon", ";"],
] as const;

export const LAYOUT_PRESETS: readonly LayoutPreset[] = [
  {
    id: "rhythm-8k",
    name: "8-key rhythm",
    description: "The original balanced two-hand layout for eight-key rhythm play.",
    category: "Rhythm",
    keySize: 100,
    kpsX: 50,
    kpsY: 90,
    keys: rhythm8Keys.map(([physicalCode, label], index) => presetKey(
      physicalCode,
      label,
      (100 / (rhythm8Keys.length - 1)) * index,
      50,
    )),
  },
  {
    id: "osu-mania-4k",
    name: "Mania 4K",
    description: "Four centered lanes using the standard D, F, J and K bindings.",
    category: "Rhythm",
    keySize: 100,
    kpsX: 50,
    kpsY: 90,
    keys: [
      presetKey("KeyD", "D", 30, 50),
      presetKey("KeyF", "F", 43.33, 50),
      presetKey("KeyJ", "J", 56.67, 50),
      presetKey("KeyK", "K", 70, 50),
    ],
  },
  {
    id: "osu-mania-7k",
    name: "Mania 7K",
    description: "Seven symmetrical bindings with a wider Space key on a lower center row.",
    category: "Rhythm",
    keySize: 100,
    kpsX: 72.72727272727273,
    kpsY: 77.82100936292925,
    keys: [
      presetKey("KeyS", "S", 8.88888888888889, 45.55808497685374),
      presetKey("KeyD", "D", 22.22222222222222, 45.55808497685374),
      presetKey("KeyF", "F", 35.55555555555556, 45.55808497685374),
      presetKey("Space", "SPACE", 46.51162790697674, 79.72664870949404, 140, 100),
      presetKey("KeyJ", "J", 57.77777777777777, 45.55808497685374),
      presetKey("KeyK", "K", 71.11111111111111, 45.55808497685374),
      presetKey("KeyL", "L", 84.44444444444444, 45.55808497685374),
    ],
  },
  {
    id: "wasd-movement",
    name: "WASD movement",
    description: "Movement essentials with jump, sprint and crouch controls.",
    category: "Movement",
    keySize: 100,
    kpsX: 100,
    kpsY: 100,
    keys: [
      presetKey("KeyW", "W", 17.77777777777778, 22.77904248842687),
      presetKey("KeyA", "A", 4.444444444444445, 56.94760622106717),
      presetKey("KeyS", "S", 17.77777777777778, 56.94760622106717),
      presetKey("KeyD", "D", 31.11111111111111, 56.94760622106717),
      presetKey("ShiftLeft", "L SHIFT", 5, 100, 140, 100),
      presetKey("ControlLeft", "L CTRL", 23, 100, 120, 100),
      presetKey("Space", "SPACE", 48, 100, 180, 100),
    ],
  },
] as const;

export function materializeLayoutPreset(
  preset: LayoutPreset,
  currentLayout: readonly LayoutKey[] = [],
): LayoutKey[] {
  const currentAppearances = new Map(
    currentLayout.map((key) => [key.physicalCode, key.appearance] as const),
  );

  return preset.keys.map((key) => {
    const appearance = currentAppearances.get(key.physicalCode);
    return {
      id: `key-${key.physicalCode}`,
      ...key,
      appearance: appearance ? { ...appearance } : null,
    };
  });
}
