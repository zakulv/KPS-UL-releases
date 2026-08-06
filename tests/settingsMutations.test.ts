import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the frontend persistence queue stores mutations rather than settings documents", async () => {
  const source = await readFile(
    new URL("../src/settingsPersistence.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /let queued: SettingsMutation\[\] = \[\]/);
  assert.match(source, /let failed: SettingsMutation\[\] = \[\]/);
  assert.match(source, /apply_settings_mutation/);
  assert.doesNotMatch(source, /AppSettings|save_settings/);
});

test("high-frequency settings controls coalesce narrow patches", async () => {
  const source = await readFile(
    new URL("../src/settingsPersistence.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /current\.type === "setGlobalAppearance"/);
  assert.match(source, /current\.type === "updateKeyAppearance"/);
  assert.match(source, /current\.type === "setLayoutOptions"/);
  assert.match(source, /patch: \{ \.\.\.current\.patch, \.\.\.next\.patch \}/);
});

test("only latest-value mutations are coalesced", async () => {
  const source = await readFile(
    new URL("../src/settingsPersistence.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /function coalescingKey/);
  assert.match(source, /case "setGlobalAppearance":/);
  assert.match(source, /Creation, deletion, reset, and activation operations are ordered actions/);
  assert.match(source, /return null;/);
  assert.doesNotMatch(source, /case "replaceLayout":/);
});

test("failed mutations remain retryable without a frontend settings snapshot", async () => {
  const source = await readFile(
    new URL("../src/settingsPersistence.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /failed = \[mutation, \.\.\.queued\]/);
  assert.match(source, /function restoreFailedMutations/);
  assert.match(source, /queued = \[\.\.\.failed, \.\.\.queued\]/);
  assert.match(source, /restoreFailedMutations\(\);/);
  assert.match(source, /export async function retrySettingsSave/);
});
