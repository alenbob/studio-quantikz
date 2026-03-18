export type ToolType =
  | "select"
  | "pencil"
  | "gate"
  | "meter"
  | "annotation"
  | "controlDot"
  | "targetPlus"
  | "swapX";

export type ItemType =
  | "gate"
  | "meter"
  | "frame"
  | "slice"
  | "verticalConnector"
  | "horizontalSegment"
  | "controlDot"
  | "targetPlus"
  | "swapX";

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

export type WireLabelBracket = "none" | "brace" | "bracket" | "paren";

export interface WireLabel {
  left: string;
  right: string;
  leftSpan?: number;
  rightSpan?: number;
  leftBracket?: WireLabelBracket;
  rightBracket?: WireLabelBracket;
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

export interface MeterItem extends BaseItem {
  type: "meter";
  point: GridPoint;
  span: Span;
}

export interface FrameItem extends BaseItem {
  type: "frame";
  point: GridPoint;
  span: Span;
  label: string;
  rounded: boolean;
  dashed: boolean;
  background: boolean;
  innerXSepPt: number;
}

export interface SliceItem extends BaseItem {
  type: "slice";
  point: GridPoint;
  label: string;
}

export interface VerticalConnectorItem extends BaseItem {
  type: "verticalConnector";
  point: GridPoint;
  length: number;
  wireType: WireType;
}

export type HorizontalSegmentMode = "present" | "absent";
export type WireType = "quantum" | "classical";
export type ControlState = "filled" | "open";

export interface HorizontalSegmentItem extends BaseItem {
  type: "horizontalSegment";
  point: GridPoint;
  mode: HorizontalSegmentMode;
  wireType: WireType;
  bundled?: boolean;
  autoSuppressed?: boolean;
  bundleLabel?: string;
}

export interface ControlDotItem extends BaseItem {
  type: "controlDot";
  point: GridPoint;
  controlState?: ControlState;
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
  | MeterItem
  | FrameItem
  | SliceItem
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

export interface ClipboardMeterItem extends ClipboardBaseItem {
  type: "meter";
  span: Span;
}

export interface ClipboardFrameItem extends ClipboardBaseItem {
  type: "frame";
  span: Span;
  label: string;
  rounded: boolean;
  dashed: boolean;
  background: boolean;
  innerXSepPt: number;
}

export interface ClipboardSliceItem extends ClipboardBaseItem {
  type: "slice";
  label: string;
}

export interface ClipboardVerticalConnectorItem extends ClipboardBaseItem {
  type: "verticalConnector";
  length: number;
  wireType: WireType;
}

export interface ClipboardHorizontalSegmentItem extends ClipboardBaseItem {
  type: "horizontalSegment";
  mode: HorizontalSegmentMode;
  wireType: WireType;
  bundled?: boolean;
  bundleLabel?: string;
}

export interface ClipboardControlDotItem extends ClipboardBaseItem {
  type: "controlDot";
  controlState?: ControlState;
}

export interface ClipboardTargetPlusItem extends ClipboardBaseItem {
  type: "targetPlus";
}

export interface ClipboardSwapXItem extends ClipboardBaseItem {
  type: "swapX";
}

export type ClipboardItem =
  | ClipboardGateItem
  | ClipboardMeterItem
  | ClipboardFrameItem
  | ClipboardSliceItem
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
  wireTypes: WireType[];
  autoWireNewGrid: boolean;
  horizontalSegmentsUnlocked: boolean;
  wireLabels: WireLabel[];
  selectedItemIds: string[];
  activeTool: ToolType;
  exportCode: string;
  exportPreamble: string;
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
  wireTypes: WireType[];
  wireLabels: WireLabel[];
}
