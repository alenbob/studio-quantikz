import type { CircuitLayout } from "./types";
import { getLabelMeasurementText } from "./tex";

export const DEFAULT_COLUMN_SEP_CM = 0.7;
export const DEFAULT_ROW_SEP_CM = 0.9;
export const BASE_COLUMN_WIDTH = 72;
export const BASE_ROW_HEIGHT = 56;
export const WIRE_STROKE = 2;
export const GATE_MIN_WIDTH = 40;
export const GATE_MIN_HEIGHT = 32;
export const GATE_PADDING_X = 12;
export const GATE_PADDING_Y = 8;
export const LEFT_LABEL_WIDTH = 144;
export const RIGHT_LABEL_WIDTH = 144;
export const GRID_LEFT = LEFT_LABEL_WIDTH + 28;
export const GRID_TOP = 72;

export const DEFAULT_CIRCUIT_LAYOUT: CircuitLayout = {
  rowSepCm: DEFAULT_ROW_SEP_CM,
  columnSepCm: DEFAULT_COLUMN_SEP_CM
};

export function clampRowSepCm(value: number): number {
  return Math.min(1.8, Math.max(0.45, value));
}

export function clampColumnSepCm(value: number): number {
  return Math.min(1.6, Math.max(0.4, value));
}

export function getColumnWidth(layout: CircuitLayout): number {
  return BASE_COLUMN_WIDTH * (layout.columnSepCm / DEFAULT_COLUMN_SEP_CM);
}

export function getRowHeight(layout: CircuitLayout): number {
  return BASE_ROW_HEIGHT * (layout.rowSepCm / DEFAULT_ROW_SEP_CM);
}

export function getCellCenterX(col: number, layout: CircuitLayout): number {
  const columnWidth = getColumnWidth(layout);
  return GRID_LEFT + (col * columnWidth) + (columnWidth / 2);
}

export function getRowY(row: number, layout: CircuitLayout): number {
  return GRID_TOP + (row * getRowHeight(layout));
}

export function getGridWidth(steps: number, layout: CircuitLayout): number {
  const columnWidth = getColumnWidth(layout);
  return GRID_LEFT + (steps * columnWidth) + (columnWidth / 2) + RIGHT_LABEL_WIDTH + 32;
}

export function getGridHeight(qubits: number, layout: CircuitLayout): number {
  return GRID_TOP + Math.max(qubits - 1, 0) * getRowHeight(layout) + 96;
}

export function getWireStartX(): number {
  return GRID_LEFT;
}

export function getWireEndX(steps: number, layout: CircuitLayout): number {
  return getCellCenterX(Math.max(steps - 1, 0), layout) + (getColumnWidth(layout) / 2);
}

export function getIncomingSegmentRange(col: number, steps: number, layout: CircuitLayout): [number, number] {
  if (col <= 0) {
    return [getWireStartX(), getCellCenterX(0, layout)];
  }

  if (col >= steps) {
    return [getCellCenterX(steps - 1, layout), getWireEndX(steps, layout)];
  }

  return [getCellCenterX(col - 1, layout), getCellCenterX(col, layout)];
}

let cachedContext: CanvasRenderingContext2D | null = null;

export function measureGateWidth(label: string): number {
  const safeLabel = getLabelMeasurementText(label);

  if (typeof document !== "undefined") {
    try {
      if (!cachedContext) {
        cachedContext = document.createElement("canvas").getContext("2d");
      }

      if (cachedContext) {
        cachedContext.font = '600 16px "Avenir Next", "Segoe UI", sans-serif';
        return Math.max(
          GATE_MIN_WIDTH,
          Math.ceil(cachedContext.measureText(safeLabel).width + (GATE_PADDING_X * 2))
        );
      }
    } catch {
      cachedContext = null;
    }
  }

  return Math.max(GATE_MIN_WIDTH, safeLabel.length * 10 + (GATE_PADDING_X * 2));
}
