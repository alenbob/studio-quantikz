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
    default:
      return null;
  }
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