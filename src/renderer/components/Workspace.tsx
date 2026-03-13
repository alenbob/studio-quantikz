import { useEffect, useMemo, useRef, useState } from "react";
import { canPasteClipboardAt, instantiateClipboardItems } from "../clipboard";
import {
  GATE_MIN_HEIGHT,
  GATE_MIN_WIDTH,
  GRID_LEFT,
  GRID_TOP,
  LEFT_LABEL_WIDTH,
  RIGHT_LABEL_WIDTH,
  getColumnWidth,
  getCellCenterX,
  getGridHeight,
  getGridWidth,
  getIncomingSegmentRange,
  getRowHeight,
  getRowY,
  getWireEndX,
  getWireStartX
} from "../layout";
import {
  DEFAULT_ABSENT_WIRE_COLOR,
  DEFAULT_ITEM_COLOR,
  DEFAULT_PRESENT_WIRE_COLOR,
  mixHexWithWhite
} from "../color";
import { canPlaceCellToolAtRow, getBoardMetrics, placementFromViewportPoint } from "../placement";
import { isLikelyTexMath, normalizeGateLabel, normalizeLabel, renderGateLabelHtml } from "../tex";
import type {
  BoardMetrics,
  CircuitClipboard,
  CircuitItem,
  EditorState,
  GateItem,
  HorizontalSegmentItem,
  ItemType,
  CircuitLayout,
  MeterItem,
  PlacementTarget,
  ToolType,
  VerticalConnectorItem
} from "../types";

interface WorkspaceProps {
  state: EditorState;
  externalDrag: { tool: ItemType; clientX: number; clientY: number } | null;
  isPasteMode: boolean;
  pasteClipboard: CircuitClipboard | null;
  horizontalSegmentsUnlocked: boolean;
  onLayoutSpacingChange: (dimension: "rowSepCm" | "columnSepCm", value: number) => void;
  onWireLabelChange: (row: number, side: "left" | "right", label: string) => void;
  onPlaceItem: (tool: ItemType, placement: PlacementTarget) => void;
  onSelectOrCreateHorizontalSegment: (row: number, col: number, additive: boolean) => void;
  onPasteAt: (placement: PlacementTarget) => void;
  onMoveItem: (itemId: string, placement: PlacementTarget) => void;
  onSelectionChange: (itemIds: string[]) => void;
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

function gapKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function isGateItem(item: CircuitItem): item is GateItem | MeterItem {
  return item.type === "gate" || item.type === "meter";
}

function isWireLayerItem(item: CircuitItem): item is VerticalConnectorItem | HorizontalSegmentItem {
  return item.type === "verticalConnector" || item.type === "horizontalSegment";
}

function isMarkerItem(item: CircuitItem): item is Exclude<CircuitItem, GateItem | MeterItem | VerticalConnectorItem | HorizontalSegmentItem> {
  return item.type === "controlDot" || item.type === "targetPlus" || item.type === "swapX";
}

function getItemColor(item: CircuitItem): string {
  if (item.type === "horizontalSegment") {
    return item.color ?? (item.mode === "present" ? DEFAULT_PRESENT_WIRE_COLOR : DEFAULT_ABSENT_WIRE_COLOR);
  }

  return item.color ?? DEFAULT_ITEM_COLOR;
}

function shouldRenderMathLabel(label: string): boolean {
  const trimmed = label.trim();
  return isLikelyTexMath(trimmed) || (trimmed.startsWith("$") && trimmed.endsWith("$"));
}

function getClipboardPlacementTool(clipboard: CircuitClipboard | null): ToolType {
  if (!clipboard) {
    return "gate";
  }

  return clipboard.items.some((item) => item.type === "horizontalSegment") ? "horizontalSegment" : "gate";
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

function getItemBounds(item: CircuitItem, steps: number, layout: CircuitLayout): SelectionRect {
  if (item.type === "gate") {
    const x = getCellCenterX(item.point.col, layout) - (item.width / 2);
    const y = getRowY(item.point.row, layout) - (GATE_MIN_HEIGHT / 2);
    return {
      x,
      y,
      width: item.width,
      height: GATE_MIN_HEIGHT + ((item.span.rows - 1) * getRowHeight(layout))
    };
  }

  if (item.type === "meter") {
    return {
      x: getCellCenterX(item.point.col, layout) - (GATE_MIN_WIDTH / 2),
      y: getRowY(item.point.row, layout) - (GATE_MIN_HEIGHT / 2),
      width: GATE_MIN_WIDTH,
      height: GATE_MIN_HEIGHT
    };
  }

  if (item.type === "verticalConnector") {
    const x = getCellCenterX(item.point.col, layout) - 10;
    const y = getRowY(item.point.row, layout);
    return {
      x,
      y,
      width: 20,
      height: Math.max(getRowY(item.point.row + item.length, layout) - y, 4)
    };
  }

  if (item.type === "horizontalSegment") {
    const [x1, x2] = getIncomingSegmentRange(item.point.col, steps, layout);
    return {
      x: x1,
      y: getRowY(item.point.row, layout) - 10,
      width: Math.max(x2 - x1, 12),
      height: 20
    };
  }

  if (item.type === "controlDot") {
    return {
      x: getCellCenterX(item.point.col, layout) - 8,
      y: getRowY(item.point.row, layout) - 8,
      width: 16,
      height: 16
    };
  }

  return {
    x: getCellCenterX(item.point.col, layout) - 14,
    y: getRowY(item.point.row, layout) - 14,
    width: 28,
    height: 28
  };
}

function renderEditableWireLabel(
  row: number,
  side: "left" | "right",
  label: string,
  x: number,
  y: number,
  width: number,
  align: "left" | "right",
  isEditing: boolean,
  placeholder: string,
  onStartEditing: () => void,
  onStopEditing: () => void,
  onChange: (value: string) => void
): JSX.Element {
  const foreignX = align === "left" ? x - width : x;
  const normalized = normalizeLabel(label);
  const displayLabel = normalized || placeholder;
  const placeholderClass = !normalized ? "is-placeholder" : "";
  const mathHtml = normalized && shouldRenderMathLabel(normalized) ? renderGateLabelHtml(normalized) : null;

  if (isEditing) {
    return (
      <foreignObject
        x={foreignX}
        y={y - 20}
        width={width}
        height={40}
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
            onPointerDown={(event) => event.stopPropagation()}
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
        className={`wire-label-inline-button wire-label-inline-${align} ${placeholderClass}`}
        onClick={(event) => {
          event.stopPropagation();
          onStartEditing();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {mathHtml ? (
          <span
            className="wire-label-inline-math"
            dangerouslySetInnerHTML={{ __html: mathHtml }}
          />
        ) : (
          <span className="wire-label-inline-text">{displayLabel}</span>
        )}
      </button>
    </foreignObject>
  );
}

function renderGate(item: GateItem, isSelected: boolean, layout: CircuitLayout): JSX.Element {
  const x = getCellCenterX(item.point.col, layout) - (item.width / 2);
  const y = getRowY(item.point.row, layout) - (GATE_MIN_HEIGHT / 2);
  const height = GATE_MIN_HEIGHT + ((item.span.rows - 1) * getRowHeight(layout));
  const textY = y + (height / 2);
  const label = normalizeGateLabel(item.label);
  const texHtml = isLikelyTexMath(label) ? renderGateLabelHtml(label) : null;
  const color = getItemColor(item);

  return (
    <g>
      <rect
        data-kind="gate-rect"
        data-item-id={item.id}
        x={x}
        y={y}
        width={item.width}
        height={height}
        rx={0}
        className={`gate-rect ${isSelected ? "is-selected" : ""}`}
        style={{
          stroke: color,
          fill: item.color ? mixHexWithWhite(color, 0.9) : "rgba(255, 254, 250, 1)"
        }}
      />
      {texHtml ? (
        <foreignObject
          x={x + 4}
          y={y + 4}
          width={Math.max(item.width - 8, 24)}
          height={Math.max(height - 8, 24)}
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
          x={getCellCenterX(item.point.col, layout)}
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

function renderMeter(item: MeterItem, isSelected: boolean, layout: CircuitLayout): JSX.Element {
  const x = getCellCenterX(item.point.col, layout) - (GATE_MIN_WIDTH / 2);
  const y = getRowY(item.point.row, layout) - (GATE_MIN_HEIGHT / 2);
  const color = getItemColor(item);
  const needleBaseX = x + 11;
  const needleBaseY = y + 23;

  return (
    <g>
      <rect
        data-kind="meter-rect"
        data-item-id={item.id}
        x={x}
        y={y}
        width={GATE_MIN_WIDTH}
        height={GATE_MIN_HEIGHT}
        rx={0}
        className={`gate-rect ${isSelected ? "is-selected" : ""}`}
        style={{
          stroke: color,
          fill: item.color ? mixHexWithWhite(color, 0.9) : "rgba(255, 254, 250, 1)"
        }}
      />
      <path
        d={`M ${x + 10} ${y + 22} Q ${x + 20} ${y + 10} ${x + 30} ${y + 18}`}
        className="meter-glyph"
        style={{ stroke: color }}
      />
      <line
        x1={needleBaseX + 11}
        y1={needleBaseY - 7}
        x2={needleBaseX + 15}
        y2={needleBaseY - 13}
        className="meter-glyph"
        style={{ stroke: color }}
      />
    </g>
  );
}

function renderVerticalConnector(
  item: VerticalConnectorItem,
  isSelected: boolean,
  layout: CircuitLayout
): JSX.Element {
  return (
    <line
      x1={getCellCenterX(item.point.col, layout)}
      x2={getCellCenterX(item.point.col, layout)}
      y1={getRowY(item.point.row, layout)}
      y2={getRowY(item.point.row + item.length, layout)}
      className={`vertical-connector ${isSelected ? "is-selected" : ""}`}
      style={{ stroke: getItemColor(item) }}
    />
  );
}

function renderMarker(item: CircuitItem, isSelected: boolean, layout: CircuitLayout): JSX.Element {
  const cx = getCellCenterX(item.point.col, layout);
  const cy = getRowY(item.point.row, layout);
  const color = getItemColor(item);

  if (item.type === "controlDot") {
    return (
      <circle
        cx={cx}
        cy={cy}
        r={7}
        className={`control-dot ${isSelected ? "is-selected" : ""}`}
        style={{ fill: color }}
      />
    );
  }

  if (item.type === "targetPlus") {
    return (
      <g className={`target-plus ${isSelected ? "is-selected" : ""}`} style={{ stroke: color }}>
        <circle cx={cx} cy={cy} r={13} />
        <line x1={cx - 9} y1={cy} x2={cx + 9} y2={cy} />
        <line x1={cx} y1={cy - 9} x2={cx} y2={cy + 9} />
      </g>
    );
  }

  return (
    <g className={`swap-x ${isSelected ? "is-selected" : ""}`} style={{ stroke: color }}>
      <line x1={cx - 10} y1={cy - 10} x2={cx + 10} y2={cy + 10} />
      <line x1={cx - 10} y1={cy + 10} x2={cx + 10} y2={cy - 10} />
    </g>
  );
}

function renderHorizontalOverride(
  item: HorizontalSegmentItem,
  isSelected: boolean,
  steps: number,
  layout: CircuitLayout
): JSX.Element {
  const [x1, x2] = getIncomingSegmentRange(item.point.col, steps, layout);
  const y = getRowY(item.point.row, layout);
  const color = getItemColor(item);

  if (item.mode === "present") {
    return (
      <line
        x1={x1}
        x2={x2}
        y1={y}
        y2={y}
        className={`present-override ${isSelected ? "is-selected" : ""}`}
        style={{ stroke: color }}
      />
    );
  }

  return (
    <g className={`absent-override ${isSelected ? "is-selected" : ""}`} style={{ stroke: color }}>
      <line x1={x1} x2={x2} y1={y} y2={y} />
      <circle cx={(x1 + x2) / 2} cy={y} r={4} style={{ fill: color }} />
    </g>
  );
}

function renderVerticalHover(
  row: number,
  col: number,
  qubits: number,
  layout: CircuitLayout,
  length = 1,
  invalid = false
): JSX.Element | null {
  if (row >= qubits - 1) {
    return null;
  }

  const x = getCellCenterX(col, layout);
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
  externalDrag,
  isPasteMode,
  pasteClipboard,
  horizontalSegmentsUnlocked,
  onLayoutSpacingChange,
  onWireLabelChange,
  onPlaceItem,
  onSelectOrCreateHorizontalSegment,
  onPasteAt,
  onMoveItem,
  onSelectionChange,
  onBoardMetricsChange
}: WorkspaceProps): JSX.Element {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [hoverPlacement, setHoverPlacement] = useState<PlacementTarget | null>(null);
  const [marquee, setMarquee] = useState<MarqueeSelection | null>(null);
  const [editingWireLabel, setEditingWireLabel] = useState<{ row: number; side: "left" | "right" } | null>(null);

  const layout = state.layout;
  const columnWidth = getColumnWidth(layout);
  const rowHeight = getRowHeight(layout);
  const width = getGridWidth(state.steps, layout);
  const height = getGridHeight(state.qubits, layout);
  const selectionSet = useMemo(() => new Set(state.selectedItemIds), [state.selectedItemIds]);
  const draggingItem = useMemo(
    () => state.items.find((item) => item.id === draggingItemId) ?? null,
    [draggingItemId, state.items]
  );
  const hoverTool = draggingItem
    ? draggingItem.type
    : externalDrag?.tool ?? (isPasteMode ? getClipboardPlacementTool(pasteClipboard) : state.activeTool);

  const hiddenSegments = useMemo(() => {
    const absent = new Set<string>();
    for (const [key, value] of Object.entries(state.wireMask)) {
      if (value === "absent") {
        absent.add(key);
      }
    }
    return absent;
  }, [state.wireMask]);

  const verticalHoverLength = draggingItem?.type === "verticalConnector" ? draggingItem.length : 1;
  const pasteAnchor = hoverPlacement ? { row: hoverPlacement.row, col: hoverPlacement.col } : null;
  const pastePreviewValid =
    !!isPasteMode &&
    !!pasteClipboard &&
    !!pasteAnchor &&
    canPasteClipboardAt(state, pasteClipboard, pasteAnchor);
  const pastePreviewItems =
    isPasteMode && pasteClipboard && pasteAnchor && pastePreviewValid
      ? instantiateClipboardItems(pasteClipboard, pasteAnchor)
      : [];
  const marqueeRect = marquee ? normalizeRect(marquee.start, marquee.current) : null;
  const wireLayerItems = useMemo(() => state.items.filter(isWireLayerItem), [state.items]);
  const gateLayerItems = useMemo(() => state.items.filter(isGateItem), [state.items]);
  const markerLayerItems = useMemo(() => state.items.filter(isMarkerItem), [state.items]);
  const previewWireItems = useMemo(() => pastePreviewItems.filter(isWireLayerItem), [pastePreviewItems]);
  const previewGateItems = useMemo(() => pastePreviewItems.filter(isGateItem), [pastePreviewItems]);
  const previewMarkerItems = useMemo(() => pastePreviewItems.filter(isMarkerItem), [pastePreviewItems]);
  const pastePlacementTool = getClipboardPlacementTool(pasteClipboard);

  useEffect(() => {
    if (editingWireLabel && editingWireLabel.row >= state.qubits) {
      setEditingWireLabel(null);
    }
  }, [editingWireLabel, state.qubits]);

  function resolvePlacement(clientX: number, clientY: number, tool: ToolType): PlacementTarget | null {
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
        row: Math.min(placement.row, state.qubits - draggingItem.span.rows)
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

  function updateHoverFromPointer(clientX: number, clientY: number, tool: ToolType): void {
    setHoverPlacement(resolvePlacement(clientX, clientY, tool));
  }

  function placeWithTool(tool: ItemType, placement: PlacementTarget | null): void {
    if (!placement) {
      return;
    }
    onPlaceItem(tool, placement);
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

  function isSelectableItem(item: CircuitItem): boolean {
    return horizontalSegmentsUnlocked || item.type !== "horizontalSegment";
  }

  function renderInteractiveItem(item: CircuitItem): JSX.Element {
    const selected = selectionSet.has(item.id);
    const rendered =
      item.type === "gate"
        ? renderGate(item, selected, layout)
        : item.type === "meter"
          ? renderMeter(item, selected, layout)
        : item.type === "verticalConnector"
          ? renderVerticalConnector(item, selected, layout)
          : item.type === "horizontalSegment"
            ? renderHorizontalOverride(item, selected, state.steps, layout)
            : renderMarker(item, selected, layout);

    return (
      <g
        key={item.id}
        data-item-id={item.id}
        data-testid={`item-${item.id}`}
        className="item-group"
        onPointerDown={(event) => {
          if (!isPasteMode && state.activeTool === "select" && !isSelectableItem(item)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          if (isPasteMode) {
            onPasteAt(
              item.type === "horizontalSegment"
                ? { kind: "segment", row: item.point.row, col: item.point.col }
                : { kind: "cell", row: item.point.row, col: item.point.col }
            );
            return;
          }

          if (state.activeTool === "select" && event.altKey) {
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

          if (state.activeTool === "select") {
            setDraggingItemId(item.id);
            updateHoverFromPointer(event.clientX, event.clientY, item.type);
          }
        }}
      >
        {rendered}
      </g>
    );
  }

  function renderPreviewItem(item: CircuitItem, index: number): JSX.Element {
    const key = `paste-preview-${item.type}-${index}`;
    const rendered =
      item.type === "gate"
        ? renderGate(item, false, layout)
        : item.type === "meter"
          ? renderMeter(item, false, layout)
        : item.type === "verticalConnector"
          ? renderVerticalConnector(item, false, layout)
          : item.type === "horizontalSegment"
            ? renderHorizontalOverride(item, false, state.steps, layout)
            : renderMarker(item, false, layout);

    return (
      <g key={key} className="paste-preview-item">
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
  }, [onBoardMetricsChange, state.qubits, state.steps, state.layout.columnSepCm, state.layout.rowSepCm]);

  useEffect(() => {
    if (!draggingItemId || !draggingItem) {
      return;
    }

    const dragTool = draggingItem.type;

    const handlePointerMove = (event: PointerEvent) => {
      updateHoverFromPointer(event.clientX, event.clientY, dragTool);
    };

    const finishDrag = (event: PointerEvent) => {
      const placement = resolvePlacement(event.clientX, event.clientY, dragTool);
      if (placement) {
        onMoveItem(draggingItemId, placement);
      }

      setDraggingItemId(null);
      setHoverPlacement(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [draggingItem, draggingItemId, onMoveItem, state]);

  useEffect(() => {
    if (!marquee) {
      return;
    }

    const updateSelection = (point: ContentPoint) => {
      setMarquee((current) => (current ? { ...current, current: point } : current));
    };

    const handlePointerMove = (event: PointerEvent) => {
      const point = getClampedContentPoint(event.clientX, event.clientY);
      if (point) {
        updateSelection(point);
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
              .filter(isSelectableItem)
              .filter((item) => rectsIntersect(getItemBounds(item, state.steps, layout), rect))
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
  }, [layout, marquee, onSelectionChange, state.items, state.steps]);

  useEffect(() => {
    if (!externalDrag) {
      if (!draggingItemId && !isPasteMode && !marquee) {
        setHoverPlacement(null);
      }
      return;
    }

    updateHoverFromPointer(externalDrag.clientX, externalDrag.clientY, externalDrag.tool);
  }, [draggingItemId, externalDrag, isPasteMode, marquee, state]);

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
          if (event.button !== 0 || state.activeTool !== "select" || isPasteMode) {
            return;
          }

          const point = getClampedContentPoint(event.clientX, event.clientY);
          if (!point) {
            return;
          }

          setMarquee({ start: point, current: point });
        }}
        onPointerMove={(event) => {
          if (!isPasteMode || externalDrag || draggingItemId || marquee) {
            return;
          }

          updateHoverFromPointer(event.clientX, event.clientY, pastePlacementTool);
        }}
        onPointerLeave={() => {
          if (!externalDrag && !draggingItemId && !marquee) {
            setHoverPlacement(null);
          }
        }}
      >
        <svg width={width} height={height} className="workspace-svg" aria-label="Circuit workbench">
          {Array.from({ length: state.qubits }, (_, row) => {
            const y = getRowY(row, layout);
            return (
              <g key={`wire-${row}`}>
                <line
                  x1={getWireStartX()}
                  x2={getWireEndX(state.steps, layout)}
                  y1={y}
                  y2={y}
                  className="wire-line"
                />
                {Array.from({ length: state.steps + 1 }, (_, col) => {
                  if (!hiddenSegments.has(gapKey(row, col))) {
                    return null;
                  }

                  const [x1, x2] = getIncomingSegmentRange(col, state.steps, layout);
                  return (
                    <line
                      key={`gap-${row}-${col}`}
                      x1={x1}
                      x2={x2}
                      y1={y}
                      y2={y}
                      className="wire-gap"
                    />
                  );
                })}
              </g>
            );
          })}

          {Array.from({ length: state.steps }, (_, col) => (
            <g key={`grid-col-${col}`}>
              <line
                x1={GRID_LEFT + (col * columnWidth)}
                x2={GRID_LEFT + (col * columnWidth)}
                y1={GRID_TOP - 34}
                y2={getRowY(state.qubits - 1, layout) + 34}
                className="grid-guide"
              />
              <text
                x={getCellCenterX(col, layout)}
                y={GRID_TOP - 38}
                className="grid-label"
                textAnchor="middle"
              >
                {col + 1}
              </text>
            </g>
          ))}

          {Array.from({ length: state.qubits }, (_, row) => {
            const leftLabel = state.wireLabels[row]?.left ?? "";
            const rightLabel = state.wireLabels[row]?.right ?? "";
            const y = getRowY(row, layout);

            return (
              <g key={`row-label-${row}`}>
                {renderEditableWireLabel(
                  row,
                  "left",
                  leftLabel,
                  GRID_LEFT - 16,
                  y,
                  LEFT_LABEL_WIDTH,
                  "left",
                  editingWireLabel?.row === row && editingWireLabel.side === "left",
                  `q${row + 1}`,
                  () => setEditingWireLabel({ row, side: "left" }),
                  () => setEditingWireLabel((current) =>
                    current?.row === row && current.side === "left" ? null : current
                  ),
                  (label) => onWireLabelChange(row, "left", label)
                )}
                {renderEditableWireLabel(
                  row,
                  "right",
                  rightLabel,
                  getWireEndX(state.steps, layout) + 16,
                  y,
                  RIGHT_LABEL_WIDTH,
                  "right",
                  editingWireLabel?.row === row && editingWireLabel.side === "right",
                  "",
                  () => setEditingWireLabel({ row, side: "right" }),
                  () => setEditingWireLabel((current) =>
                    current?.row === row && current.side === "right" ? null : current
                  ),
                  (label) => onWireLabelChange(row, "right", label)
                )}
              </g>
            );
          })}

          {Array.from({ length: state.qubits }, (_, row) =>
            Array.from({ length: state.steps }, (_, col) => (
              <rect
                key={`hit-cell-${row}-${col}`}
                data-testid={`grid-cell-${row}-${col}`}
                x={GRID_LEFT + (col * columnWidth)}
                y={getRowY(row, layout) - (rowHeight / 2)}
                width={columnWidth}
                height={rowHeight}
                className="grid-hit-cell"
                onClick={() => {
                  if (isPasteMode) {
                    onPasteAt({ kind: "cell", row, col });
                    return;
                  }

                  if (state.activeTool === "select" || state.activeTool === "horizontalSegment") {
                    return;
                  }

                  if (!canPlaceCellToolAtRow(state.activeTool, row, state.qubits)) {
                    return;
                  }

                  placeWithTool(state.activeTool, { kind: "cell", row, col });
                }}
              />
            ))
          )}

          {Array.from({ length: state.qubits }, (_, row) =>
            Array.from({ length: state.steps + 1 }, (_, col) => {
              const [x1, x2] = getIncomingSegmentRange(col, state.steps, layout);
              return (
                <rect
                  key={`hit-segment-${row}-${col}`}
                  data-testid={`segment-slot-${row}-${col}`}
                  x={x1}
                  y={getRowY(row, layout) - 14}
                  width={Math.max(x2 - x1, 12)}
                  height={28}
                  className="grid-hit-segment"
                  onPointerDown={(event) => {
                    if (
                      isPasteMode ||
                      state.activeTool === "horizontalSegment" ||
                      (state.activeTool === "select" && horizontalSegmentsUnlocked)
                    ) {
                      event.stopPropagation();
                    }
                  }}
                  onClick={(event) => {
                    if (isPasteMode) {
                      onPasteAt({ kind: "segment", row, col });
                      return;
                    }

                    if (state.activeTool === "select" && horizontalSegmentsUnlocked) {
                      onSelectOrCreateHorizontalSegment(row, col, event.shiftKey || event.metaKey || event.ctrlKey);
                      return;
                    }

                    if (state.activeTool !== "horizontalSegment") {
                      return;
                    }
                    placeWithTool("horizontalSegment", { kind: "segment", row, col });
                  }}
                />
              );
            })
          )}

          {hoverPlacement && hoverTool !== "select" && (
            hoverPlacement.kind === "cell" && hoverTool === "verticalConnector" ? (
              renderVerticalHover(
                hoverPlacement.row,
                hoverPlacement.col,
                state.qubits,
                layout,
                verticalHoverLength,
                isPasteMode && !pastePreviewValid
              )
            ) : hoverPlacement.kind === "cell" ? (
              <rect
                x={GRID_LEFT + (hoverPlacement.col * columnWidth)}
                y={getRowY(hoverPlacement.row, layout) - (rowHeight / 2)}
                width={columnWidth}
                height={rowHeight}
                className={`hover-indicator ${isPasteMode && !pastePreviewValid ? "is-invalid" : ""}`}
              />
            ) : (
              (() => {
                const [x1, x2] = getIncomingSegmentRange(hoverPlacement.col, state.steps, layout);
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

          {wireLayerItems.map(renderInteractiveItem)}
          {previewWireItems.map(renderPreviewItem)}
          {gateLayerItems.map(renderInteractiveItem)}
          {previewGateItems.map(renderPreviewItem)}
          {markerLayerItems.map(renderInteractiveItem)}
          {previewMarkerItems.map(renderPreviewItem)}

          {marqueeRect && (
            <rect
              x={marqueeRect.x}
              y={marqueeRect.y}
              width={marqueeRect.width}
              height={marqueeRect.height}
              className="selection-marquee"
            />
          )}
        </svg>
      </div>
    </section>
  );
}
