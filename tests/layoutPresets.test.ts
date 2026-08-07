import assert from "node:assert/strict";
import test from "node:test";
import { LAYOUT_PRESETS, materializeLayoutPreset } from "../src/layoutPresets.ts";
import type { KeyAppearance, LayoutKey } from "../src/types.ts";

const expectedMappings = new Map([
  ["rhythm-8k", ["KeyA", "KeyS", "KeyD", "KeyF", "KeyJ", "KeyK", "KeyL", "Semicolon"]],
  ["osu-mania-4k", ["KeyD", "KeyF", "KeyJ", "KeyK"]],
  ["osu-mania-7k", ["KeyS", "KeyD", "KeyF", "Space", "KeyJ", "KeyK", "KeyL"]],
  ["wasd-movement", ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ControlLeft", "Space"]],
]);

test("the initial preset registry has stable IDs and exact physical mappings", () => {
  assert.deepEqual(LAYOUT_PRESETS.map((preset) => preset.id), [
    "rhythm-8k",
    "osu-mania-4k",
    "osu-mania-7k",
    "wasd-movement",
  ]);
  assert.deepEqual(LAYOUT_PRESETS.map((preset) => preset.name), [
    "8-key rhythm",
    "Mania 4K",
    "Mania 7K",
    "WASD movement",
  ]);

  for (const preset of LAYOUT_PRESETS) {
    assert.deepEqual(
      preset.keys.map((key) => key.physicalCode),
      expectedMappings.get(preset.id),
    );
  }
});

test("the WASD preset matches the copied movement profile geometry", () => {
  const preset = LAYOUT_PRESETS.find((item) => item.id === "wasd-movement");
  assert.ok(preset);
  assert.deepEqual(
    preset.keys.slice(0, 4).map(({ physicalCode, x, y }) => ({ physicalCode, x, y })),
    [
      { physicalCode: "KeyW", x: 17.77777777777778, y: 22.77904248842687 },
      { physicalCode: "KeyA", x: 4.444444444444445, y: 56.94760622106717 },
      { physicalCode: "KeyS", x: 17.77777777777778, y: 56.94760622106717 },
      { physicalCode: "KeyD", x: 31.11111111111111, y: 56.94760622106717 },
    ],
  );
});

test("every preset has unique supported geometry within backend limits", () => {
  assert.equal(new Set(LAYOUT_PRESETS.map((preset) => preset.id)).size, LAYOUT_PRESETS.length);

  for (const preset of LAYOUT_PRESETS) {
    assert.ok(preset.keys.length > 0);
    assert.ok(preset.keySize >= 36 && preset.keySize <= 200);
    assert.ok(preset.kpsX >= 0 && preset.kpsX <= 100);
    assert.ok(preset.kpsY >= 0 && preset.kpsY <= 100);
    assert.equal(new Set(preset.keys.map((key) => key.physicalCode)).size, preset.keys.length);
    for (const key of preset.keys) {
      assert.match(key.physicalCode, /^(Key[A-Z]|Semicolon|Space|ShiftLeft|ControlLeft)$/);
      assert.ok(key.label.trim().length > 0);
      assert.ok(key.x >= 0 && key.x <= 100);
      assert.ok(key.y >= 0 && key.y <= 100);
      if (key.width !== null) assert.ok(key.width >= 28 && key.width <= 200);
      if (key.height !== null) assert.ok(key.height >= 28 && key.height <= 200);
    }
  }
});

test("materializing a preset retains only matching per-key appearance", () => {
  const appearance: KeyAppearance = {
    accent: "#123456",
    keyBackground: "#20282D",
    keyText: "#FFFFFF",
    keyBorder: "#303B40",
    keyOpacity: 0.9,
    keyRadius: 8,
    keyBorderWidth: 1,
    pressedText: "#000000",
    pressedBorder: "#FFFFFF",
    keyFontPreset: "system",
    keyFontSize: 14,
    keyFontWeight: 700,
    pressDepth: 4,
    pressScale: 100,
    pressAnimationMs: 80,
    minimumHighlightMs: 34,
  };
  const currentLayout: LayoutKey[] = [{
    id: "custom-d",
    physicalCode: "KeyD",
    label: "CUSTOM",
    x: 99,
    y: 99,
    width: 180,
    height: 180,
    appearance,
  }];

  const materialized = materializeLayoutPreset(LAYOUT_PRESETS[1], currentLayout);
  const keyD = materialized.find((key) => key.physicalCode === "KeyD");
  const keyF = materialized.find((key) => key.physicalCode === "KeyF");

  assert.equal(keyD?.label, "D");
  assert.equal(keyD?.x, 30);
  assert.equal(keyD?.width, null);
  assert.deepEqual(keyD?.appearance, appearance);
  assert.notEqual(keyD?.appearance, appearance);
  assert.equal(keyF?.appearance, null);
});
