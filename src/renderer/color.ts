export const DEFAULT_ITEM_COLOR = "#1F1B17";
export const DEFAULT_PRESENT_WIRE_COLOR = "#0F6A6D";
export const DEFAULT_ABSENT_WIRE_COLOR = "#C85D2D";

export const COLOR_SWATCHES = [
  "#1F1B17",
  "#C85D2D",
  "#0F6A6D",
  "#234E70",
  "#3C6E47",
  "#8E4A7C",
  "#B33939",
  "#D7A33C"
];

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

export function toTikzRgb(color: string): string {
  const { red, green, blue } = hexToRgb(color);
  return `{rgb,255:red,${red};green,${green};blue,${blue}}`;
}
