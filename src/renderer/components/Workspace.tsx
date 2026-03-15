import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import meterBlackIcon from "../assets/meter_black.svg";
import targBlackIcon from "../assets/targ_black.svg";
import { canPasteClipboardAt, instantiateClipboardItems } from "../clipboard";
import {
  type ColumnMetrics,
  GATE_MIN_HEIGHT,
  GATE_MIN_WIDTH,
  GRID_LEFT,
  GRID_TOP,
  LEFT_LABEL_WIDTH,
  RIGHT_LABEL_WIDTH,
  getColumnLeftX,
  getColumnMetrics,
  getColumnRightX,
  getColumnSpanRange,
  getCellCenterX,
  getGridHeight,
  getGridWidth,
  getIncomingSegmentRange,
  getRowHeight,
  getRowY,
  getWireEndX
} from "../layout";
import {
  DEFAULT_ABSENT_WIRE_COLOR,
  DEFAULT_ITEM_COLOR,
  mixHexWithWhite
} from "../color";
import { projectSelectionMove, selectionHasExternalVerticalLinks } from "../movement";
import { canPlaceItemsWithoutOverlap } from "../occupancy";
import { canPlaceCellToolAtRow, getBoardMetrics, placementFromViewportPoint } from "../placement";
import { getSwapStatusById } from "../swapAnalysis";
import { isLikelyTexMath, normalizeGateLabel, normalizeLabel, renderGateDisplayHtml, renderGateLabelHtml } from "../tex";
import {
  getWireLabelBracket,
  getWireLabelSpan,
  hasWireLabelBoundary,
  isWireLabelGroupStart,
  type WireLabelSide
} from "../wireLabels";
import type {
  BoardMetrics,
  CircuitClipboard,
  CircuitItem,
  CircuitLayout,
  EditorState,
  FrameItem,
  GateItem,
  HorizontalSegmentItem,
  ItemType,
  MeterItem,
  PlacementTarget,
  SliceItem,
  ToolType,
  VerticalConnectorItem,
  WireType
} from "../types";

interface WorkspaceProps {
  state: EditorState;
  isPasteMode: boolean;
  pasteClipboard: CircuitClipboard | null;
  selectedWireLabelGroup: { row: number; side: WireLabelSide; span: number; bracket: "none" | "brace" | "bracket" | "paren"; text: string } | null;
  onLayoutSpacingChange: (dimension: "rowSepCm" | "columnSepCm", value: number) => void;
  onWireLabelChange: (row: number, side: "left" | "right", label: string) => void;
  onSelectWireLabelGroup: (row: number, side: WireLabelSide) => void;
  onMergeWireLabelGroup: (row: number, side: WireLabelSide) => void;
  onPlaceItem: (tool: ItemType, placement: PlacementTarget) => void;
  onDrawGate: (start: { row: number; col: number }, end: { row: number; col: number }) => void;
  onDrawMeter: (start: { row: number; col: number }, endRow: number) => void;
  onDrawAnnotation: (start: { row: number; col: number }, end: { row: number; col: number }) => void;
  onPasteAt: (placement: PlacementTarget) => void;
  onMoveItem: (itemId: string, placement: PlacementTarget) => void;
  onMoveSelection: (anchorItemId: string, placement: PlacementTarget) => void;
  onSelectionChange: (itemIds: string[]) => void;
  onResizeGrid: (dimension: "qubits" | "steps", value: number) => void;
  onBoardMetricsChange: (metrics: BoardMetrics | null) => void;
}

interface ContentPoint {
  x: number;
  y: number;
}

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MarqueeSelection {
  start: ContentPoint;
  current: ContentPoint;
}

interface AreaDrawState {
  tool: "gate" | "meter" | "annotation";
  start: { row: number; col: number };
  current: { row: number; col: number };
}

interface PencilStrokeState {
  kind: PlacementTarget["kind"];
}

interface DragState {
  anchorItemId: string;
  constrainVertical: boolean;
}

type ItemOutlineTone = "selected" | "preview" | "invalid-preview";

const INVALID_SWAP_COLOR = "#c24038";

function isGateLikeItem(item: CircuitItem): item is GateItem | MeterItem {
  return item.type === "gate" || item.type === "meter";
}

function isAnnotationBackgroundItem(item: CircuitItem): item is FrameItem {
  return item.type === "frame";
}

function isAnnotationOverlayItem(item: CircuitItem): item is SliceItem {
  return item.type === "slice";
}

function isWireLayerItem(item: CircuitItem): item is VerticalConnectorItem | HorizontalSegmentItem {
  return item.type === "verticalConnector" || item.type === "horizontalSegment";
}

function isMarkerItem(item: CircuitItem): item is Exclude<CircuitItem, GateItem | MeterItem | VerticalConnectorItem | HorizontalSegmentItem> {
  return item.type === "controlDot" || item.type === "targetPlus" || item.type === "swapX";
}

function shouldRenderMathLabel(label: string): boolean {
  const trimmed = label.trim();
  return isLikelyTexMath(trimmed) || (trimmed.startsWith("$") && trimmed.endsWith("$"));
}

function getClipboardPlacementTool(clipboard: CircuitClipboard | null): ToolType {
  if (!clipboard) {
    return "gate";
  }

  return clipboard.items.some((item) => item.type === "horizontalSegment" || item.type === "verticalConnector")
    ? "pencil"
    : "gate";
}

function placementForItem(item: CircuitItem): PlacementTarget {
  if (item.type === "horizontalSegment") {
    return {
      kind: "segment",
      row: item.point.row,
      col: item.point.col
    };
  }

  return {
    kind: "cell",
    row: item.point.row,
    col: item.point.col
  };
}

function normalizeRect(start: ContentPoint, end: ContentPoint): SelectionRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function rectsIntersect(a: SelectionRect, b: SelectionRect): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

function getItemColor(item: CircuitItem): string {
  if (item.type === "horizontalSegment") {
    return item.color ?? ((item.mode === "absent" || item.autoSuppressed) ? DEFAULT_ABSENT_WIRE_COLOR : DEFAULT_ITEM_COLOR);
  }

  return item.color ?? DEFAULT_ITEM_COLOR;
}

function controlStateFor(item: Extract<CircuitItem, { type: "controlDot" }>): "filled" | "open" {
  return item.controlState ?? "filled";
}

function withPreviewColor<T extends CircuitItem>(item: T): T {
  return {
    ...item,
    color: DEFAULT_ABSENT_WIRE_COLOR
  };
}

function getGateRect(item: GateItem, layout: CircuitLayout, columnMetrics: ColumnMetrics): SelectionRect {
  const rowHeight = getRowHeight(layout);
  const [blockX, blockRight] = getColumnSpanRange(item.point.col, item.span.cols, layout, columnMetrics);
  const blockWidth = blockRight - blockX;
  const width = Math.max(item.width, Math.max(GATE_MIN_WIDTH, blockWidth - 12));
  const x = blockX + ((blockWidth - width) / 2);
  const y = getRowY(item.point.row, layout) - (GATE_MIN_HEIGHT / 2);
  const height = GATE_MIN_HEIGHT + ((item.span.rows - 1) * rowHeight);

  return { x, y, width, height };
}

function getMeterRect(item: MeterItem, layout: CircuitLayout, columnMetrics: ColumnMetrics): SelectionRect {
  const x = getCellCenterX(item.point.col, layout, columnMetrics) - (GATE_MIN_WIDTH / 2);
  const y = getRowY(item.point.row, layout) - (GATE_MIN_HEIGHT / 2);
  const rows = item.span?.rows ?? 1;
  const height = GATE_MIN_HEIGHT + ((rows - 1) * getRowHeight(layout));

  return { x, y, width: GATE_MIN_WIDTH, height };
}

function getFrameRect(item: FrameItem, layout: CircuitLayout, columnMetrics: ColumnMetrics): SelectionRect {
  const rowHeight = getRowHeight(layout);
  const [leftX, rightX] = getColumnSpanRange(item.point.col, item.span.cols, layout, columnMetrics);
  return {
    x: leftX + 4,
    y: getRowY(item.point.row, layout) - (rowHeight / 2) + 6,
    width: Math.max((rightX - leftX) - 8, 18),
    height: Math.max((item.span.rows * rowHeight) - 12, 18)
  };
}

function getSliceRect(
  item: SliceItem,
  qubits: number,
  layout: CircuitLayout,
  columnMetrics: ColumnMetrics
): SelectionRect {
  const x = getColumnRightX(item.point.col, layout, columnMetrics);
  return {
    x: x - 12,
    y: GRID_TOP - 30,
    width: 24,
    height: Math.max(getRowY(qubits - 1, layout) - (GRID_TOP - 30) + 20, 30)
  };
}

function getItemBounds(
  item: CircuitItem,
  steps: number,
  qubits: number,
  layout: CircuitLayout,
  columnMetrics: ColumnMetrics
): SelectionRect {
  if (item.type === "gate") {
    return getGateRect(item, layout, columnMetrics);
  }

  if (item.type === "meter") {
    return getMeterRect(item, layout, columnMetrics);
  }

  if (item.type === "frame") {
    return getFrameRect(item, layout, columnMetrics);
  }

  if (item.type === "slice") {
    return getSliceRect(item, qubits, layout, columnMetrics);
  }

  if (item.type === "verticalConnector") {
    const width = item.wireType === "classical" ? 26 : 20;
    const x = getCellCenterX(item.point.col, layout, columnMetrics) - (width / 2);
    const y = getRowY(item.point.row, layout);
    return {
      x,
      y,
      width,
      height: Math.max(getRowY(item.point.row + item.length, layout) - y, 4)
    };
  }

  if (item.type === "horizontalSegment") {
    const [x1, x2] = getIncomingSegmentRange(item.point.col, steps, layout, columnMetrics);
    return {
      x: x1,
      y: getRowY(item.point.row, layout) - 10,
      width: Math.max(x2 - x1, 12),
      height: 20
    };
  }

  if (item.type === "controlDot") {
    return {
      x: getCellCenterX(item.point.col, layout, columnMetrics) - 8,
      y: getRowY(item.point.row, layout) - 8,
      width: 16,
      height: 16
    };
  }

  return {
    x: getCellCenterX(item.point.col, layout, columnMetrics) - 14,
    y: getRowY(item.point.row, layout) - 14,
    width: 28,
    height: 28
  };
}

function getItemOutlinePadding(item: CircuitItem): { x: number; y: number; radius: number } {
  switch (item.type) {
    case "horizontalSegment":
      return { x: 2, y: 2, radius: 6 };
    case "verticalConnector":
      return { x: 3, y: 2, radius: 6 };
    case "slice":
      return { x: 2, y: 2, radius: 4 };
    case "controlDot":
    case "targetPlus":
    case "swapX":
      return { x: 2, y: 2, radius: 5 };
    default:
      return { x: 2, y: 2, radius: 4 };
  }
}

function renderItemOutline(
  item: CircuitItem,
  tone: ItemOutlineTone,
  steps: number,
  qubits: number,
  layout: CircuitLayout,
  columnMetrics: ColumnMetrics
): JSX.Element {
  const bounds = getItemBounds(item, steps, qubits, layout, columnMetrics);
  const padding = getItemOutlinePadding(item);

  return (
    <rect
      x={bounds.x - padding.x}
      y={bounds.y - padding.y}
      width={bounds.width + (padding.x * 2)}
      height={bounds.height + (padding.y * 2)}
      rx={padding.radius}
      className={`item-outline item-outline-${tone}`}
    />
  );
}

function renderEditableWireLabel(
  row: number,
  side: "left" | "right",
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  align: "left" | "right",
  isEditing: boolean,
  isSelected: boolean,
  placeholder: string,
  onSelect: () => void,
  onStartEditing: () => void,
  onStopEditing: () => void,
  onChange: (value: string) => void
): JSX.Element {
  const foreignX = align === "left" ? x - width : x;
  const normalized = normalizeLabel(label);
  const displayLabel = normalized || placeholder;
  const placeholderClass = !normalized ? "is-empty" : "";
  const mathHtml = normalized && shouldRenderMathLabel(normalized) ? renderGateLabelHtml(normalized) : null;
  const objectHeight = Math.max(height, 40);

  if (isEditing) {
    return (
      <foreignObject
        x={foreignX}
        y={y - (objectHeight / 2)}
        width={width}
        height={objectHeight}
        className="wire-label-editor-foreign-object"
      >
        <div xmlns="http://www.w3.org/1999/xhtml" className={`wire-label-inline-shell wire-label-inline-${align}`}>
          <input
            autoFocus
            aria-label={`Inline ${side} wire label q${row + 1}`}
            className={`wire-label-inline-input wire-label-inline-${align}`}
            spellCheck={false}
            value={label}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onStopEditing}
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelect();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        </div>
      </foreignObject>
    );
  }

  return (
    <foreignObject
      x={foreignX}
      y={y - 20}
      width={width}
      height={40}
      className="wire-label-editor-foreign-object"
    >
      <button
        xmlns="http://www.w3.org/1999/xhtml"
        type="button"
        aria-label={`Edit ${side} wire label q${row + 1}`}
        className={`wire-label-inline-button wire-label-inline-${align} ${placeholderClass} ${isSelected ? "is-selected" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
          onStartEditing();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        {mathHtml ? (
          <span
            className="wire-label-inline-math"
            dangerouslySetInnerHTML={{ __html: mathHtml }}
          />
        ) : (
          <span className="wire-label-inline-text">{displayLabel || "\u00A0"}</span>
        )}
      </button>
    </foreignObject>
  );
}

function wireLabelBracketGlyph(side: WireLabelSide, bracket: "brace" | "bracket" | "paren"): string {
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
): JSX.Element {
  const x =
    side === "left"
      ? GRID_LEFT - 12
      : wireEndX + 12;
  const fontSize = Math.max(34, span * getRowHeight(layout) * 0.78);

  return (
    <text
      x={x}
      y={centerY}
      className={`wire-label-bracket wire-label-bracket-${side}`}
      dominantBaseline="middle"
      textAnchor={side === "left" ? "end" : "start"}
      style={{ fontSize }}
    >
      {wireLabelBracketGlyph(side, bracket)}
    </text>
  );
}

function renderWireLabelMergeButton(
  side: WireLabelSide,
  upperRow: number,
  centerY: number,
  wireEndX: number,
  onMerge: () => void
): JSX.Element {
  const x =
    side === "left"
      ? GRID_LEFT - 28
      : wireEndX + 8;

  return (
    <foreignObject
      x={x}
      y={centerY - 10}
      width={20}
      height={20}
      className="wire-label-merge-foreign-object"
    >
      <button
        xmlns="http://www.w3.org/1999/xhtml"
        type="button"
        className="wire-label-merge-button"
        aria-label={`Merge ${side} labels between q${upperRow + 1} and q${upperRow + 2}`}
        onClick={(event) => {
          event.stopPropagation();
          onMerge();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        +
      </button>
    </foreignObject>
  );
}

function renderWireStroke(
  x1: number,
  x2: number,
  y: number,
  wireType: WireType,
  className: string,
  style?: CSSProperties
): JSX.Element {
  if (wireType === "classical") {
    return (
      <g className={className} style={style}>
        <line x1={x1} x2={x2} y1={y - 3} y2={y - 3} />
        <line x1={x1} x2={x2} y1={y + 3} y2={y + 3} />
      </g>
    );
  }

  return <line x1={x1} x2={x2} y1={y} y2={y} className={className} style={style} />;
}

function renderGate(item: GateItem, isSelected: boolean, layout: CircuitLayout, columnMetrics: ColumnMetrics): JSX.Element {
  const rect = getGateRect(item, layout, columnMetrics);
  const textY = rect.y + (rect.height / 2);
  const label = normalizeGateLabel(item.label);
  const texHtml = renderGateDisplayHtml(label);
  const color = getItemColor(item);

  return (
    <g>
      <rect
        data-kind="gate-rect"
        data-item-id={item.id}
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={0}
        className={`gate-rect ${isSelected ? "is-selected" : ""}`}
        style={{
          stroke: color,
          fill: item.color ? mixHexWithWhite(color, 0.9) : "rgba(255, 254, 250, 1)"
        }}
      />
      {texHtml ? (
        <foreignObject
          x={rect.x + 4}
          y={rect.y + 4}
          width={Math.max(rect.width - 8, 24)}
          height={Math.max(rect.height - 8, 24)}
          className="gate-label-foreign-object"
        >
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            className="gate-label-math"
            style={{ color }}
            dangerouslySetInnerHTML={{ __html: texHtml }}
          />
        </foreignObject>
      ) : (
        <text
          x={rect.x + (rect.width / 2)}
          y={textY}
          className="gate-label"
          dominantBaseline="middle"
          textAnchor="middle"
          style={{ fill: color }}
        >
          {label}
        </text>
      )}
    </g>
  );
}

function renderMeter(item: MeterItem, isSelected: boolean, layout: CircuitLayout, columnMetrics: ColumnMetrics): JSX.Element {
  const rect = getMeterRect(item, layout, columnMetrics);
  const color = getItemColor(item);
  const iconSize = Math.max(rect.width - 12, 12);
  const iconX = rect.x + ((rect.width - iconSize) / 2);
  const iconY = rect.y + ((rect.height - iconSize) / 2);

  return (
    <g>
      <rect
        data-kind="meter-rect"
        data-item-id={item.id}
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={0}
        className={`gate-rect ${isSelected ? "is-selected" : ""}`}
        style={{
          stroke: color,
          fill: item.color ? mixHexWithWhite(color, 0.9) : "rgba(255, 254, 250, 1)"
        }}
      />
      <image
        href={meterBlackIcon}
        x={iconX}
        y={iconY}
        width={iconSize}
        height={iconSize}
        preserveAspectRatio="xMidYMid meet"
        className="meter-glyph"
      />
    </g>
  );
}

function renderFrame(item: FrameItem, isSelected: boolean, layout: CircuitLayout, columnMetrics: ColumnMetrics): JSX.Element {
  const rect = getFrameRect(item, layout, columnMetrics);
  const color = getItemColor(item);

  return (
    <g className={`annotation-frame ${isSelected ? "is-selected" : ""}`}>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={item.rounded ? 12 : 0}
        className="annotation-frame-rect"
        style={{
          stroke: color,
          fill: item.background ? mixHexWithWhite(color, 0.93) : "transparent",
          strokeDasharray: item.dashed ? "8 6" : undefined
        }}
      />
      <text
        x={rect.x + (rect.width / 2)}
        y={rect.y - 8}
        textAnchor="middle"
        className="annotation-frame-label"
        style={{ fill: color }}
      >
        {normalizeGateLabel(item.label)}
      </text>
    </g>
  );
}

function renderSlice(
  item: SliceItem,
  isSelected: boolean,
  qubits: number,
  layout: CircuitLayout,
  columnMetrics: ColumnMetrics
): JSX.Element {
  const x = getColumnRightX(item.point.col, layout, columnMetrics);
  return (
    <g className={`slice-annotation ${isSelected ? "is-selected" : ""}`}>
      <line
        x1={x}
        x2={x}
        y1={GRID_TOP - 16}
        y2={getRowY(qubits - 1, layout) + 18}
        className="slice-line"
        style={{ stroke: getItemColor(item) }}
      />
      <text
        x={x + 4}
        y={GRID_TOP - 24}
        className="slice-label"
        style={{ fill: getItemColor(item) }}
      >
        {normalizeGateLabel(item.label)}
      </text>
    </g>
  );
}

function renderVerticalConnector(
  item: VerticalConnectorItem,
  isSelected: boolean,
  layout: CircuitLayout,
  columnMetrics: ColumnMetrics
): JSX.Element {
  const x = getCellCenterX(item.point.col, layout, columnMetrics);
  const y1 = getRowY(item.point.row, layout);
  const y2 = getRowY(item.point.row + item.length, layout);
  const className = `vertical-connector ${isSelected ? "is-selected" : ""}`;
  const style = { stroke: getItemColor(item) };

  if (item.wireType === "classical") {
    return (
      <g className={className} style={style}>
        <line x1={x - 3} x2={x - 3} y1={y1} y2={y2} />
        <line x1={x + 3} x2={x + 3} y1={y1} y2={y2} />
      </g>
    );
  }

  return <line x1={x} x2={x} y1={y1} y2={y2} className={className} style={style} />;
}

function renderMarker(
  item: CircuitItem,
  isSelected: boolean,
  layout: CircuitLayout,
  columnMetrics: ColumnMetrics,
  invalidSwap = false
): JSX.Element {
  const cx = getCellCenterX(item.point.col, layout, columnMetrics);
  const cy = getRowY(item.point.row, layout);
  const color = invalidSwap ? INVALID_SWAP_COLOR : getItemColor(item);

  if (item.type === "controlDot") {
    const controlState = controlStateFor(item);
    return (
      <circle
        cx={cx}
        cy={cy}
        r={7}
        className={`control-dot control-dot-${controlState} ${isSelected ? "is-selected" : ""}`}
        style={{
          fill: controlState === "open" ? "#FFF8EF" : color,
          stroke: controlState === "open" ? color : "none"
        }}
      />
    );
  }

  if (item.type === "targetPlus") {
    const iconSize = 28;
    return (
      <g className={`target-plus ${isSelected ? "is-selected" : ""}`} style={{ stroke: color }}>
        <image
          href={targBlackIcon}
          x={cx - (iconSize / 2)}
          y={cy - (iconSize / 2)}
          width={iconSize}
          height={iconSize}
          preserveAspectRatio="xMidYMid meet"
        />
      </g>
    );
  }

  return (
    <g className={`swap-x ${isSelected ? "is-selected" : ""} ${invalidSwap ? "is-invalid" : ""}`} style={{ stroke: color }}>
      {invalidSwap && (
        <rect
          x={cx - 10}
          y={cy - 10}
          width={20}
          height={20}
          rx={4}
          className="swap-x-border"
        />
      )}
      <line x1={cx - 8} x2={cx + 8} y1={cy - 8} y2={cy + 8} />
      <line x1={cx - 8} x2={cx + 8} y1={cy + 8} y2={cy - 8} />
    </g>
  );
}

function renderHorizontalSegment(
  item: HorizontalSegmentItem,
  isSelected: boolean,
  steps: number,
  layout: CircuitLayout,
  columnMetrics: ColumnMetrics
): JSX.Element {
  const [x1, x2] = getIncomingSegmentRange(item.point.col, steps, layout, columnMetrics);
  const y = getRowY(item.point.row, layout);
  const color = getItemColor(item);
  const isAbsent = item.mode === "absent" || item.autoSuppressed;

  if (!isAbsent) {
    return (
      <g className={`horizontal-segment ${isSelected ? "is-selected" : ""}`}>
        <line x1={x1} x2={x2} y1={y} y2={y} className="horizontal-segment-hit" />
        {isSelected && renderWireStroke(x1, x2, y, item.wireType, "horizontal-segment-selection")}
        {renderWireStroke(x1, x2, y, item.wireType, "horizontal-segment-stroke", { stroke: color })}
      </g>
    );
  }

  return (
    <g className={`absent-override ${isSelected ? "is-selected" : ""}`} style={{ stroke: color }}>
      {!item.autoSuppressed && renderWireStroke(x1, x2, y, item.wireType, "absent-override-hit", { stroke: color })}
      {isSelected && <line x1={x1} x2={x2} y1={y} y2={y} className="absent-override-selection" />}
    </g>
  );
}

function renderVerticalHover(
  row: number,
  col: number,
  qubits: number,
  layout: CircuitLayout,
  columnMetrics: ColumnMetrics,
  length = 1,
  invalid = false
): JSX.Element | null {
  if (row >= qubits - 1) {
    return null;
  }

  const x = getCellCenterX(col, layout, columnMetrics);
  const topY = getRowY(row, layout);
  const bottomY = getRowY(Math.min(row + length, qubits - 1), layout);
  const previewTop = topY + 4;
  const previewHeight = Math.max(bottomY - topY - 8, 12);

  return (
    <g className={`hover-vertical-group ${invalid ? "is-invalid" : ""}`}>
      <rect
        x={x - 12}
        y={previewTop}
        width={24}
        height={previewHeight}
        rx={10}
        className="hover-vertical-slot"
      />
      <line
        x1={x}
        x2={x}
        y1={topY}
        y2={bottomY}
        className="hover-vertical-line"
      />
    </g>
  );
}

export function Workspace({
  state,
  isPasteMode,
  pasteClipboard,
  selectedWireLabelGroup,
  onLayoutSpacingChange,
  onWireLabelChange,
  onSelectWireLabelGroup,
  onMergeWireLabelGroup,
  onPlaceItem,
  onDrawGate,
  onDrawMeter,
  onDrawAnnotation,
  onPasteAt,
  onMoveItem,
  onMoveSelection,
  onSelectionChange,
  onResizeGrid,
  onBoardMetricsChange
}: WorkspaceProps): JSX.Element {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoverPlacement, setHoverPlacement] = useState<PlacementTarget | null>(null);
  const [marquee, setMarquee] = useState<MarqueeSelection | null>(null);
  const [editingWireLabel, setEditingWireLabel] = useState<{ row: number; side: "left" | "right" } | null>(null);
  const [areaDraw, setAreaDraw] = useState<AreaDrawState | null>(null);
  const [pencilStroke, setPencilStroke] = useState<PencilStrokeState | null>(null);
  const [swapTooltip, setSwapTooltip] = useState<{ message: string; x: number; y: number } | null>(null);
  const pencilVisitedRef = useRef<Set<string>>(new Set());
  const dragPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const dragGrowRef = useRef({ lastRowGrowAt: 0, lastColGrowAt: 0 });
  const lastPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const layout = state.layout;
  const columnMetrics = useMemo(
    () => getColumnMetrics(state.steps, state.items, layout),
    [layout, state.items, state.steps]
  );
  const rowHeight = getRowHeight(layout);
  const width = getGridWidth(state.steps, layout, columnMetrics);
  const height = getGridHeight(state.qubits, layout);
  const wireEndX = getWireEndX(state.steps, layout, columnMetrics);
  const selectionSet = useMemo(() => new Set(state.selectedItemIds), [state.selectedItemIds]);
  const draggingItem = useMemo(
    () => state.items.find((item) => item.id === dragState?.anchorItemId) ?? null,
    [dragState, state.items]
  );
  const hoverTool = draggingItem
    ? draggingItem.type
    : isPasteMode
      ? getClipboardPlacementTool(pasteClipboard)
      : state.activeTool;
  const verticalHoverLength = draggingItem?.type === "verticalConnector" ? draggingItem.length : 1;
  const pasteAnchor = hoverPlacement ? { row: hoverPlacement.row, col: hoverPlacement.col } : null;
  const pastePreviewValid =
    !!isPasteMode &&
    !!pasteClipboard &&
    !!pasteAnchor &&
    canPasteClipboardAt(state, pasteClipboard, pasteAnchor);
  const pastePreviewItems =
    isPasteMode && pasteClipboard && pasteAnchor
      ? instantiateClipboardItems(pasteClipboard, pasteAnchor)
      : [];
  const marqueeRect = marquee ? normalizeRect(marquee.start, marquee.current) : null;
  const wireLayerItems = useMemo(() => state.items.filter(isWireLayerItem), [state.items]);
  const gateLayerItems = useMemo(() => state.items.filter(isGateLikeItem), [state.items]);
  const annotationBackgroundItems = useMemo(() => state.items.filter(isAnnotationBackgroundItem), [state.items]);
  const annotationOverlayItems = useMemo(() => state.items.filter(isAnnotationOverlayItem), [state.items]);
  const markerLayerItems = useMemo(() => state.items.filter(isMarkerItem), [state.items]);
  const swapStatuses = useMemo(() => getSwapStatusById(state.items), [state.items]);
  const previewWireItems = useMemo(() => pastePreviewItems.filter(isWireLayerItem), [pastePreviewItems]);
  const previewGateItems = useMemo(() => pastePreviewItems.filter(isGateLikeItem), [pastePreviewItems]);
  const previewAnnotationBackgroundItems = useMemo(() => pastePreviewItems.filter(isAnnotationBackgroundItem), [pastePreviewItems]);
  const previewAnnotationOverlayItems = useMemo(() => pastePreviewItems.filter(isAnnotationOverlayItem), [pastePreviewItems]);
  const previewMarkerItems = useMemo(() => pastePreviewItems.filter(isMarkerItem), [pastePreviewItems]);
  const pastePlacementTool = getClipboardPlacementTool(pasteClipboard);
  const dragPreviewProjection = useMemo(() => {
    if (!dragState || !draggingItem || !hoverPlacement || areaDraw || isPasteMode) {
      return null;
    }

    return projectSelectionMove(state.items, state.selectedItemIds, dragState.anchorItemId, hoverPlacement);
  }, [areaDraw, dragState, draggingItem, hoverPlacement, isPasteMode, state.items, state.selectedItemIds]);
  const dragPreviewValid = useMemo(() => {
    if (!dragPreviewProjection) {
      return true;
    }

    return canPlaceItemsWithoutOverlap(state.items, dragPreviewProjection.movedItems, dragPreviewProjection.selectedIds);
  }, [dragPreviewProjection, state.items]);
  const hoverProjectionItems = useMemo(() => {
    if (dragPreviewProjection) {
      return dragPreviewProjection.finalItems
        .filter((item) => dragPreviewProjection.selectedIds.has(item.id))
        .map(withPreviewColor);
    }

    if (!hoverPlacement || areaDraw || isPasteMode || hoverTool === "select" || hoverTool === "pencil") {
      return [];
    }

    if (hoverPlacement.kind !== "cell") {
      return [];
    }

    switch (state.activeTool) {
      case "gate":
        return [withPreviewColor({
          id: "hover-preview-gate",
          type: "gate",
          point: { row: hoverPlacement.row, col: hoverPlacement.col },
          span: { rows: 1, cols: 1 },
          label: "U",
          width: GATE_MIN_WIDTH,
          color: DEFAULT_ABSENT_WIRE_COLOR
        })];
      case "meter":
        return [withPreviewColor({
          id: "hover-preview-meter",
          type: "meter",
          point: { row: hoverPlacement.row, col: hoverPlacement.col },
          span: { rows: 1, cols: 1 },
          color: DEFAULT_ABSENT_WIRE_COLOR
        })];
      case "annotation":
        return [withPreviewColor({
          id: "hover-preview-slice",
          type: "slice",
          point: { row: hoverPlacement.row, col: hoverPlacement.col },
          label: "slice",
          color: DEFAULT_ABSENT_WIRE_COLOR
        })];
      case "controlDot":
        return [withPreviewColor({
          id: "hover-preview-control",
          type: "controlDot",
          point: { row: hoverPlacement.row, col: hoverPlacement.col },
          controlState: "filled",
          color: DEFAULT_ABSENT_WIRE_COLOR
        })];
      case "targetPlus":
        return [withPreviewColor({
          id: "hover-preview-target",
          type: "targetPlus",
          point: { row: hoverPlacement.row, col: hoverPlacement.col },
          color: DEFAULT_ABSENT_WIRE_COLOR
        })];
      case "swapX":
        return [withPreviewColor({
          id: "hover-preview-swap",
          type: "swapX",
          point: { row: hoverPlacement.row, col: hoverPlacement.col },
          color: DEFAULT_ABSENT_WIRE_COLOR
        })];
      default:
        return [];
    }
  }, [areaDraw, dragPreviewProjection, hoverPlacement, hoverTool, isPasteMode, state.activeTool]);
  const hoverProjectionWireItems = useMemo(() => hoverProjectionItems.filter(isWireLayerItem), [hoverProjectionItems]);
  const hoverProjectionGateItems = useMemo(() => hoverProjectionItems.filter(isGateLikeItem), [hoverProjectionItems]);
  const hoverProjectionAnnotationBackgroundItems = useMemo(() => hoverProjectionItems.filter(isAnnotationBackgroundItem), [hoverProjectionItems]);
  const hoverProjectionAnnotationOverlayItems = useMemo(() => hoverProjectionItems.filter(isAnnotationOverlayItem), [hoverProjectionItems]);
  const hoverProjectionMarkerItems = useMemo(() => hoverProjectionItems.filter(isMarkerItem), [hoverProjectionItems]);

  useEffect(() => {
    if (!isPasteMode) {
      return;
    }

    const lastPointer = lastPointerRef.current;
    if (!lastPointer) {
      return;
    }

    setHoverPlacement(resolvePlacement(lastPointer.clientX, lastPointer.clientY, pastePlacementTool));
  }, [isPasteMode, pastePlacementTool]);

  useEffect(() => {
    if (editingWireLabel && editingWireLabel.row >= state.qubits) {
      setEditingWireLabel(null);
    }
  }, [editingWireLabel, state.qubits]);

  function resolvePlacement(clientX: number, clientY: number, tool: ToolType | ItemType): PlacementTarget | null {
    const board = boardRef.current;
    if (!board) {
      return null;
    }

    const placement = placementFromViewportPoint(clientX, clientY, getBoardMetrics(board), tool, state);
    if (!placement || placement.kind !== "cell" || !draggingItem) {
      return placement;
    }

    if (draggingItem.type === "gate") {
      return {
        ...placement,
        row: Math.min(placement.row, state.qubits - draggingItem.span.rows),
        col: Math.min(placement.col, state.steps - draggingItem.span.cols)
      };
    }

    if (draggingItem.type === "meter") {
      return {
        ...placement,
        row: Math.min(placement.row, state.qubits - draggingItem.span.rows)
      };
    }

    if (draggingItem.type === "frame") {
      return {
        ...placement,
        row: Math.min(placement.row, state.qubits - draggingItem.span.rows),
        col: Math.min(placement.col, state.steps - draggingItem.span.cols)
      };
    }

    if (draggingItem.type === "verticalConnector") {
      return {
        ...placement,
        row: Math.min(placement.row, state.qubits - draggingItem.length - 1)
      };
    }

    return placement;
  }

  function maybeGrowDragGrid(clientX: number, clientY: number): void {
    const board = boardRef.current;
    if (!board) {
      return;
    }

    const now = Date.now();
    const rect = board.getBoundingClientRect();

    if (clientY > rect.bottom + 12 && now - dragGrowRef.current.lastRowGrowAt > 180) {
      dragGrowRef.current.lastRowGrowAt = now;
      onResizeGrid("qubits", state.qubits + 1);
    }

    if (clientX > rect.right + 12 && now - dragGrowRef.current.lastColGrowAt > 180) {
      dragGrowRef.current.lastColGrowAt = now;
      onResizeGrid("steps", state.steps + 1);
    }
  }

  function getClampedContentPoint(clientX: number, clientY: number): ContentPoint | null {
    const board = boardRef.current;
    if (!board) {
      return null;
    }

    const metrics = getBoardMetrics(board);
    const clampedX = Math.min(Math.max(clientX, metrics.left), metrics.left + metrics.width);
    const clampedY = Math.min(Math.max(clientY, metrics.top), metrics.top + metrics.height);

    return {
      x: clampedX - metrics.left + metrics.scrollLeft,
      y: clampedY - metrics.top + metrics.scrollTop
    };
  }

  function updateHoverFromPointer(clientX: number, clientY: number, tool: ToolType | ItemType): void {
    setHoverPlacement(resolvePlacement(clientX, clientY, tool));
  }

  function placeWithTool(tool: ItemType, placement: PlacementTarget | null): void {
    if (!placement) {
      return;
    }

    onPlaceItem(tool, placement);
  }

  function placementKey(placement: PlacementTarget): string {
    return `${placement.kind}:${placement.row}:${placement.col}`;
  }

  function applyPencilPlacement(placement: PlacementTarget | null, expectedKind: PlacementTarget["kind"]): void {
    if (!placement || placement.kind !== expectedKind) {
      return;
    }

    const key = placementKey(placement);
    if (pencilVisitedRef.current.has(key)) {
      return;
    }
    pencilVisitedRef.current.add(key);

    if (placement.kind === "segment") {
      placeWithTool("horizontalSegment", placement);
      return;
    }

    if (canPlaceCellToolAtRow("pencil", placement.row, state.qubits)) {
      placeWithTool("verticalConnector", placement);
    }
  }

  function beginPencilStroke(placement: PlacementTarget): void {
    pencilVisitedRef.current = new Set();
    setPencilStroke({ kind: placement.kind });
    applyPencilPlacement(placement, placement.kind);
  }

  function placePastedClipboardFromPointer(clientX: number, clientY: number): void {
    if (!isPasteMode || !pasteClipboard) {
      return;
    }

    const placement = hoverPlacement ?? resolvePlacement(clientX, clientY, pastePlacementTool);
    if (!placement) {
      return;
    }

    onPasteAt(placement);
  }

  function startAreaDraw(tool: "gate" | "meter" | "annotation", placement: PlacementTarget | null): void {
    if (!placement || placement.kind !== "cell") {
      return;
    }

    setAreaDraw({
      tool,
      start: { row: placement.row, col: placement.col },
      current: { row: placement.row, col: placement.col }
    });
    setHoverPlacement(placement);
  }

  function handleToolPointerDown(clientX: number, clientY: number): void {
    if (state.activeTool === "select") {
      return;
    }

    const placement = resolvePlacement(clientX, clientY, state.activeTool);
    if (!placement) {
      return;
    }

    if (state.activeTool === "gate") {
      startAreaDraw("gate", placement);
      return;
    }

    if (state.activeTool === "meter") {
      startAreaDraw("meter", placement);
      return;
    }

    if (state.activeTool === "annotation") {
      startAreaDraw("annotation", placement);
      return;
    }

    if (state.activeTool === "pencil") {
      beginPencilStroke(placement);
      return;
    }

    if (placement.kind === "cell" && canPlaceCellToolAtRow(state.activeTool, placement.row, state.qubits)) {
      placeWithTool(state.activeTool, placement);
    }
  }

  function renderInteractiveItem(item: CircuitItem): JSX.Element {
    const selected = selectionSet.has(item.id);
    const swapStatus = item.type === "swapX" ? swapStatuses.get(item.id) : null;
    const invalidSwap = item.type === "swapX" && !!swapStatus && !swapStatus.valid;
    const rendered =
      item.type === "gate"
        ? renderGate(item, selected, layout, columnMetrics)
        : item.type === "meter"
          ? renderMeter(item, selected, layout, columnMetrics)
          : item.type === "frame"
            ? renderFrame(item, selected, layout, columnMetrics)
            : item.type === "slice"
              ? renderSlice(item, selected, state.qubits, layout, columnMetrics)
          : item.type === "verticalConnector"
            ? renderVerticalConnector(item, selected, layout, columnMetrics)
            : item.type === "horizontalSegment"
          ? renderHorizontalSegment(item, selected, state.steps, layout, columnMetrics)
              : renderMarker(item, selected, layout, columnMetrics, invalidSwap);

    return (
      <g
        key={item.id}
        data-item-id={item.id}
        data-testid={`item-${item.id}`}
        className="item-group"
        onPointerEnter={(event) => {
          if (!invalidSwap || !swapStatus?.message) {
            return;
          }

          setSwapTooltip({
            message: swapStatus.message,
            x: Number.isFinite(event.clientX) ? event.clientX : 0,
            y: Number.isFinite(event.clientY) ? event.clientY : 0
          });
        }}
        onPointerMove={(event) => {
          if (!invalidSwap || !swapStatus?.message) {
            return;
          }

          setSwapTooltip({
            message: swapStatus.message,
            x: Number.isFinite(event.clientX) ? event.clientX : 0,
            y: Number.isFinite(event.clientY) ? event.clientY : 0
          });
        }}
        onPointerLeave={() => {
          if (invalidSwap) {
            setSwapTooltip(null);
          }
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setSwapTooltip(null);

          if (isPasteMode) {
            placePastedClipboardFromPointer(event.clientX, event.clientY);
            return;
          }

          if (state.activeTool !== "select") {
            handleToolPointerDown(event.clientX, event.clientY);
            return;
          }

          if (event.altKey) {
            const point = getClampedContentPoint(event.clientX, event.clientY);
            if (point) {
              setMarquee({ start: point, current: point });
            }
            return;
          }

          const additive = event.shiftKey || event.metaKey || event.ctrlKey;
          const alreadySelected = selectionSet.has(item.id);

          if (additive) {
            onSelectionChange(
              alreadySelected
                ? state.selectedItemIds.filter((itemId) => itemId !== item.id)
                : [...state.selectedItemIds, item.id]
            );
            return;
          }

          if (!alreadySelected) {
            onSelectionChange([item.id]);
            return;
          }

          dragPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
          dragGrowRef.current = { lastRowGrowAt: 0, lastColGrowAt: 0 };
          setDragState({
            anchorItemId: item.id,
            constrainVertical: selectionHasExternalVerticalLinks(state.items, state.selectedItemIds, item.id)
          });
          updateHoverFromPointer(event.clientX, event.clientY, item.type);
        }}
      >
        {selected && renderItemOutline(item, "selected", state.steps, state.qubits, layout, columnMetrics)}
        {rendered}
      </g>
    );
  }

  function renderPreviewItem(item: CircuitItem, key: string, invalid = false): JSX.Element {
    const previewInvalidSwap = item.type === "swapX" && invalid;
    const rendered =
      item.type === "gate"
        ? renderGate(item, false, layout, columnMetrics)
        : item.type === "meter"
          ? renderMeter(item, false, layout, columnMetrics)
          : item.type === "frame"
            ? renderFrame(item, false, layout, columnMetrics)
            : item.type === "slice"
              ? renderSlice(item, false, state.qubits, layout, columnMetrics)
          : item.type === "verticalConnector"
            ? renderVerticalConnector(item, false, layout, columnMetrics)
            : item.type === "horizontalSegment"
          ? renderHorizontalSegment(item, false, state.steps, layout, columnMetrics)
              : renderMarker(item, false, layout, columnMetrics, previewInvalidSwap);

    return (
      <g key={key} className={`paste-preview-item ${invalid ? "is-invalid" : ""}`}>
        {renderItemOutline(item, invalid ? "invalid-preview" : "preview", state.steps, state.qubits, layout, columnMetrics)}
        {rendered}
      </g>
    );
  }

  useEffect(() => {
    const board = boardRef.current;
    if (!board) {
      onBoardMetricsChange(null);
      return;
    }

    const updateMetrics = () => {
      onBoardMetricsChange(getBoardMetrics(board));
    };

    updateMetrics();

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateMetrics);
    resizeObserver?.observe(board);
    board.addEventListener("scroll", updateMetrics);
    window.addEventListener("resize", updateMetrics);

    return () => {
      resizeObserver?.disconnect();
      board.removeEventListener("scroll", updateMetrics);
      window.removeEventListener("resize", updateMetrics);
      onBoardMetricsChange(null);
    };
  }, [onBoardMetricsChange, state.items, state.qubits, state.steps, state.layout.columnSepCm, state.layout.rowSepCm]);

  useEffect(() => {
    if (!dragState || !draggingItem) {
      return;
    }

    const dragTool = draggingItem.type;

    const handlePointerMove = (event: PointerEvent) => {
      lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      dragPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      maybeGrowDragGrid(event.clientX, event.clientY);

      const placement = resolvePlacement(event.clientX, event.clientY, dragTool);
      if (!placement) {
        return;
      }

      setHoverPlacement(
        dragState.constrainVertical
          ? { ...placement, col: placementForItem(draggingItem).col }
          : placement
      );
    };

    const finishDrag = (event: PointerEvent) => {
      const placement = resolvePlacement(event.clientX, event.clientY, dragTool) ?? hoverPlacement;
      if (placement) {
        const nextPlacement = dragState.constrainVertical
          ? { ...placement, col: placementForItem(draggingItem).col }
          : placement;

        if (state.selectedItemIds.length > 1 || selectionSet.has(dragState.anchorItemId)) {
          onMoveSelection(dragState.anchorItemId, nextPlacement);
        } else {
          onMoveItem(dragState.anchorItemId, nextPlacement);
        }
      }

      setDragState(null);
      setHoverPlacement(null);
      dragPointerRef.current = null;
    };

    const growthInterval = window.setInterval(() => {
      const pointer = dragPointerRef.current;
      if (!pointer) {
        return;
      }

      maybeGrowDragGrid(pointer.clientX, pointer.clientY);
    }, 180);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);

    return () => {
      window.clearInterval(growthInterval);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [dragState, draggingItem, hoverPlacement, onMoveItem, onMoveSelection, onResizeGrid, selectionSet, state.qubits, state.selectedItemIds.length, state.steps]);

  useEffect(() => {
    if (!marquee) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const point = getClampedContentPoint(event.clientX, event.clientY);
      if (point) {
        setMarquee((current) => (current ? { ...current, current: point } : current));
      }
    };

    const finishSelection = (event: PointerEvent) => {
      const point = getClampedContentPoint(event.clientX, event.clientY) ?? marquee.current;
      const rect = normalizeRect(marquee.start, point);
      if (rect.width < 4 && rect.height < 4) {
        onSelectionChange([]);
      } else {
        onSelectionChange(
          state.items
            .filter((item) => rectsIntersect(getItemBounds(item, state.steps, state.qubits, layout, columnMetrics), rect))
            .map((item) => item.id)
        );
      }
      setMarquee(null);
      setHoverPlacement(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishSelection);
    window.addEventListener("pointercancel", finishSelection);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishSelection);
      window.removeEventListener("pointercancel", finishSelection);
    };
  }, [columnMetrics, layout, marquee, onSelectionChange, state.items, state.qubits, state.steps]);

  useEffect(() => {
    if (!pencilStroke) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const placement = resolvePlacement(event.clientX, event.clientY, "pencil");
      setHoverPlacement(placement);
      applyPencilPlacement(placement, pencilStroke.kind);
    };

    const finishStroke = () => {
      pencilVisitedRef.current = new Set();
      setPencilStroke(null);
      setHoverPlacement(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishStroke);
    window.addEventListener("pointercancel", finishStroke);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishStroke);
      window.removeEventListener("pointercancel", finishStroke);
    };
  }, [pencilStroke, state.activeTool, state.qubits]);

  useEffect(() => {
    if (!areaDraw) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const placement = resolvePlacement(event.clientX, event.clientY, areaDraw.tool);
      if (!placement || placement.kind !== "cell") {
        return;
      }

      setAreaDraw((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          current: {
            row: placement.row,
            col: current.tool === "meter" ? current.start.col : placement.col
          }
        };
      });
      setHoverPlacement(placement);
    };

    const finishAreaDraw = (event: PointerEvent) => {
      const placement = resolvePlacement(event.clientX, event.clientY, areaDraw.tool);
      const finalCell =
        placement && placement.kind === "cell"
          ? placement
          : { kind: "cell" as const, row: areaDraw.current.row, col: areaDraw.current.col };

      if (areaDraw.tool === "gate") {
        onDrawGate(areaDraw.start, { row: finalCell.row, col: finalCell.col });
      } else if (areaDraw.tool === "annotation") {
        onDrawAnnotation(areaDraw.start, { row: finalCell.row, col: finalCell.col });
      } else {
        onDrawMeter(areaDraw.start, finalCell.row);
      }

      setAreaDraw(null);
      setHoverPlacement(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishAreaDraw);
    window.addEventListener("pointercancel", finishAreaDraw);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishAreaDraw);
      window.removeEventListener("pointercancel", finishAreaDraw);
    };
  }, [areaDraw, onDrawAnnotation, onDrawGate, onDrawMeter]);

  function renderAreaPreview(): JSX.Element | null {
    if (!areaDraw) {
      return null;
    }

    const topRow = Math.min(areaDraw.start.row, areaDraw.current.row);
    const leftCol = Math.min(areaDraw.start.col, areaDraw.current.col);
    const rows = Math.abs(areaDraw.current.row - areaDraw.start.row) + 1;
    const cols = Math.abs(areaDraw.current.col - areaDraw.start.col) + 1;

    if (areaDraw.tool === "gate") {
      return renderPreviewItem(
        {
          id: "area-preview-gate",
          type: "gate",
          point: { row: topRow, col: leftCol },
          span: { rows, cols },
          label: "U",
          width: GATE_MIN_WIDTH,
          color: null
        },
        "area-preview-gate"
      );
    }

    if (areaDraw.tool === "annotation") {
      const topRow = Math.min(areaDraw.start.row, areaDraw.current.row);
      const leftCol = Math.min(areaDraw.start.col, areaDraw.current.col);
      const rows = Math.abs(areaDraw.current.row - areaDraw.start.row) + 1;
      const cols = Math.abs(areaDraw.current.col - areaDraw.start.col) + 1;

      if (rows === 1 && cols === 1) {
        return renderPreviewItem(
          {
            id: "area-preview-slice",
            type: "slice",
            point: { row: areaDraw.start.row, col: areaDraw.start.col },
            label: "slice",
            color: null
          },
          "area-preview-slice"
        );
      }

      return renderPreviewItem(
        {
          id: "area-preview-frame",
          type: "frame",
          point: { row: topRow, col: leftCol },
          span: { rows, cols },
          label: "Group",
          rounded: true,
          dashed: true,
          background: true,
          innerXSepPt: 2,
          color: null
        },
        "area-preview-frame"
      );
    }

    return renderPreviewItem(
      {
        id: "area-preview-meter",
        type: "meter",
        point: { row: topRow, col: areaDraw.start.col },
        span: { rows, cols: 1 },
        color: null
      },
      "area-preview-meter"
    );
  }

  return (
    <section className="panel workspace-panel">
      <div className="panel-heading">
        <p className="eyebrow">Workbench</p>
        <h2>Grid editor</h2>
      </div>
      <div className="spacing-toolbar">
        <label className="spacing-control">
          <span>Row spacing</span>
          <input
            aria-label="Row spacing"
            type="range"
            min="0.45"
            max="1.8"
            step="0.05"
            value={state.layout.rowSepCm}
            onChange={(event) => onLayoutSpacingChange("rowSepCm", Number(event.target.value))}
          />
          <strong>{state.layout.rowSepCm.toFixed(2)}cm</strong>
        </label>
        <label className="spacing-control">
          <span>Column spacing</span>
          <input
            aria-label="Column spacing"
            type="range"
            min="0.4"
            max="1.6"
            step="0.05"
            value={state.layout.columnSepCm}
            onChange={(event) => onLayoutSpacingChange("columnSepCm", Number(event.target.value))}
          />
          <strong>{state.layout.columnSepCm.toFixed(2)}cm</strong>
        </label>
      </div>
      <div
        ref={boardRef}
        className="workspace-board"
        onClickCapture={(event) => {
          if (!isPasteMode) {
            return;
          }

          const target = event.target;
          if (target instanceof Element && target.closest(".item-group")) {
            return;
          }

          placePastedClipboardFromPointer(event.clientX, event.clientY);
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || isPasteMode) {
            return;
          }

          if (state.activeTool !== "select") {
            const target = event.target;
            if (target instanceof Element && target.closest(".item-group, .grid-hit-cell, .grid-hit-segment")) {
              return;
            }

            handleToolPointerDown(event.clientX, event.clientY);
            return;
          }

          const point = getClampedContentPoint(event.clientX, event.clientY);
          if (!point) {
            return;
          }

          setMarquee({ start: point, current: point });
        }}
        onPointerMove={(event) => {
          lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };

          if (dragState || marquee || areaDraw || pencilStroke) {
            return;
          }

          if (isPasteMode) {
            updateHoverFromPointer(event.clientX, event.clientY, pastePlacementTool);
            return;
          }

          if (state.activeTool !== "select") {
            updateHoverFromPointer(event.clientX, event.clientY, state.activeTool);
          }
        }}
        onPointerLeave={() => {
          if (!dragState && !marquee && !areaDraw && !pencilStroke) {
            setHoverPlacement(null);
          }
          setSwapTooltip(null);
        }}
      >
        <svg width={width} height={height} className="workspace-svg" aria-label="Circuit workbench">
          {Array.from({ length: state.steps }, (_, col) => (
            <g key={`grid-col-${col}`}>
              <line
                x1={getColumnLeftX(col, layout, columnMetrics)}
                x2={getColumnLeftX(col, layout, columnMetrics)}
                y1={GRID_TOP - 34}
                y2={getRowY(state.qubits - 1, layout) + 18}
                className="grid-guide"
              />
              <text
                x={getCellCenterX(col, layout, columnMetrics)}
                y={GRID_TOP - 38}
                className="grid-label"
                textAnchor="middle"
              >
                {col + 1}
              </text>
            </g>
          ))}

          {Array.from({ length: state.qubits }, (_, row) => {
            const y = getRowY(row, layout);
            const leftLabel = state.wireLabels[row]?.left ?? "";
            const rightLabel = state.wireLabels[row]?.right ?? "";
            const leftSpan = getWireLabelSpan(state.wireLabels[row], "left");
            const rightSpan = getWireLabelSpan(state.wireLabels[row], "right");
            const leftBracket = getWireLabelBracket(state.wireLabels[row], "left");
            const rightBracket = getWireLabelBracket(state.wireLabels[row], "right");
            const leftCenterY = y + (((leftSpan - 1) * rowHeight) / 2);
            const rightCenterY = y + (((rightSpan - 1) * rowHeight) / 2);
            const leftLabelX = GRID_LEFT - 18 - (leftSpan > 1 && leftBracket !== "none" ? 26 : 0);
            const rightLabelX = wireEndX + 18 + (rightSpan > 1 && rightBracket !== "none" ? 26 : 0);
            const leftSelected =
              selectedWireLabelGroup?.side === "left" && selectedWireLabelGroup.row === row;
            const rightSelected =
              selectedWireLabelGroup?.side === "right" && selectedWireLabelGroup.row === row;

            return (
              <g key={`row-label-${row}`}>
                <text
                  x={16}
                  y={y}
                  className="grid-label grid-row-label"
                  dominantBaseline="middle"
                  textAnchor="start"
                >
                  {row + 1}
                </text>
                {isWireLabelGroupStart(state.wireLabels, row, "left") && (
                  <>
                    {leftSpan > 1 && leftBracket !== "none" &&
                      renderWireLabelBracket("left", leftBracket as "brace" | "bracket" | "paren", leftCenterY, leftSpan, wireEndX, layout)}
                    {renderEditableWireLabel(
                      row,
                      "left",
                      leftLabel,
                      leftLabelX,
                      leftCenterY,
                      LEFT_LABEL_WIDTH,
                      Math.max(40, leftSpan * rowHeight),
                      "left",
                      editingWireLabel?.row === row && editingWireLabel.side === "left",
                      leftSelected,
                      "",
                      () => onSelectWireLabelGroup(row, "left"),
                      () => {
                        onSelectWireLabelGroup(row, "left");
                        setEditingWireLabel({ row, side: "left" });
                      },
                      () => setEditingWireLabel((current) =>
                        current?.row === row && current.side === "left" ? null : current
                      ),
                      (label) => onWireLabelChange(row, "left", label)
                    )}
                  </>
                )}
                {isWireLabelGroupStart(state.wireLabels, row, "right") && (
                  <>
                    {rightSpan > 1 && rightBracket !== "none" &&
                      renderWireLabelBracket("right", rightBracket as "brace" | "bracket" | "paren", rightCenterY, rightSpan, wireEndX, layout)}
                    {renderEditableWireLabel(
                      row,
                      "right",
                      rightLabel,
                      rightLabelX,
                      rightCenterY,
                      RIGHT_LABEL_WIDTH,
                      Math.max(40, rightSpan * rowHeight),
                      "right",
                      editingWireLabel?.row === row && editingWireLabel.side === "right",
                      rightSelected,
                      "",
                      () => onSelectWireLabelGroup(row, "right"),
                      () => {
                        onSelectWireLabelGroup(row, "right");
                        setEditingWireLabel({ row, side: "right" });
                      },
                      () => setEditingWireLabel((current) =>
                        current?.row === row && current.side === "right" ? null : current
                      ),
                      (label) => onWireLabelChange(row, "right", label)
                    )}
                  </>
                )}
              </g>
            );
          })}

          {Array.from({ length: Math.max(state.qubits - 1, 0) }, (_, row) => {
            const centerY = getRowY(row, layout) + (rowHeight / 2);
            return (
              <g key={`merge-buttons-${row}`}>
                {hasWireLabelBoundary(state.wireLabels, row, "left") &&
                  renderWireLabelMergeButton("left", row, centerY, wireEndX, () =>
                    onMergeWireLabelGroup(row, "left")
                  )}
                {hasWireLabelBoundary(state.wireLabels, row, "right") &&
                  renderWireLabelMergeButton("right", row, centerY, wireEndX, () =>
                    onMergeWireLabelGroup(row, "right")
                  )}
              </g>
            );
          })}

          {state.activeTool === "pencil" && !isPasteMode && (
            <g className="pencil-guide-layer" aria-hidden="true">
              {Array.from({ length: state.qubits }, (_, row) =>
                Array.from({ length: state.steps + 1 }, (_, col) => {
                  const [x1, x2] = getIncomingSegmentRange(col, state.steps, layout, columnMetrics);
                  const y = getRowY(row, layout);
                  return (
                    <line
                      key={`pencil-guide-h-${row}-${col}`}
                      x1={x1}
                      x2={x2}
                      y1={y}
                      y2={y}
                      className="pencil-guide pencil-guide-horizontal"
                    />
                  );
                })
              )}
              {Array.from({ length: Math.max(state.qubits - 1, 0) }, (_, row) =>
                Array.from({ length: state.steps }, (_, col) => {
                  const x = getCellCenterX(col, layout, columnMetrics);
                  return (
                    <line
                      key={`pencil-guide-v-${row}-${col}`}
                      x1={x}
                      x2={x}
                      y1={getRowY(row, layout)}
                      y2={getRowY(row + 1, layout)}
                      className="pencil-guide pencil-guide-vertical"
                    />
                  );
                })
              )}
            </g>
          )}

          {Array.from({ length: state.qubits }, (_, row) =>
            Array.from({ length: state.steps }, (_, col) => (
              <rect
                key={`hit-cell-${row}-${col}`}
                data-testid={`grid-cell-${row}-${col}`}
                x={getColumnLeftX(col, layout, columnMetrics)}
                y={getRowY(row, layout) - (rowHeight / 2)}
                width={getColumnRightX(col, layout, columnMetrics) - getColumnLeftX(col, layout, columnMetrics)}
                height={rowHeight}
                className="grid-hit-cell"
                onPointerEnter={() => {
                  if (state.activeTool !== "pencil" || isPasteMode) {
                    return;
                  }

                  const placement = { kind: "cell" as const, row, col };
                  setHoverPlacement(placement);
                  if (pencilStroke?.kind === "cell") {
                    applyPencilPlacement(placement, "cell");
                  }
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }

                  if (isPasteMode) {
                    event.preventDefault();
                    event.stopPropagation();
                    onPasteAt({ kind: "cell", row, col });
                    return;
                  }

                  if (state.activeTool === "select") {
                    return;
                  }

                  if (!canPlaceCellToolAtRow(state.activeTool, row, state.qubits)) {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();

                  if (state.activeTool === "gate") {
                    startAreaDraw("gate", { kind: "cell", row, col });
                    return;
                  }

                  if (state.activeTool === "meter") {
                    startAreaDraw("meter", { kind: "cell", row, col });
                    return;
                  }

                  if (state.activeTool === "annotation") {
                    startAreaDraw("annotation", { kind: "cell", row, col });
                    return;
                  }

                  if (state.activeTool === "pencil") {
                    beginPencilStroke({ kind: "cell", row, col });
                    return;
                  }

                  placeWithTool(state.activeTool, { kind: "cell", row, col });
                }}
              />
            ))
          )}

          {Array.from({ length: state.qubits }, (_, row) =>
            Array.from({ length: state.steps + 1 }, (_, col) => {
              const [x1, x2] = getIncomingSegmentRange(col, state.steps, layout, columnMetrics);
              return (
                <rect
                  key={`hit-segment-${row}-${col}`}
                  data-testid={`segment-slot-${row}-${col}`}
                x={x1}
                y={getRowY(row, layout) - 14}
                width={Math.max(x2 - x1, 12)}
                height={28}
                className="grid-hit-segment"
                onPointerEnter={() => {
                  if (state.activeTool !== "pencil" || isPasteMode) {
                    return;
                  }

                  const placement = { kind: "segment" as const, row, col };
                  setHoverPlacement(placement);
                  if (pencilStroke?.kind === "segment") {
                    applyPencilPlacement(placement, "segment");
                  }
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }

                    if (isPasteMode) {
                      event.preventDefault();
                      event.stopPropagation();
                      onPasteAt({ kind: "segment", row, col });
                      return;
                    }

                    if (state.activeTool !== "pencil") {
                      return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                    beginPencilStroke({ kind: "segment", row, col });
                  }}
                />
              );
            })
          )}

          {hoverPlacement && !areaDraw && hoverTool !== "select" && (
            hoverPlacement.kind === "cell" && hoverTool === "pencil" ? (
              renderVerticalHover(
                hoverPlacement.row,
                hoverPlacement.col,
                state.qubits,
                layout,
                columnMetrics,
                verticalHoverLength,
                isPasteMode && !pastePreviewValid
              )
            ) : hoverPlacement.kind === "cell" ? (
              <rect
                x={getColumnLeftX(hoverPlacement.col, layout, columnMetrics)}
                y={getRowY(hoverPlacement.row, layout) - (rowHeight / 2)}
                width={
                  getColumnRightX(hoverPlacement.col, layout, columnMetrics) -
                  getColumnLeftX(hoverPlacement.col, layout, columnMetrics)
                }
                height={rowHeight}
                className={`hover-indicator ${isPasteMode && !pastePreviewValid ? "is-invalid" : ""}`}
              />
            ) : (
              (() => {
                const [x1, x2] = getIncomingSegmentRange(hoverPlacement.col, state.steps, layout, columnMetrics);
                return (
                  <line
                    x1={x1}
                    x2={x2}
                    y1={getRowY(hoverPlacement.row, layout)}
                    y2={getRowY(hoverPlacement.row, layout)}
                    className={`hover-segment ${isPasteMode && !pastePreviewValid ? "is-invalid" : ""}`}
                  />
                );
              })()
            )
          )}

          {annotationBackgroundItems.map(renderInteractiveItem)}
          {previewAnnotationBackgroundItems.map((item, index) => renderPreviewItem(item, `paste-preview-bg-${index}`, !pastePreviewValid))}
          {hoverProjectionAnnotationBackgroundItems.map((item, index) => (
            <g key={`hover-projection-bg-${index}`} className={`hover-projection-item ${!dragPreviewValid ? "is-invalid" : ""}`}>
              {renderPreviewItem(item, `hover-projection-bg-item-${index}`, !dragPreviewValid)}
            </g>
          ))}
          {wireLayerItems.map(renderInteractiveItem)}
          {previewWireItems.map((item, index) => renderPreviewItem(item, `paste-preview-wire-${index}`, !pastePreviewValid))}
          {hoverProjectionWireItems.map((item, index) => (
            <g key={`hover-projection-wire-${index}`} className={`hover-projection-item ${!dragPreviewValid ? "is-invalid" : ""}`}>
              {renderPreviewItem(item, `hover-projection-wire-item-${index}`, !dragPreviewValid)}
            </g>
          ))}
          {gateLayerItems.map(renderInteractiveItem)}
          {previewGateItems.map((item, index) => renderPreviewItem(item, `paste-preview-gate-${index}`, !pastePreviewValid))}
          {hoverProjectionGateItems.map((item, index) => (
            <g key={`hover-projection-gate-${index}`} className={`hover-projection-item ${!dragPreviewValid ? "is-invalid" : ""}`}>
              {renderPreviewItem(item, `hover-projection-gate-item-${index}`, !dragPreviewValid)}
            </g>
          ))}
          {annotationOverlayItems.map(renderInteractiveItem)}
          {previewAnnotationOverlayItems.map((item, index) => renderPreviewItem(item, `paste-preview-overlay-${index}`, !pastePreviewValid))}
          {hoverProjectionAnnotationOverlayItems.map((item, index) => (
            <g key={`hover-projection-overlay-${index}`} className={`hover-projection-item ${!dragPreviewValid ? "is-invalid" : ""}`}>
              {renderPreviewItem(item, `hover-projection-overlay-item-${index}`, !dragPreviewValid)}
            </g>
          ))}
          {markerLayerItems.map(renderInteractiveItem)}
          {previewMarkerItems.map((item, index) => renderPreviewItem(item, `paste-preview-marker-${index}`, !pastePreviewValid))}
          {hoverProjectionMarkerItems.map((item, index) => (
            <g key={`hover-projection-marker-${index}`} className={`hover-projection-item ${!dragPreviewValid ? "is-invalid" : ""}`}>
              {renderPreviewItem(item, `hover-projection-marker-item-${index}`, !dragPreviewValid)}
            </g>
          ))}
          {renderAreaPreview()}
          {marqueeRect && (
            <rect
              x={marqueeRect.x}
              y={marqueeRect.y}
              width={marqueeRect.width}
              height={marqueeRect.height}
              rx={0}
              className="selection-marquee"
            />
          )}
        </svg>
        {swapTooltip && (
          <div
            className="workspace-tooltip"
            style={{
              left: swapTooltip.x + 14,
              top: swapTooltip.y + 18
            }}
            role="status"
          >
            {swapTooltip.message}
          </div>
        )}
      </div>
    </section>
  );
}
