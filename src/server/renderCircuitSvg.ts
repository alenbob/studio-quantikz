import {
  DEFAULT_ITEM_COLOR,
  mixHexWithWhite
} from "../renderer/color";
import {
  type ColumnMetrics,
  GATE_MIN_HEIGHT,
  GATE_MIN_WIDTH,
  GRID_LEFT,
  GRID_TOP,
  getCellCenterX,
  getColumnMetrics,
  getColumnRightX,
  getColumnSpanRange,
  getGridHeight,
  getGridWidth,
  getIncomingSegmentRange,
  getRowHeight,
  getRowY,
  getWireEndX
} from "../renderer/layout";
import {
  normalizeGateLabel,
  normalizeLabel,
  stripMathDelimiters
} from "../renderer/tex";
import {
  getWireLabelBracket,
  getWireLabelSpan,
  isWireLabelGroupStart,
  type WireLabelSide
} from "../renderer/wireLabels";
import type {
  CircuitItem,
  CircuitLayout,
  ControlDotItem,
  FrameItem,
  GateItem,
  HorizontalSegmentItem,
  ImportedCircuit,
  MeterItem,
  SliceItem,
  VerticalConnectorItem,
  WireType
} from "../renderer/types";

const DEFAULT_GATE_FILL = "#FFF8EF";
const FONT_FAMILY = "Avenir Next, Segoe UI, sans-serif";
const WIRE_STROKE_WIDTH = 2.2;
const LABEL_FONT_SIZE = 16;
const BRACKET_OFFSET = 26;

interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function plainTextLabel(value: string, fallback = ""): string {
  const normalized = normalizeLabel(value, fallback);
  if (normalized.startsWith("$") && normalized.endsWith("$")) {
    return stripMathDelimiters(normalized);
  }
  return normalized;
}

function plainGateLabel(value: string): string {
  return plainTextLabel(normalizeGateLabel(value), "U");
}

function getItemColor(item: CircuitItem): string {
  return item.color ?? DEFAULT_ITEM_COLOR;
}

function controlStateFor(item: ControlDotItem): "filled" | "open" {
  return item.controlState ?? "filled";
}

function gateRect(item: GateItem, layout: CircuitLayout, columnMetrics: ColumnMetrics): RectBounds {
  const rowHeight = getRowHeight(layout);
  const [blockX, blockRight] = getColumnSpanRange(item.point.col, item.span.cols, layout, columnMetrics);
  const blockWidth = blockRight - blockX;
  const width = Math.max(item.width, Math.max(GATE_MIN_WIDTH, blockWidth - 12));
  const x = blockX + ((blockWidth - width) / 2);
  const y = getRowY(item.point.row, layout) - (GATE_MIN_HEIGHT / 2);
  const height = GATE_MIN_HEIGHT + ((item.span.rows - 1) * rowHeight);

  return { x, y, width, height };
}

function meterRect(item: MeterItem, layout: CircuitLayout, columnMetrics: ColumnMetrics): RectBounds {
  const x = getCellCenterX(item.point.col, layout, columnMetrics) - (GATE_MIN_WIDTH / 2);
  const y = getRowY(item.point.row, layout) - (GATE_MIN_HEIGHT / 2);
  const rows = item.span.rows ?? 1;
  const height = GATE_MIN_HEIGHT + ((rows - 1) * getRowHeight(layout));

  return { x, y, width: GATE_MIN_WIDTH, height };
}

function frameRect(item: FrameItem, layout: CircuitLayout, columnMetrics: ColumnMetrics): RectBounds {
  const rowHeight = getRowHeight(layout);
  const [leftX, rightX] = getColumnSpanRange(item.point.col, item.span.cols, layout, columnMetrics);

  return {
    x: leftX + 4,
    y: getRowY(item.point.row, layout) - (rowHeight / 2) + 6,
    width: Math.max((rightX - leftX) - 8, 18),
    height: Math.max((item.span.rows * rowHeight) - 12, 18)
  };
}

function renderWireStroke(x1: number, x2: number, y: number, wireType: WireType, color: string): string {
  if (wireType === "classical") {
    return [
      `<line x1="${x1}" x2="${x2}" y1="${y - 3}" y2="${y - 3}" stroke="${color}" stroke-width="${WIRE_STROKE_WIDTH}" />`,
      `<line x1="${x1}" x2="${x2}" y1="${y + 3}" y2="${y + 3}" stroke="${color}" stroke-width="${WIRE_STROKE_WIDTH}" />`
    ].join("");
  }

  return `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="${WIRE_STROKE_WIDTH}" />`;
}

function bracketGlyph(side: WireLabelSide, bracket: "brace" | "bracket" | "paren"): string {
  if (bracket === "brace") {
    return side === "left" ? "{" : "}";
  }

  if (bracket === "bracket") {
    return side === "left" ? "[" : "]";
  }

  return side === "left" ? "(" : ")";
}

function renderWireLabelBracket(
  side: WireLabelSide,
  bracket: "brace" | "bracket" | "paren",
  centerY: number,
  span: number,
  wireEndX: number,
  layout: CircuitLayout
): string {
  const x = side === "left" ? GRID_LEFT - 12 : wireEndX + 12;
  const fontSize = Math.max(34, span * getRowHeight(layout) * 0.78);

  return `<text x="${x}" y="${centerY}" fill="${DEFAULT_ITEM_COLOR}" font-family="${FONT_FAMILY}" font-size="${fontSize}" dominant-baseline="middle" text-anchor="${side === "left" ? "end" : "start"}">${escapeXml(bracketGlyph(side, bracket))}</text>`;
}

function renderWireLabels(circuit: ImportedCircuit, columnMetrics: ColumnMetrics): string {
  const wireEndX = getWireEndX(circuit.steps, circuit.layout, columnMetrics);
  const parts: string[] = [];

  for (let row = 0; row < circuit.qubits; row += 1) {
    const y = getRowY(row, circuit.layout);
    const leftLabel = circuit.wireLabels[row]?.left ?? "";
    const rightLabel = circuit.wireLabels[row]?.right ?? "";
    const leftSpan = getWireLabelSpan(circuit.wireLabels[row], "left");
    const rightSpan = getWireLabelSpan(circuit.wireLabels[row], "right");
    const leftBracket = getWireLabelBracket(circuit.wireLabels[row], "left");
    const rightBracket = getWireLabelBracket(circuit.wireLabels[row], "right");
    const rowHeight = getRowHeight(circuit.layout);
    const leftCenterY = y + (((leftSpan - 1) * rowHeight) / 2);
    const rightCenterY = y + (((rightSpan - 1) * rowHeight) / 2);
    const leftX = GRID_LEFT - 18 - (leftSpan > 1 && leftBracket !== "none" ? BRACKET_OFFSET : 0);
    const rightX = wireEndX + 18 + (rightSpan > 1 && rightBracket !== "none" ? BRACKET_OFFSET : 0);

    if (isWireLabelGroupStart(circuit.wireLabels, row, "left")) {
      if (leftSpan > 1 && leftBracket !== "none") {
        parts.push(renderWireLabelBracket("left", leftBracket as "brace" | "bracket" | "paren", leftCenterY, leftSpan, wireEndX, circuit.layout));
      }

      if (leftLabel.trim()) {
        parts.push(
          `<text x="${leftX}" y="${leftCenterY}" fill="${DEFAULT_ITEM_COLOR}" font-family="${FONT_FAMILY}" font-size="${LABEL_FONT_SIZE}" dominant-baseline="middle" text-anchor="end">${escapeXml(plainTextLabel(leftLabel))}</text>`
        );
      }
    }

    if (isWireLabelGroupStart(circuit.wireLabels, row, "right")) {
      if (rightSpan > 1 && rightBracket !== "none") {
        parts.push(renderWireLabelBracket("right", rightBracket as "brace" | "bracket" | "paren", rightCenterY, rightSpan, wireEndX, circuit.layout));
      }

      if (rightLabel.trim()) {
        parts.push(
          `<text x="${rightX}" y="${rightCenterY}" fill="${DEFAULT_ITEM_COLOR}" font-family="${FONT_FAMILY}" font-size="${LABEL_FONT_SIZE}" dominant-baseline="middle" text-anchor="start">${escapeXml(plainTextLabel(rightLabel))}</text>`
        );
      }
    }
  }

  return parts.join("");
}

function renderGate(item: GateItem, layout: CircuitLayout, columnMetrics: ColumnMetrics): string {
  const rect = gateRect(item, layout, columnMetrics);
  const color = getItemColor(item);
  const fill = item.color ? mixHexWithWhite(color, 0.9) : DEFAULT_GATE_FILL;
  const label = plainGateLabel(item.label);

  return [
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="0" fill="${fill}" stroke="${color}" stroke-width="2" />`,
    `<text x="${rect.x + (rect.width / 2)}" y="${rect.y + (rect.height / 2)}" fill="${color}" font-family="${FONT_FAMILY}" font-size="${LABEL_FONT_SIZE}" dominant-baseline="middle" text-anchor="middle">${escapeXml(label)}</text>`
  ].join("");
}

function renderMeter(item: MeterItem, layout: CircuitLayout, columnMetrics: ColumnMetrics): string {
  const rect = meterRect(item, layout, columnMetrics);
  const color = getItemColor(item);
  const fill = item.color ? mixHexWithWhite(color, 0.9) : DEFAULT_GATE_FILL;
  const centerX = rect.x + (rect.width / 2);
  const centerY = rect.y + (rect.height / 2);
  const radius = Math.min(rect.width, rect.height) * 0.22;
  const arcTop = centerY - radius * 0.6;
  const arcBottom = centerY + radius * 0.75;
  const left = centerX - radius;
  const right = centerX + radius;

  return [
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="0" fill="${fill}" stroke="${color}" stroke-width="2" />`,
    `<path d="M ${left} ${arcBottom} A ${radius} ${radius} 0 0 1 ${right} ${arcBottom}" fill="none" stroke="${color}" stroke-width="2" />`,
    `<line x1="${centerX}" x2="${centerX + radius * 0.72}" y1="${arcBottom}" y2="${arcTop}" stroke="${color}" stroke-width="2" />`,
    `<circle cx="${centerX}" cy="${arcBottom}" r="1.8" fill="${color}" />`
  ].join("");
}

function renderFrame(item: FrameItem, layout: CircuitLayout, columnMetrics: ColumnMetrics): string {
  const rect = frameRect(item, layout, columnMetrics);
  const color = getItemColor(item);

  return [
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="${item.rounded ? 12 : 0}" fill="${item.background ? mixHexWithWhite(color, 0.93) : "transparent"}" stroke="${color}" stroke-width="2" ${item.dashed ? "stroke-dasharray=\"8 6\"" : ""} />`,
    `<text x="${rect.x + (rect.width / 2)}" y="${rect.y - 8}" fill="${color}" font-family="${FONT_FAMILY}" font-size="${LABEL_FONT_SIZE}" text-anchor="middle">${escapeXml(plainGateLabel(item.label))}</text>`
  ].join("");
}

function renderSlice(item: SliceItem, qubits: number, layout: CircuitLayout, columnMetrics: ColumnMetrics): string {
  const x = getColumnRightX(item.point.col, layout, columnMetrics);
  return [
    `<line x1="${x}" x2="${x}" y1="${GRID_TOP - 16}" y2="${getRowY(qubits - 1, layout) + 18}" stroke="${getItemColor(item)}" stroke-width="2" stroke-dasharray="6 6" />`,
    `<text x="${x + 4}" y="${GRID_TOP - 24}" fill="${getItemColor(item)}" font-family="${FONT_FAMILY}" font-size="${LABEL_FONT_SIZE}">${escapeXml(plainGateLabel(item.label))}</text>`
  ].join("");
}

function renderVerticalConnector(item: VerticalConnectorItem, layout: CircuitLayout, columnMetrics: ColumnMetrics): string {
  const x = getCellCenterX(item.point.col, layout, columnMetrics);
  const y1 = getRowY(item.point.row, layout);
  const y2 = getRowY(item.point.row + item.length, layout);
  const color = getItemColor(item);

  if (item.wireType === "classical") {
    return [
      `<line x1="${x - 3}" x2="${x - 3}" y1="${y1}" y2="${y2}" stroke="${color}" stroke-width="${WIRE_STROKE_WIDTH}" />`,
      `<line x1="${x + 3}" x2="${x + 3}" y1="${y1}" y2="${y2}" stroke="${color}" stroke-width="${WIRE_STROKE_WIDTH}" />`
    ].join("");
  }

  return `<line x1="${x}" x2="${x}" y1="${y1}" y2="${y2}" stroke="${color}" stroke-width="${WIRE_STROKE_WIDTH}" />`;
}

function renderHorizontalSegment(item: HorizontalSegmentItem, steps: number, layout: CircuitLayout, columnMetrics: ColumnMetrics): string {
  if (item.mode === "absent" || item.autoSuppressed === true) {
    return "";
  }

  const [x1, x2] = getIncomingSegmentRange(item.point.col, steps, layout, columnMetrics);
  const y = getRowY(item.point.row, layout);
  return renderWireStroke(x1, x2, y, item.wireType, getItemColor(item));
}

function renderControlDot(item: ControlDotItem, layout: CircuitLayout, columnMetrics: ColumnMetrics): string {
  const x = getCellCenterX(item.point.col, layout, columnMetrics);
  const y = getRowY(item.point.row, layout);
  const color = getItemColor(item);
  const controlState = controlStateFor(item);

  if (controlState === "open") {
    return `<circle cx="${x}" cy="${y}" r="7" fill="#FFF8EF" stroke="${color}" stroke-width="2" />`;
  }

  return `<circle cx="${x}" cy="${y}" r="7" fill="${color}" />`;
}

function renderTargetPlus(item: Extract<CircuitItem, { type: "targetPlus" }>, layout: CircuitLayout, columnMetrics: ColumnMetrics): string {
  const x = getCellCenterX(item.point.col, layout, columnMetrics);
  const y = getRowY(item.point.row, layout);
  const color = getItemColor(item);

  return [
    `<circle cx="${x}" cy="${y}" r="11" fill="none" stroke="${color}" stroke-width="2" />`,
    `<line x1="${x - 8}" x2="${x + 8}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="2" />`,
    `<line x1="${x}" x2="${x}" y1="${y - 8}" y2="${y + 8}" stroke="${color}" stroke-width="2" />`
  ].join("");
}

function renderSwapX(item: Extract<CircuitItem, { type: "swapX" }>, layout: CircuitLayout, columnMetrics: ColumnMetrics): string {
  const x = getCellCenterX(item.point.col, layout, columnMetrics);
  const y = getRowY(item.point.row, layout);
  const color = getItemColor(item);

  return [
    `<line x1="${x - 8}" x2="${x + 8}" y1="${y - 8}" y2="${y + 8}" stroke="${color}" stroke-width="2" />`,
    `<line x1="${x - 8}" x2="${x + 8}" y1="${y + 8}" y2="${y - 8}" stroke="${color}" stroke-width="2" />`
  ].join("");
}

export function renderCircuitSvg(circuit: ImportedCircuit): string {
  const columnMetrics = getColumnMetrics(circuit.steps, circuit.items, circuit.layout);
  const width = getGridWidth(circuit.steps, circuit.layout, columnMetrics);
  const height = getGridHeight(circuit.qubits, circuit.layout);
  const backgroundItems = circuit.items.filter((item): item is FrameItem => item.type === "frame");
  const wireItems = circuit.items.filter(
    (item): item is HorizontalSegmentItem | VerticalConnectorItem =>
      item.type === "horizontalSegment" || item.type === "verticalConnector"
  );
  const gateItems = circuit.items.filter((item): item is GateItem | MeterItem => item.type === "gate" || item.type === "meter");
  const overlayItems = circuit.items.filter((item): item is SliceItem => item.type === "slice");
  const markerItems = circuit.items.filter(
    (item) => item.type === "controlDot" || item.type === "targetPlus" || item.type === "swapX"
  );

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Quantikz circuit">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="white" />`,
    renderWireLabels(circuit, columnMetrics),
    ...backgroundItems.map((item) => renderFrame(item, circuit.layout, columnMetrics)),
    ...wireItems.map((item) =>
      item.type === "horizontalSegment"
        ? renderHorizontalSegment(item, circuit.steps, circuit.layout, columnMetrics)
        : renderVerticalConnector(item, circuit.layout, columnMetrics)
    ),
    ...gateItems.map((item) =>
      item.type === "gate"
        ? renderGate(item, circuit.layout, columnMetrics)
        : renderMeter(item, circuit.layout, columnMetrics)
    ),
    ...overlayItems.map((item) => renderSlice(item, circuit.qubits, circuit.layout, columnMetrics)),
    ...markerItems.map((item) => {
      if (item.type === "controlDot") {
        return renderControlDot(item, circuit.layout, columnMetrics);
      }
      if (item.type === "targetPlus") {
        return renderTargetPlus(item, circuit.layout, columnMetrics);
      }
      return renderSwapX(item, circuit.layout, columnMetrics);
    }),
    "</svg>"
  ];

  return parts.filter(Boolean).join("");
}
