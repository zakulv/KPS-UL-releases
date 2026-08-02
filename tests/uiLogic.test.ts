import assert from "node:assert/strict";
import test from "node:test";
import {
  contrastAcrossGameBackdrops,
  contrastRatio,
  finalizeProcessName,
  finalizeProfileName,
  formatRgb,
  MINIMUM_VISIBLE_PRESS_MS,
  nextRadioIndex,
  obsKeyColorConflicts,
  physicalKeyLabel,
  remainingMinimumHighlightMs,
  rgba,
  shouldAcceptSettingsRevision,
  updaterErrorMessage,
  windowMoveDelta,
} from "../src/uiLogic.ts";

test("settings revisions accept canonical equals/newer and reject stale events", () => {
  assert.equal(shouldAcceptSettingsRevision(7, 6), false);
  assert.equal(shouldAcceptSettingsRevision(7, 7), true);
  assert.equal(shouldAcceptSettingsRevision(7, 8), true);
});

test("radio navigation wraps in both directions", () => {
  assert.equal(nextRadioIndex("ArrowRight", 3, 4), 0);
  assert.equal(nextRadioIndex("ArrowDown", 1, 4), 2);
  assert.equal(nextRadioIndex("ArrowLeft", 0, 4), 3);
  assert.equal(nextRadioIndex("ArrowUp", 2, 4), 1);
});

test("radio navigation supports Home and End", () => {
  assert.equal(nextRadioIndex("Home", 2, 4), 0);
  assert.equal(nextRadioIndex("End", 1, 4), 3);
  assert.equal(nextRadioIndex("Enter", 1, 4), null);
});

test("output window keyboard movement uses precise and accelerated steps", () => {
  assert.deepEqual(windowMoveDelta("ArrowLeft"), [-10, 0]);
  assert.deepEqual(windowMoveDelta("ArrowDown"), [0, 10]);
  assert.deepEqual(windowMoveDelta("ArrowRight", true), [50, 0]);
  assert.deepEqual(windowMoveDelta("ArrowUp", true), [0, -50]);
  assert.equal(windowMoveDelta("Enter"), null);
});

test("contrast calculations include transparent dark and bright game backdrops", () => {
  const contrast = contrastAcrossGameBackdrops("#9BA7A8", "#20282D", 0.7);

  assert.ok(contrast.onDark > 4.5);
  assert.ok(contrast.onBright < 3);
  assert.equal(contrast.worst, contrast.onBright);
});

test("opaque color helpers remain deterministic", () => {
  assert.equal(rgba("#20282D", 0.92), "rgba(32, 40, 45, 0.92)");
  assert.equal(formatRgb("#FF00FF"), "255, 0, 255");
  assert.ok(contrastRatio("#182015", "#D8FF5C") > 4.5);
});

test("OBS removal color warns when it collides with the key palette", () => {
  assert.equal(
    obsKeyColorConflicts("#FF00FF", ["#D8FF5C", "#20282D", "#9BA7A8", "#303B40"]),
    false,
  );
  assert.equal(obsKeyColorConflicts("#D8FF5C", ["#D8FF5C"]), true);
  assert.equal(obsKeyColorConflicts("#FF10FF", ["#FF00FF"]), true);
});

test("minimum highlight timing guarantees a visible pulse at zero", () => {
  assert.equal(MINIMUM_VISIBLE_PRESS_MS, 34);
  assert.equal(remainingMinimumHighlightMs(100, 101, 0), 33);
  assert.equal(remainingMinimumHighlightMs(100, 134, 0), 0);
  assert.equal(remainingMinimumHighlightMs(100, 120, 60), 40);
  assert.equal(remainingMinimumHighlightMs(100, 180, 60), 0);
});

test("physical key capture creates concise labels without a catalog", () => {
  assert.equal(physicalKeyLabel("KeyA"), "A");
  assert.equal(physicalKeyLabel("Digit7"), "7");
  assert.equal(physicalKeyLabel("F12"), "F12");
  assert.equal(physicalKeyLabel("Numpad3"), "NUM 3");
  assert.equal(physicalKeyLabel("ShiftLeft"), "L SHIFT");
  assert.equal(physicalKeyLabel("Escape"), "ESC");
  assert.equal(physicalKeyLabel("AudioVolumeUp"), null);
});

test("profile text is normalized only when an edit is committed", () => {
  assert.equal(finalizeProfileName(""), "Untitled profile");
  assert.equal(finalizeProfileName("  My rhythm setup  "), "My rhythm setup");
  assert.equal(finalizeProcessName("  osu!.exe  "), "osu!.exe");
  assert.equal(finalizeProcessName(""), "");
});

test("updater failures retain useful diagnostic details", () => {
  assert.equal(
    updaterErrorMessage(new Error("signature verification failed")),
    "signature verification failed",
  );
  assert.equal(updaterErrorMessage("  network request timed out  "), "network request timed out");
  assert.equal(
    updaterErrorMessage({ message: "Windows Installer could not start" }),
    "Windows Installer could not start",
  );
  assert.equal(
    updaterErrorMessage({ code: "ERR_DOWNLOAD" }),
    '{"code":"ERR_DOWNLOAD"}',
  );
  assert.equal(
    updaterErrorMessage(null),
    "The updater did not provide diagnostic details.",
  );
});
