export type ToolType =
  | "select"
  | "gate"
  | "verticalConnector"
  | "horizontalSegment"
  | "controlDot"
  | "targetPlus"
  | "swapX";

export type ItemType = Exclude<ToolType, "select">;

export interface GridPoint {
  row: number;
  col: number;
}

export interface Span {
  rows: number;
  cols: number;
}

export interface PlacementTarget {
  kind: "cell" | "segment";
  row: number;
  col: number;
}

export interface BoardMetrics {
  left: number;
  top: number;
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
}

interface BaseItem {
  id: string;
  type: ItemType;
  color?: string | null;
}

export interface WireLabel {
  left: string;
  right: string;
}

export interface CircuitLayout {
  rowSepCm: number;
  columnSepCm: number;
}

export interface GateItem extends BaseItem {
  type: "gate";
  point: GridPoint;
  span: Span;
  label: string;
  width: number;
}

export interface VerticalConnectorItem extends BaseItem {
  type: "verticalConnector";
  point: GridPoint;
  length: number;
}

export type HorizontalSegmentMode = "present" | "absent";

export interface HorizontalSegmentItem extends BaseItem {
  type: "horizontalSegment";
  point: GridPoint;
  mode: HorizontalSegmentMode;
}

export interface ControlDotItem extends BaseItem {
  type: "controlDot";
  point: GridPoint;
}

export interface TargetPlusItem extends BaseItem {
  type: "targetPlus";
  point: GridPoint;
}

export interface SwapXItem extends BaseItem {
  type: "swapX";
  point: GridPoint;
}

export type CircuitItem =
  | GateItem
  | VerticalConnectorItem
  | HorizontalSegmentItem
  | ControlDotItem
  | TargetPlusItem
  | SwapXItem;

export type WireMask = Record<string, "present" | "absent">;

export interface ExportIssue {
  id: string;
  severity: "error" | "warning";
  message: string;
}

interface ClipboardBaseItem {
  type: ItemType;
  rowOffset: number;
  colOffset: number;
  color?: string | null;
}

export interface ClipboardGateItem extends ClipboardBaseItem {
  type: "gate";
  span: Span;
  label: string;
}

export interface ClipboardVerticalConnectorItem extends ClipboardBaseItem {
  type: "verticalConnector";
  length: number;
}

export interface ClipboardHorizontalSegmentItem extends ClipboardBaseItem {
  type: "horizontalSegment";
  mode: HorizontalSegmentMode;
}

export interface ClipboardControlDotItem extends ClipboardBaseItem {
  type: "controlDot";
}

export interface ClipboardTargetPlusItem extends ClipboardBaseItem {
  type: "targetPlus";
}

export interface ClipboardSwapXItem extends ClipboardBaseItem {
  type: "swapX";
}

export type ClipboardItem =
  | ClipboardGateItem
  | ClipboardVerticalConnectorItem
  | ClipboardHorizontalSegmentItem
  | ClipboardControlDotItem
  | ClipboardTargetPlusItem
  | ClipboardSwapXItem;

export interface CircuitClipboard {
  anchor: GridPoint;
  items: ClipboardItem[];
}

export interface EditorState {
  qubits: number;
  steps: number;
  layout: CircuitLayout;
  items: CircuitItem[];
  wireMask: WireMask;
  wireLabels: WireLabel[];
  selectedItemIds: string[];
  activeTool: ToolType;
  exportCode: string;
  exportIssues: ExportIssue[];
  uiMessage: string | null;
}

export interface ExportResult {
  code: string;
  issues: ExportIssue[];
}

export interface ImportedCircuit {
  qubits: number;
  steps: number;
  layout: CircuitLayout;
  items: CircuitItem[];
  wireLabels: WireLabel[];
}
