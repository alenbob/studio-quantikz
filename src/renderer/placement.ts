import {
  DEFAULT_CIRCUIT_LAYOUT,
  getColumnMetrics,
  getColumnRightX,
  getIncomingSegmentRange,
  getRowHeight,
  getRowY,
  GRID_LEFT,
  GRID_TOP
} from "./layout";
import type { BoardMetrics, EditorState, ItemType, PlacementTarget, ToolType } from "./types";

export function canPlaceCellToolAtRow(tool: ToolType | ItemType, row: number, qubits: number): boolean {
  if (tool === "verticalConnector" || tool === "pencil") {
    return row >= 0 && row < qubits - 1;
  }

  return row >= 0 && row < qubits;
}

export function segmentColumnFromX(contentX: number, steps: number): number {
  return segmentColumnFromXWithLayout(contentX, steps, DEFAULT_CIRCUIT_LAYOUT);
}

export function segmentColumnFromXWithLayout(
  contentX: number,
  steps: number,
  layout: EditorState["layout"],
  metrics = getColumnMetrics(steps, [], layout)
): number {
  for (let col = 0; col <= steps; col += 1) {
    const [x1, x2] = getIncomingSegmentRange(col, steps, layout, metrics);
    if (contentX >= x1 && contentX <= x2) {
      return col;
    }
  }

  if (contentX <= GRID_LEFT) {
    return 0;
  }

  return steps;
}

function cellColumnFromXWithLayout(
  contentX: number,
  steps: number,
  layout: EditorState["layout"],
  metrics = getColumnMetrics(steps, [], layout)
): number | null {
  if (steps <= 0 || contentX < GRID_LEFT) {
    return null;
  }

  for (let col = 0; col < steps; col += 1) {
    const rightX = getColumnRightX(col, layout, metrics);
    if (contentX <= rightX) {
      return col;
    }
  }

  return null;
}

export function placementFromViewportPoint(
  clientX: number,
  clientY: number,
  metrics: BoardMetrics,
  tool: ToolType | ItemType,
  state: EditorState
): PlacementTarget | null {
  const isInsideBoard =
    clientX >= metrics.left &&
    clientX <= metrics.left + metrics.width &&
    clientY >= metrics.top &&
    clientY <= metrics.top + metrics.height;

  if (!isInsideBoard) {
    return null;
  }

  const contentX = clientX - metrics.left + metrics.scrollLeft;
  const contentY = clientY - metrics.top + metrics.scrollTop;
  const rowHeight = getRowHeight(state.layout);
  const columnMetrics = getColumnMetrics(state.steps, state.items, state.layout);
  const row = Math.floor((contentY - (GRID_TOP - (rowHeight / 2))) / rowHeight);

  if (tool === "pencil") {
    const nearestRow = Math.round((contentY - GRID_TOP) / rowHeight);
    const nearestWireY = getRowY(Math.max(0, Math.min(state.qubits - 1, nearestRow)), state.layout);
    const distanceToNearestWire = Math.abs(contentY - nearestWireY);

    if (distanceToNearestWire <= 14) {
      if (nearestRow < 0 || nearestRow >= state.qubits) {
        return null;
      }

      return {
        kind: "segment",
        row: nearestRow,
        col: segmentColumnFromXWithLayout(contentX, state.steps, state.layout, columnMetrics)
      };
    }
  }

  if (!canPlaceCellToolAtRow(tool, row, state.qubits) && tool !== "horizontalSegment") {
    return null;
  }

  if (tool === "horizontalSegment") {
    if (row < 0 || row >= state.qubits) {
      return null;
    }

    return {
      kind: "segment",
      row,
      col: segmentColumnFromXWithLayout(contentX, state.steps, state.layout, columnMetrics)
    };
  }

  const col = cellColumnFromXWithLayout(contentX, state.steps, state.layout, columnMetrics);
  if (col === null || col < 0 || col >= state.steps) {
    return null;
  }

  return { kind: "cell", row, col };
}

export function getBoardMetrics(board: HTMLElement): BoardMetrics {
  const rect = board.getBoundingClientRect();

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    scrollLeft: board.scrollLeft,
    scrollTop: board.scrollTop
  };
}
