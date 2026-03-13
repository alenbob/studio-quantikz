import type { WireLabel, WireLabelBracket } from "./types";

export type WireLabelSide = "left" | "right";

const SPAN_KEYS = {
  left: "leftSpan",
  right: "rightSpan"
} as const;

const BRACKET_KEYS = {
  left: "leftBracket",
  right: "rightBracket"
} as const;

export interface WireLabelGroup {
  side: WireLabelSide;
  row: number;
  span: number;
  bracket: WireLabelBracket;
  text: string;
}

function spanKey(side: WireLabelSide): "leftSpan" | "rightSpan" {
  return SPAN_KEYS[side];
}

function bracketKey(side: WireLabelSide): "leftBracket" | "rightBracket" {
  return BRACKET_KEYS[side];
}

function emptyWireLabel(): WireLabel {
  return { left: "", right: "" };
}

export function getWireLabelSpan(label: WireLabel | undefined, side: WireLabelSide): number {
  const value = label?.[spanKey(side)];
  return Number.isFinite(value) && typeof value === "number" && value > 1 ? Math.round(value) : 1;
}

export function getWireLabelBracket(label: WireLabel | undefined, side: WireLabelSide): WireLabelBracket {
  return label?.[bracketKey(side)] ?? "none";
}

export function setWireLabelSpan(label: WireLabel, side: WireLabelSide, span: number): WireLabel {
  return {
    ...label,
    [spanKey(side)]: span > 1 ? span : 1
  };
}

export function setWireLabelBracket(
  label: WireLabel,
  side: WireLabelSide,
  bracket: WireLabelBracket
): WireLabel {
  return {
    ...label,
    [bracketKey(side)]: bracket
  };
}

export function createWireLabels(qubits: number): WireLabel[] {
  return Array.from({ length: qubits }, () => emptyWireLabel());
}

export function resizeWireLabels(labels: WireLabel[], qubits: number): WireLabel[] {
  const resized =
    labels.length >= qubits
      ? labels.slice(0, qubits)
      : [...labels, ...Array.from({ length: qubits - labels.length }, () => emptyWireLabel())];

  return normalizeWireLabels(resized, qubits);
}

export function normalizeWireLabels(labels: WireLabel[], qubits: number): WireLabel[] {
  const resized = resizeRawWireLabels(labels, qubits);

  for (const side of ["left", "right"] as const) {
    const spanProp = spanKey(side);
    const bracketProp = bracketKey(side);
    let coveredUntil = -1;

    for (let row = 0; row < qubits; row += 1) {
      const current = resized[row];
      if (row <= coveredUntil) {
        current[spanProp] = 1;
        current[bracketProp] = "none";
        continue;
      }

      const span = Math.min(Math.max(getWireLabelSpan(current, side), 1), qubits - row);
      current[spanProp] = span;
      current[bracketProp] = span > 1 ? getWireLabelBracket(current, side) : "none";
      coveredUntil = row + span - 1;
    }
  }

  return resized;
}

function resizeRawWireLabels(labels: WireLabel[], qubits: number): WireLabel[] {
  return Array.from({ length: qubits }, (_, row) => ({ ...(labels[row] ?? emptyWireLabel()) }));
}

export function findWireLabelGroupStart(
  labels: WireLabel[],
  row: number,
  side: WireLabelSide
): number {
  for (let index = 0; index <= Math.max(0, row); index += 1) {
    const span = getWireLabelSpan(labels[index], side);
    if (row <= index + span - 1) {
      return index;
    }
  }

  return Math.max(0, row);
}

export function getWireLabelGroup(
  labels: WireLabel[],
  row: number,
  side: WireLabelSide
): WireLabelGroup {
  const startRow = findWireLabelGroupStart(labels, row, side);
  const label = labels[startRow] ?? emptyWireLabel();

  return {
    side,
    row: startRow,
    span: getWireLabelSpan(label, side),
    bracket: getWireLabelBracket(label, side),
    text: label[side]
  };
}

export function isWireLabelGroupStart(
  labels: WireLabel[],
  row: number,
  side: WireLabelSide
): boolean {
  return findWireLabelGroupStart(labels, row, side) === row;
}

export function hasWireLabelBoundary(
  labels: WireLabel[],
  upperRow: number,
  side: WireLabelSide
): boolean {
  return findWireLabelGroupStart(labels, upperRow, side) !== findWireLabelGroupStart(labels, upperRow + 1, side);
}

export function updateWireLabelText(
  labels: WireLabel[],
  row: number,
  side: WireLabelSide,
  text: string,
  qubits: number
): WireLabel[] {
  const next = resizeRawWireLabels(labels, qubits);
  const startRow = findWireLabelGroupStart(next, row, side);
  next[startRow] = {
    ...next[startRow],
    [side]: text
  };
  return normalizeWireLabels(next, qubits);
}

export function updateWireLabelGroup(
  labels: WireLabel[],
  row: number,
  side: WireLabelSide,
  updates: { span?: number; bracket?: WireLabelBracket },
  qubits: number
): WireLabel[] {
  const next = resizeRawWireLabels(labels, qubits);
  const startRow = findWireLabelGroupStart(next, row, side);
  const targetSpan = Math.min(Math.max(updates.span ?? getWireLabelSpan(next[startRow], side), 1), qubits - startRow);
  const targetBracket =
    targetSpan > 1
      ? updates.bracket ?? getWireLabelBracket(next[startRow], side)
      : "none";

  next[startRow] = setWireLabelBracket(setWireLabelSpan(next[startRow], side, targetSpan), side, targetBracket);

  for (let index = startRow + 1; index < startRow + targetSpan; index += 1) {
    next[index] = setWireLabelBracket(setWireLabelSpan(next[index], side, 1), side, "none");
    next[index] = {
      ...next[index],
      [side]: ""
    };
  }

  return normalizeWireLabels(next, qubits);
}

export function mergeWireLabelGroups(
  labels: WireLabel[],
  upperRow: number,
  side: WireLabelSide,
  qubits: number
): WireLabel[] {
  if (upperRow < 0 || upperRow >= qubits - 1) {
    return normalizeWireLabels(labels, qubits);
  }

  const next = resizeRawWireLabels(labels, qubits);
  const upper = getWireLabelGroup(next, upperRow, side);
  const lower = getWireLabelGroup(next, upperRow + 1, side);
  if (upper.row === lower.row) {
    return normalizeWireLabels(next, qubits);
  }

  const mergedEnd = Math.max(upper.row + upper.span - 1, lower.row + lower.span - 1);
  const mergedSpan = mergedEnd - upper.row + 1;
  const mergedBracket =
    upper.bracket !== "none"
      ? upper.bracket
      : lower.bracket !== "none"
        ? lower.bracket
        : "brace";

  next[upper.row] = {
    ...next[upper.row],
    [side]: next[upper.row][side] || next[lower.row][side],
    [spanKey(side)]: mergedSpan,
    [bracketKey(side)]: mergedBracket
  };

  for (let index = upper.row + 1; index <= mergedEnd; index += 1) {
    next[index] = {
      ...next[index],
      [side]: "",
      [spanKey(side)]: 1,
      [bracketKey(side)]: "none"
    };
  }

  return normalizeWireLabels(next, qubits);
}

export function unmergeWireLabelGroup(
  labels: WireLabel[],
  row: number,
  side: WireLabelSide,
  qubits: number
): WireLabel[] {
  const next = resizeRawWireLabels(labels, qubits);
  const group = getWireLabelGroup(next, row, side);
  next[group.row] = {
    ...next[group.row],
    [spanKey(side)]: 1,
    [bracketKey(side)]: "none"
  };

  return normalizeWireLabels(next, qubits);
}
