import type { CircuitItem, PlacementTarget } from "./types";

export interface SelectionMoveProjection {
  selectedIds: Set<string>;
  movedItems: CircuitItem[];
  finalItems: CircuitItem[];
  rowDelta: number;
  colDelta: number;
}

function itemPlacement(item: CircuitItem): PlacementTarget {
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

function moveItemByDelta(item: CircuitItem, rowDelta: number, colDelta: number): CircuitItem {
  if (rowDelta === 0 && colDelta === 0) {
    return item;
  }

  return {
    ...item,
    point: {
      row: item.point.row + rowDelta,
      col: item.point.col + colDelta
    }
  };
}

function verticalAnchorRowsForItem(item: CircuitItem): number[] {
  switch (item.type) {
    case "gate":
    case "meter":
    case "controlDot":
    case "targetPlus":
    case "swapX":
      return [item.point.row];
    default:
      return [];
  }
}

interface ExternalConnectorLink {
  connectorId: string;
  selectedRows: number[];
  unselectedRows: number[];
}

function getExternalConnectorLinks(items: CircuitItem[], selectedIds: Set<string>): ExternalConnectorLink[] {
  const anchorsByColumn = new Map<number, Array<{ row: number; selected: boolean }>>();

  for (const item of items) {
    for (const row of verticalAnchorRowsForItem(item)) {
      const anchors = anchorsByColumn.get(item.point.col) ?? [];
      anchors.push({
        row,
        selected: selectedIds.has(item.id)
      });
      anchorsByColumn.set(item.point.col, anchors);
    }
  }

  return items.flatMap((item) => {
    if (item.type !== "verticalConnector" || selectedIds.has(item.id)) {
      return [];
    }

    const anchors = anchorsByColumn.get(item.point.col) ?? [];
    const startRow = item.point.row;
    const endRow = item.point.row + item.length;
    const selectedRows = anchors
      .filter((anchor) => anchor.selected && anchor.row >= startRow && anchor.row <= endRow)
      .map((anchor) => anchor.row);
    const unselectedRows = anchors
      .filter((anchor) => !anchor.selected && anchor.row >= startRow && anchor.row <= endRow)
      .map((anchor) => anchor.row);

    if (selectedRows.length === 0 || unselectedRows.length === 0) {
      return [];
    }

    return [{
      connectorId: item.id,
      selectedRows,
      unselectedRows
    }];
  });
}

function computeMinimumOccupiedPoint(items: CircuitItem[]): { minRow: number; minCol: number } {
  let minRow = Number.POSITIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;

  for (const item of items) {
    minRow = Math.min(minRow, item.point.row);
    minCol = Math.min(minCol, item.point.col);
  }

  return {
    minRow: Number.isFinite(minRow) ? minRow : 0,
    minCol: Number.isFinite(minCol) ? minCol : 0
  };
}

export function selectionHasExternalVerticalLinks(
  items: CircuitItem[],
  selectedItemIds: string[],
  anchorItemId: string
): boolean {
  const selectedIds = new Set(selectedItemIds);
  selectedIds.add(anchorItemId);
  return getExternalConnectorLinks(items, selectedIds).length > 0;
}

export function projectSelectionMove(
  items: CircuitItem[],
  selectedItemIds: string[],
  anchorItemId: string,
  placement: PlacementTarget
): SelectionMoveProjection | null {
  const anchorItem = items.find((item) => item.id === anchorItemId);
  if (!anchorItem) {
    return null;
  }

  const selectedIds = new Set(selectedItemIds);
  selectedIds.add(anchorItemId);

  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  if (selectedItems.length === 0) {
    return null;
  }

  const anchorPlacement = itemPlacement(anchorItem);
  if (anchorPlacement.kind !== placement.kind) {
    return null;
  }

  let rowDelta = placement.row - anchorPlacement.row;
  let colDelta = placement.col - anchorPlacement.col;

  const externalLinks = getExternalConnectorLinks(items, selectedIds);
  if (externalLinks.length > 0) {
    colDelta = 0;
  }

  const { minRow, minCol } = computeMinimumOccupiedPoint(selectedItems);
  rowDelta = Math.max(rowDelta, -minRow);
  colDelta = Math.max(colDelta, -minCol);

  const movedItemsById = new Map<string, CircuitItem>();
  for (const item of selectedItems) {
    movedItemsById.set(item.id, moveItemByDelta(item, rowDelta, colDelta));
  }

  const finalItems = items.map((item) => {
    const movedItem = movedItemsById.get(item.id);
    if (movedItem) {
      return movedItem;
    }

    if (item.type !== "verticalConnector") {
      return item;
    }

    const externalLink = externalLinks.find((link) => link.connectorId === item.id);
    if (!externalLink) {
      return item;
    }

    const adjustedSelectedRows = externalLink.selectedRows.map((row) => row + rowDelta);
    const connectorRows = [...externalLink.unselectedRows, ...adjustedSelectedRows];
    const startRow = Math.min(...connectorRows);
    const endRow = Math.max(...connectorRows);

    return {
      ...item,
      point: {
        row: startRow,
        col: item.point.col
      },
      length: Math.max(endRow - startRow, 1)
    };
  });

  return {
    selectedIds,
    movedItems: [...movedItemsById.values()],
    finalItems,
    rowDelta,
    colDelta
  };
}