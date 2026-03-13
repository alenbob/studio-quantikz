import { measureGateWidth } from "./layout";
import type {
  CircuitClipboard,
  CircuitItem,
  ClipboardItem,
  EditorState,
  GridPoint
} from "./types";

type InstantiatedItem = Omit<CircuitItem, "id">;

function sortClipboardItems(a: CircuitItem, b: CircuitItem): number {
  if (a.point.col !== b.point.col) {
    return a.point.col - b.point.col;
  }

  return a.point.row - b.point.row;
}

export function buildClipboard(items: CircuitItem[]): CircuitClipboard | null {
  if (items.length === 0) {
    return null;
  }

  const sortedItems = [...items].sort(sortClipboardItems);
  const anchor = {
    row: Math.min(...sortedItems.map((item) => item.point.row)),
    col: Math.min(...sortedItems.map((item) => item.point.col))
  };

  const clipboardItems: ClipboardItem[] = sortedItems.map((item) => {
    const base = {
      type: item.type,
      rowOffset: item.point.row - anchor.row,
      colOffset: item.point.col - anchor.col,
      color: item.color ?? null
    };

    switch (item.type) {
      case "gate":
        return {
          ...base,
          type: "gate",
          span: item.span,
          label: item.label
        };
      case "meter":
        return {
          ...base,
          type: "meter",
          span: item.span
        };
      case "frame":
        return {
          ...base,
          type: "frame",
          span: item.span,
          label: item.label,
          rounded: item.rounded,
          dashed: item.dashed,
          background: item.background,
          innerXSepPt: item.innerXSepPt
        };
      case "slice":
        return {
          ...base,
          type: "slice",
          label: item.label
        };
      case "verticalConnector":
        return {
          ...base,
          type: "verticalConnector",
          length: item.length,
          wireType: item.wireType
        };
      case "horizontalSegment":
        return {
          ...base,
          type: "horizontalSegment",
          mode: item.mode,
          wireType: item.wireType
        };
      case "controlDot":
        return {
          ...base,
          type: "controlDot",
          controlState: item.controlState ?? "filled"
        };
      case "targetPlus":
        return {
          ...base,
          type: "targetPlus"
        };
      case "swapX":
        return {
          ...base,
          type: "swapX"
        };
      default: {
        const exhaustiveCheck: never = item;
        return exhaustiveCheck;
      }
    }
  });

  return {
    anchor,
    items: clipboardItems
  };
}

export function instantiateClipboardItems(
  clipboard: CircuitClipboard,
  anchor: GridPoint
): InstantiatedItem[] {
  return clipboard.items.map((item) => {
    const point = {
      row: anchor.row + item.rowOffset,
      col: anchor.col + item.colOffset
    };

    switch (item.type) {
      case "gate":
        return {
          type: "gate",
          point,
          span: item.span,
          label: item.label,
          width: measureGateWidth(item.label),
          color: item.color ?? null
        };
      case "meter":
        return {
          type: "meter",
          point,
          span: item.span,
          color: item.color ?? null
        };
      case "frame":
        return {
          type: "frame",
          point,
          span: item.span,
          label: item.label,
          rounded: item.rounded,
          dashed: item.dashed,
          background: item.background,
          innerXSepPt: item.innerXSepPt,
          color: item.color ?? null
        };
      case "slice":
        return {
          type: "slice",
          point,
          label: item.label,
          color: item.color ?? null
        };
      case "verticalConnector":
        return {
          type: "verticalConnector",
          point,
          length: item.length,
          wireType: item.wireType,
          color: item.color ?? null
        };
      case "horizontalSegment":
        return {
          type: "horizontalSegment",
          point,
          mode: item.mode,
          wireType: item.wireType,
          color: item.color ?? null
        };
      case "controlDot":
        return {
          type: "controlDot",
          point,
          controlState: item.controlState ?? "filled",
          color: item.color ?? null
        };
      case "targetPlus":
        return {
          type: "targetPlus",
          point,
          color: item.color ?? null
        };
      case "swapX":
        return {
          type: "swapX",
          point,
          color: item.color ?? null
        };
      default: {
        const exhaustiveCheck: never = item;
        return exhaustiveCheck;
      }
    }
  });
}

function fitsGrid(item: InstantiatedItem, state: EditorState): boolean {
  switch (item.type) {
    case "gate":
      return (
        item.point.row >= 0 &&
        item.point.col >= 0 &&
        item.point.col < state.steps &&
        item.point.row + item.span.rows <= state.qubits
      );
    case "meter":
      return (
        item.point.row >= 0 &&
        item.point.col >= 0 &&
        item.point.col < state.steps &&
        item.point.row + item.span.rows <= state.qubits
      );
    case "frame":
      return (
        item.point.row >= 0 &&
        item.point.col >= 0 &&
        item.point.col < state.steps &&
        item.point.row + item.span.rows <= state.qubits &&
        item.point.col + item.span.cols <= state.steps
      );
    case "slice":
      return (
        item.point.row >= 0 &&
        item.point.row < state.qubits &&
        item.point.col >= 0 &&
        item.point.col < state.steps
      );
    case "verticalConnector":
      return (
        item.point.row >= 0 &&
        item.point.col >= 0 &&
        item.point.col < state.steps &&
        item.point.row + item.length < state.qubits
      );
    case "horizontalSegment":
      return (
        item.point.row >= 0 &&
        item.point.row < state.qubits &&
        item.point.col >= 0 &&
        item.point.col <= state.steps
      );
    default:
      return (
        item.point.row >= 0 &&
        item.point.row < state.qubits &&
        item.point.col >= 0 &&
        item.point.col < state.steps
      );
  }
}

export function canPasteClipboardAt(
  state: EditorState,
  clipboard: CircuitClipboard,
  anchor: GridPoint
): boolean {
  return instantiateClipboardItems(clipboard, anchor).every((item) => fitsGrid(item, state));
}
