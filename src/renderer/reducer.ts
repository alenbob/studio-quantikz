import { canPasteClipboardAt, instantiateClipboardItems } from "./clipboard";
import { DEFAULT_EXPORT_PREAMBLE, DEFAULT_SYMBOLIC_PREAMBLE } from "./document";
import {
  DEFAULT_CIRCUIT_LAYOUT,
  clampColumnSepCm,
  clampRowSepCm,
  measureGateWidth
} from "./layout";
import { normalizeHexColor } from "./color";
import {
  getMeterSuppressedHorizontalKeys,
  isVisibleHorizontalSegment,
  wireKey
} from "./horizontalWires";
import { projectSelectionMove } from "./movement";
import { canPlaceItemsWithoutOverlap } from "./occupancy";
import { exportToQuantikz } from "./exporter";
import { validateCircuit } from "./validation";
import {
  createWireLabels,
  getWireLabelBracket,
  getWireLabelSpan,
  isWireLabelGroupStart,
  mergeWireLabelGroups,
  normalizeWireLabels,
  resizeWireLabels,
  type WireLabelSide,
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
  WireLabel,
  WireLabelBracket,
  WireType
} from "./types";

type Action =
  | { type: "setTool"; tool: ToolType }
  | { type: "setAutoWireNewGrid"; enabled: boolean }
  | { type: "setHorizontalSegmentsUnlocked"; unlocked: boolean }
  | { type: "setSelectedIds"; itemIds: string[] }
  | { type: "selectOrCreateHorizontalSegment"; row: number; col: number; additive?: boolean }
  | { type: "drawWire"; start: { row: number; col: number }; end: { row: number; col: number } }
  | { type: "addItem"; tool: ItemType; placement: PlacementTarget }
  | { type: "addGateFromArea"; start: { row: number; col: number }; end: { row: number; col: number } }
  | { type: "addMeterFromArea"; start: { row: number; col: number }; endRow: number }
  | { type: "addAnnotationFromArea"; start: { row: number; col: number }; end: { row: number; col: number } }
  | { type: "moveItem"; itemId: string; placement: PlacementTarget }
  | { type: "moveSelection"; anchorItemId: string; placement: PlacementTarget }
  | { type: "pasteClipboard"; clipboard: CircuitClipboard; anchor: { row: number; col: number } }
  | { type: "updateGateLabel"; itemId: string; label: string }
  | { type: "updateGateLabelBatch"; itemIds: string[]; label: string }
  | { type: "updateGateSpan"; itemId: string; rows: number; cols: number }
  | { type: "updateFrameLabel"; itemId: string; label: string }
  | { type: "updateFrameSpan"; itemId: string; rows: number; cols: number }
  | { type: "updateFrameStyle"; itemId: string; rounded?: boolean; dashed?: boolean; background?: boolean; innerXSepPt?: number }
  | { type: "updateSliceLabel"; itemId: string; label: string }
  | { type: "updateVerticalLength"; itemId: string; length: number }
  | { type: "updateVerticalWireType"; itemId: string; wireType: WireType }
  | { type: "updateControlState"; itemId: string; controlState: ControlState }
  | { type: "updateControlStateBatch"; itemIds: string[]; controlState: ControlState }
  | { type: "updateHorizontalMode"; itemId: string; mode: HorizontalSegmentMode }
  | { type: "updateHorizontalWireType"; itemId: string; wireType: WireType }
  | { type: "updateHorizontalBundled"; itemId: string; bundled: boolean }
  | { type: "updateHorizontalBundleLabel"; itemId: string; bundleLabel: string }
  | { type: "updateWireTypeBatch"; itemIds: string[]; wireType: WireType }
  | { type: "updateItemColor"; itemId: string; color: string | null }
  | { type: "updateItemColorBatch"; itemIds: string[]; color: string | null }
  | { type: "updateLayoutSpacing"; dimension: "rowSepCm" | "columnSepCm"; value: number }
  | { type: "updateWireLabel"; row: number; side: "left" | "right"; label: string }
  | { type: "updateWireLabelGroup"; row: number; side: "left" | "right"; span?: number; bracket?: WireLabelBracket }
  | { type: "mergeWireLabelGroup"; row: number; side: "left" | "right" }
  | { type: "unmergeWireLabelGroup"; row: number; side: "left" | "right" }
  | { type: "updateRowWireType"; row: number; wireType: WireType }
  | { type: "insertGridLine"; dimension: "qubits" | "steps"; index: number }
  | { type: "deleteGridLine"; dimension: "qubits" | "steps"; index: number }
  | { type: "resizeGrid"; dimension: "qubits" | "steps"; value: number }
  | { type: "deleteSelected" }
  | { type: "resetCircuit" }
  | { type: "convert" }
  | { type: "setExportCode"; code: string }
  | { type: "setExportPreamble"; preamble: string }
  | { type: "setExportSymbolicPreamble"; preamble: string }
  | { type: "loadQuantikz"; imported: ImportedCircuit; code: string; preamble: string }
  | { type: "clearMessage" }
  | { type: "setMessage"; message: string | null };

let idCounter = 0;

function createId(type: ItemType): string {
  idCounter += 1;
  return `${type}-${idCounter}`;
}

function deriveWireMask(items: CircuitItem[]): EditorState["wireMask"] {
  const mask: EditorState["wireMask"] = {};

  for (const item of items) {
    if (item.type === "horizontalSegment") {
      mask[wireKey(item.point.row, item.point.col)] = item.autoSuppressed === true ? "absent" : item.mode;
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

function canSelectItem(item: CircuitItem, horizontalSegmentsUnlocked: boolean): boolean {
  return item.type !== "horizontalSegment" || (horizontalSegmentsUnlocked && isVisibleHorizontalSegment(item));
}

function filterSelectedItemIds(
  items: CircuitItem[],
  selectedItemIds: string[],
  horizontalSegmentsUnlocked: boolean
): string[] {
  const selectableIds = new Set(
    items
      .filter((item) => canSelectItem(item, horizontalSegmentsUnlocked))
      .map((item) => item.id)
  );

  return [...new Set(selectedItemIds)].filter((itemId) => selectableIds.has(itemId));
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
  color: string | null = null,
  bundled = false,
  bundleLabel?: string
): HorizontalSegmentItem {
  return {
    id: createId("horizontalSegment"),
    type: "horizontalSegment",
    point: { row, col },
    mode,
    wireType,
    bundled,
    color,
    bundleLabel
  };
}

function buildVerticalConnector(
  row: number,
  col: number,
  wireType: WireType = "quantum",
  color: string | null = null,
  id = createId("verticalConnector")
): CircuitItem {
  return {
    id,
    type: "verticalConnector",
    point: { row, col },
    length: 1,
    wireType,
    color
  };
}

interface WireLabelGroupDescriptor {
  row: number;
  span: number;
  bracket: WireLabelBracket;
  text: string;
}

function extractWireLabelGroups(labels: WireLabel[], side: WireLabelSide, qubits: number): WireLabelGroupDescriptor[] {
  const groups: WireLabelGroupDescriptor[] = [];

  for (let row = 0; row < qubits; row += 1) {
    if (!isWireLabelGroupStart(labels, row, side)) {
      continue;
    }

    const label = labels[row];
    const span = getWireLabelSpan(label, side);
    const bracket = getWireLabelBracket(label, side);
    const text = label?.[side] ?? "";

    if (!text && span <= 1) {
      continue;
    }

    groups.push({ row, span, bracket, text });
  }

  return groups;
}

function buildWireLabelsFromGroups(
  qubits: number,
  leftGroups: WireLabelGroupDescriptor[],
  rightGroups: WireLabelGroupDescriptor[]
): WireLabel[] {
  const labels = createWireLabels(qubits);

  for (const group of leftGroups) {
    if (group.row < 0 || group.row >= qubits) {
      continue;
    }

    labels[group.row] = {
      ...labels[group.row],
      left: group.text,
      leftSpan: group.span,
      leftBracket: group.span > 1 ? group.bracket : "none"
    };
  }

  for (const group of rightGroups) {
    if (group.row < 0 || group.row >= qubits) {
      continue;
    }

    labels[group.row] = {
      ...labels[group.row],
      right: group.text,
      rightSpan: group.span,
      rightBracket: group.span > 1 ? group.bracket : "none"
    };
  }

  return normalizeWireLabels(labels, qubits);
}

function insertWireLabelGroups(
  groups: WireLabelGroupDescriptor[],
  index: number
): WireLabelGroupDescriptor[] {
  return groups.map((group) => {
    const end = group.row + group.span - 1;
    if (group.row >= index) {
      return { ...group, row: group.row + 1 };
    }

    if (group.row < index && index <= end) {
      return { ...group, span: group.span + 1 };
    }

    return group;
  });
}

function deleteWireLabelGroups(
  groups: WireLabelGroupDescriptor[],
  index: number
): WireLabelGroupDescriptor[] {
  return groups.flatMap((group) => {
    const end = group.row + group.span - 1;

    if (index < group.row) {
      return [{ ...group, row: group.row - 1 }];
    }

    if (index > end) {
      return [group];
    }

    if (group.span <= 1) {
      return [];
    }

    return [{
      ...group,
      span: group.span - 1,
      bracket: group.span - 1 > 1 ? group.bracket : "none"
    }];
  });
}

function insertWireLabelRow(labels: WireLabel[], index: number, qubits: number): WireLabel[] {
  const leftGroups = insertWireLabelGroups(extractWireLabelGroups(labels, "left", qubits), index);
  const rightGroups = insertWireLabelGroups(extractWireLabelGroups(labels, "right", qubits), index);
  return buildWireLabelsFromGroups(qubits + 1, leftGroups, rightGroups);
}

function deleteWireLabelRow(labels: WireLabel[], index: number, qubits: number): WireLabel[] {
  const leftGroups = deleteWireLabelGroups(extractWireLabelGroups(labels, "left", qubits), index);
  const rightGroups = deleteWireLabelGroups(extractWireLabelGroups(labels, "right", qubits), index);
  return buildWireLabelsFromGroups(Math.max(qubits - 1, 1), leftGroups, rightGroups);
}

function insertWireTypeRow(wireTypes: WireType[], index: number): WireType[] {
  return [
    ...wireTypes.slice(0, index),
    "quantum",
    ...wireTypes.slice(index)
  ];
}

function deleteWireTypeRow(wireTypes: WireType[], index: number): WireType[] {
  return wireTypes.filter((_, row) => row !== index);
}

function insertRowItems(items: CircuitItem[], index: number): CircuitItem[] {
  return items.map((item) => {
    switch (item.type) {
      case "gate":
      case "meter":
      case "frame": {
        const spanRows = item.span.rows;
        const end = item.point.row + spanRows - 1;
        if (item.point.row >= index) {
          return {
            ...item,
            point: {
              ...item.point,
              row: item.point.row + 1
            }
          };
        }

        if (item.point.row < index && index <= end) {
          return {
            ...item,
            span: {
              ...item.span,
              rows: spanRows + 1
            }
          };
        }

        return item;
      }
      case "verticalConnector": {
        const end = item.point.row + item.length;
        if (item.point.row >= index) {
          return {
            ...item,
            point: {
              ...item.point,
              row: item.point.row + 1
            }
          };
        }

        if (item.point.row < index && index <= end) {
          return {
            ...item,
            length: item.length + 1
          };
        }

        return item;
      }
      case "horizontalSegment":
        return item.point.row >= index
          ? {
              ...item,
              point: {
                ...item.point,
                row: item.point.row + 1
              }
            }
          : item;
      case "equalsColumn":
        return item;
      default:
        return item.point.row >= index
          ? {
              ...item,
              point: {
                ...item.point,
                row: item.point.row + 1
              }
            }
          : item;
    }
  });
}

function deleteRowItems(items: CircuitItem[], index: number): CircuitItem[] {
  return items.flatMap((item) => {
    switch (item.type) {
      case "gate":
      case "meter":
      case "frame": {
        const spanRows = item.span.rows;
        const end = item.point.row + spanRows - 1;

        if (item.point.row > index) {
          return [{
            ...item,
            point: {
              ...item.point,
              row: item.point.row - 1
            }
          }];
        }

        if (index < item.point.row || index > end) {
          return [item];
        }

        if (spanRows <= 1) {
          return [];
        }

        return [{
          ...item,
          span: {
            ...item.span,
            rows: spanRows - 1
          }
        }];
      }
      case "verticalConnector": {
        const end = item.point.row + item.length;

        if (item.point.row > index) {
          return [{
            ...item,
            point: {
              ...item.point,
              row: item.point.row - 1
            }
          }];
        }

        if (index < item.point.row || index > end) {
          return [item];
        }

        if (item.length <= 1) {
          return [];
        }

        return [{
          ...item,
          length: item.length - 1
        }];
      }
      case "horizontalSegment":
        if (item.point.row === index) {
          return [];
        }

        return item.point.row > index
          ? [{
              ...item,
              point: {
                ...item.point,
                row: item.point.row - 1
              }
            }]
          : [item];
      case "equalsColumn":
        return [item];
      default:
        if (item.point.row === index) {
          return [];
        }

        return item.point.row > index
          ? [{
              ...item,
              point: {
                ...item.point,
                row: item.point.row - 1
              }
            }]
          : [item];
    }
  });
}

function insertColumnItems(items: CircuitItem[], index: number): CircuitItem[] {
  return items.map((item) => {
    switch (item.type) {
      case "gate":
      case "frame": {
        const end = item.point.col + item.span.cols - 1;
        if (item.point.col >= index) {
          return {
            ...item,
            point: {
              ...item.point,
              col: item.point.col + 1
            }
          };
        }

        if (item.point.col < index && index <= end) {
          return {
            ...item,
            span: {
              ...item.span,
              cols: item.span.cols + 1
            }
          };
        }

        return item;
      }
      case "horizontalSegment":
        return item.point.col >= index
          ? {
              ...item,
              point: {
                ...item.point,
                col: item.point.col + 1
              }
            }
          : item;
      default:
        return item.point.col >= index
          ? {
              ...item,
              point: {
                ...item.point,
                col: item.point.col + 1
              }
            }
          : item;
    }
  });
}

function deleteColumnItems(items: CircuitItem[], index: number): CircuitItem[] {
  return items.flatMap((item) => {
    switch (item.type) {
      case "gate":
      case "frame": {
        const end = item.point.col + item.span.cols - 1;

        if (item.point.col > index) {
          return [{
            ...item,
            point: {
              ...item.point,
              col: item.point.col - 1
            }
          }];
        }

        if (index < item.point.col || index > end) {
          return [item];
        }

        if (item.span.cols <= 1) {
          return [];
        }

        return [{
          ...item,
          span: {
            ...item.span,
            cols: item.span.cols - 1
          }
        }];
      }
      case "horizontalSegment":
        if (item.point.col === index) {
          return [];
        }

        if (item.point.col === index + 1) {
          return [{
            ...item,
            point: {
              ...item.point,
              col: index
            }
          }];
        }

        return item.point.col > index + 1
          ? [{
              ...item,
              point: {
                ...item.point,
                col: item.point.col - 1
              }
            }]
          : [item];
      default:
        if (item.point.col === index) {
          return [];
        }

        return item.point.col > index
          ? [{
              ...item,
              point: {
                ...item.point,
                col: item.point.col - 1
              }
            }]
          : [item];
    }
  });
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
    case "equalsColumn":
      return item.point.col >= 0 && item.point.col < steps;
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

function normalizeHorizontalSegments(
  items: CircuitItem[],
  qubits: number,
  steps: number,
  wireTypes: WireType[]
): CircuitItem[] {
  const nonHorizontals = items.filter((item) => item.type !== "horizontalSegment");
  const horizontals = new Map<string, HorizontalSegmentItem>();
  const meterSuppressedKeys = getMeterSuppressedHorizontalKeys(items, steps);

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

  for (const [key, segment] of horizontals.entries()) {
    if (meterSuppressedKeys.has(key)) {
      if (segment.autoSuppressed !== true && segment.autoSuppressed !== false) {
        horizontals.set(key, {
          ...segment,
          autoSuppressed: true
        });
      }
      continue;
    }

    if (segment.autoSuppressed) {
      const { autoSuppressed, ...rest } = segment;
      horizontals.set(key, rest);
    }
  }

  const orderedHorizontals = [...horizontals.values()].sort(
    (left, right) => left.point.row - right.point.row || left.point.col - right.point.col
  );

  return [...nonHorizontals, ...orderedHorizontals];
}

function normalizeVerticalConnectors(items: CircuitItem[]): CircuitItem[] {
  const normalizedItems: CircuitItem[] = [];

  for (const item of items) {
    if (item.type !== "verticalConnector" || item.length <= 1) {
      normalizedItems.push(item.type === "verticalConnector"
        ? {
            ...item,
            length: 1
          }
        : item);
      continue;
    }

    for (let offset = 0; offset < item.length; offset += 1) {
      normalizedItems.push(buildVerticalConnector(
        item.point.row + offset,
        item.point.col,
        item.wireType,
        item.color ?? null,
        offset === 0 ? item.id : createId("verticalConnector")
      ));
    }
  }

  return normalizedItems;
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
    case "equalsColumn":
      return {
        id: createId(tool),
        type: "equalsColumn",
        point: { row: 0, col: placement.col },
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

  if (item.type === "equalsColumn") {
    return {
      ...item,
      point: {
        row: 0,
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

function addSegmentsForExpandedGrid(
  items: CircuitItem[],
  previousQubits: number,
  previousSteps: number,
  nextQubits: number,
  nextSteps: number,
  autoWireNewGrid: boolean
): CircuitItem[] {
  if (autoWireNewGrid) {
    return items;
  }

  const nextItems = [...items];
  const existingKeys = new Set(
    items
      .filter((item): item is HorizontalSegmentItem => item.type === "horizontalSegment")
      .map((item) => wireKey(item.point.row, item.point.col))
  );

  if (nextQubits > previousQubits) {
    for (let row = previousQubits; row < nextQubits; row += 1) {
      for (let col = 0; col <= previousSteps; col += 1) {
        const key = wireKey(row, col);
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          nextItems.push(buildHorizontalSegment(row, col, "absent"));
        }
      }
    }
  }

  if (nextSteps > previousSteps) {
    for (let row = 0; row < nextQubits; row += 1) {
      for (let col = previousSteps + 1; col <= nextSteps; col += 1) {
        const key = wireKey(row, col);
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          nextItems.push(buildHorizontalSegment(row, col, "absent"));
        }
      }
    }
  }

  return nextItems;
}

function buildAbsentSegmentsForInsertedRow(
  row: number,
  steps: number,
  wireType: WireType
): HorizontalSegmentItem[] {
  return Array.from({ length: steps + 1 }, (_, col) =>
    buildHorizontalSegment(row, col, "absent", wireType)
  );
}

function buildAbsentSegmentsForInsertedColumn(
  qubits: number,
  col: number,
  wireTypes: WireType[]
): HorizontalSegmentItem[] {
  return Array.from({ length: qubits }, (_, row) =>
    buildHorizontalSegment(row, col, "absent", wireTypes[row] ?? "quantum")
  );
}

function withItems(state: EditorState, items: CircuitItem[], selectedItemIds: string[]): EditorState {
  const verticallyNormalizedItems = normalizeVerticalConnectors(items);
  const normalizedItems = normalizeHorizontalSegments(verticallyNormalizedItems, state.qubits, state.steps, state.wireTypes);
  const nextState = resetExport({
    ...state,
    items: normalizedItems,
    wireMask: deriveWireMask(normalizedItems),
    wireTypes: resizeWireTypes(state.wireTypes, state.qubits),
    selectedItemIds: filterSelectedItemIds(normalizedItems, selectedItemIds, state.horizontalSegmentsUnlocked),
    wireLabels: resizeWireLabels(state.wireLabels, state.qubits)
  });

  return nextState;
}

function prioritizeHorizontalSegments(items: CircuitItem[], prioritizedItemIds: Iterable<string>): CircuitItem[] {
  const prioritizedIds = new Set(prioritizedItemIds);
  if (prioritizedIds.size === 0) {
    return items;
  }

  const leadingItems: CircuitItem[] = [];
  const prioritizedSegments: CircuitItem[] = [];

  for (const item of items) {
    if (item.type === "horizontalSegment" && prioritizedIds.has(item.id)) {
      prioritizedSegments.push(item);
      continue;
    }

    leadingItems.push(item);
  }

  return [...leadingItems, ...prioritizedSegments];
}

function materializeVacatedHorizontalSources(
  previousItems: CircuitItem[],
  nextItems: CircuitItem[],
  movedHorizontalSegments: HorizontalSegmentItem[]
): CircuitItem[] {
  if (movedHorizontalSegments.length === 0) {
    return nextItems;
  }

  const movedIds = new Set(movedHorizontalSegments.map((item) => item.id));
  const previousById = new Map(
    previousItems
      .filter((item): item is HorizontalSegmentItem => item.type === "horizontalSegment" && movedIds.has(item.id))
      .map((item) => [item.id, item])
  );
  const destinationKeys = new Set(movedHorizontalSegments.map((item) => wireKey(item.point.row, item.point.col)));
  const nextKeys = new Set(
    nextItems
      .filter((item): item is HorizontalSegmentItem => item.type === "horizontalSegment")
      .map((item) => wireKey(item.point.row, item.point.col))
  );
  const vacatedSegments: HorizontalSegmentItem[] = [];

  for (const movedItem of movedHorizontalSegments) {
    const previousItem = previousById.get(movedItem.id);
    if (!previousItem) {
      continue;
    }

    const sourceKey = wireKey(previousItem.point.row, previousItem.point.col);
    if (destinationKeys.has(sourceKey) || nextKeys.has(sourceKey)) {
      continue;
    }

    nextKeys.add(sourceKey);
    vacatedSegments.push({
      ...buildHorizontalSegment(previousItem.point.row, previousItem.point.col, "absent", previousItem.wireType),
      color: null,
      bundled: previousItem.bundled ?? false,
      bundleLabel: previousItem.bundleLabel
    });
  }

  return vacatedSegments.length > 0 ? [...nextItems, ...vacatedSegments] : nextItems;
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
    exportPreamble: DEFAULT_EXPORT_PREAMBLE,
    exportSymbolicPreamble: DEFAULT_SYMBOLIC_PREAMBLE,
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
          .filter((item): item is HorizontalSegmentItem => item.type === "horizontalSegment" && isVisibleHorizontalSegment(item))
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
        selectedItemIds: filterSelectedItemIds(state.items, action.itemIds, state.horizontalSegmentsUnlocked)
      };
    case "selectOrCreateHorizontalSegment": {
      if (!state.horizontalSegmentsUnlocked) {
        return {
          ...state,
          selectedItemIds: [],
          uiMessage: null
        };
      }

      const suppressedKeys = getMeterSuppressedHorizontalKeys(state.items, state.steps);
      const maskKey = wireKey(action.row, action.col);
      const existing = getHorizontalSegmentAt(state.items, action.row, action.col);

      if (state.wireMask[maskKey] === "absent" || suppressedKeys.has(maskKey)) {
        return {
          ...state,
          selectedItemIds: [],
          uiMessage: null
        };
      }

      const nextSelectedIds = action.additive
        ? [...new Set([...(state.selectedItemIds ?? []), existing?.id].filter(Boolean) as string[])]
        : existing
          ? [existing.id]
          : [];

      if (existing) {
        if (!isVisibleHorizontalSegment(existing)) {
          return {
            ...state,
            selectedItemIds: [],
            uiMessage: null
          };
        }

        return {
          ...state,
          selectedItemIds: nextSelectedIds,
          uiMessage: null
        };
      }

      const newItem: HorizontalSegmentItem = {
        ...buildHorizontalSegment(action.row, action.col, "present", state.wireTypes[action.row] ?? "quantum"),
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
    case "drawWire": {
      const sameRow = action.start.row === action.end.row;
      const sameCol = action.start.col === action.end.col;

      if (!sameRow && !sameCol) {
        return state;
      }

      if (sameRow && action.start.col === action.end.col) {
        return state;
      }

      if (sameCol && action.start.row === action.end.row) {
        return state;
      }

      if (sameRow) {
        const row = action.start.row;
        const startCol = Math.min(action.start.col, action.end.col) + 1;
        const endCol = Math.max(action.start.col, action.end.col);
        const segments = new Map(
          state.items
            .filter((item): item is HorizontalSegmentItem => item.type === "horizontalSegment")
            .map((item) => [wireKey(item.point.row, item.point.col), item])
        );

        for (let col = startCol; col <= endCol; col += 1) {
          const key = wireKey(row, col);
          const existing = segments.get(key);

          if (existing) {
            segments.set(key, {
              ...existing,
              mode: "present",
              wireType: existing.wireType,
              autoSuppressed: false
            });
            continue;
          }

          segments.set(key, buildHorizontalSegment(row, col, "present", state.wireTypes[row] ?? "quantum"));
        }

        const horizontalIds = new Set(
          state.items
            .filter((item) => item.type === "horizontalSegment")
            .map((item) => item.id)
        );
        const items = [
          ...state.items.filter((item) => !horizontalIds.has(item.id)),
          ...segments.values()
        ];

        return withItems({
          ...state,
          uiMessage: null
        }, items, []);
      }

      if (action.start.col < 0 || action.start.col >= state.steps) {
        return state;
      }

      const topRow = Math.min(action.start.row, action.end.row);
      const bottomRow = Math.max(action.start.row, action.end.row);
      const connectors = Array.from(
        { length: bottomRow - topRow },
        (_, index) => buildVerticalConnector(topRow + index, action.start.col)
      );

      if (!canPlaceItemsWithoutOverlap(state.items, connectors)) {
        return withOverlapMessage(state);
      }

      return withItems({
        ...state,
        uiMessage: null
      }, [...state.items, ...connectors], connectors.map((connector) => connector.id));
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
          if (existing.mode === "present" && existing.autoSuppressed !== true) {
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
                    mode: "present",
                    autoSuppressed: false
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

      const items = prioritizeHorizontalSegments(
        materializeVacatedHorizontalSources(
          state.items,
          state.items.map((item) =>
            item.id === action.itemId ? nextItem : item
          ),
          nextItem.type === "horizontalSegment" ? [nextItem] : []
        ),
        nextItem.type === "horizontalSegment" ? [action.itemId] : []
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
    case "moveSelection": {
      const projection = projectSelectionMove(
        state.items,
        state.selectedItemIds,
        action.anchorItemId,
        action.placement
      );
      if (!projection) {
        return state;
      }

      if (projection.rowDelta === 0 && projection.colDelta === 0) {
        return state;
      }

      if (!canPlaceItemsWithoutOverlap(state.items, projection.movedItems, projection.selectedIds)) {
        return withOverlapMessage(state);
      }

      const { maxRow, maxStep } = computeOccupiedExtents(projection.finalItems);
      const nextQubits = Math.max(state.qubits, maxRow + 1);
      const nextSteps = Math.max(state.steps, maxStep);
      const grownItems = addSegmentsForExpandedGrid(
        projection.finalItems,
        state.qubits,
        state.steps,
        nextQubits,
        nextSteps,
        state.autoWireNewGrid
      );
      const prioritizedItems = prioritizeHorizontalSegments(
        materializeVacatedHorizontalSources(
          state.items,
          grownItems,
          projection.movedItems
            .filter((item): item is HorizontalSegmentItem => item.type === "horizontalSegment")
        ),
        projection.movedItems
          .filter((item): item is HorizontalSegmentItem => item.type === "horizontalSegment")
          .map((item) => item.id)
      );

      return withItems(
        {
          ...state,
          qubits: nextQubits,
          steps: nextSteps,
          wireTypes: resizeWireTypes(state.wireTypes, nextQubits),
          wireLabels: resizeWireLabels(state.wireLabels, nextQubits),
          uiMessage: null
        },
        prioritizedItems,
        state.selectedItemIds.filter((itemId) => grownItems.some((item) => item.id === itemId))
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
    case "updateGateLabelBatch": {
      const selectedIds = new Set(action.itemIds);
      const items = state.items.map((item) => {
        if (!selectedIds.has(item.id) || item.type !== "gate") {
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
        [...projection.selectedIds]
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
          length: 1
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
    case "updateControlStateBatch": {
      const selectedIds = new Set(action.itemIds);
      const items = state.items.map((item) => {
        if (!selectedIds.has(item.id) || item.type !== "controlDot") {
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
          mode: action.mode,
          autoSuppressed: action.mode === "present" ? false : item.autoSuppressed
        };
      });

      return withItems(state, items, action.mode === "absent"
        ? state.selectedItemIds.filter((itemId) => itemId !== action.itemId)
        : state.selectedItemIds);
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
    case "updateHorizontalBundled": {
      const items = state.items.map((item) => {
        if (item.id !== action.itemId || item.type !== "horizontalSegment") {
          return item;
        }

        return {
          ...item,
          bundled: action.bundled,
          bundleLabel: action.bundled ? item.bundleLabel ?? "" : undefined
        };
      });

      return withItems(state, items, state.selectedItemIds);
    }
    case "updateHorizontalBundleLabel": {
      const items = state.items.map((item) => {
        if (item.id !== action.itemId || item.type !== "horizontalSegment" || item.bundled !== true) {
          return item;
        }

        return {
          ...item,
          bundleLabel: action.bundleLabel
        };
      });

      return withItems(state, items, state.selectedItemIds);
    }
    case "updateWireTypeBatch": {
      const selectedIds = new Set(action.itemIds);
      const items = state.items.map((item) => {
        if (!selectedIds.has(item.id)) {
          return item;
        }

        if (item.type === "horizontalSegment" || item.type === "verticalConnector") {
          return {
            ...item,
            wireType: action.wireType
          };
        }

        return item;
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
    case "updateItemColorBatch": {
      const selectedIds = new Set(action.itemIds);
      const color = normalizeHexColor(action.color);
      const items = state.items.map((item) => (
        selectedIds.has(item.id)
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
    case "insertGridLine": {
      if (action.dimension === "qubits") {
        const index = clamp(action.index, 0, state.qubits);
        const qubits = state.qubits + 1;
        const wireTypes = insertWireTypeRow(state.wireTypes, index);
        let items = insertRowItems(state.items, index);

        if (!state.autoWireNewGrid) {
          items = [
            ...items,
            ...buildAbsentSegmentsForInsertedRow(index, state.steps, wireTypes[index] ?? "quantum")
          ];
        }

        return withItems(
          {
            ...state,
            qubits,
            wireTypes,
            wireLabels: insertWireLabelRow(state.wireLabels, index, state.qubits),
            uiMessage: null
          },
          items,
          state.selectedItemIds
        );
      }

      const index = clamp(action.index, 0, state.steps);
      const steps = state.steps + 1;
      let items = insertColumnItems(state.items, index);

      if (!state.autoWireNewGrid) {
        items = [
          ...items,
          ...buildAbsentSegmentsForInsertedColumn(state.qubits, index, state.wireTypes)
        ];
      }

      return withItems(
        {
          ...state,
          steps,
          uiMessage: null
        },
        items,
        state.selectedItemIds
      );
    }
    case "deleteGridLine": {
      if (action.dimension === "qubits") {
        if (state.qubits <= 1 || action.index < 0 || action.index >= state.qubits) {
          return state;
        }

        return withItems(
          {
            ...state,
            qubits: state.qubits - 1,
            wireTypes: deleteWireTypeRow(state.wireTypes, action.index),
            wireLabels: deleteWireLabelRow(state.wireLabels, action.index, state.qubits),
            uiMessage: null
          },
          deleteRowItems(state.items, action.index),
          state.selectedItemIds
        );
      }

      if (state.steps <= 1 || action.index < 0 || action.index >= state.steps) {
        return state;
      }

      return withItems(
        {
          ...state,
          steps: state.steps - 1,
          uiMessage: null
        },
        deleteColumnItems(state.items, action.index),
        state.selectedItemIds
      );
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
        items = addSegmentsForExpandedGrid(
          items,
          state.qubits,
          state.steps,
          action.dimension === "qubits" ? nextValue : state.qubits,
          action.dimension === "steps" ? nextValue : state.steps,
          false
        );
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
    case "setExportPreamble":
      return {
        ...state,
        exportPreamble: action.preamble,
        exportIssues: [],
        uiMessage: null
      };
    case "setExportSymbolicPreamble":
      return {
        ...state,
        exportSymbolicPreamble: action.preamble,
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
          exportPreamble: action.preamble,
          exportSymbolicPreamble: state.exportSymbolicPreamble,
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
