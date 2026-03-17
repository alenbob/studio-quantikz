import type { CircuitItem, CircuitLayout } from "./types.js";
import { getLabelMeasurementText, normalizeGateLabel, renderGateLabelHtml } from "./tex.js";

export const DEFAULT_COLUMN_SEP_CM = 0.7;
export const DEFAULT_ROW_SEP_CM = 0.9;
export const BASE_COLUMN_WIDTH = 72;
export const BASE_ROW_HEIGHT = 56;
export const WIRE_STROKE = 2;
export const GATE_MIN_WIDTH = 40;
export const GATE_MIN_HEIGHT = 32;
export const GATE_PADDING_X = 2;
export const GATE_PADDING_Y = 8;
export const LEFT_LABEL_WIDTH = 144;
export const RIGHT_LABEL_WIDTH = 144;
export const ROW_NUMBER_GUTTER = 36;
export const GRID_LEFT = LEFT_LABEL_WIDTH + ROW_NUMBER_GUTTER + 28;
export const GRID_TOP = 72;
export const GRID_BOTTOM_PADDING = 44;
const BASE_COLUMN_PADDING = BASE_COLUMN_WIDTH - GATE_MIN_WIDTH;
const CONNECTOR_CONTENT_WIDTH = 28;
const MEASUREMENT_ROOT_ID = "quantikzz-gate-measure-root";

interface GateLabelMeasurement {
  width: number;
  height: number;
}

export interface ColumnMetrics {
  widths: number[];
  starts: number[];
  centers: number[];
  wireEndX: number;
}

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

export function getColumnPadding(layout: CircuitLayout): number {
  return BASE_COLUMN_PADDING * (layout.columnSepCm / DEFAULT_COLUMN_SEP_CM);
}

export function getRowHeight(layout: CircuitLayout): number {
  return BASE_ROW_HEIGHT * (layout.rowSepCm / DEFAULT_ROW_SEP_CM);
}

export function getColumnMetrics(
  steps: number,
  items: CircuitItem[],
  layout: CircuitLayout
): ColumnMetrics {
  const safeSteps = Math.max(steps, 1);
  const contentWidths = Array.from({ length: safeSteps }, () => GATE_MIN_WIDTH);

  for (const item of items) {
    if ("point" in item && (item.point.col < 0 || item.point.col >= safeSteps)) {
      continue;
    }

    switch (item.type) {
      case "gate": {
        const contentWidth = Math.max(measureGateWidth(item.label), GATE_MIN_WIDTH);
        const spanCols = Math.max(item.span.cols, 1);
        const perColumnWidth = Math.max(GATE_MIN_WIDTH, Math.ceil(contentWidth / spanCols));
        for (let col = item.point.col; col < Math.min(item.point.col + spanCols, safeSteps); col += 1) {
          contentWidths[col] = Math.max(contentWidths[col], perColumnWidth);
        }
        break;
      }
      case "meter":
        contentWidths[item.point.col] = Math.max(contentWidths[item.point.col], GATE_MIN_WIDTH);
        break;
      case "controlDot":
      case "targetPlus":
      case "swapX":
      case "verticalConnector":
        contentWidths[item.point.col] = Math.max(contentWidths[item.point.col], CONNECTOR_CONTENT_WIDTH);
        break;
      default:
        break;
    }
  }

  const padding = getColumnPadding(layout);
  const widths = contentWidths.map((contentWidth) => Math.max(contentWidth + padding, BASE_COLUMN_WIDTH * 0.7));
  const starts: number[] = [];
  const centers: number[] = [];
  let cursor = GRID_LEFT;

  for (const width of widths) {
    starts.push(cursor);
    centers.push(cursor + (width / 2));
    cursor += width;
  }

  return {
    widths,
    starts,
    centers,
    wireEndX: cursor
  };
}

function clampedColumnIndex(col: number, layout: CircuitLayout, metrics?: ColumnMetrics): number {
  if (metrics) {
    return Math.max(0, Math.min(metrics.widths.length - 1, col));
  }

  return Math.max(0, col);
}

export function getColumnLeftX(col: number, layout: CircuitLayout, metrics?: ColumnMetrics): number {
  if (metrics) {
    return metrics.starts[clampedColumnIndex(col, layout, metrics)];
  }

  return GRID_LEFT + (clampedColumnIndex(col, layout) * getColumnWidth(layout));
}

export function getColumnRightX(col: number, layout: CircuitLayout, metrics?: ColumnMetrics): number {
  if (metrics) {
    const index = clampedColumnIndex(col, layout, metrics);
    return metrics.starts[index] + metrics.widths[index];
  }

  const index = clampedColumnIndex(col, layout);
  return GRID_LEFT + ((index + 1) * getColumnWidth(layout));
}

export function getColumnSpanRange(
  startCol: number,
  spanCols: number,
  layout: CircuitLayout,
  metrics?: ColumnMetrics
): [number, number] {
  const safeStart = Math.max(0, startCol);
  const safeSpan = Math.max(1, spanCols);
  const lastCol = safeStart + safeSpan - 1;
  return [
    getColumnLeftX(safeStart, layout, metrics),
    getColumnRightX(lastCol, layout, metrics)
  ];
}

export function getCellCenterX(col: number, layout: CircuitLayout, metrics?: ColumnMetrics): number {
  if (metrics) {
    return metrics.centers[clampedColumnIndex(col, layout, metrics)];
  }

  const columnWidth = getColumnWidth(layout);
  return GRID_LEFT + (clampedColumnIndex(col, layout) * columnWidth) + (columnWidth / 2);
}

export function getRowY(row: number, layout: CircuitLayout): number {
  return GRID_TOP + (row * getRowHeight(layout));
}

export function getGridWidth(steps: number, layout: CircuitLayout, metrics?: ColumnMetrics): number {
  if (metrics) {
    return metrics.wireEndX + RIGHT_LABEL_WIDTH + 32;
  }

  const columnWidth = getColumnWidth(layout);
  return GRID_LEFT + (steps * columnWidth) + (columnWidth / 2) + RIGHT_LABEL_WIDTH + 32;
}

export function getGridHeight(qubits: number, layout: CircuitLayout): number {
  return GRID_TOP + Math.max(qubits - 1, 0) * getRowHeight(layout) + GRID_BOTTOM_PADDING;
}

export function getWireStartX(): number {
  return GRID_LEFT;
}

export function getWireEndX(steps: number, layout: CircuitLayout, metrics?: ColumnMetrics): number {
  if (metrics) {
    return metrics.wireEndX;
  }

  return getCellCenterX(Math.max(steps - 1, 0), layout) + (getColumnWidth(layout) / 2);
}

export function getIncomingSegmentRange(
  col: number,
  steps: number,
  layout: CircuitLayout,
  metrics?: ColumnMetrics
): [number, number] {
  if (col <= 0) {
    return [getWireStartX(), getCellCenterX(0, layout, metrics)];
  }

  if (col >= steps) {
    return [getCellCenterX(steps - 1, layout, metrics), getWireEndX(steps, layout, metrics)];
  }

  return [getCellCenterX(col - 1, layout, metrics), getCellCenterX(col, layout, metrics)];
}

let cachedContext: CanvasRenderingContext2D | null = null;
let measurementRoot: HTMLDivElement | null = null;
const gateMeasurementCache = new Map<string, GateLabelMeasurement>();

function getMeasurementRoot(): HTMLDivElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  if (measurementRoot?.isConnected) {
    return measurementRoot;
  }

  const existingRoot = document.getElementById(MEASUREMENT_ROOT_ID);
  if (existingRoot instanceof HTMLDivElement) {
    measurementRoot = existingRoot;
    return measurementRoot;
  }

  const root = document.createElement("div");
  root.id = MEASUREMENT_ROOT_ID;
  root.setAttribute("aria-hidden", "true");
  Object.assign(root.style, {
    position: "absolute",
    left: "-99999px",
    top: "-99999px",
    visibility: "hidden",
    pointerEvents: "none",
    whiteSpace: "nowrap"
  });
  document.body.appendChild(root);
  measurementRoot = root;
  return measurementRoot;
}

function estimateGateLabelHeight(label: string): number {
  const normalized = normalizeGateLabel(label);
  let extraHeight = 0;

  if (/\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|oint|left|right|overline|underline)/.test(normalized)) {
    extraHeight += 10;
  }

  if (/[_^]/.test(normalized)) {
    extraHeight += 4;
  }

  if (/\\begin\{(?:matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|cases|array)\}/.test(normalized)) {
    extraHeight += 14;
  }

  return Math.max(GATE_MIN_HEIGHT, 20 + (GATE_PADDING_Y * 2) + extraHeight);
}

function fallbackGateMeasurement(label: string): GateLabelMeasurement {
  const safeLabel = getLabelMeasurementText(label);

  let width = Math.max(GATE_MIN_WIDTH, safeLabel.length * 10 + (GATE_PADDING_X * 2));

  if (typeof document !== "undefined") {
    try {
      if (!cachedContext) {
        cachedContext = document.createElement("canvas").getContext("2d");
      }

      if (cachedContext) {
        cachedContext.font = '600 16px "Avenir Next", "Segoe UI", sans-serif';
        width = Math.max(
          GATE_MIN_WIDTH,
          Math.ceil(cachedContext.measureText(safeLabel).width + (GATE_PADDING_X * 2))
        );
      }
    } catch {
      cachedContext = null;
    }
  }

  return {
    width,
    height: estimateGateLabelHeight(label)
  };
}

function measureGateLabel(label: string): GateLabelMeasurement {
  const normalized = normalizeGateLabel(label);
  const cached = gateMeasurementCache.get(normalized);
  if (cached) {
    return cached;
  }

  const root = getMeasurementRoot();
  const texHtml = renderGateLabelHtml(normalized);

  if (root && texHtml) {
    try {
      const wrapper = document.createElement("div");
      Object.assign(wrapper.style, {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "max-content",
        height: "max-content",
        padding: "0",
        margin: "0",
        whiteSpace: "nowrap"
      });
      wrapper.innerHTML = texHtml;

      const katexNode = wrapper.querySelector(".katex");
      if (katexNode instanceof HTMLElement) {
        katexNode.style.fontSize = "1.05rem";
        katexNode.style.lineHeight = "1";
      }

      root.appendChild(wrapper);
      const rect = wrapper.getBoundingClientRect();
      root.removeChild(wrapper);

      if (rect.width > 0 && rect.height > 0) {
        const measured = {
          width: Math.max(GATE_MIN_WIDTH, Math.ceil(rect.width + (GATE_PADDING_X * 2))),
          height: Math.max(GATE_MIN_HEIGHT, Math.ceil(rect.height + (GATE_PADDING_Y * 2)))
        };
        gateMeasurementCache.set(normalized, measured);
        return measured;
      }
    } catch {
      measurementRoot = null;
    }
  }

  const fallback = fallbackGateMeasurement(normalized);
  gateMeasurementCache.set(normalized, fallback);
  return fallback;
}

export function measureGateWidth(label: string): number {
  return measureGateLabel(label).width;
}

export function measureGateHeight(label: string): number {
  return measureGateLabel(label).height;
}
