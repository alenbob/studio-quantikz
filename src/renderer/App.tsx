import { useEffect, useMemo, useReducer, useRef, useState, type DragEvent, type FocusEvent, type JSX } from "react";
import { toPng } from "html-to-image";
import { buildClipboard, canPasteClipboardAt } from "./clipboard";
import cmdIcon from "./assets/cmd.svg";
import automaticIcon from "./assets/automatic.svg";
import historyIcon from "./assets/history.svg";
import lockedIcon from "./assets/locked.svg";
import unlockedIcon from "./assets/unlocked.svg";
import { Palette, TOOL_LABELS } from "./components/Palette";
import { Inspector } from "./components/Inspector";
import { Workspace } from "./components/Workspace";
import {
  normalizeSymbolicPreamble,
  splitStandaloneQuantikzSource
} from "./document";
import {
  buildShareLandingUrl,
  buildShareLandingUrlWithServerStorage,
  buildSharedCircuitUrl,
  readSharedCircuitFromSearch
} from "./shareUrl";
import { uploadSharePreviewImage } from "./sharePreview";
import {
  getExportHistorySnippet,
  loadExportHistory,
  persistExportHistory,
  pushExportHistoryEntry,
  type ExportHistoryEntry
} from "./exportHistory";
import {
  fetchQuantikzPdf,
  buildDownloadBlob,
  copyQuantikzImageToClipboard,
  copyQuantikzSvgToClipboard,
  downloadBlob,
  getDownloadFilename,
  type DownloadFormat,
  type ExportAssetSource
} from "./exportAssets";
import { renderPdfBlobToPngBlob } from "./pdfRaster";
import { isVisibleHorizontalSegment } from "./horizontalWires";
import { importFromQuantikz } from "./importer";
import { resolveVisualPreambleDefinitions } from "../shared/tikzPreamble";
import { submitBugReport } from "./bugReport";
import {
  BUG_REPORT_RESTORE_SEARCH_PARAM,
  consumeBugReportRestorePayload,
  type BugReportRestorePayload
} from "./bugReportRestore";
import { useRenderedPdf } from "./useRenderedPdf";
import { useRenderedSvg } from "./useRenderedSvg";
import { useSymbolicLatex } from "./useSymbolicLatex";
import { editorReducer, initialState, type EditorAction } from "./reducer";
import { getWireLabelGroup, type WireLabelSide } from "./wireLabels";
import {
  BUG_REPORT_DESCRIPTION_MAX_LENGTH,
  BUG_REPORT_EMAIL_MAX_LENGTH,
  BUG_REPORT_TITLE_MAX_LENGTH
} from "../shared/bugReport";
import type {
  CircuitClipboard,
  CircuitItem,
  EditorState,
  PlacementTarget,
  StructureSelection,
  ToolType
} from "./types";

interface HistoryState {
  past: EditorState[];
  present: EditorState;
  future: EditorState[];
}

type HistoryAction = EditorAction | { type: "undo" } | { type: "redo" };
type ExportPanelMode = "quantikz" | "symbolic";
type ExportPaneView = "content" | "preamble";
type CopyFormat = "png" | "svg";
type DownloadMenuTarget = "main" | `history:${string}` | null;
type WorkbenchLayoutMode = "left-rail-tall" | "workspace-tall";
type HelpSheetMode = "shortcuts" | "symbolic";

const TOAST_DURATION_MS = 4000;
const WORKBENCH_LAYOUT_TOLERANCE_PX = 1;
const DEFAULT_DOWNLOAD_FORMATS: DownloadFormat[] = ["tex", "pdf"];
const REPOSITORY_URL = import.meta.env.VITE_REPOSITORY_URL?.trim() || "https://github.com/alenbob";
const REPOSITORY_LABEL = import.meta.env.VITE_REPOSITORY_LABEL?.trim() || "github/alenbob";

const TOOL_SHORTCUTS = TOOL_LABELS.filter((entry): entry is (typeof TOOL_LABELS)[number] & { shortcutKey: string } =>
  Boolean(entry.shortcutKey)
);

const TOOL_SHORTCUTS_BY_KEY = new Map<string, ToolType>(
  TOOL_SHORTCUTS.map(({ shortcutKey, tool }) => [shortcutKey.toLowerCase(), tool])
);

const GENERAL_SHORTCUTS: Array<{ key: string; description: string }> = [
  { key: "Cmd/Ctrl + A", description: "Select every drawable item in the circuit." },
  { key: "Cmd/Ctrl + C", description: "Copy the current selection." },
  { key: "Cmd/Ctrl + S", description: "Convert the current visual circuit to Quantikz." },
  { key: "Cmd/Ctrl + Enter", description: "Convert the current visual circuit to Quantikz." },
  { key: "Cmd/Ctrl + V", description: "Enter paste mode for the copied selection." },
  { key: "Cmd/Ctrl + Z", description: "Undo the last circuit change." },
  { key: "Cmd/Ctrl + Shift + Z", description: "Redo the last undone change." },
  { key: "Enter", description: "Convert the current visual circuit to Quantikz when focus is not in a field." },
  { key: "H", description: "Open the cached Quantikz export history." },
  { key: "Delete / Backspace", description: "Delete the current selection or wire label." },
  { key: "Escape", description: "Close the open sheet, leave paste mode, and return to select." }
];

const SYMBOLIC_HELP_SECTIONS: Array<{
  title: string;
  items: Array<{ label: string; description: string }>;
}> = [
  {
    title: "Recognized states",
    items: [
      {
        label: String.raw`\ket{0}, \ket{1}, \ket{+}, \ket{-}, \ket{i}, \ket{-i}, \ket{T}`,
        description: "Accepted as exact single-wire input product states."
      },
      {
        label: String.raw`\ket{00}, \ket{101}, ...`,
        description: "Multi-wire computational-basis product labels are expanded wire by wire."
      },
      {
        label: String.raw`\ket{0}_{c_0}, \ket{\psi}_{data}`,
        description: "A trailing lstick subscript is interpreted as the wire name and reused in slice descriptions and measurement labels."
      }
    ]
  },
  {
    title: "Exact basis rules",
    items: [
      {
        label: String.raw`H, X, Y, Z, S, S^\dagger, T, T^\dagger`,
        description: "Applied exactly on computational-basis inputs and preserved through supported symbolic evolution."
      },
      {
        label: String.raw`\textsc{UNIFORM}_M, \textsc{UNIFORM}`,
        description: "On a zero input, \textsc{UNIFORM}_M expands to a normalized symbolic sum \sum_{m=0}^{M-1}\ket{m}/\sqrt{M}. When the wire has a named subscript such as \ket{0}_\ell, that subscript becomes the sum index, giving \sum_{\ell=0}^{M-1}\ket{\ell}/\sqrt{M}. Bare \textsc{UNIFORM} on a named wire such as \ket{0}_a promotes that row to \ket{a}_a."
      },
      {
        label: String.raw`In, In_a, \text{In}, \mathrm{In}`,
        description: "Treated as a transparent read gate: acts as the identity on its row, leaving the qubit state unchanged regardless of any subscript parameter."
      },
      {
        label: String.raw`data:add_a, \text{data:add}_a`,
        description: "When connected to another row via \\wire[d][n]{q}, infers the symbolic value a from the connected row's state and writes \ket{a} to the target if it is \ket{0} (since 0 ⊕ a = a), or \ket{k ⊕ a} if the target holds \ket{k}. With no connector, the gate uses the subscript from the label directly as a. Bare data:add with no connector and no subscript falls back to opaque operator application."
      },
      {
        label: String.raw`\ctrl{...}, \targ{}, \swap{...}`,
        description: "Controls and swaps are interpreted exactly while the participating control row is still in the computational basis. A supported bare \textsc{UNIFORM} label can also be copied by a later controlled X from \ket{a}_a \otimes \ket{0}_b to \ket{a}_a \otimes \ket{a}_b."
      },
      {
        label: "Separable slices",
        description: "As long as the current symbolic state is still a tensor product, each independent wire stays separated in the rendered state. Once rows become entangled, the renderer falls back to joint basis-state sums."
      }
    ]
  },
  {
    title: "Rotation conventions",
    items: [
      {
        label: String.raw`R_X(\theta), R_Y(\theta), R_Z(\theta)`,
        description: "Interpreted with the physics convention e^{-i \theta \sigma_\alpha / 2} on basis inputs."
      },
      {
        label: String.raw`RX(\theta), R_{y}(\phi), R_z(2\phi + \pi/3)`,
        description: "Aliases with brace subscripts, lower-case axes, and literal angle expressions are normalized and preserved."
      },
      {
        label: String.raw`\arccos(t), \pi/7, 2\phi + \pi/3`,
        description: "Angle expressions are kept literally in the symbolic output instead of being numerically evaluated."
      },
      {
        label: String.raw`R_Y(2\arccos{\sqrt{x}})`,
        description: "Recognized half-angle forms are simplified on basis inputs, for example to \\sqrt{x} and \\sqrt{1-x} branch coefficients."
      },
      {
        label: String.raw`\frac{1}{5}, \frac{tN}{\lambda}`,
        description: "The scalar parser simplifies common rational and square-root algebra in branch coefficients, for example 1-\\frac{1}{5} and \\sqrt{(1-x)\\frac{1}{5}}."
      }
    ]
  },
  {
    title: "Where it runs",
    items: [
      {
        label: "Deployed website",
        description: "Symbolic LaTeX is generated on the server, so people using the hosted site do not need a local Python installation."
      },
      {
        label: "Local preview and dev",
        description: "The local preview and dev servers call the symbolic Python script on this machine, so symbolic mode needs a local Python runtime there."
      },
      {
        label: "Browser-only static build",
        description: "This is not a browser-only feature today. The symbolic interpreter is implemented in Python and is not currently executed directly in the browser."
      }
    ]
  },
  {
    title: "Current limits",
    items: [
      {
        label: "Opaque gates",
        description: "Unrecognized gate labels remain opaque symbolic operators, for example A|psi> rendered as A\\ket{\\psi}."
      },
      {
        label: "Measurements after rotations",
        description: "Measurement probabilities are also derived after symbolic R_X, R_Y, and R_Z rotations; when rotated branches interfere, the result is kept as an exact |...|^2 expression instead of being over-simplified."
      },
      {
        label: "Post-measurement branch form",
        description: "After each measurement, branch outputs are rendered as normalized post-measurement states with explicit outcome probabilities in a cases block. If later classically controlled corrections make all branches identical, the repeated branches are collapsed to one final state expression."
      },
      {
        label: "Controls through symbolism",
        description: "Supported rotations expand into basis-state branches so later supported controls keep working term by term. Arbitrary opaque symbolic payloads are not fully analyzed as controls, except the named-register form introduced by bare \textsc{UNIFORM} on \ket{0}_{name}."
      }
    ]
  }
];

function formatHistoryTimestamp(createdAt: string): string {
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime())
    ? "Saved export"
    : parsed.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
}

function formatLabelForDownload(format: DownloadFormat): string {
  return format.toUpperCase();
}

function imageUrlToDataUrl(imageUrl: string, maxWidth = 220, maxHeight = 120): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas rendering is unavailable in this browser."));
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Unable to prepare the history preview image."));
    image.src = imageUrl;
  });
}

function getPdfViewerSrc(pdfUrl: string): string {
  return `${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&zoom=page-width&view=FitH`;
}

function resolveWorkbenchLayoutMode(leftPanelHeight: number, workspaceHeight: number): WorkbenchLayoutMode {
  if (!Number.isFinite(leftPanelHeight) || !Number.isFinite(workspaceHeight)) {
    return "left-rail-tall";
  }

  return leftPanelHeight + WORKBENCH_LAYOUT_TOLERANCE_PX >= workspaceHeight
    ? "left-rail-tall"
    : "workspace-tall";
}

function DownloadMenu({
  isOpen,
  formats,
  onToggle,
  onSelect
}: {
  isOpen: boolean;
  formats: DownloadFormat[];
  onToggle: () => void;
  onSelect: (format: DownloadFormat) => void;
}): JSX.Element {
  return (
    <div className="download-menu">
      <button
        type="button"
        className="secondary-button download-menu-trigger"
        aria-expanded={isOpen}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        Download
      </button>
      {isOpen && (
        <div
          className="download-menu-popover"
          onClick={(event) => event.stopPropagation()}
        >
          {formats.map((format) => (
            <button
              key={format}
              type="button"
              className="download-menu-option"
              onClick={() => onSelect(format)}
            >
              {formatLabelForDownload(format)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyMenu({
  isOpen,
  formats,
  disabled,
  onToggle,
  onSelect
}: {
  isOpen: boolean;
  formats: CopyFormat[];
  disabled: boolean;
  onToggle: () => void;
  onSelect: (format: CopyFormat) => void;
}): JSX.Element {
  return (
    <div className="download-menu">
      <button
        type="button"
        className="secondary-button download-menu-trigger"
        disabled={disabled}
        aria-expanded={isOpen}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        Copy image
      </button>
      {isOpen && (
        <div
          className="download-menu-popover"
          onClick={(event) => event.stopPropagation()}
        >
          {formats.map((format) => (
            <button
              key={format}
              type="button"
              className="download-menu-option"
              onClick={() => onSelect(format)}
            >
              {format.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TextToggleSwitch({
  leftLabel,
  rightLabel,
  value,
  onChange,
  ariaLabel
}: {
  leftLabel: string;
  rightLabel: string;
  value: ExportPaneView;
  onChange: (value: ExportPaneView) => void;
  ariaLabel: string;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`text-toggle-switch ${value === "preamble" ? "is-right" : "is-left"}`}
      aria-label={ariaLabel}
      aria-pressed={value === "preamble"}
      onClick={() => onChange(value === "content" ? "preamble" : "content")}
    >
      <span className="text-toggle-thumb" aria-hidden="true" />
      <span className={`text-toggle-label ${value === "content" ? "is-active" : ""}`}>{leftLabel}</span>
      <span className={`text-toggle-label ${value === "preamble" ? "is-active" : ""}`}>{rightLabel}</span>
    </button>
  );
}

function isUndoableAction(action: EditorAction): boolean {
  return ![
    "setTool",
    "setHorizontalSegmentsUnlocked",
    "setSelectedIds",
    "convert",
    "setExportCode",
    "setExportPreamble",
    "setExportSymbolicPreamble",
    "loadEditorSnapshot",
    "clearMessage",
    "setMessage",
    "setAutoWireNewGrid"
  ].includes(action.type);
}

function didCircuitStateChange(previous: EditorState, next: EditorState): boolean {
  return (
    previous.qubits !== next.qubits ||
    previous.steps !== next.steps ||
    previous.layout !== next.layout ||
    previous.items !== next.items ||
    previous.wireLabels !== next.wireLabels ||
    previous.wireTypes !== next.wireTypes
  );
}

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === "undo") {
    if (state.past.length === 0) {
      return state;
    }

    const previous = state.past[state.past.length - 1];
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future]
    };
  }

  if (action.type === "redo") {
    if (state.future.length === 0) {
      return state;
    }

    const [next, ...rest] = state.future;
    return {
      past: [...state.past, state.present],
      present: next,
      future: rest
    };
  }

  const nextPresent = editorReducer(state.present, action);
  if (nextPresent === state.present) {
    return state;
  }

  if (!isUndoableAction(action) || !didCircuitStateChange(state.present, nextPresent)) {
    return {
      ...state,
      present: nextPresent
    };
  }

  return {
    past: [...state.past, state.present],
    present: nextPresent,
    future: []
  };
}

export default function App(): JSX.Element {
  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: initialState,
    future: []
  });
  const state = history.present;
  const [gridDrafts, setGridDrafts] = useState({
    qubits: String(initialState.qubits),
    steps: String(initialState.steps)
  });
  const [clipboard, setClipboard] = useState<CircuitClipboard | null>(null);
  const [isPasteMode, setPasteMode] = useState(false);
  const [isShortcutSheetOpen, setShortcutSheetOpen] = useState(false);
  const [helpSheetMode, setHelpSheetMode] = useState<HelpSheetMode>("shortcuts");
  const [isHistorySheetOpen, setHistorySheetOpen] = useState(false);
  const [exportHistoryEntries, setExportHistoryEntries] = useState<ExportHistoryEntry[]>(() => loadExportHistory());
  const [exportPanelMode, setExportPanelMode] = useState<ExportPanelMode>("quantikz");
  const [quantikzPaneView, setQuantikzPaneView] = useState<ExportPaneView>("content");
  const [symbolicPaneView, setSymbolicPaneView] = useState<ExportPaneView>("content");
  const [openDownloadMenuTarget, setOpenDownloadMenuTarget] = useState<DownloadMenuTarget>(null);
  const [isCopyMenuOpen, setCopyMenuOpen] = useState(false);
  const [isPreparingShareUrl, setPreparingShareUrl] = useState(false);
  const [pendingHistoryCapture, setPendingHistoryCapture] = useState(false);
  const [toastAnimationKey, setToastAnimationKey] = useState(0);
  const [selectedWireLabel, setSelectedWireLabel] = useState<{ row: number; side: WireLabelSide } | null>(null);
  const [selectedStructure, setSelectedStructure] = useState<StructureSelection | null>(null);
  const [symbolicEditorCode, setSymbolicEditorCode] = useState("");
  const [symbolicRefreshVersion, setSymbolicRefreshVersion] = useState(0);
  const [workbenchLayoutMode, setWorkbenchLayoutMode] = useState<WorkbenchLayoutMode>("left-rail-tall");
  const [isBugReportOpen, setBugReportOpen] = useState(false);
  const [bugReportTitle, setBugReportTitle] = useState("");
  const [bugReportEmail, setBugReportEmail] = useState("");
  const [bugReportDescription, setBugReportDescription] = useState("");
  const [isSubmittingBugReport, setSubmittingBugReport] = useState(false);
  const stateRef = useRef(state);
  const clipboardRef = useRef<CircuitClipboard | null>(null);
  const shortcutSheetOpenRef = useRef(isShortcutSheetOpen);
  const historySheetOpenRef = useRef(isHistorySheetOpen);
  const selectedWireLabelRef = useRef(selectedWireLabel);
  const selectedStructureRef = useRef(selectedStructure);
  const exportPanelModeRef = useRef<ExportPanelMode>(exportPanelMode);
  const lastGeneratedSymbolicLatexRef = useRef("");
  const hasInitializedShareUrlRef = useRef(false);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const workspacePanelRef = useRef<HTMLElement | null>(null);

  const selectedItems = useMemo<CircuitItem[]>(
    () => state.items.filter((item) => state.selectedItemIds.includes(item.id)),
    [state.items, state.selectedItemIds]
  );
  const selectedItem = selectedItems.length === 1 ? selectedItems[0] : null;
  const selectedItemIds = useMemo(() => selectedItems.map((item) => item.id), [selectedItems]);
  const selectedWireLabelGroup = useMemo(
    () =>
      selectedWireLabel
        ? getWireLabelGroup(state.wireLabels, selectedWireLabel.row, selectedWireLabel.side)
        : null,
    [selectedWireLabel, state.wireLabels]
  );
  const selectedColumnHasEquals = useMemo(
    () =>
      selectedStructure?.kind === "column" &&
      state.items.some((item) => item.type === "equalsColumn" && item.point.col === selectedStructure.index),
    [selectedStructure, state.items]
  );
  const hasSelection = selectedItems.length > 0 || selectedWireLabelGroup !== null || selectedStructure !== null;
  const resolvedExportSource = useMemo(
    () => splitStandaloneQuantikzSource(state.exportCode, state.exportPreamble),
    [state.exportCode, state.exportPreamble]
  );
  const figurePreviewResult = useRenderedPdf(
    resolvedExportSource.code,
    resolvedExportSource.preamble
  );
  const isSymbolicMode = exportPanelMode === "symbolic";
  const figureSvgPreviewResult = useRenderedSvg(
    resolvedExportSource.code,
    resolvedExportSource.preamble,
    !isSymbolicMode
  );
  const symbolicLatexResult = useSymbolicLatex(resolvedExportSource.code, symbolicRefreshVersion);
  const normalizedSymbolicPreamble = useMemo(
    () => normalizeSymbolicPreamble(state.exportSymbolicPreamble),
    [state.exportSymbolicPreamble]
  );
  const symbolicPreviewResult = useRenderedPdf(
    isSymbolicMode ? symbolicEditorCode : "",
    normalizedSymbolicPreamble
  );
  const visualPreambleDefinitions = useMemo(
    () => resolveVisualPreambleDefinitions(resolvedExportSource.preamble),
    [resolvedExportSource.preamble]
  );
  const activePreviewResult = isSymbolicMode ? symbolicPreviewResult : figurePreviewResult;
  const pdfPreviewUrl = activePreviewResult.pdfUrl;
  const previewImageUrl = activePreviewResult.previewImageUrl;
  const pdfPreviewState = activePreviewResult.state;
  const pdfPreviewError = activePreviewResult.error;
  const figurePdfPreviewState = figurePreviewResult.state;
  const figurePreviewImageUrl = figurePreviewResult.previewImageUrl;
  const svgPreviewUrl = figureSvgPreviewResult.svgUrl;
  const svgPreviewMarkup = figureSvgPreviewResult.svgMarkup;
  const svgStatusText = !isSymbolicMode ? figureSvgPreviewResult.availabilityMessage : null;
  const previewFormat = !isSymbolicMode && svgPreviewUrl ? "svg" : "pdf";
  const mainDownloadFormats = useMemo<DownloadFormat[]>(() => {
    if (isSymbolicMode) {
      return DEFAULT_DOWNLOAD_FORMATS;
    }

    return figureSvgPreviewResult.isAvailable
      ? [...DEFAULT_DOWNLOAD_FORMATS, "svg"]
      : DEFAULT_DOWNLOAD_FORMATS;
  }, [figureSvgPreviewResult.isAvailable, isSymbolicMode]);
  const historyDownloadFormats = useMemo<DownloadFormat[]>(() => {
    return figureSvgPreviewResult.isAvailable
      ? [...DEFAULT_DOWNLOAD_FORMATS, "svg"]
      : DEFAULT_DOWNLOAD_FORMATS;
  }, [figureSvgPreviewResult.isAvailable]);
  const appBodyClassName = ["app-body", hasSelection ? "has-context-sidebar" : "", `layout-${workbenchLayoutMode}`]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (typeof window === "undefined") {
      hasInitializedShareUrlRef.current = true;
      return;
    }

    const hasRestoreParam = new URLSearchParams(window.location.search).has(BUG_REPORT_RESTORE_SEARCH_PARAM);
    if (!hasRestoreParam) {
      const sharedCircuit = readSharedCircuitFromSearch(window.location.search);

      if (!sharedCircuit) {
        hasInitializedShareUrlRef.current = true;
        return;
      }

      try {
        const imported = importFromQuantikz(sharedCircuit.code, { preamble: sharedCircuit.preamble });
        dispatch({
          type: "loadQuantikz",
          imported,
          code: sharedCircuit.code,
          preamble: sharedCircuit.preamble
        });
        setExportPanelMode("quantikz");
        setQuantikzPaneView("content");
      } catch (error) {
        dispatch({ type: "setExportCode", code: sharedCircuit.code });
        dispatch({ type: "setExportPreamble", preamble: sharedCircuit.preamble });
        dispatch({
          type: "setMessage",
          message: error instanceof Error
            ? `${error.message} The shared code was left in the editor so you can fix it.`
            : "Unable to load the shared Quantikz circuit. The shared code was left in the editor so you can fix it."
        });
      } finally {
        hasInitializedShareUrlRef.current = true;
      }

      return;
    }

    const restorePayload = consumeBugReportRestorePayload(window.location.search, window.localStorage);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete(BUG_REPORT_RESTORE_SEARCH_PARAM);
    window.history.replaceState(null, "", nextUrl.toString());
    hasInitializedShareUrlRef.current = true;

    if (!restorePayload) {
      dispatch({ type: "setMessage", message: "Unable to restore the selected bug report." });
      return;
    }

    applyBugReportRestore(restorePayload);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !hasInitializedShareUrlRef.current) {
      return;
    }

    const nextUrl = buildSharedCircuitUrl(window.location.href, state.exportCode, state.exportPreamble);
    if (nextUrl !== window.location.href) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [state.exportCode, state.exportPreamble]);

  useEffect(() => {
    const previousMode = exportPanelModeRef.current;
    exportPanelModeRef.current = exportPanelMode;

    if (previousMode !== "symbolic" && exportPanelMode === "symbolic" && resolvedExportSource.code.trim()) {
      setSymbolicRefreshVersion((currentVersion) => currentVersion + 1);
    }
  }, [exportPanelMode, resolvedExportSource.code]);

  useEffect(() => {
    setGridDrafts((currentDrafts) => {
      const nextDrafts = {
        qubits: String(state.qubits),
        steps: String(state.steps)
      };

      return currentDrafts.qubits === nextDrafts.qubits && currentDrafts.steps === nextDrafts.steps
        ? currentDrafts
        : nextDrafts;
    });
  }, [state.qubits, state.steps]);

  useEffect(() => {
    if (normalizedSymbolicPreamble !== state.exportSymbolicPreamble) {
      dispatch({ type: "setExportSymbolicPreamble", preamble: normalizedSymbolicPreamble });
    }
  }, [dispatch, normalizedSymbolicPreamble, state.exportSymbolicPreamble]);

  useEffect(() => {
    if (!resolvedExportSource.code.trim()) {
      lastGeneratedSymbolicLatexRef.current = "";
      setSymbolicEditorCode((currentCode) => currentCode ? "" : currentCode);
      return;
    }

    if (symbolicLatexResult.state !== "ready") {
      return;
    }

    const nextGeneratedLatex = symbolicLatexResult.latex;
    const previousGeneratedLatex = lastGeneratedSymbolicLatexRef.current;
    lastGeneratedSymbolicLatexRef.current = nextGeneratedLatex;

    setSymbolicEditorCode((currentCode) => {
      if (!currentCode.trim() || currentCode === previousGeneratedLatex) {
        return nextGeneratedLatex;
      }

      return currentCode;
    });
  }, [resolvedExportSource.code, symbolicLatexResult.latex, symbolicLatexResult.state]);

  useEffect(() => {
    clipboardRef.current = clipboard;
  }, [clipboard]);

  useEffect(() => {
    shortcutSheetOpenRef.current = isShortcutSheetOpen;
  }, [isShortcutSheetOpen]);

  useEffect(() => {
    historySheetOpenRef.current = isHistorySheetOpen;
  }, [isHistorySheetOpen]);

  useEffect(() => {
    selectedWireLabelRef.current = selectedWireLabel;
  }, [selectedWireLabel]);

  useEffect(() => {
    selectedStructureRef.current = selectedStructure;
  }, [selectedStructure]);

  useEffect(() => {
    const leftPanel = leftPanelRef.current;
    const workspacePanel = workspacePanelRef.current;
    if (!leftPanel || !workspacePanel) {
      return;
    }

    let animationFrameId = 0;

    const updateWorkbenchLayout = () => {
      animationFrameId = 0;

      const nextMode = resolveWorkbenchLayoutMode(
        leftPanel.getBoundingClientRect().height,
        workspacePanel.getBoundingClientRect().height
      );

      setWorkbenchLayoutMode((currentMode) => currentMode === nextMode ? currentMode : nextMode);
    };

    const scheduleWorkbenchLayoutUpdate = () => {
      if (animationFrameId !== 0) {
        window.cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = window.requestAnimationFrame(updateWorkbenchLayout);
    };

    scheduleWorkbenchLayoutUpdate();

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleWorkbenchLayoutUpdate);
    resizeObserver?.observe(leftPanel);
    resizeObserver?.observe(workspacePanel);
    window.addEventListener("resize", scheduleWorkbenchLayoutUpdate);

    return () => {
      if (animationFrameId !== 0) {
        window.cancelAnimationFrame(animationFrameId);
      }

      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleWorkbenchLayoutUpdate);
    };
  }, [hasSelection]);

  useEffect(() => {
    if (selectedItems.length > 0 && selectedWireLabel !== null) {
      setSelectedWireLabel(null);
    }
    if (selectedItems.length > 0 && selectedStructure !== null) {
      setSelectedStructure(null);
    }
  }, [selectedItems.length, selectedStructure, selectedWireLabel]);

  useEffect(() => {
    if (selectedWireLabel && selectedWireLabel.row >= state.qubits) {
      setSelectedWireLabel(null);
    }
  }, [selectedWireLabel, state.qubits]);

  useEffect(() => {
    if (!selectedStructure) {
      return;
    }

    if (selectedStructure.kind === "row" && selectedStructure.index >= state.qubits) {
      setSelectedStructure(null);
    }

    if (selectedStructure.kind === "column" && selectedStructure.index >= state.steps) {
      setSelectedStructure(null);
    }
  }, [selectedStructure, state.qubits, state.steps]);

  useEffect(() => {
    if (!state.uiMessage) {
      return;
    }

    setToastAnimationKey((currentKey) => currentKey + 1);
    const timeoutId = window.setTimeout(() => {
      dispatch({ type: "clearMessage" });
    }, TOAST_DURATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [state.uiMessage]);

  useEffect(() => {
    if (!openDownloadMenuTarget && !isCopyMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (target instanceof Element && target.closest(".download-menu")) {
        return;
      }

      setOpenDownloadMenuTarget(null);
      setCopyMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isCopyMenuOpen, openDownloadMenuTarget]);

  useEffect(() => {
    if (!isBugReportOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !isSubmittingBugReport) {
        setBugReportOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBugReportOpen, isSubmittingBugReport]);

  function refreshExportHistory(): void {
    setExportHistoryEntries(loadExportHistory());
  }

  function handleOpenHistory(): void {
    refreshExportHistory();
    setHistorySheetOpen(true);
  }

  function resetBugReportForm(): void {
    setBugReportTitle("");
    setBugReportEmail("");
    setBugReportDescription("");
  }

  function handleOpenBugReport(): void {
    setBugReportOpen(true);
  }

  function handleCloseBugReport(): void {
    if (isSubmittingBugReport) {
      return;
    }

    setBugReportOpen(false);
  }

  async function buildBugReportPreviewDataUrl(): Promise<string | undefined> {
    if (pdfPreviewState !== "ready" || !previewImageUrl) {
      return undefined;
    }

    try {
      return await imageUrlToDataUrl(previewImageUrl, 1600, 1200);
    } catch {
      return undefined;
    }
  }

  async function buildBugReportInterfaceDataUrl(): Promise<string | undefined> {
    if (typeof window === "undefined" || !appShellRef.current) {
      return undefined;
    }

    try {
      return await toPng(appShellRef.current, {
        cacheBust: true,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2)
      });
    } catch {
      return undefined;
    }
  }

  function buildBugReportVisualCircuitSnapshot(): string {
    const itemCounts = state.items.reduce<Record<string, number>>((counts, item) => {
      counts[item.type] = (counts[item.type] ?? 0) + 1;
      return counts;
    }, {});

    return JSON.stringify({
      capturedAt: new Date().toISOString(),
      summary: {
        qubits: state.qubits,
        steps: state.steps,
        itemCount: state.items.length,
        selectedItemCount: state.selectedItemIds.length,
        itemCounts
      },
      editorState: state
    });
  }

  function buildBugReportSessionSnapshot(): string {
    return JSON.stringify({
      capturedAt: new Date().toISOString(),
      locationHref: typeof window === "undefined" ? null : window.location.href,
      viewport: typeof window === "undefined"
        ? null
        : {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1
        },
      visualCircuitSummary: {
        qubits: state.qubits,
        steps: state.steps,
        itemCount: state.items.length,
        selectedItemCount: state.selectedItemIds.length,
        exportIssueCount: state.exportIssues.length
      },
      ui: {
        exportPanelMode,
        quantikzPaneView,
        symbolicPaneView,
        symbolicEditorCode,
        symbolicRefreshVersion,
        workbenchLayoutMode,
        isPasteMode,
        gridDrafts,
        isShortcutSheetOpen,
        helpSheetMode,
        isHistorySheetOpen,
        selectedWireLabel,
        selectedStructure,
        openDownloadMenuTarget,
        pendingHistoryCapture,
        toastAnimationKey
      },
      exports: {
        resolvedExportSource,
        normalizedSymbolicPreamble,
        currentExportAssetSource
      },
      preview: {
        isSymbolicMode,
        state: pdfPreviewState,
        error: pdfPreviewError,
        pdfPreviewUrlAvailable: Boolean(pdfPreviewUrl),
        previewImageAvailable: Boolean(previewImageUrl),
        figurePreviewState: figurePdfPreviewState,
        figurePreviewImageAvailable: Boolean(figurePreviewImageUrl),
        symbolicLatexState: symbolicLatexResult.state,
        symbolicLatexError: symbolicLatexResult.error
      }
    });
  }

  async function handleSubmitBugReport(): Promise<void> {
    const title = bugReportTitle.trim();
    const description = bugReportDescription.trim();

    if (!title || !description) {
      dispatch({ type: "setMessage", message: "Add a short title and description before submitting." });
      return;
    }

    setSubmittingBugReport(true);

    try {
      const [previewImageDataUrl, interfaceImageDataUrl] = await Promise.all([
        buildBugReportPreviewDataUrl(),
        buildBugReportInterfaceDataUrl()
      ]);
      const visualCircuitSnapshot = buildBugReportVisualCircuitSnapshot();
      const sessionSnapshot = buildBugReportSessionSnapshot();

      await submitBugReport({
        title,
        description,
        email: bugReportEmail.trim(),
        code: resolvedExportSource.code,
        preamble: resolvedExportSource.preamble,
        pageUrl: typeof window === "undefined" ? "" : window.location.href,
        userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
        previewImageDataUrl,
        interfaceImageDataUrl,
        visualCircuitSnapshot,
        sessionSnapshot
      });

      setBugReportOpen(false);
      resetBugReportForm();
      dispatch({ type: "setMessage", message: "Bug report submitted." });
    } catch (error) {
      dispatch({
        type: "setMessage",
        message: error instanceof Error ? error.message : "Unable to submit bug report."
      });
    } finally {
      setSubmittingBugReport(false);
    }
  }

  function getCurrentExportAssetSource(): ExportAssetSource {
    if (isSymbolicMode) {
      return {
        code: symbolicEditorCode,
        preamble: normalizedSymbolicPreamble
      };
    }

    return {
      code: resolvedExportSource.code,
      preamble: resolvedExportSource.preamble
    };
  }

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      );
    }

    function isActionElementTarget(target: EventTarget | null): boolean {
      return target instanceof Element && target.closest("button, a, summary, [role='button']") !== null;
    }

    function onKeyDown(event: KeyboardEvent): void {
      const hasItemSelection = stateRef.current.selectedItemIds.length > 0;
      const selectedLabel = selectedWireLabelRef.current;
      const selectedStructure = selectedStructureRef.current;
      const hasDeletableSelection = hasItemSelection || selectedLabel !== null || selectedStructure !== null;
      const isFormElement = isEditableTarget(event.target);
      const isActionElement = isActionElementTarget(event.target);
      const normalizedKey = event.key.toLowerCase();

      if (shortcutSheetOpenRef.current || historySheetOpenRef.current) {
        if (event.key === "Escape") {
          event.preventDefault();
          setShortcutSheetOpen(false);
          setHistorySheetOpen(false);
          return;
        }

        if (historySheetOpenRef.current && normalizedKey === "h" && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          setHistorySheetOpen(false);
        }

        return;
      }

      if ((event.metaKey || event.ctrlKey) && normalizedKey === "a" && !isFormElement) {
        event.preventDefault();
        setPasteMode(false);
        clearContextSelection();
        dispatch({
          type: "setSelectedIds",
          itemIds: stateRef.current.items
            .filter((item) =>
              item.type !== "horizontalSegment" ||
              (stateRef.current.horizontalSegmentsUnlocked && isVisibleHorizontalSegment(item))
            )
            .map((item) => item.id)
        });
        dispatch({ type: "setTool", tool: "select" });
        return;
      }

      if ((event.metaKey || event.ctrlKey) && normalizedKey === "z" && !isFormElement) {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
        setPasteMode(false);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && (normalizedKey === "s" || event.key === "Enter")) {
        event.preventDefault();
        handleConvertToQuantikz();
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && hasDeletableSelection) {
        if (!isFormElement) {
          event.preventDefault();
          if (hasItemSelection) {
            dispatch({ type: "deleteSelected" });
          } else if (selectedLabel) {
            dispatch({
              type: "updateWireLabel",
              row: selectedLabel.row,
              side: selectedLabel.side,
              label: ""
            });
          } else if (selectedStructure) {
            const currentCount = selectedStructure.kind === "row"
              ? stateRef.current.qubits
              : stateRef.current.steps;

            if (currentCount <= 1 || selectedStructure.index < 0 || selectedStructure.index >= currentCount) {
              return;
            }

            dispatch({
              type: "deleteGridLine",
              dimension: selectedStructure.kind === "row" ? "qubits" : "steps",
              index: selectedStructure.index
            });

            const nextCount = currentCount - 1;
            setSelectedStructure(
              nextCount > 0
                ? {
                    kind: selectedStructure.kind,
                    index: Math.min(selectedStructure.index, nextCount - 1)
                  }
                : null
            );
          }
        }
      }

      if ((event.metaKey || event.ctrlKey) && normalizedKey === "c" && hasItemSelection && !isFormElement) {
        event.preventDefault();
        const nextClipboard = buildClipboard(
          stateRef.current.items.filter((item) => stateRef.current.selectedItemIds.includes(item.id))
        );
        if (!nextClipboard) {
          return;
        }

        setClipboard(nextClipboard);
        setPasteMode(false);
        dispatch({ type: "setMessage", message: "Selection copied. Press Cmd/Ctrl+V and click a destination." });
      }

      if ((event.metaKey || event.ctrlKey) && normalizedKey === "v" && !isFormElement) {
        if (!clipboardRef.current) {
          return;
        }

        event.preventDefault();
        setPasteMode(true);
        clearContextSelection();
        dispatch({ type: "setTool", tool: "select" });
        dispatch({ type: "setMessage", message: "Click on the grid to place the copied group." });
      }

      if (!isFormElement && !event.metaKey && !event.ctrlKey && !event.altKey && normalizedKey === "h") {
        event.preventDefault();
        handleOpenHistory();
        return;
      }

      if (!isFormElement && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const shortcutTool = TOOL_SHORTCUTS_BY_KEY.get(normalizedKey);
        if (shortcutTool) {
          event.preventDefault();
          setPasteMode(false);
          clearContextSelection();
          if (shortcutTool !== "select") {
            dispatch({ type: "setSelectedIds", itemIds: [] });
          }
          dispatch({ type: "setTool", tool: shortcutTool });
          return;
        }
      }

      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey && !isFormElement && !isActionElement) {
        event.preventDefault();
        handleConvertToQuantikz();
        return;
      }

      if (event.key === "Escape") {
        setPasteMode(false);
        clearContextSelection();
        dispatch({ type: "setTool", tool: "select" });
        dispatch({ type: "clearMessage" });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!pendingHistoryCapture) {
      return;
    }

    if (!resolvedExportSource.code.trim()) {
      setPendingHistoryCapture(false);
      return;
    }

    if (figurePdfPreviewState !== "ready" || !figurePreviewImageUrl) {
      return;
    }

    let cancelled = false;

    void imageUrlToDataUrl(figurePreviewImageUrl)
      .then((historyPreviewImage) => {
        if (cancelled) {
          return;
        }

        const nextHistoryEntries = pushExportHistoryEntry(loadExportHistory(), {
          code: resolvedExportSource.code,
          preamble: resolvedExportSource.preamble,
          previewImage: historyPreviewImage
        });

        persistExportHistory(nextHistoryEntries);
        setExportHistoryEntries(nextHistoryEntries);
        setPendingHistoryCapture(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        const nextHistoryEntries = pushExportHistoryEntry(loadExportHistory(), {
          code: resolvedExportSource.code,
          preamble: resolvedExportSource.preamble
        });

        persistExportHistory(nextHistoryEntries);
        setExportHistoryEntries(nextHistoryEntries);
        setPendingHistoryCapture(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    pendingHistoryCapture,
    resolvedExportSource.code,
    resolvedExportSource.preamble,
    figurePdfPreviewState,
    figurePreviewImageUrl
  ]);

  async function handleDownload(
    format: DownloadFormat,
    source: ExportAssetSource,
    baseName?: string
  ): Promise<void> {
    if (!source.code.trim()) {
      dispatch({
        type: "setMessage",
        message: isSymbolicMode
          ? "Add symbolic LaTeX before downloading an export."
          : "Add Quantikz code before downloading an export."
      });
      return;
    }

    try {
      const resolvedBaseName = baseName ?? (isSymbolicMode ? "symbolic-evolution" : "quantikz-circuit");
      const blob = await buildDownloadBlob(format, source, {
        svgMarkup: !isSymbolicMode ? svgPreviewMarkup ?? undefined : undefined
      });
      downloadBlob(blob, getDownloadFilename(resolvedBaseName, format));
      setOpenDownloadMenuTarget(null);
      dispatch({
        type: "setMessage",
        message: `Downloaded ${getDownloadFilename(resolvedBaseName, format)}.`
      });
    } catch (error) {
      dispatch({
        type: "setMessage",
        message: error instanceof Error ? error.message : "Unable to download the selected export."
      });
    }
  }

  function handleOpenPdfPreview(): void {
    const previewDocumentUrl = previewFormat === "svg" ? svgPreviewUrl : pdfPreviewUrl;
    if (!previewDocumentUrl) {
      return;
    }

    const targetUrl = previewFormat === "svg"
      ? previewDocumentUrl
      : getPdfViewerSrc(previewDocumentUrl);
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  }

  async function handleCopyPreviewImage(format: CopyFormat = "png"): Promise<void> {
    const source = getCurrentExportAssetSource();

    try {
      if (format === "svg") {
        await copyQuantikzSvgToClipboard(source, {
          svgMarkup: svgPreviewMarkup ?? undefined
        });
        setCopyMenuOpen(false);
        dispatch({
          type: "setMessage",
          message: "Copied the rendered figure as an SVG to the clipboard."
        });
        return;
      }

      await copyQuantikzImageToClipboard(source.code, source.preamble);
      setCopyMenuOpen(false);
      dispatch({
        type: "setMessage",
        message: isSymbolicMode
          ? "Copied the rendered symbolic preview as a PNG to the clipboard."
          : "Copied the rendered figure as a PNG to the clipboard."
      });
    } catch (error) {
      dispatch({
        type: "setMessage",
        message: error instanceof Error
          ? error.message
          : isSymbolicMode
            ? "Unable to copy the symbolic preview to the clipboard."
            : "Unable to copy the figure to the clipboard."
      });
    }
  }

  async function handleCopyShareUrl(): Promise<void> {
    if (typeof window === "undefined") {
      return;
    }

    if (!state.exportCode.trim()) {
      dispatch({ type: "setMessage", message: "Generate or paste Quantikz code before copying a share URL." });
      return;
    }

    try {
      setPreparingShareUrl(true);
      dispatch({ type: "setMessage", message: "Preparing share link preview..." });

      const pdfBlob = await fetchQuantikzPdf(state.exportCode, state.exportPreamble);
      const pngBlob = await renderPdfBlobToPngBlob(pdfBlob);
      const imageId = await uploadSharePreviewImage(pngBlob);
      const shareUrl = await buildShareLandingUrlWithServerStorage(window.location.href, state.exportCode, state.exportPreamble, imageId);

      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(shareUrl);
      } else if (window.quantikzDesktop?.copyText) {
        await window.quantikzDesktop.copyText(shareUrl);
      } else {
        throw new Error("Clipboard access is unavailable in this browser.");
      }

      dispatch({ type: "setMessage", message: "Share URL copied with a rendered preview image." });
    } catch (error) {
      dispatch({
        type: "setMessage",
        message: error instanceof Error ? error.message : "Unable to copy the share URL."
      });
    } finally {
      setPreparingShareUrl(false);
    }
  }

  function handlePreviewDragStart(event: DragEvent<HTMLImageElement>): void {
    if (!previewImageUrl) {
      return;
    }

    // Keep native image drag payload so drops insert image content instead of a blob URL string.
    event.dataTransfer.effectAllowed = "copy";
  }

  function handleLoadFromCode(): void {
    try {
      const nextSource = splitStandaloneQuantikzSource(state.exportCode, state.exportPreamble);
      const imported = importFromQuantikz(nextSource.code, { preamble: nextSource.preamble });
      setPasteMode(false);
      clearContextSelection();
      dispatch({ type: "loadQuantikz", imported, code: nextSource.code, preamble: nextSource.preamble });
    } catch (error) {
      dispatch({
        type: "setMessage",
        message: error instanceof Error ? error.message : "Failed to parse Quantikz code."
      });
    }
  }

  function handleConvertToQuantikz(): void {
    if (import.meta.env.MODE !== "test") {
      setPendingHistoryCapture(true);
    }

    dispatch({ type: "convert" });
  }

  function handleLoadHistoryEntry(entry: ExportHistoryEntry): void {
    try {
      const imported = importFromQuantikz(entry.code, { preamble: entry.preamble });
      setPasteMode(false);
      clearContextSelection();
      setOpenDownloadMenuTarget(null);
      dispatch({ type: "loadQuantikz", imported, code: entry.code, preamble: entry.preamble });
      setExportPanelMode("quantikz");
      setQuantikzPaneView("content");
      setHistorySheetOpen(false);
    } catch (error) {
      dispatch({
        type: "setMessage",
        message: error instanceof Error ? error.message : "Unable to load the selected history circuit."
      });
    }
  }

  function applyBugReportRestore(restorePayload: BugReportRestorePayload): void {
    setExportPanelMode(restorePayload.exportPanelMode);
    setQuantikzPaneView(restorePayload.quantikzPaneView);
    setSymbolicPaneView(restorePayload.symbolicPaneView);
    setSymbolicEditorCode(restorePayload.symbolicEditorCode);

    if (restorePayload.editorState) {
      dispatch({
        type: "loadEditorSnapshot",
        snapshot: {
          ...restorePayload.editorState,
          exportCode: restorePayload.code || restorePayload.editorState.exportCode,
          exportPreamble: restorePayload.preamble || restorePayload.editorState.exportPreamble,
          uiMessage: "Circuit restored from bug report."
        }
      });
      return;
    }

    try {
      const imported = importFromQuantikz(restorePayload.code, { preamble: restorePayload.preamble });
      dispatch({
        type: "loadQuantikz",
        imported,
        code: restorePayload.code,
        preamble: restorePayload.preamble
      });
    } catch {
      dispatch({ type: "setMessage", message: "Unable to restore the selected bug report." });
    }
  }

  function handleSelectedItemsColorChange(color: string | null): void {
    if (selectedItemIds.length === 0) {
      return;
    }

    dispatch({ type: "updateItemColorBatch", itemIds: selectedItemIds, color });
  }

  function handleSelectedGateLabelChange(label: string): void {
    if (selectedItemIds.length === 0) {
      return;
    }

    dispatch({ type: "updateGateLabelBatch", itemIds: selectedItemIds, label });
  }

  function handleSelectedControlStateChange(controlState: "filled" | "open"): void {
    if (selectedItemIds.length === 0) {
      return;
    }

    dispatch({ type: "updateControlStateBatch", itemIds: selectedItemIds, controlState });
  }

  function handleSelectedWireTypeChange(wireType: "quantum" | "classical"): void {
    if (selectedItemIds.length === 0) {
      return;
    }

    dispatch({ type: "updateWireTypeBatch", itemIds: selectedItemIds, wireType });
  }

  function handleClearHistory(): void {
    persistExportHistory([]);
    setExportHistoryEntries([]);
  }

  function selectNumericField(event: FocusEvent<HTMLInputElement>): void {
    event.currentTarget.select();
  }

  function parsePositiveInteger(value: string): number | null {
    if (!/^\d+$/.test(value)) {
      return null;
    }

    return Number(value);
  }

  function clearContextSelection(): void {
    setSelectedWireLabel(null);
    setSelectedStructure(null);
  }

  function clearAllSelection(): void {
    clearContextSelection();
    dispatch({ type: "setSelectedIds", itemIds: [] });
  }

  function resizeGrid(dimension: "qubits" | "steps", value: number): void {
    dispatch({
      type: "resizeGrid",
      dimension,
      value
    });
  }

  function updateGridDraft(dimension: "qubits" | "steps", value: string): void {
    if (!/^\d*$/.test(value)) {
      return;
    }

    setGridDrafts((currentDrafts) => ({
      ...currentDrafts,
      [dimension]: value
    }));

    const parsedValue = parsePositiveInteger(value);
    if (parsedValue !== null) {
      resizeGrid(dimension, parsedValue);
    }
  }

  function commitGridDraft(dimension: "qubits" | "steps"): void {
    const parsedValue = parsePositiveInteger(gridDrafts[dimension]);
    const fallbackValue = dimension === "qubits" ? state.qubits : state.steps;
    const committedValue = parsedValue ?? fallbackValue;

    setGridDrafts((currentDrafts) => ({
      ...currentDrafts,
      [dimension]: String(committedValue)
    }));

    if (parsedValue !== null && parsedValue !== fallbackValue) {
      resizeGrid(dimension, parsedValue);
    }
  }

  function adjustGrid(dimension: "qubits" | "steps", delta: number): void {
    const current = dimension === "qubits" ? state.qubits : state.steps;
    resizeGrid(dimension, Math.max(1, current + delta));
  }

  function handleSelectStructure(selection: StructureSelection): void {
    setPasteMode(false);
    setSelectedWireLabel(null);
    dispatch({ type: "setSelectedIds", itemIds: [] });
    setSelectedStructure(selection);
  }

  function handleInsertStructure(selection: StructureSelection, side: "before" | "after"): void {
    const insertIndex = side === "before" ? selection.index : selection.index + 1;
    dispatch({
      type: "insertGridLine",
      dimension: selection.kind === "row" ? "qubits" : "steps",
      index: insertIndex
    });
    setSelectedWireLabel(null);
    dispatch({ type: "setSelectedIds", itemIds: [] });
    setSelectedStructure({ kind: selection.kind, index: insertIndex });
  }

  function handleDeleteStructure(selection: StructureSelection): void {
    if (selection.kind === "row" && state.qubits <= 1) {
      return;
    }

    if (selection.kind === "column" && state.steps <= 1) {
      return;
    }

    dispatch({
      type: "deleteGridLine",
      dimension: selection.kind === "row" ? "qubits" : "steps",
      index: selection.index
    });
    setSelectedWireLabel(null);
    dispatch({ type: "setSelectedIds", itemIds: [] });
    const nextCount = selection.kind === "row" ? state.qubits - 1 : state.steps - 1;
    if (nextCount <= 0) {
      setSelectedStructure(null);
      return;
    }

    setSelectedStructure({
      kind: selection.kind,
      index: Math.min(selection.index, nextCount - 1)
    });
  }

  function handleConvertColumnToEquals(col: number): void {
    dispatch({
      type: "addItem",
      tool: "equalsColumn",
      placement: { kind: "cell", row: 0, col }
    });
    dispatch({ type: "setSelectedIds", itemIds: [] });
    setSelectedWireLabel(null);
    setSelectedStructure({ kind: "column", index: col });
  }

  function handlePastePlacement(placement: PlacementTarget): void {
    if (!clipboard) {
      return;
    }

    const anchor = { row: placement.row, col: placement.col };
    if (!canPasteClipboardAt(stateRef.current, clipboard, anchor)) {
      dispatch({ type: "setMessage", message: "Copied group cannot be placed there." });
      return;
    }

    dispatch({ type: "pasteClipboard", clipboard, anchor });
    clearContextSelection();
    setPasteMode(false);
  }

  function handleToolSelection(tool: ToolType): void {
    setPasteMode(false);
    clearContextSelection();
    if (tool !== "select") {
      dispatch({ type: "setSelectedIds", itemIds: [] });
    }
    dispatch({ type: "setTool", tool });
  }

  function handleRefreshSymbolicLatex(): void {
    if (!resolvedExportSource.code.trim() || symbolicLatexResult.state === "loading") {
      return;
    }

    setSymbolicRefreshVersion((currentVersion) => currentVersion + 1);
  }

  const symbolicCodeEdited = Boolean(symbolicEditorCode.trim()) && symbolicEditorCode !== symbolicLatexResult.latex;
  const symbolicTextareaPlaceholder = !resolvedExportSource.code.trim()
    ? "Generate or paste Quantikz code to populate the symbolic LaTeX editor."
    : symbolicLatexResult.state === "loading" && !symbolicEditorCode.trim()
      ? "Generating symbolic LaTeX..."
      : symbolicLatexResult.state === "error" && !symbolicEditorCode.trim()
        ? symbolicLatexResult.error ?? "Unable to generate symbolic evolution for this circuit."
        : "Symbolic LaTeX appears here. You can edit it before rendering.";
  const symbolicStatusText = !resolvedExportSource.code.trim()
    ? "Generate or paste Quantikz code, then edit the symbolic LaTeX here if needed."
    : symbolicLatexResult.state === "loading"
      ? "Generating slice-by-slice symbolic evolution..."
      : symbolicLatexResult.state === "error" && !symbolicEditorCode.trim()
        ? symbolicLatexResult.error ?? "Unable to generate symbolic evolution for this circuit."
        : symbolicCodeEdited
          ? "Editing the symbolic LaTeX locally."
          : "Auto-generated from the current Quantikz circuit. You can edit it below.";
  const activeEditorView = isSymbolicMode ? symbolicPaneView : quantikzPaneView;
  const symbolicPreamblePlaceholder = "LaTeX preamble for the symbolic evolution preview.";
  const previewHeadingLabel = isSymbolicMode ? "Symbolic preview" : "Figure preview";
  const previewAltText = isSymbolicMode ? "Rendered symbolic evolution preview" : "Rendered Quantikz figure preview";
  const currentExportAssetSource = getCurrentExportAssetSource();
  const helpSheetEyebrow = helpSheetMode === "symbolic" ? "Symbolic" : "Keyboard";
  const helpSheetTitle = helpSheetMode === "symbolic" ? "Symbolic interpretation" : "Shortcuts";

  function handleOpenHelpSheet(): void {
    setHelpSheetMode(isSymbolicMode ? "symbolic" : "shortcuts");
    setShortcutSheetOpen(true);
  }

  return (
    <div ref={appShellRef} className="app-shell">
      <header className="top-bar">
        <div className="title-block">
          <p className="eyebrow">Studio Quantikz</p>
          <div className="title-row">
            <h1>Circuit drawer</h1>
            <button
              type="button"
              className="shortcut-launcher"
              aria-label={isSymbolicMode ? "Show symbolic conventions" : "Show keyboard shortcuts"}
              title={isSymbolicMode ? "Show symbolic conventions" : "Show keyboard shortcuts"}
              onClick={handleOpenHelpSheet}
            >
              <span className="shortcut-chip" aria-hidden="true">Help</span>
              <img src={cmdIcon} alt="" className="shortcut-help-icon" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="toolbar-controls">
          <button
            type="button"
            className="shortcut-launcher history-launcher"
            aria-label="Show export history"
            title="Show export history"
            onClick={handleOpenHistory}
          >
            <img src={historyIcon} alt="" className="shortcut-help-icon" aria-hidden="true" />
            <span className="history-launcher-shortcut" aria-hidden="true">H</span>
          </button>
          <div className="toolbar-stepper" aria-label="Qubits control group">
            <div className="stepper-control">
              <span className="stepper-title" aria-hidden="true">Qubits</span>
              <button
                type="button"
                className="stepper-button"
                aria-label="Decrease qubits"
                onClick={() => adjustGrid("qubits", -1)}
              >
                -
              </button>
              <input
                aria-label="Qubits"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={gridDrafts.qubits}
                onFocus={selectNumericField}
                onChange={(event) => updateGridDraft("qubits", event.target.value)}
                onBlur={() => commitGridDraft("qubits")}
              />
              <button
                type="button"
                className="stepper-button"
                aria-label="Increase qubits"
                onClick={() => adjustGrid("qubits", 1)}
              >
                +
              </button>
            </div>
          </div>
          <div className="toolbar-stepper" aria-label="Steps control group">
            <div className="stepper-control">
              <span className="stepper-title" aria-hidden="true">Steps</span>
              <button
                type="button"
                className="stepper-button"
                aria-label="Decrease steps"
                onClick={() => adjustGrid("steps", -1)}
              >
                -
              </button>
              <input
                aria-label="Steps"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={gridDrafts.steps}
                onFocus={selectNumericField}
                onChange={(event) => updateGridDraft("steps", event.target.value)}
                onBlur={() => commitGridDraft("steps")}
              />
              <button
                type="button"
                className="stepper-button"
                aria-label="Increase steps"
                onClick={() => adjustGrid("steps", 1)}
              >
                +
              </button>
            </div>
          </div>
          <div className="toolbar-stepper toolbar-wires-stepper" aria-label="Wires control group">
            <div className="stepper-control wires-control">
              <span className="stepper-title" aria-hidden="true">Wires</span>
              <button
                type="button"
                className={`stepper-button wires-icon-button ${!state.horizontalSegmentsUnlocked ? "is-active" : ""}`}
                aria-label={state.horizontalSegmentsUnlocked ? "Lock wires (prevent selection)" : "Unlock wires (allow selection)"}
                aria-pressed={!state.horizontalSegmentsUnlocked}
                title={state.horizontalSegmentsUnlocked ? "Wires selectable" : "Wires locked (not selectable)"}
                onClick={() =>
                  dispatch({
                    type: "setHorizontalSegmentsUnlocked",
                    unlocked: !state.horizontalSegmentsUnlocked
                  })
                }
              >
                <img src={state.horizontalSegmentsUnlocked ? unlockedIcon : lockedIcon} alt="" className="wires-icon" />
              </button>
              <button
                type="button"
                className={`stepper-button wires-icon-button ${state.autoWireNewGrid ? "is-active" : ""}`}
                aria-label={state.autoWireNewGrid ? "Disable auto wires" : "Enable auto wires"}
                aria-pressed={state.autoWireNewGrid}
                title={state.autoWireNewGrid ? "Auto wires on" : "Auto wires off"}
                onClick={() =>
                  dispatch({
                    type: "setAutoWireNewGrid",
                    enabled: !state.autoWireNewGrid
                  })
                }
              >
                <img src={automaticIcon} alt="" className="wires-icon" />
              </button>
            </div>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setPasteMode(false);
              clearContextSelection();
              dispatch({ type: "resetCircuit" });
              if (typeof window !== "undefined") {
                const cleanUrl = new URL(window.location.href);
                cleanUrl.search = "";
                cleanUrl.hash = "";
                window.history.replaceState({}, "", cleanUrl.toString());
              }
            }}
          >
            Reset
          </button>
          <button
            type="button"
            className="primary-button toolbar-convert-button"
            onClick={handleConvertToQuantikz}
          >
            Convert to Quantikz
          </button>
        </div>
      </header>

      {state.uiMessage && (
        <div className="message-toast" role="status" aria-live="polite">
          <span className="message-toast-text">{state.uiMessage}</span>
          <span
            key={toastAnimationKey}
            className="message-toast-timer"
            aria-hidden="true"
            style={{ animationDuration: `${TOAST_DURATION_MS}ms` }}
          />
        </div>
      )}

      {isShortcutSheetOpen && (
        <div className="shortcut-sheet-backdrop" onClick={() => setShortcutSheetOpen(false)}>
          <section
            className="shortcut-sheet history-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-sheet-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shortcut-sheet-header">
              <div>
                <p className="eyebrow">{helpSheetEyebrow}</p>
                <h2 id="help-sheet-title">{helpSheetTitle}</h2>
              </div>
              <div className="shortcut-sheet-actions">
                <div className="export-editor-tabs help-sheet-tabs" role="tablist" aria-label="Help topics">
                  <button
                    type="button"
                    className={`export-editor-tab ${helpSheetMode === "shortcuts" ? "is-active" : ""}`}
                    aria-pressed={helpSheetMode === "shortcuts"}
                    onClick={() => setHelpSheetMode("shortcuts")}
                  >
                    Shortcuts
                  </button>
                  <button
                    type="button"
                    className={`export-editor-tab ${helpSheetMode === "symbolic" ? "is-active" : ""}`}
                    aria-pressed={helpSheetMode === "symbolic"}
                    onClick={() => setHelpSheetMode("symbolic")}
                  >
                    Symbolic
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="secondary-button shortcut-sheet-close"
                onClick={() => setShortcutSheetOpen(false)}
              >
                Close
              </button>
            </div>

            {helpSheetMode === "shortcuts" ? (
              <div className="shortcut-sheet-grid">
                <section className="shortcut-section" aria-label="Tool shortcuts">
                  <h3>Tool switching</h3>
                  <div className="shortcut-list">
                    {TOOL_SHORTCUTS.map(({ tool, label, description, shortcutKey }) => (
                      <div key={tool} className="shortcut-row">
                        <span className="shortcut-key">{shortcutKey}</span>
                        <div>
                          <strong>{tool === "controlDot" ? `${label} (hold Option for empty)` : label}</strong>
                          <p>{description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="shortcut-section" aria-label="General shortcuts">
                  <h3>General actions</h3>
                  <div className="shortcut-list">
                    {GENERAL_SHORTCUTS.map(({ key, description }) => (
                      <div key={key} className="shortcut-row">
                        <span className="shortcut-key shortcut-key-wide">{key}</span>
                        <div>
                          <p>{description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            ) : (
              <div className="shortcut-sheet-grid shortcut-sheet-grid-single">
                {SYMBOLIC_HELP_SECTIONS.map((section) => (
                  <section key={section.title} className="shortcut-section" aria-label={section.title}>
                    <h3>{section.title}</h3>
                    <div className="shortcut-list">
                      {section.items.map((item) => (
                        <div key={`${section.title}-${item.label}`} className="shortcut-row shortcut-row-help">
                          <code className="help-inline-code">{item.label}</code>
                          <div>
                            <p>{item.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {isHistorySheetOpen && (
        <div className="shortcut-sheet-backdrop" onClick={() => setHistorySheetOpen(false)}>
          <section
            className="shortcut-sheet history-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-sheet-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shortcut-sheet-header">
              <div>
                <p className="eyebrow">Exports</p>
                <h2 id="history-sheet-title">History</h2>
              </div>
              <div className="history-sheet-actions">
                <button
                  type="button"
                  className="secondary-button shortcut-sheet-close"
                  onClick={handleClearHistory}
                  disabled={exportHistoryEntries.length === 0}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="secondary-button shortcut-sheet-close"
                  onClick={() => setHistorySheetOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>

            {exportHistoryEntries.length > 0 ? (
              <>
                <p className="history-sheet-caption">
                  Recent Quantikz exports are cached in the browser. Click one to load its code and preamble.
                </p>
                <div className="history-card-list" aria-label="Quantikz export history">
                  {exportHistoryEntries.map((entry) => (
                    <article
                      key={entry.id}
                      className="history-card"
                    >
                      <button
                        type="button"
                        className="history-card-load"
                        onClick={() => handleLoadHistoryEntry(entry)}
                      >
                        <div className="history-card-preview">
                          {entry.previewImage ? (
                            <img
                              className="history-card-preview-image"
                              src={entry.previewImage}
                              alt=""
                              aria-hidden="true"
                            />
                          ) : (
                            <div className="history-card-preview-image history-card-preview-placeholder" aria-hidden="true" />
                          )}
                        </div>
                        <div className="history-card-copy">
                          <span className="export-field-label">{formatHistoryTimestamp(entry.createdAt)}</span>
                          <code>{getExportHistorySnippet(entry.code)}</code>
                        </div>
                      </button>
                      <div className="history-card-actions">
                        <DownloadMenu
                          isOpen={openDownloadMenuTarget === `history:${entry.id}`}
                          formats={historyDownloadFormats}
                          onToggle={() =>
                            setOpenDownloadMenuTarget((current) => current === `history:${entry.id}` ? null : `history:${entry.id}`)
                          }
                          onSelect={(format) =>
                            void handleDownload(format, {
                              code: entry.code,
                              preamble: entry.preamble
                            }, `quantikz-history-${entry.id.slice(0, 8)}`)
                          }
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p className="history-sheet-empty">
                No cached Quantikz exports yet. Convert a circuit and its source will be stored here.
              </p>
            )}
          </section>
        </div>
      )}

      {isBugReportOpen && (
        <div className="bug-report-backdrop" onClick={handleCloseBugReport}>
          <section
            className="bug-report-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bug-report-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="bug-report-header">
              <div>
                <p className="eyebrow">Feedback</p>
                <h2 id="bug-report-title">Submit a bug</h2>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={handleCloseBugReport}
                disabled={isSubmittingBugReport}
              >
                Close
              </button>
            </div>
            <p className="bug-report-caption">
              The current code, preamble, and rendered preview image are attached automatically when available, without using screen-capture permissions.
            </p>
            <form
              className="bug-report-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSubmitBugReport();
              }}
            >
              <label className="bug-report-field">
                <span>Title</span>
                <input
                  aria-label="Bug title"
                  type="text"
                  maxLength={BUG_REPORT_TITLE_MAX_LENGTH}
                  value={bugReportTitle}
                  onChange={(event) => setBugReportTitle(event.target.value)}
                  placeholder="Short summary of the problem"
                  disabled={isSubmittingBugReport}
                />
              </label>
              <label className="bug-report-field">
                <span>Email (optional)</span>
                <input
                  aria-label="Bug email"
                  type="email"
                  maxLength={BUG_REPORT_EMAIL_MAX_LENGTH}
                  value={bugReportEmail}
                  onChange={(event) => setBugReportEmail(event.target.value)}
                  placeholder="name@example.com"
                  disabled={isSubmittingBugReport}
                />
              </label>
              <label className="bug-report-field">
                <span>Description</span>
                <textarea
                  aria-label="Bug description"
                  maxLength={BUG_REPORT_DESCRIPTION_MAX_LENGTH}
                  value={bugReportDescription}
                  onChange={(event) => setBugReportDescription(event.target.value)}
                  placeholder="What happened, what you expected, and how to reproduce it"
                  rows={7}
                  disabled={isSubmittingBugReport}
                />
              </label>
              <div className="bug-report-actions">
                <span className="bug-report-counter" aria-live="polite">
                  {bugReportDescription.length}/{BUG_REPORT_DESCRIPTION_MAX_LENGTH}
                </span>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={isSubmittingBugReport}
                >
                  {isSubmittingBugReport ? "Submitting..." : "Submit bug"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      <main className={appBodyClassName}>
        <div
          key={hasSelection ? "inspector" : "palette"}
          ref={leftPanelRef}
          className={`left-panel-shell ${hasSelection ? "left-panel-slide-in" : "left-panel-slide-back"}`}
        >
          {hasSelection ? (
            <Inspector
              selectedItem={selectedItem}
              selectedItems={selectedItems}
              selectedStructure={selectedStructure}
              selectedColumnHasEquals={selectedColumnHasEquals}
              selectedWireLabelGroup={selectedWireLabelGroup}
              selectedCount={selectedItems.length}
              qubits={state.qubits}
              steps={state.steps}
              wireLabels={state.wireLabels}
              onGateLabelChange={(itemId, label) => dispatch({ type: "updateGateLabel", itemId, label })}
              onGateSpanChange={(itemId, rows, cols) => dispatch({ type: "updateGateSpan", itemId, rows, cols })}
              onFrameLabelChange={(itemId, label) => dispatch({ type: "updateFrameLabel", itemId, label })}
              onFrameSpanChange={(itemId, rows, cols) => dispatch({ type: "updateFrameSpan", itemId, rows, cols })}
              onFrameStyleChange={(itemId, updates) => dispatch({ type: "updateFrameStyle", itemId, ...updates })}
              onSliceLabelChange={(itemId, label) => dispatch({ type: "updateSliceLabel", itemId, label })}
              onVerticalLengthChange={(itemId, length) =>
                dispatch({ type: "updateVerticalLength", itemId, length })
              }
              onVerticalWireTypeChange={(itemId, wireType) =>
                dispatch({ type: "updateVerticalWireType", itemId, wireType })
              }
              onControlStateChange={(itemId, controlState) =>
                dispatch({ type: "updateControlState", itemId, controlState })
              }
              onHorizontalModeChange={(itemId, mode) =>
                dispatch({ type: "updateHorizontalMode", itemId, mode })
              }
              onHorizontalWireTypeChange={(itemId, wireType) =>
                dispatch({ type: "updateHorizontalWireType", itemId, wireType })
              }
              onHorizontalBundledChange={(itemId, bundled) =>
                dispatch({ type: "updateHorizontalBundled", itemId, bundled })
              }
              onHorizontalBundleLabelChange={(itemId, bundleLabel) =>
                dispatch({ type: "updateHorizontalBundleLabel", itemId, bundleLabel })
              }
              onItemColorChange={(itemId, color) => dispatch({ type: "updateItemColor", itemId, color })}
              onSelectedItemsColorChange={handleSelectedItemsColorChange}
              onSelectedGateLabelChange={handleSelectedGateLabelChange}
              onSelectedControlStateChange={handleSelectedControlStateChange}
              onSelectedWireTypeChange={handleSelectedWireTypeChange}
              onWireLabelChange={(row, side, label) =>
                dispatch({ type: "updateWireLabel", row, side, label })
              }
              onWireLabelGroupChange={(row, side, updates) =>
                dispatch({ type: "updateWireLabelGroup", row, side, ...updates })
              }
              onWireLabelGroupUnmerge={(row, side) =>
                dispatch({ type: "unmergeWireLabelGroup", row, side })
              }
              onInsertStructure={handleInsertStructure}
              onDeleteStructure={handleDeleteStructure}
              onConvertColumnToEquals={handleConvertColumnToEquals}
              onDelete={() => dispatch({ type: "deleteSelected" })}
              onClearSelection={clearAllSelection}
              showWireLabels={false}
              showSelectionControls
              eyebrow="Selection"
              heading="Object controls"
              panelClassName="context-panel"
            />
          ) : (
            <Palette
              activeTool={state.activeTool}
              onSelectTool={handleToolSelection}
            />
          )}
        </div>

        <Workspace
          panelRef={workspacePanelRef}
          state={state}
          latexMacros={visualPreambleDefinitions.katexMacros}
          isPasteMode={isPasteMode}
          pasteClipboard={clipboard}
          selectedStructure={selectedStructure}
          selectedWireLabelGroup={selectedWireLabelGroup}
          onLayoutSpacingChange={(dimension, value) =>
            dispatch({ type: "updateLayoutSpacing", dimension, value })
          }
          onWireLabelChange={(row, side, label) =>
            dispatch({ type: "updateWireLabel", row, side, label })
          }
          onSelectWireLabelGroup={(row, side) => {
            dispatch({ type: "setSelectedIds", itemIds: [] });
            setSelectedStructure(null);
            setSelectedWireLabel({ row, side });
          }}
          onMergeWireLabelGroup={(row, side) => {
            dispatch({ type: "mergeWireLabelGroup", row, side });
            setSelectedStructure(null);
            setSelectedWireLabel({ row, side });
          }}
          onSelectStructure={handleSelectStructure}
          onPlaceItem={(tool, placement, options) => {
            clearContextSelection();
            dispatch({ type: "addItem", tool, placement, controlState: options?.controlState });
            if (state.activeTool !== "select") {
              dispatch({ type: "setSelectedIds", itemIds: [] });
            }
          }}
          onDrawWire={(start, end) => {
            clearContextSelection();
            dispatch({ type: "drawWire", start, end });
            dispatch({ type: "setSelectedIds", itemIds: [] });
          }}
          onDrawGate={(start, end) => {
            clearContextSelection();
            dispatch({ type: "addGateFromArea", start, end });
            dispatch({ type: "setSelectedIds", itemIds: [] });
          }}
          onDrawMeter={(start, endRow) => {
            clearContextSelection();
            dispatch({ type: "addMeterFromArea", start, endRow });
            dispatch({ type: "setSelectedIds", itemIds: [] });
          }}
          onDrawAnnotation={(start, end) => {
            clearContextSelection();
            dispatch({ type: "addAnnotationFromArea", start, end });
            dispatch({ type: "setSelectedIds", itemIds: [] });
          }}
          onPasteAt={handlePastePlacement}
          onMoveItem={(itemId: string, placement: PlacementTarget) =>
            dispatch({ type: "moveItem", itemId, placement })
          }
          onMoveSelection={(anchorItemId: string, placement: PlacementTarget) =>
            dispatch({ type: "moveSelection", anchorItemId, placement })
          }
          onSelectHorizontalSegment={(row, col, additive) => {
            clearContextSelection();
            dispatch({ type: "selectOrCreateHorizontalSegment", row, col, additive });
          }}
          onSelectionChange={(itemIds) => {
            clearContextSelection();
            dispatch({ type: "setSelectedIds", itemIds });
          }}
          onResizeGrid={(dimension, value) => dispatch({ type: "resizeGrid", dimension, value })}
          onBoardMetricsChange={() => {}}
        />

        <div className="right-rail">
          <section className="panel export-panel" aria-label="Export panel">
            <div className="panel-heading">
              <p className="eyebrow">Export</p>
              <h2>Quantikz output</h2>
            </div>
            <div className="export-split">
              <div className="export-pane export-pane-editor">
                <div className="export-pane-header">
                  <div className="export-pane-toggle-group">
                    <div className="export-editor-tabs" role="tablist" aria-label="Export panel mode">
                      <button
                        type="button"
                        className={`export-editor-tab ${exportPanelMode === "quantikz" ? "is-active" : ""}`}
                        aria-pressed={exportPanelMode === "quantikz"}
                        onClick={() => setExportPanelMode("quantikz")}
                      >
                        Quantikz
                      </button>
                      <button
                        type="button"
                        className={`export-editor-tab ${exportPanelMode === "symbolic" ? "is-active" : ""}`}
                        aria-pressed={exportPanelMode === "symbolic"}
                        onClick={() => setExportPanelMode("symbolic")}
                      >
                        Symbolic
                      </button>
                    </div>
                    <TextToggleSwitch
                      leftLabel={isSymbolicMode ? "Symbolic" : "Code"}
                      rightLabel="Preamble"
                      value={activeEditorView}
                      onChange={(value) => {
                        if (isSymbolicMode) {
                          setSymbolicPaneView(value);
                          return;
                        }

                        setQuantikzPaneView(value);
                      }}
                      ariaLabel={isSymbolicMode ? "Toggle symbolic editor view" : "Toggle quantikz editor view"}
                    />
                  </div>
                  {!isSymbolicMode ? (
                    <div className="export-generated-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        title="Copy a share URL that includes an Open Graph preview image rendered from this circuit."
                        disabled={isPreparingShareUrl}
                        onClick={handleCopyShareUrl}
                      >
                        {isPreparingShareUrl ? "Preparing share URL..." : "Copy share URL"}
                      </button>
                      <button type="button" className="secondary-button" onClick={handleLoadFromCode}>
                        Convert to visual
                      </button>
                    </div>
                  ) : (
                    <div className="export-generated-actions">
                      <span className={`export-generated-status ${symbolicLatexResult.state === "error" ? "is-error" : ""}`}>
                        {symbolicStatusText}
                      </span>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={handleRefreshSymbolicLatex}
                        disabled={!resolvedExportSource.code.trim() || symbolicLatexResult.state === "loading"}
                      >
                        Refresh symbolic evolution
                      </button>
                    </div>
                  )}
                </div>
                <div className="export-pane-body">
                  {!isSymbolicMode && quantikzPaneView === "content" ? (
                    <textarea
                      aria-label="Quantikz output"
                      className="code-output"
                      spellCheck={false}
                      value={state.exportCode}
                      placeholder="Press “Convert to Quantikz” to generate code, or paste Quantikz here."
                      onChange={(event) => dispatch({ type: "setExportCode", code: event.target.value })}
                    />
                  ) : !isSymbolicMode ? (
                    <textarea
                      aria-label="Quantikz preamble"
                      className="code-output preamble-output"
                      spellCheck={false}
                      value={state.exportPreamble}
                      placeholder="LaTeX preamble"
                      onChange={(event) => dispatch({ type: "setExportPreamble", preamble: event.target.value })}
                    />
                  ) : symbolicPaneView === "content" ? (
                    <textarea
                      aria-label="Symbolic evolution output"
                      className="code-output preamble-output"
                      spellCheck={false}
                      value={symbolicEditorCode}
                      placeholder={symbolicTextareaPlaceholder}
                      onChange={(event) => setSymbolicEditorCode(event.target.value)}
                    />
                  ) : (
                    <textarea
                      aria-label="Symbolic preamble"
                      className="code-output preamble-output"
                      spellCheck={false}
                      value={normalizedSymbolicPreamble}
                      placeholder={symbolicPreamblePlaceholder}
                      onChange={(event) => dispatch({ type: "setExportSymbolicPreamble", preamble: event.target.value })}
                    />
                  )}
                </div>
              </div>
              <div className="export-pane pdf-preview-panel" aria-live="polite">
                <div className="export-pane-header export-pane-header-preview">
                  <div className="preview-heading-block">
                    <span className="export-field-label">{previewHeadingLabel}</span>
                    {svgStatusText && (
                      <span className="preview-svg-status">{svgStatusText}</span>
                    )}
                  </div>
                  <div className="pdf-preview-actions">
                    {!isSymbolicMode && figureSvgPreviewResult.isAvailable ? (
                      <CopyMenu
                        isOpen={isCopyMenuOpen}
                        formats={["png", "svg"]}
                        disabled={!currentExportAssetSource.code.trim()}
                        onToggle={() => {
                          setOpenDownloadMenuTarget(null);
                          setCopyMenuOpen((current) => !current);
                        }}
                        onSelect={(format) => {
                          void handleCopyPreviewImage(format);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          void handleCopyPreviewImage();
                        }}
                        disabled={!currentExportAssetSource.code.trim()}
                      >
                        Copy image
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleOpenPdfPreview}
                      disabled={previewFormat === "svg" ? !svgPreviewUrl : !pdfPreviewUrl}
                    >
                      {previewFormat === "svg" ? "Open SVG" : "Open PDF"}
                    </button>
                    <DownloadMenu
                      isOpen={openDownloadMenuTarget === "main"}
                      formats={mainDownloadFormats}
                      onToggle={() => {
                        setCopyMenuOpen(false);
                        setOpenDownloadMenuTarget((current) => current === "main" ? null : "main");
                      }}
                      onSelect={(format) => void handleDownload(format, currentExportAssetSource)}
                    />
                  </div>
                </div>
                {pdfPreviewState === "ready" && previewImageUrl ? (
                  <div className="pdf-preview-stage">
                    <img
                      className="pdf-preview-frame"
                      src={previewImageUrl}
                      alt={previewAltText}
                      title={previewAltText}
                      draggable={true}
                      onDragStart={handlePreviewDragStart}
                    />
                    <p className="pdf-preview-drag-hint">
                      {isSymbolicMode
                        ? "Drag the rendered symbolic evolution into another app or onto the desktop."
                        : "Drag the figure into another app or onto the desktop."}
                    </p>
                  </div>
                ) : (
                  <p className="pdf-preview-placeholder">
                    {isSymbolicMode
                      ? !resolvedExportSource.code.trim() && !symbolicEditorCode.trim()
                        ? "Generate or paste Quantikz code to produce symbolic LaTeX."
                        : symbolicLatexResult.state === "loading" && !symbolicEditorCode.trim()
                        ? "Generating symbolic evolution..."
                        : symbolicLatexResult.state === "error" && !symbolicEditorCode.trim()
                          ? symbolicLatexResult.error ?? "Unable to generate the symbolic evolution."
                          : pdfPreviewState === "loading"
                            ? "Rendering symbolic preview..."
                            : pdfPreviewState === "error"
                              ? pdfPreviewError ?? "Unable to render the symbolic preview."
                              : "Edit the symbolic LaTeX on the left to render the symbolic preview."
                      : pdfPreviewState === "loading"
                        ? "Rendering figure preview..."
                        : pdfPreviewState === "error"
                          ? pdfPreviewError ?? "Unable to render the figure preview."
                          : "Convert the circuit or paste Quantikz code to render a figure preview."}
                  </p>
                )}
              </div>
            </div>
            {state.exportIssues.length > 0 && (
              <div className="issues-panel">
                <h3>Validation</h3>
                <ul>
                  {state.exportIssues.map((entry) => (
                    <li key={entry.id} className={`issue-${entry.severity}`}>
                      {entry.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </main>
      <button
        type="button"
        className="secondary-button bug-report-launcher"
        onClick={handleOpenBugReport}
      >
        Submit a bug
      </button>
      <a
        className="corner-profile-link"
        href={REPOSITORY_URL}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${REPOSITORY_LABEL}`}
        title={REPOSITORY_LABEL}
      >
        {REPOSITORY_LABEL}
      </a>
    </div>
  );
}
