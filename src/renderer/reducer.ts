import { canPasteClipboardAt, instantiateClipboardItems } from "./clipboard";
import {
  DEFAULT_CIRCUIT_LAYOUT,
  clampColumnSepCm,
  clampRowSepCm,
  measureGateWidth
} from "./layout";
import { normalizeHexColor } from "./color";
import { exportToQuantikz } from "./exporter";
import { validateCircuit } from "./validation";
import type {
  CircuitClipboard,
  CircuitItem,
  EditorState,
  HorizontalSegmentItem,
  HorizontalSegmentMode,
  ImportedCircuit,
  ItemType,
  PlacementTarget,
  ToolType,
  WireLabel
} from "./types";

type Action =
  | { type: "setTool"; tool: ToolType }
  | { type: "setHorizontalSegmentsUnlocked"; unlocked: boolean }
  | { type: "setSelectedIds"; itemIds: string[] }
  | { type: "selectOrCreateHorizontalSegment"; row: number; col: number; additive?: boolean }
  | { type: "addItem"; tool: ItemType; placement: PlacementTarget }
  | { type: "moveItem"; itemId: string; placement: PlacementTarget }
  | { type: "pasteClipboard"; clipboard: CircuitClipboard; anchor: { row: number; col: number } }
  | { type: "updateGateLabel"; itemId: string; label: string }
  | { type: "updateGateSpan"; itemId: string; rows: number }
  | { type: "updateVerticalLength"; itemId: string; length: number }
  | { type: "updateHorizontalMode"; itemId: string; mode: HorizontalSegmentMode }
  | { type: "updateItemColor"; itemId: string; color: string | null }
  | { type: "updateLayoutSpacing"; dimension: "rowSepCm" | "columnSepCm"; value: number }
  | { type: "updateWireLabel"; row: number; side: "left" | "right"; label: string }
  | { type: "resizeGrid"; dimension: "qubits" | "steps"; value: number }
  | { type: "deleteSelected" }
  | { type: "resetCircuit" }
  | { type: "convert" }
  | { type: "setExportCode"; code: string }
  | { type: "loadQuantikz"; imported: ImportedCircuit; code: string }
  | { type: "clearMessage" }
  | { type: "setMessage"; message: string | null };

let idCounter = 0;

function createId(type: ItemType): string {
  idCounter += 1;
  return `${type}-${idCounter}`;
}

function wireKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function deriveWireMask(items: CircuitItem[]): EditorState["wireMask"] {
  const mask: EditorState["wireMask"] = {};

  for (const item of items) {
    if (item.type === "horizontalSegment") {
      mask[wireKey(item.point.row, item.point.col)] = item.mode;
    }
  }

  return mask;
}

function getHorizontalSegmentAt(items: CircuitItem[], row: number, col: number): HorizontalSegmentItem | null {
  return items.find(
    (item): item is HorizontalSegmentItem =>
      item.type === "horizontalSegment" &&
      item.point.row === row &&
      item.point.col === col
  ) ?? null;
}

function resetExport(state: EditorState): EditorState {
  return {
    ...state,
    exportIssues: []
  };
}

function createWireLabels(qubits: number): WireLabel[] {
  return Array.from({ length: qubits }, () => ({ left: "", right: "" }));
}

function resizeWireLabels(labels: WireLabel[], qubits: number): WireLabel[] {
  if (labels.length === qubits) {
    return labels;
  }

  if (labels.length > qubits) {
    return labels.slice(0, qubits);
  }

  return [
    ...labels,
    ...Array.from({ length: qubits - labels.length }, () => ({ left: "", right: "" }))
  ];
}

function createItem(tool: ItemType, placement: PlacementTarget): CircuitItem | null {
  if (tool === "horizontalSegment") {
    if (placement.kind !== "segment") {
      return null;
    }

    return {
      id: createId(tool),
      type: "horizontalSegment",
      point: { row: placement.row, col: placement.col },
      mode: "absent",
      color: null
    };
  }

  if (placement.kind !== "cell") {
    return null;
  }

  const point = { row: placement.row, col: placement.col };

  switch (tool) {
    case "gate":
      return {
        id: createId(tool),
        type: "gate",
        point,
        span: { rows: 1, cols: 1 },
        label: "U",
        width: measureGateWidth("U"),
        color: null
      };
    case "meter":
      return {
        id: createId(tool),
        type: "meter",
        point,
        color: null
      };
    case "verticalConnector":
      return {
        id: createId(tool),
        type: "verticalConnector",
        point,
        length: 1,
        color: null
      };
    case "controlDot":
      return {
        id: createId(tool),
        type: "controlDot",
        point,
        color: null
      };
    case "targetPlus":
      return {
        id: createId(tool),
        type: "targetPlus",
        point,
        color: null
      };
    case "swapX":
      return {
        id: createId(tool),
        type: "swapX",
        point,
        color: null
      };
    default:
      return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function moveItemToPlacement(item: CircuitItem, placement: PlacementTarget, state: EditorState): CircuitItem {
  if (item.type === "horizontalSegment") {
    if (placement.kind !== "segment") {
      return item;
    }

    return {
      ...item,
      point: {
        row: clamp(placement.row, 0, state.qubits - 1),
        col: clamp(placement.col, 0, state.steps)
      }
    };
  }

  if (placement.kind !== "cell") {
    return item;
  }

  if (item.type === "gate") {
    return {
      ...item,
      point: {
        row: clamp(placement.row, 0, state.qubits - item.span.rows),
        col: clamp(placement.col, 0, state.steps - 1)
      }
    };
  }

  if (item.type === "meter") {
    return {
      ...item,
      point: {
        row: clamp(placement.row, 0, state.qubits - 1),
        col: clamp(placement.col, 0, state.steps - 1)
      }
    };
  }

  if (item.type === "verticalConnector") {
    return {
      ...item,
      point: {
        row: clamp(placement.row, 0, state.qubits - 1 - item.length),
        col: clamp(placement.col, 0, state.steps - 1)
      }
    };
  }

  return {
    ...item,
    point: {
      row: clamp(placement.row, 0, state.qubits - 1),
      col: clamp(placement.col, 0, state.steps - 1)
    }
  };
}

function computeOccupiedExtents(items: CircuitItem[]): { maxRow: number; maxStep: number } {
  let maxRow = 0;
  let maxStep = 0;

  for (const item of items) {
    switch (item.type) {
      case "gate":
        maxRow = Math.max(maxRow, item.point.row + item.span.rows - 1);
        maxStep = Math.max(maxStep, item.point.col + 1);
        break;
      case "meter":
        maxRow = Math.max(maxRow, item.point.row);
        maxStep = Math.max(maxStep, item.point.col + 1);
        break;
      case "verticalConnector":
        maxRow = Math.max(maxRow, item.point.row + item.length);
        maxStep = Math.max(maxStep, item.point.col + 1);
        break;
      case "horizontalSegment":
        maxRow = Math.max(maxRow, item.point.row);
        maxStep = Math.max(maxStep, item.point.col);
        break;
      default:
        maxRow = Math.max(maxRow, item.point.row);
        maxStep = Math.max(maxStep, item.point.col + 1);
        break;
    }
  }

  return { maxRow, maxStep };
}

function withItems(state: EditorState, items: CircuitItem[], selectedItemIds: string[]): EditorState {
  const nextState = resetExport({
    ...state,
    items,
    wireMask: deriveWireMask(items),
    selectedItemIds,
    wireLabels: resizeWireLabels(state.wireLabels, state.qubits)
  });

  return nextState;
}

export const initialState: EditorState = {
  qubits: 3,
  steps: 5,
  layout: DEFAULT_CIRCUIT_LAYOUT,
  items: [],
  wireMask: {},
  horizontalSegmentsUnlocked: false,
  wireLabels: createWireLabels(3),
  selectedItemIds: [],
  activeTool: "select",
  exportCode: "",
  exportIssues: [],
  uiMessage: null
};

export function editorReducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "setTool":
      return {
        ...state,
        activeTool: action.tool,
        uiMessage: null
      };
    case "setHorizontalSegmentsUnlocked": {
      const horizontalSegmentIds = new Set(
        state.items
          .filter((item) => item.type === "horizontalSegment")
          .map((item) => item.id)
      );

      return {
        ...state,
        horizontalSegmentsUnlocked: action.unlocked,
        selectedItemIds: action.unlocked
          ? state.selectedItemIds
          : state.selectedItemIds.filter((itemId) => !horizontalSegmentIds.has(itemId)),
        uiMessage: null
      };
    }
    case "setSelectedIds":
      return {
        ...state,
        selectedItemIds: [...new Set(action.itemIds)]
      };
    case "selectOrCreateHorizontalSegment": {
      const existing = getHorizontalSegmentAt(state.items, action.row, action.col);
      const nextSelectedIds = action.additive
        ? [...new Set([...(state.selectedItemIds ?? []), existing?.id].filter(Boolean) as string[])]
        : existing
          ? [existing.id]
          : [];

      if (existing) {
        return {
          ...state,
          selectedItemIds: nextSelectedIds,
          uiMessage: null
        };
      }

      const newItem: HorizontalSegmentItem = {
        id: createId("horizontalSegment"),
        type: "horizontalSegment",
        point: { row: action.row, col: action.col },
        mode: "present",
        color: null
      };

      return withItems(
        {
          ...state,
          uiMessage: null
        },
        [...state.items, newItem],
        action.additive ? [...new Set([...state.selectedItemIds, newItem.id])] : [newItem.id]
      );
    }
    case "addItem": {
      const newItem = createItem(action.tool, action.placement);
      if (!newItem) {
        return state;
      }

      if (newItem.type === "horizontalSegment") {
        const existing = state.items.find(
          (item) =>
            item.type === "horizontalSegment" &&
            item.point.row === newItem.point.row &&
            item.point.col === newItem.point.col
        );

        if (existing) {
          return {
            ...state,
            selectedItemIds: [existing.id],
            uiMessage: null
          };
        }
      }

      return withItems(
        {
          ...state,
          uiMessage: null
        },
        [...state.items, newItem],
        [newItem.id]
      );
    }
    case "moveItem": {
      const items = state.items.map((item) =>
        item.id === action.itemId ? moveItemToPlacement(item, action.placement, state) : item
      );

      return withItems(
        {
          ...state,
          uiMessage: null
        },
        items,
        [action.itemId]
      );
    }
    case "pasteClipboard": {
      if (!canPasteClipboardAt(state, action.clipboard, action.anchor)) {
        return {
          ...state,
          uiMessage: "Copied group does not fit in that area."
        };
      }

      const pastedItems = instantiateClipboardItems(action.clipboard, action.anchor).map((item) => ({
        ...item,
        id: createId(item.type)
      }));

      return withItems(
        {
          ...state,
          uiMessage: null
        },
        [...state.items, ...pastedItems],
        pastedItems.map((item) => item.id)
      );
    }
    case "updateGateLabel": {
      const items = state.items.map((item) => {
        if (item.id !== action.itemId || item.type !== "gate") {
          return item;
        }

        return {
          ...item,
          label: action.label,
          width: measureGateWidth(action.label)
        };
      });

      return withItems(state, items, state.selectedItemIds);
    }
    case "updateGateSpan": {
      const items = state.items.map((item) => {
        if (item.id !== action.itemId || item.type !== "gate") {
          return item;
        }

        const rows = clamp(action.rows, 1, state.qubits - item.point.row);
        return {
          ...item,
          span: { ...item.span, rows }
        };
      });

      return withItems(state, items, state.selectedItemIds);
    }
    case "updateVerticalLength": {
      const items = state.items.map((item) => {
        if (item.id !== action.itemId || item.type !== "verticalConnector") {
          return item;
        }

        return {
          ...item,
          length: clamp(action.length, 1, state.qubits - item.point.row - 1)
        };
      });

      return withItems(state, items, state.selectedItemIds);
    }
    case "updateHorizontalMode": {
      const items = state.items.map((item) => {
        if (item.id !== action.itemId || item.type !== "horizontalSegment") {
          return item;
        }

        return {
          ...item,
          mode: action.mode
        };
      });

      return withItems(state, items, state.selectedItemIds);
    }
    case "updateItemColor": {
      const color = normalizeHexColor(action.color);
      const items = state.items.map((item) => (
        item.id === action.itemId
          ? {
              ...item,
              color
            }
          : item
      ));

      return withItems(state, items, state.selectedItemIds);
    }
    case "updateLayoutSpacing":
      return resetExport({
        ...state,
        layout: {
          ...state.layout,
          [action.dimension]:
            action.dimension === "rowSepCm"
              ? clampRowSepCm(action.value)
              : clampColumnSepCm(action.value)
        },
        uiMessage: null
      });
    case "updateWireLabel": {
      if (action.row < 0 || action.row >= state.qubits) {
        return state;
      }

      const wireLabels = state.wireLabels.map((labels, row) => (
        row === action.row
          ? {
              ...labels,
              [action.side]: action.label
            }
          : labels
      ));

      return resetExport({
        ...state,
        wireLabels
      });
    }
    case "resizeGrid": {
      const nextValue = Math.max(1, action.value);
      const nextState = {
        ...state,
        [action.dimension]: nextValue
      } as EditorState;

      const { maxRow, maxStep } = computeOccupiedExtents(state.items);
      if (action.dimension === "qubits" && nextValue <= maxRow) {
        return {
          ...state,
          uiMessage: "Cannot reduce qubits below the occupied circuit height."
        };
      }

      if (action.dimension === "steps" && nextValue < maxStep) {
        return {
          ...state,
          uiMessage: "Cannot reduce steps below the occupied circuit width."
        };
      }

      return resetExport({
        ...nextState,
        wireLabels: resizeWireLabels(
          state.wireLabels,
          action.dimension === "qubits" ? nextValue : state.qubits
        ),
        uiMessage: null
      });
    }
    case "deleteSelected": {
      if (state.selectedItemIds.length === 0) {
        return state;
      }

      const selectedIds = new Set(state.selectedItemIds);
      const items = state.items.flatMap((item) => {
        if (!selectedIds.has(item.id)) {
          return [item];
        }

        if (item.type === "horizontalSegment") {
          return [{
            ...item,
            mode: "absent",
            color: null
          }];
        }

        return [];
      });

      return withItems(
        {
          ...state,
          uiMessage: null
        },
        items,
        []
      );
    }
    case "resetCircuit":
      idCounter = 0;
      return {
        ...initialState,
        wireLabels: createWireLabels(initialState.qubits)
      };
    case "convert": {
      const issues = validateCircuit(state);
      const hasErrors = issues.some((entry) => entry.severity === "error");
      return {
        ...state,
        exportIssues: issues,
        exportCode: hasErrors ? "" : exportToQuantikz(state),
        uiMessage: hasErrors ? "Fix validation errors before exporting." : "Quantikz code generated."
      };
    }
    case "setExportCode":
      return {
        ...state,
        exportCode: action.code,
        exportIssues: [],
        uiMessage: null
      };
    case "loadQuantikz":
      idCounter = action.imported.items.length;
      return {
        qubits: action.imported.qubits,
        steps: action.imported.steps,
        layout: action.imported.layout,
        items: action.imported.items,
        wireMask: deriveWireMask(action.imported.items),
        horizontalSegmentsUnlocked: false,
        wireLabels: resizeWireLabels(action.imported.wireLabels, action.imported.qubits),
        selectedItemIds: [],
        activeTool: "select",
        exportCode: action.code,
        exportIssues: [],
        uiMessage: "Quantikz code loaded into the visual editor."
      };
    case "clearMessage":
      return {
        ...state,
        uiMessage: null
      };
    case "setMessage":
      return {
        ...state,
        uiMessage: action.message
      };
    default:
      return state;
  }
}

export type EditorAction = Action;
