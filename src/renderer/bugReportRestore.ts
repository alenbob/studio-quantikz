import { DEFAULT_EXPORT_PREAMBLE, DEFAULT_SYMBOLIC_PREAMBLE } from "./document";
import { DEFAULT_CIRCUIT_LAYOUT, clampColumnSepCm, clampRowSepCm } from "./layout";
import type { CircuitItem, EditorState, ToolType, WireLabel, WireLabelBracket, WireType } from "./types";

export const BUG_REPORT_RESTORE_SEARCH_PARAM = "bugReportRestore";
export const BUG_REPORT_RESTORE_STORAGE_PREFIX = "quantikzz_bug_report_restore_";

export type RestoreExportPanelMode = "quantikz" | "symbolic";
export type RestoreExportPaneView = "content" | "preamble";

export interface BugReportRestorePayload {
  editorState: EditorState | null;
  code: string;
  preamble: string;
  exportPanelMode: RestoreExportPanelMode;
  quantikzPaneView: RestoreExportPaneView;
  symbolicPaneView: RestoreExportPaneView;
  symbolicEditorCode: string;
}

const VALID_TOOL_TYPES = new Set<ToolType>([
  "select",
  "pencil",
  "gate",
  "meter",
  "annotation",
  "controlDot",
  "targetPlus",
  "swapX"
]);

const VALID_WIRE_TYPES = new Set<WireType>(["quantum", "classical"]);
const VALID_EXPORT_PANEL_MODES = new Set<RestoreExportPanelMode>(["quantikz", "symbolic"]);
const VALID_EXPORT_PANE_VIEWS = new Set<RestoreExportPaneView>(["content", "preamble"]);
const VALID_WIRE_LABEL_BRACKETS = new Set<WireLabelBracket>(["none", "brace", "bracket", "paren"]);

function sanitizePositiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && typeof value === "number" && value > 0 ? value : fallback;
}

function sanitizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeWireTypes(value: unknown, qubits: number): WireType[] {
  const candidate = Array.isArray(value) ? value : [];
  return Array.from({ length: qubits }, (_, index) => {
    const wireType = candidate[index];
    return VALID_WIRE_TYPES.has(wireType as WireType) ? wireType as WireType : "quantum";
  });
}

function sanitizeWireLabelBracket(value: unknown): WireLabelBracket {
  return VALID_WIRE_LABEL_BRACKETS.has(value as WireLabelBracket) ? value as WireLabelBracket : "none";
}

function sanitizeWireLabels(value: unknown, qubits: number): WireLabel[] {
  const candidate = Array.isArray(value) ? value : [];
  return Array.from({ length: qubits }, (_, index) => {
    const label = candidate[index];
    if (!label || typeof label !== "object") {
      return { left: "", right: "" };
    }

    const wireLabel = label as Partial<WireLabel>;
    return {
      left: sanitizeString(wireLabel.left),
      right: sanitizeString(wireLabel.right),
      leftSpan: Number.isInteger(wireLabel.leftSpan) && typeof wireLabel.leftSpan === "number" && wireLabel.leftSpan > 0
        ? wireLabel.leftSpan
        : undefined,
      rightSpan: Number.isInteger(wireLabel.rightSpan) && typeof wireLabel.rightSpan === "number" && wireLabel.rightSpan > 0
        ? wireLabel.rightSpan
        : undefined,
      leftBracket: sanitizeWireLabelBracket(wireLabel.leftBracket),
      rightBracket: sanitizeWireLabelBracket(wireLabel.rightBracket)
    };
  });
}

function sanitizeEditorStateSnapshot(value: unknown): EditorState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<EditorState>;
  if (!Array.isArray(candidate.items)) {
    return null;
  }

  const qubits = sanitizePositiveInteger(candidate.qubits, 3);
  const steps = sanitizePositiveInteger(candidate.steps, 5);

  return {
    qubits,
    steps,
    layout: {
      rowSepCm: clampRowSepCm(candidate.layout?.rowSepCm ?? DEFAULT_CIRCUIT_LAYOUT.rowSepCm),
      columnSepCm: clampColumnSepCm(candidate.layout?.columnSepCm ?? DEFAULT_CIRCUIT_LAYOUT.columnSepCm)
    },
    items: candidate.items as CircuitItem[],
    wireMask: {},
    wireTypes: sanitizeWireTypes(candidate.wireTypes, qubits),
    autoWireNewGrid: sanitizeBoolean(candidate.autoWireNewGrid, true),
    horizontalSegmentsUnlocked: sanitizeBoolean(candidate.horizontalSegmentsUnlocked, false),
    wireLabels: sanitizeWireLabels(candidate.wireLabels, qubits),
    selectedItemIds: Array.isArray(candidate.selectedItemIds)
      ? candidate.selectedItemIds.filter((itemId): itemId is string => typeof itemId === "string")
      : [],
    activeTool: VALID_TOOL_TYPES.has(candidate.activeTool as ToolType) ? candidate.activeTool as ToolType : "select",
    exportCode: sanitizeString(candidate.exportCode),
    exportPreamble: sanitizeString(candidate.exportPreamble, DEFAULT_EXPORT_PREAMBLE),
    exportSymbolicPreamble: sanitizeString(candidate.exportSymbolicPreamble, DEFAULT_SYMBOLIC_PREAMBLE),
    exportIssues: [],
    uiMessage: null
  };
}

export function buildBugReportRestoreStorageKey(restoreId: string): string {
  return `${BUG_REPORT_RESTORE_STORAGE_PREFIX}${restoreId}`;
}

export function parseBugReportRestorePayload(raw: string): BugReportRestorePayload | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const editorState = sanitizeEditorStateSnapshot(parsed.editorState);
    const code = sanitizeString(parsed.code);

    if (!editorState && !code.trim()) {
      return null;
    }

    return {
      editorState,
      code,
      preamble: sanitizeString(parsed.preamble, DEFAULT_EXPORT_PREAMBLE),
      exportPanelMode: VALID_EXPORT_PANEL_MODES.has(parsed.exportPanelMode as RestoreExportPanelMode)
        ? parsed.exportPanelMode as RestoreExportPanelMode
        : "quantikz",
      quantikzPaneView: VALID_EXPORT_PANE_VIEWS.has(parsed.quantikzPaneView as RestoreExportPaneView)
        ? parsed.quantikzPaneView as RestoreExportPaneView
        : "content",
      symbolicPaneView: VALID_EXPORT_PANE_VIEWS.has(parsed.symbolicPaneView as RestoreExportPaneView)
        ? parsed.symbolicPaneView as RestoreExportPaneView
        : "content",
      symbolicEditorCode: sanitizeString(parsed.symbolicEditorCode)
    };
  } catch {
    return null;
  }
}

export function consumeBugReportRestorePayload(locationSearch: string, storage: Pick<Storage, "getItem" | "removeItem">): BugReportRestorePayload | null {
  const params = new URLSearchParams(locationSearch);
  const restoreId = params.get(BUG_REPORT_RESTORE_SEARCH_PARAM)?.trim();

  if (!restoreId) {
    return null;
  }

  const storageKey = buildBugReportRestoreStorageKey(restoreId);
  const raw = storage.getItem(storageKey);
  storage.removeItem(storageKey);

  if (!raw) {
    return null;
  }

  return parseBugReportRestorePayload(raw);
}