import type { CircuitItem, HorizontalSegmentItem } from "./types";

export function wireKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export function getMeterSuppressedHorizontalKeys(items: CircuitItem[], steps: number): Set<string> {
  const suppressed = new Set<string>();

  for (const item of items) {
    if (item.type !== "meter") {
      continue;
    }

    const rows = item.span.rows ?? 1;
    for (let row = item.point.row; row < item.point.row + rows; row += 1) {
      for (let col = item.point.col + 1; col <= steps; col += 1) {
        suppressed.add(wireKey(row, col));
      }
    }
  }

  for (const item of items) {
    if (item.type !== "horizontalSegment") {
      continue;
    }

    if (item.mode === "present" && item.autoSuppressed === false) {
      suppressed.delete(wireKey(item.point.row, item.point.col));
    }
  }

  return suppressed;
}

export function getEqualsColumnSuppressedHorizontalKeys(items: CircuitItem[], qubits: number): Set<string> {
  const suppressed = new Set<string>();

  for (const item of items) {
    if (item.type !== "equalsColumn") {
      continue;
    }

    for (let row = 0; row < qubits; row += 1) {
      suppressed.add(wireKey(row, item.point.col));
      suppressed.add(wireKey(row, item.point.col + 1));
    }
  }

  return suppressed;
}

export function isVisibleHorizontalSegment(item: HorizontalSegmentItem): boolean {
  return item.mode === "present" && item.autoSuppressed !== true;
}

export function isAbsentHorizontalSegment(item: HorizontalSegmentItem): boolean {
  return item.mode === "absent" || item.autoSuppressed === true;
}
