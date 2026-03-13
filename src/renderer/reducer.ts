import { canPasteClipboardAt, instantiateClipboardItems } from "./clipboard";
import {
  DEFAULT_CIRCUIT_LAYOUT,
  clampColumnSepCm,
  clampRowSepCm,
  measureGateWidth
} from "./layout";
import { normalizeHexColor } from "./color";
import { canPlaceItemsWithoutOverlap } from "./occupancy";
import { exportToQuantikz } from "./exporter";
import { validateCircuit } from "./validation";
import {
  createWireLabels,
  mergeWireLabelGroups,
  resizeWireLabels,
  unmergeWireLabelGroup,
  updateWireLabelGroup,
  updateWireLabelText
} from "./wireLabels";
import type {
  CircuitClipboard,
  CircuitItem,
  ControlState,
  EditorState,
  FrameItem,
  HorizontalSegmentItem,
  HorizontalSegmentMode,
  ImportedCircuit,
  ItemType,
  PlacementTarget,
  SliceItem,
  ToolType,
  WireLabelBracket,
  WireType
} from "./types";

type Action =
  | { type: "setTool"; tool: ToolType }
  | { type: "setAutoWireNewGrid"; enabled: boolean }
  | { type: "setHorizontalSegmentsUnlocked"; unlocked: boolean }
  | { type: "setSelectedIds"; itemIds: string[] }
  | { type: "selectOrCreateHorizontalSegment"; row: number; col: number; additive?: boolean }
  | { type: "addItem"; tool: ItemType; placement: PlacementTarget }
  | { type: "addGateFromArea"; start: { row: number; col: number }; end: { row: number; col: number } }
  | { type: "addMeterFromArea"; start: { row: number; col: number }; endRow: number }
  | { type: "addAnnotationFromArea"; start: { row: number; col: number }; end: { row: number; col: number } }
  | { type: "moveItem"; itemId: string; placement: PlacementTarget }
  | { type: "pasteClipboard"; clipboard: CircuitClipboard; anchor: { row: number; col: number } }
  | { type: "updateGateLabel"; itemId: string; label: string }
  | { type: "updateGateSpan"; itemId: string; rows: number; cols: number }
  | { type: "updateFrameLabel"; itemId: string; label: string }
  | { type: "updateFrameSpan"; itemId: string; rows: number; cols: number }
  | { type: "updateFrameStyle"; itemId: string; rounded?: boolean; dashed?: boolean; background?: boolean; innerXSepPt?: number }
  | { type: "updateSliceLabel"; itemId: string; label: string }
  | { type: "updateVerticalLength"; itemId: string; length: number }
  | { type: "updateVerticalWireType"; itemId: string; wireType: WireType }
  | { type: "updateControlState"; itemId: string; controlState: ControlState }
  | { type: "updateHorizontalMode"; itemId: string; mode: HorizontalSegmentMode }
  | { type: "updateHorizontalWireType"; itemId: string; wireType: WireType }
  | { type: "updateItemColor"; itemId: string; color: string | null }
  | { type: "updateLayoutSpacing"; dimension: "rowSepCm" | "columnSepCm"; value: number }
  | { type: "updateWireLabel"; row: number; side: "left" | "right"; label: string }
  | { type: "updateWireLabelGroup"; row: number; side: "left" | "right"; span?: number; bracket?: WireLabelBracket }
  | { type: "mergeWireLabelGroup"; row: number; side: "left" | "right" }
  | { type: "unmergeWireLabelGroup"; row: number; side: "left" | "right" }
  | { type: "updateRowWireType"; row: number; wireType: WireType }
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

function createWireTypes(qubits: number): WireType[] {
  return Array.from({ length: qubits }, () => "quantum");
}

function buildHorizontalSegment(
  row: number,
  col: number,
  mode: HorizontalSegmentMode = "present",
  wireType: WireType = "quantum",
  color: string | null = null
): HorizontalSegmentItem {
  return {
    id: createId("horizontalSegment"),
    type: "horizontalSegment",
    point: { row, col },
    mode,
    wireType,
    color
  };
}

function fitsInGrid(item: CircuitItem, qubits: number, steps: number): boolean {
  switch (item.type) {
    case "gate":
    case "frame":
      return (
        item.point.row >= 0 &&
        item.point.col >= 0 &&
        item.point.row + item.span.rows <= qubits &&
        item.point.col + item.span.cols <= steps
      );
    case "meter":
      return (
        item.point.row >= 0 &&
        item.point.col >= 0 &&
        item.point.row + item.span.rows <= qubits &&
        item.point.col < steps
      );
    case "slice":
      return item.point.row >= 0 && item.point.row < qubits && item.point.col >= 0 && item.point.col < steps;
    case "verticalConnector":
      return (
        item.point.row >= 0 &&
        item.point.col >= 0 &&
        item.point.col < steps &&
        item.point.row + item.length < qubits
      );
    case "horizontalSegment":
      return (
        item.point.row >= 0 &&
        item.point.row < qubits &&
        item.point.col >= 0 &&
        item.point.col <= steps
      );
    default:
      return item.point.row >= 0 && item.point.row < qubits && item.point.col >= 0 && item.point.col < steps;
  }
}

function resizeWireTypes(wireTypes: WireType[], qubits: number): WireType[] {
  if (wireTypes.length === qubits) {
    return wireTypes;
  }

  if (wireTypes.length > qubits) {
    return wireTypes.slice(0, qubits);
  }

  return [
    ...wireTypes,
    ...Array.from({ length: qubits - wireTypes.length }, () => "quantum" as const)
  ];
}

function createAbsentHorizontalSegments(
  rows: number[],
  segmentCols: number[]
): HorizontalSegmentItem[] {
  return rows.flatMap((row) =>
    segmentCols.map((col) => buildHorizontalSegment(row, col, "absent"))
  );
}

function normalizeHorizontalSegments(
  items: CircuitItem[],
  qubits: number,
  steps: number,
  wireTypes: WireType[]
): CircuitItem[] {
  const nonHorizontals = items.filter((item) => item.type !== "horizontalSegment");
  const horizontals = new Map<string, HorizontalSegmentItem>();

  for (const item of items) {
    if (item.type !== "horizontalSegment") {
      continue;
    }

    if (item.point.row < 0 || item.point.row >= qubits || item.point.col < 0 || item.point.col > steps) {
      continue;
    }

    horizontals.set(wireKey(item.point.row, item.point.col), item);
  }

  for (let row = 0; row < qubits; row += 1) {
    for (let col = 0; col <= steps; col += 1) {
      const key = wireKey(row, col);
      if (!horizontals.has(key)) {
        horizontals.set(
          key,
          buildHorizontalSegment(row, col, "present", wireTypes[row] ?? "quantum")
        );
      }
    }
  }

  const orderedHorizontals = [...horizontals.values()].sort(
    (left, right) => left.point.row - right.point.row || left.point.col - right.point.col
  );

  return [...nonHorizontals, ...orderedHorizontals];
}

function createItem(tool: ItemType, placement: PlacementTarget, state: EditorState): CircuitItem | null {
  if (tool === "horizontalSegment") {
    if (placement.kind !== "segment") {
      return null;
    }

    return {
      ...buildHorizontalSegment(placement.row, placement.col),
      id: createId(tool),
      type: "horizontalSegment"
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
        span: { rows: 1, cols: 1 },
        color: null
      };
    case "frame":
      return {
        id: createId(tool),
        type: "frame",
        point,
        span: { rows: 2, cols: 2 },
        label: "Group",
        rounded: true,
        dashed: true,
        background: true,
        innerXSepPt: 2,
        color: null
      };
    case "slice":
      return {
        id: createId(tool),
        type: "slice",
        point,
        label: "slice",
        color: null
      };
    case "verticalConnector":
      return {
        id: createId(tool),
        type: "verticalConnector",
        point,
        length: 1,
        wireType: "quantum",
        color: null
      };
    case "controlDot":
      return {
        id: createId(tool),
        type: "controlDot",
        point,
        controlState: "filled",
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
        col: clamp(placement.col, 0, state.steps - item.span.cols)
      }
    };
  }

  if (item.type === "meter") {
    return {
      ...item,
      point: {
        row: clamp(placement.row, 0, state.qubits - item.span.rows),
        col: clamp(placement.col, 0, state.steps - 1)
      }
    };
  }

  if (item.type === "frame") {
    return {
      ...item,
      point: {
        row: clamp(placement.row, 0, state.qubits - item.span.rows),
        col: clamp(placement.col, 0, state.steps - item.span.cols)
      }
    };
  }

  if (item.type === "slice") {
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
        maxStep = Math.max(maxStep, item.point.col + item.span.cols);
        break;
      case "meter":
        maxRow = Math.max(maxRow, item.point.row + item.span.rows - 1);
        maxStep = Math.max(maxStep, item.point.col + 1);
        break;
      case "frame":
        maxRow = Math.max(maxRow, item.point.row + item.span.rows - 1);
        maxStep = Math.max(maxStep, item.point.col + item.span.cols);
        break;
      case "slice":
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
  const normalizedItems = normalizeHorizontalSegments(items, state.qubits, state.steps, state.wireTypes);
  const nextState = resetExport({
    ...state,
    items: normalizedItems,
    wireMask: deriveWireMask(normalizedItems),
    wireTypes: resizeWireTypes(state.wireTypes, state.qubits),
    selectedItemIds,
    wireLabels: resizeWireLabels(state.wireLabels, state.qubits)
  });

  return nextState;
}

function withOverlapMessage(state: EditorState, message = "Cannot place objects on top of each other."): EditorState {
  return {
    ...state,
    uiMessage: message
  };
}

function createInitialEditorState(): EditorState {
  const qubits = 3;
  const steps = 5;
  const wireTypes = createWireTypes(qubits);
  const items = normalizeHorizontalSegments([], qubits, steps, wireTypes);

  return {
    qubits,
    steps,
    layout: DEFAULT_CIRCUIT_LAYOUT,
    items,
    wireMask: deriveWireMask(items),
    wireTypes,
    autoWireNewGrid: true,
    horizontalSegmentsUnlocked: false,
    wireLabels: createWireLabels(qubits),
    selectedItemIds: [],
    activeTool: "select",
    exportCode: "",
    exportIssues: [],
    uiMessage: null
  };
}

export const initialState: EditorState = createInitialEditorState();

export function editorReducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "setTool":
      return {
        ...state,
        activeTool: action.tool,
        uiMessage: null
      };
    case "setAutoWireNewGrid":
      return {
        ...state,
        autoWireNewGrid: action.enabled,
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
        ...buildHorizontalSegment(action.row, action.col),
        id: createId("horizontalSegment"),
        type: "horizontalSegment"
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
      const newItem = createItem(action.tool, action.placement, state);
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
          if (existing.mode === "present") {
            return {
              ...state,
              selectedItemIds: [existing.id],
              uiMessage: null
            };
          }

          return withItems(
            {
              ...state,
              uiMessage: null
            },
            state.items.map((item) =>
              item.id === existing.id
                ? {
                    ...item,
                    mode: "present"
                  }
                : item
            ),
            [existing.id]
          );
        }
      }

      if (!canPlaceItemsWithoutOverlap(state.items, [newItem])) {
        return withOverlapMessage(state);
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
    case "addGateFromArea": {
      const topRow = Math.min(action.start.row, action.end.row);
      const leftCol = Math.min(action.start.col, action.end.col);
      const rows = clamp(Math.abs(action.end.row - action.start.row) + 1, 1, state.qubits - topRow);
      const cols = clamp(Math.abs(action.end.col - action.start.col) + 1, 1, state.steps - leftCol);
      const gate: CircuitItem = {
        id: createId("gate"),
        type: "gate",
        point: { row: topRow, col: leftCol },
        span: { rows, cols },
        label: "U",
        width: measureGateWidth("U"),
        color: null
      };

      if (!canPlaceItemsWithoutOverlap(state.items, [gate])) {
        return withOverlapMessage(state);
      }

      return withItems({ ...state, uiMessage: null }, [...state.items, gate], [gate.id]);
    }
    case "addMeterFromArea": {
      const topRow = Math.min(action.start.row, action.endRow);
      const rows = clamp(Math.abs(action.endRow - action.start.row) + 1, 1, state.qubits - topRow);
      const meter: CircuitItem = {
        id: createId("meter"),
        type: "meter",
        point: { row: topRow, col: clamp(action.start.col, 0, state.steps - 1) },
        span: { rows, cols: 1 },
        color: null
      };

      if (!canPlaceItemsWithoutOverlap(state.items, [meter])) {
        return withOverlapMessage(state);
      }

      return withItems({ ...state, uiMessage: null }, [...state.items, meter], [meter.id]);
    }
    case "addAnnotationFromArea": {
      const topRow = Math.min(action.start.row, action.end.row);
      const leftCol = Math.min(action.start.col, action.end.col);
      const rows = Math.abs(action.end.row - action.start.row) + 1;
      const cols = Math.abs(action.end.col - action.start.col) + 1;

      if (rows === 1 && cols === 1) {
        const slice: SliceItem = {
          id: createId("slice"),
          type: "slice",
          point: { row: action.start.row, col: action.start.col },
          label: "slice",
          color: null
        };
        return withItems({ ...state, uiMessage: null }, [...state.items, slice], [slice.id]);
      }

      const frame: FrameItem = {
        id: createId("frame"),
        type: "frame",
        point: { row: topRow, col: leftCol },
        span: {
          rows: clamp(rows, 1, state.qubits - topRow),
          cols: clamp(cols, 1, state.steps - leftCol)
        },
        label: "Group",
        rounded: true,
        dashed: true,
        background: true,
        innerXSepPt: 2,
        color: null
      };
      return withItems({ ...state, uiMessage: null }, [...state.items, frame], [frame.id]);
    }
    case "moveItem": {
      const movingItem = state.items.find((item) => item.id === action.itemId);
      if (!movingItem) {
        return state;
      }

      const nextItem = moveItemToPlacement(movingItem, action.placement, state);
      if (!canPlaceItemsWithoutOverlap(state.items, [nextItem], [action.itemId])) {
        return withOverlapMessage(state);
      }

      const items = state.items.map((item) =>
        item.id === action.itemId ? nextItem : item
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
          uiMessage: "Copied group cannot be placed there."
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
      const gate = state.items.find((item) => item.id === action.itemId && item.type === "gate");
      if (!gate || gate.type !== "gate") {
        return state;
      }

      const rows = clamp(action.rows, 1, state.qubits - gate.point.row);
      const cols = clamp(action.cols, 1, state.steps - gate.point.col);
      const updatedGate = {
        ...gate,
        span: { rows, cols }
      };

      if (!canPlaceItemsWithoutOverlap(state.items, [updatedGate], [action.itemId])) {
        return withOverlapMessage(state);
      }

      const items = state.items.map((item) => (
        item.id === action.itemId ? updatedGate : item
      ));

      return withItems(state, items, state.selectedItemIds);
    }
    case "updateFrameLabel": {
      const items = state.items.map((item) => {
        if (item.id !== action.itemId || item.type !== "frame") {
          return item;
        }

        return {
          ...item,
          label: action.label
        };
      });

      return withItems(state, items, state.selectedItemIds);
    }
    case "updateFrameSpan": {
      const items = state.items.map((item) => {
        if (item.id !== action.itemId || item.type !== "frame") {
          return item;
        }

        return {
          ...item,
          span: {
            rows: clamp(action.rows, 1, state.qubits - item.point.row),
            cols: clamp(action.cols, 1, state.steps - item.point.col)
          }
        };
      });

      return withItems(state, items, state.selectedItemIds);
    }
    case "updateFrameStyle": {
      const items = state.items.map((item) => {
        if (item.id !== action.itemId || item.type !== "frame") {
          return item;
        }

        return {
          ...item,
          rounded: action.rounded ?? item.rounded,
          dashed: action.dashed ?? item.dashed,
          background: action.background ?? item.background,
          innerXSepPt: action.innerXSepPt ?? item.innerXSepPt
        };
      });

      return withItems(state, items, state.selectedItemIds);
    }
    case "updateSliceLabel": {
      const items = state.items.map((item) => {
        if (item.id !== action.itemId || item.type !== "slice") {
          return item;
        }

        return {
          ...item,
          label: action.label
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
    case "updateVerticalWireType": {
      const items = state.items.map((item) => {
        if (item.id !== action.itemId || item.type !== "verticalConnector") {
          return item;
        }

        return {
          ...item,
          wireType: action.wireType
        };
      });

      return withItems(state, items, state.selectedItemIds);
    }
    case "updateControlState": {
      const items = state.items.map((item) => {
        if (item.id !== action.itemId || item.type !== "controlDot") {
          return item;
        }

        return {
          ...item,
          controlState: action.controlState
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
    case "updateHorizontalWireType": {
      const items = state.items.map((item) => {
        if (item.id !== action.itemId || item.type !== "horizontalSegment") {
          return item;
        }

        return {
          ...item,
          wireType: action.wireType
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

      const wireLabels = updateWireLabelText(
        state.wireLabels,
        action.row,
        action.side,
        action.label,
        state.qubits
      );

      return resetExport({
        ...state,
        wireLabels
      });
    }
    case "updateWireLabelGroup":
      return resetExport({
        ...state,
        wireLabels: updateWireLabelGroup(
          state.wireLabels,
          action.row,
          action.side,
          {
            span: action.span,
            bracket: action.bracket
          },
          state.qubits
        )
      });
    case "mergeWireLabelGroup":
      return resetExport({
        ...state,
        wireLabels: mergeWireLabelGroups(state.wireLabels, action.row, action.side, state.qubits)
      });
    case "unmergeWireLabelGroup":
      return resetExport({
        ...state,
        wireLabels: unmergeWireLabelGroup(state.wireLabels, action.row, action.side, state.qubits)
      });
    case "updateRowWireType": {
      if (action.row < 0 || action.row >= state.qubits) {
        return state;
      }

      const wireTypes = state.wireTypes.map((wireType, row) =>
        row === action.row ? action.wireType : wireType
      );

      return resetExport({
        ...state,
        wireTypes
      });
    }
    case "resizeGrid": {
      const nextValue = Math.max(1, action.value);
      const currentValue = action.dimension === "qubits" ? state.qubits : state.steps;
      const nextState = {
        ...state,
        [action.dimension]: nextValue
      } as EditorState;

      let items = state.items.filter((item) => {
        if (action.dimension === "qubits" && item.type === "horizontalSegment") {
          return item.point.row < nextValue;
        }

        if (action.dimension === "steps" && item.type === "horizontalSegment") {
          return item.point.col <= nextValue;
        }

        return true;
      });
      items = items.filter((item) =>
        fitsInGrid(
          item,
          action.dimension === "qubits" ? nextValue : state.qubits,
          action.dimension === "steps" ? nextValue : state.steps
        )
      );
      let nextWireTypes =
        action.dimension === "qubits"
          ? resizeWireTypes(state.wireTypes, nextValue)
          : state.wireTypes;
      const removedCount = Math.max(0, state.items.length - items.length);

      if (nextValue > currentValue && !state.autoWireNewGrid) {
        if (action.dimension === "qubits") {
          const newRows = Array.from({ length: nextValue - state.qubits }, (_, index) => state.qubits + index);
          const segmentCols = Array.from({ length: state.steps + 1 }, (_, index) => index);
          items = [
            ...items,
            ...createAbsentHorizontalSegments(newRows, segmentCols)
          ];
        } else {
          const newSegmentCols = Array.from({ length: nextValue - state.steps }, (_, index) => state.steps + 1 + index);
          const rows = Array.from({ length: state.qubits }, (_, row) => row);
          items = [
            ...items,
            ...createAbsentHorizontalSegments(rows, newSegmentCols)
          ];
        }
      }

      return withItems(
        {
          ...nextState,
          wireTypes: nextWireTypes,
          wireLabels: resizeWireLabels(
            state.wireLabels,
            action.dimension === "qubits" ? nextValue : state.qubits
          ),
          uiMessage: removedCount > 0 ? `Resized grid and removed ${removedCount} out-of-bounds object${removedCount === 1 ? "" : "s"}.` : null
        },
        items,
        state.selectedItemIds.filter((itemId) => items.some((item) => item.id === itemId))
      );
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
      return createInitialEditorState();
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
      return withItems(
        {
          qubits: action.imported.qubits,
          steps: action.imported.steps,
          layout: action.imported.layout,
          items: [],
          wireMask: {},
          wireTypes: resizeWireTypes(action.imported.wireTypes, action.imported.qubits),
          autoWireNewGrid: true,
          horizontalSegmentsUnlocked: false,
          wireLabels: resizeWireLabels(action.imported.wireLabels, action.imported.qubits),
          selectedItemIds: [],
          activeTool: "select",
          exportCode: action.code,
          exportIssues: [],
          uiMessage: "Quantikz code loaded into the visual editor."
        },
        action.imported.items,
        []
      );
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
