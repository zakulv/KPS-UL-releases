const FORWARD_RADIO_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const BACKWARD_RADIO_KEYS = new Set(["ArrowLeft", "ArrowUp"]);
const WINDOW_MOVE_DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function nextRadioIndex(key: string, currentIndex: number, optionCount: number) {
  if (optionCount <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return optionCount - 1;
  if (FORWARD_RADIO_KEYS.has(key)) return (currentIndex + 1) % optionCount;
  if (BACKWARD_RADIO_KEYS.has(key)) return (currentIndex - 1 + optionCount) % optionCount;
  return null;
}

export function windowMoveDelta(key: string, accelerated = false) {
  const direction = WINDOW_MOVE_DIRECTIONS[key];
  if (!direction) return null;
  const step = accelerated ? 50 : 10;
  return [direction[0] * step, direction[1] * step] as const;
}

export function shouldAcceptSettingsRevision(currentRevision: number, incomingRevision: number) {
  return incomingRevision >= currentRevision;
}

export function finalizeProfileName(value: string) {
  return value.trim() || "Untitled profile";
}

export function finalizeProcessName(value: string) {
  return value.trim();
}

function normalizeDiagnosticMessage(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function updaterErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const message = normalizeDiagnosticMessage(error.message);
    if (message) return message;
  }
  if (typeof error === "string") {
    const message = normalizeDiagnosticMessage(error);
    if (message) return message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      const normalized = normalizeDiagnosticMessage(message);
      if (normalized) return normalized;
    }
  }
  if (error !== undefined && error !== null) {
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Fall through to the stable recovery message.
    }
  }
  return "The updater did not provide diagnostic details.";
}

function hexChannels(hex: string) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return [0, 0, 0] as const;
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ] as const;
}

export function formatRgb(hex: string) {
  const [red, green, blue] = hexChannels(hex);
  return `${red}, ${green}, ${blue}`;
}

export function obsKeyColorConflicts(keyColor: string, palette: readonly string[]) {
  const keyChannels = hexChannels(keyColor);
  return palette.some((color) => {
    const channels = hexChannels(color);
    const distance = Math.sqrt(channels.reduce(
      (sum, channel, index) => sum + ((channel - keyChannels[index]) ** 2),
      0,
    ));
    return distance < 96;
  });
}

export const MINIMUM_VISIBLE_PRESS_MS = 34;

export function remainingMinimumHighlightMs(startedAt: number, now: number, minimumMs: number) {
  const effectiveMinimumMs = Math.max(MINIMUM_VISIBLE_PRESS_MS, minimumMs);
  return Math.max(0, effectiveMinimumMs - Math.max(0, now - startedAt));
}

const NAMED_PHYSICAL_KEY_LABELS: Readonly<Record<string, string>> = {
  Escape: "ESC",
  Tab: "TAB",
  CapsLock: "CAPS",
  Backspace: "BACKSPACE",
  Enter: "ENTER",
  Space: "SPACE",
  ShiftLeft: "L SHIFT",
  ShiftRight: "R SHIFT",
  ControlLeft: "L CTRL",
  ControlRight: "R CTRL",
  AltLeft: "L ALT",
  AltRight: "R ALT",
  MetaLeft: "L WIN",
  MetaRight: "R WIN",
  ContextMenu: "MENU",
  ArrowLeft: "LEFT",
  ArrowDown: "DOWN",
  ArrowUp: "UP",
  ArrowRight: "RIGHT",
  Home: "HOME",
  End: "END",
  PageUp: "PG UP",
  PageDown: "PG DN",
  Insert: "INS",
  Delete: "DEL",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Comma: ",",
  Period: ".",
  Slash: "/",
  PrintScreen: "PRT SC",
  ScrollLock: "SCR LK",
  Pause: "PAUSE",
  NumLock: "NUM",
  NumpadDivide: "NUM /",
  NumpadMultiply: "NUM *",
  NumpadSubtract: "NUM -",
  NumpadAdd: "NUM +",
  NumpadEnter: "NUM ENTER",
  NumpadDecimal: "NUM .",
};

export function physicalKeyLabel(physicalCode: string) {
  const letter = /^Key([A-Z])$/.exec(physicalCode);
  if (letter) return letter[1];

  const digit = /^Digit([0-9])$/.exec(physicalCode);
  if (digit) return digit[1];

  const functionKey = /^F([1-9]|1[0-2])$/.exec(physicalCode);
  if (functionKey) return `F${functionKey[1]}`;

  const numpadDigit = /^Numpad([0-9])$/.exec(physicalCode);
  if (numpadDigit) return `NUM ${numpadDigit[1]}`;

  return NAMED_PHYSICAL_KEY_LABELS[physicalCode] ?? null;
}

function luminance(channels: readonly number[]) {
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastBetweenChannels(foreground: readonly number[], background: readonly number[]) {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function composite(foreground: readonly number[], background: readonly number[], alpha: number) {
  return foreground.map((channel, index) => Math.round(
    (channel * alpha) + (background[index] * (1 - alpha)),
  ));
}

export function rgba(hex: string, alpha: number) {
  const [red, green, blue] = hexChannels(hex);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function contrastRatio(foreground: string, background: string) {
  return contrastBetweenChannels(hexChannels(foreground), hexChannels(background));
}

export function contrastAcrossGameBackdrops(text: string, surface: string, opacity: number) {
  const textChannels = hexChannels(text);
  const surfaceChannels = hexChannels(surface);
  const onDark = contrastBetweenChannels(
    textChannels,
    composite(surfaceChannels, [0, 0, 0], opacity),
  );
  const onBright = contrastBetweenChannels(
    textChannels,
    composite(surfaceChannels, [255, 255, 255], opacity),
  );
  return {
    onDark,
    onBright,
    worst: Math.min(onDark, onBright),
  };
}
