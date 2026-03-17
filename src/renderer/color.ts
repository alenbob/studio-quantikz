export const DEFAULT_ITEM_COLOR = "#1F1B17";
export const DEFAULT_PRESENT_WIRE_COLOR = "#0F6A6D";
export const DEFAULT_ABSENT_WIRE_COLOR = "#C85D2D";

export const COLOR_SWATCHES = [
  "#000000",
  "#FF0000",
  "#0000FF",
  "#00FF00"
];

const LATEX_NAMED_COLOR_BY_HEX: Record<string, string> = {
  "#000000": "black",
  "#FF0000": "red",
  "#0000FF": "blue",
  "#00FF00": "green"
};

const HEX_BY_LATEX_NAMED_COLOR: Record<string, string> = {
  black: "#000000",
  red: "#FF0000",
  blue: "#0000FF",
  green: "#00FF00"
};

export function normalizeHexColor(color: string | null | undefined): string | null {
  if (!color) {
    return null;
  }

  const normalized = color.trim();
  if (!normalized) {
    return null;
  }

  const prefixed = normalized.startsWith("#") ? normalized : `#${normalized}`;
  if (/^#[0-9a-fA-F]{3}$/.test(prefixed)) {
    const [, red, green, blue] = prefixed;
    return `#${red}${red}${green}${green}${blue}${blue}`.toUpperCase();
  }

  if (/^#[0-9a-fA-F]{6}$/.test(prefixed)) {
    return prefixed.toUpperCase();
  }

  return null;
}

export function hexToRgb(color: string): { red: number; green: number; blue: number } {
  const normalized = normalizeHexColor(color) ?? DEFAULT_ITEM_COLOR;

  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16)
  };
}

export function hexToRgba(color: string, alpha: number): string {
  const { red, green, blue } = hexToRgb(color);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function mixHexWithWhite(color: string, amount = 0.88): string {
  const { red, green, blue } = hexToRgb(color);
  const clampAmount = Math.min(1, Math.max(0, amount));
  const mix = (channel: number) =>
    Math.round((channel * (1 - clampAmount)) + (255 * clampAmount))
      .toString(16)
      .padStart(2, "0");

  return `#${mix(red)}${mix(green)}${mix(blue)}`.toUpperCase();
}

export function toLatexNamedColor(color: string): string | null {
  const normalized = normalizeHexColor(color);
  return normalized ? (LATEX_NAMED_COLOR_BY_HEX[normalized] ?? null) : null;
}

export function latexNamedColorToHex(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  return HEX_BY_LATEX_NAMED_COLOR[normalized] ?? null;
}

export function toTikzRgb(color: string): string {
  const { red, green, blue } = hexToRgb(color);
  return `{rgb,255:red,${red};green,${green};blue,${blue}}`;
}

export function toTikzColor(color: string): string {
  return toLatexNamedColor(color) ?? toTikzRgb(color);
}

export function toLatexColorCommand(color: string): string {
  const namedColor = toLatexNamedColor(color);
  if (namedColor) {
    return `\\color{${namedColor}}`;
  }

  const { red, green, blue } = hexToRgb(color);
  return `\\color[RGB]{${red},${green},${blue}}`;
}
