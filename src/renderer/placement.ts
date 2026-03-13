import { DEFAULT_CIRCUIT_LAYOUT, getColumnWidth, getRowHeight, GRID_LEFT, GRID_TOP } from "./layout";
import type { BoardMetrics, EditorState, PlacementTarget, ToolType } from "./types";

export function canPlaceCellToolAtRow(tool: ToolType, row: number, qubits: number): boolean {
  if (tool === "verticalConnector") {
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
  layout: EditorState["layout"]
): number {
  const columnWidth = getColumnWidth(layout);

  if (contentX <= GRID_LEFT + (columnWidth / 2)) {
    return 0;
  }

  const segment = Math.floor((contentX - (GRID_LEFT + (columnWidth / 2))) / columnWidth) + 1;
  return Math.max(0, Math.min(steps, segment));
}

export function placementFromViewportPoint(
  clientX: number,
  clientY: number,
  metrics: BoardMetrics,
  tool: ToolType,
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
  const columnWidth = getColumnWidth(state.layout);
  const row = Math.floor((contentY - (GRID_TOP - (rowHeight / 2))) / rowHeight);

  if (!canPlaceCellToolAtRow(tool, row, state.qubits) && tool !== "horizontalSegment") {
    return null;
  }

  if (tool === "horizontalSegment") {
    if (row < 0 || row >= state.qubits) {
      return null;
    }

    return { kind: "segment", row, col: segmentColumnFromXWithLayout(contentX, state.steps, state.layout) };
  }

  const col = Math.floor((contentX - GRID_LEFT) / columnWidth);
  if (col < 0 || col >= state.steps) {
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
