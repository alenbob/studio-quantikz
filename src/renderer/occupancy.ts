import type { CircuitItem } from "./types";

interface OccupancyBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function getOccupancyBounds(item: CircuitItem): OccupancyBounds | null {
  switch (item.type) {
    case "gate":
      return {
        top: item.point.row,
        bottom: item.point.row + item.span.rows - 1,
        left: item.point.col,
        right: item.point.col + item.span.cols - 1
      };
    case "meter":
      return {
        top: item.point.row,
        bottom: item.point.row + item.span.rows - 1,
        left: item.point.col,
        right: item.point.col
      };
    case "controlDot":
    case "targetPlus":
    case "swapX":
      return {
        top: item.point.row,
        bottom: item.point.row,
        left: item.point.col,
        right: item.point.col
      };
    case "equalsColumn":
      return {
        top: Number.NEGATIVE_INFINITY,
        bottom: Number.POSITIVE_INFINITY,
        left: item.point.col,
        right: item.point.col
      };
    default:
      return null;
  }
}

function itemOccupiesColumn(item: CircuitItem, col: number): boolean {
  switch (item.type) {
    case "gate":
      return col >= item.point.col && col < item.point.col + item.span.cols;
    case "meter":
      return item.point.col === col;
    case "frame":
      return col >= item.point.col && col < item.point.col + item.span.cols;
    case "slice":
    case "equalsColumn":
    case "verticalConnector":
    case "controlDot":
    case "targetPlus":
    case "swapX":
      return item.point.col === col;
    case "horizontalSegment":
      return false;
    default: {
      const exhaustiveCheck: never = item;
      return exhaustiveCheck;
    }
  }
}

function equalsColumnOverlaps(left: CircuitItem, right: CircuitItem): boolean {
  if (left.type === "equalsColumn") {
    return itemOccupiesColumn(right, left.point.col);
  }

  if (right.type === "equalsColumn") {
    return itemOccupiesColumn(left, right.point.col);
  }

  return false;
}

function boundsOverlap(left: OccupancyBounds, right: OccupancyBounds): boolean {
  return !(
    left.right < right.left ||
    right.right < left.left ||
    left.bottom < right.top ||
    right.bottom < left.top
  );
}

export function hasBlockingObjectOverlap(items: CircuitItem[]): boolean {
  const occupyingItems = items
    .map((item) => ({ item, bounds: getOccupancyBounds(item) }))
    .filter((entry): entry is { item: CircuitItem; bounds: OccupancyBounds } => entry.bounds !== null);

  for (let index = 0; index < occupyingItems.length; index += 1) {
    const current = occupyingItems[index];

    for (let otherIndex = index + 1; otherIndex < occupyingItems.length; otherIndex += 1) {
      const other = occupyingItems[otherIndex];

      if (equalsColumnOverlaps(current.item, other.item)) {
        return true;
      }

      if (boundsOverlap(current.bounds, other.bounds)) {
        return true;
      }
    }
  }

  return false;
}

export function canPlaceItemsWithoutOverlap(
  existingItems: CircuitItem[],
  candidateItems: CircuitItem[],
  ignoredItemIds: Iterable<string> = []
): boolean {
  const ignoredIds = new Set(ignoredItemIds);
  const relevantExistingItems = existingItems.filter((item) => !ignoredIds.has(item.id));

  return !hasBlockingObjectOverlap([...relevantExistingItems, ...candidateItems]);
}
