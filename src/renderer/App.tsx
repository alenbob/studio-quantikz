import { useEffect, useMemo, useReducer, useRef, useState, type DragEvent, type FocusEvent, type JSX } from "react";
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
  getExportHistorySnippet,
  loadExportHistory,
  persistExportHistory,
  pushExportHistoryEntry,
  type ExportHistoryEntry
} from "./exportHistory";
import {
  buildDownloadBlob,
  copyQuantikzImageToClipboard,
  downloadBlob,
  getDownloadFilename,
  type DownloadFormat,
  type ExportAssetSource
} from "./exportAssets";
import { isVisibleHorizontalSegment } from "./horizontalWires";
import { importFromQuantikz } from "./importer";
import { resolveVisualPreambleDefinitions } from "../shared/tikzPreamble";
import { useRenderedPdf } from "./useRenderedPdf";
import { useSymbolicLatex } from "./useSymbolicLatex";
import { editorReducer, initialState, type EditorAction } from "./reducer";
import { getWireLabelGroup, type WireLabelSide } from "./wireLabels";
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
type DownloadMenuTarget = "main" | `history:${string}` | null;
type WorkbenchLayoutMode = "left-rail-tall" | "workspace-tall";

const TOAST_DURATION_MS = 4000;
const WORKBENCH_LAYOUT_TOLERANCE_PX = 1;
const DOWNLOAD_FORMATS: DownloadFormat[] = ["tex", "pdf"];
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
  onToggle,
  onSelect
}: {
  isOpen: boolean;
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
          {DOWNLOAD_FORMATS.map((format) => (
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
  const [isHistorySheetOpen, setHistorySheetOpen] = useState(false);
  const [exportHistoryEntries, setExportHistoryEntries] = useState<ExportHistoryEntry[]>(() => loadExportHistory());
  const [exportPanelMode, setExportPanelMode] = useState<ExportPanelMode>("quantikz");
  const [quantikzPaneView, setQuantikzPaneView] = useState<ExportPaneView>("content");
  const [symbolicPaneView, setSymbolicPaneView] = useState<ExportPaneView>("content");
  const [openDownloadMenuTarget, setOpenDownloadMenuTarget] = useState<DownloadMenuTarget>(null);
  const [pendingHistoryCapture, setPendingHistoryCapture] = useState(false);
  const [toastAnimationKey, setToastAnimationKey] = useState(0);
  const [selectedWireLabel, setSelectedWireLabel] = useState<{ row: number; side: WireLabelSide } | null>(null);
  const [selectedStructure, setSelectedStructure] = useState<StructureSelection | null>(null);
  const [symbolicEditorCode, setSymbolicEditorCode] = useState("");
  const [workbenchLayoutMode, setWorkbenchLayoutMode] = useState<WorkbenchLayoutMode>("left-rail-tall");
  const stateRef = useRef(state);
  const clipboardRef = useRef<CircuitClipboard | null>(null);
  const shortcutSheetOpenRef = useRef(isShortcutSheetOpen);
  const historySheetOpenRef = useRef(isHistorySheetOpen);
  const selectedWireLabelRef = useRef(selectedWireLabel);
  const selectedStructureRef = useRef(selectedStructure);
  const lastGeneratedSymbolicLatexRef = useRef("");
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
  const symbolicLatexResult = useSymbolicLatex(resolvedExportSource.code);
  const isSymbolicMode = exportPanelMode === "symbolic";
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
  const appBodyClassName = ["app-body", hasSelection ? "has-context-sidebar" : "", `layout-${workbenchLayoutMode}`]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
    if (!openDownloadMenuTarget) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (target instanceof Element && target.closest(".download-menu")) {
        return;
      }

      setOpenDownloadMenuTarget(null);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [openDownloadMenuTarget]);

  function refreshExportHistory(): void {
    setExportHistoryEntries(loadExportHistory());
  }

  function handleOpenHistory(): void {
    refreshExportHistory();
    setHistorySheetOpen(true);
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
      const blob = await buildDownloadBlob(format, source);
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
    if (!pdfPreviewUrl) {
      return;
    }

    window.open(getPdfViewerSrc(pdfPreviewUrl), "_blank", "noopener,noreferrer");
  }

  async function handleCopyPreviewImage(): Promise<void> {
    const source = getCurrentExportAssetSource();

    try {
      await copyQuantikzImageToClipboard(source.code, source.preamble);
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

  function handlePreviewDragStart(event: DragEvent<HTMLImageElement>): void {
    if (!previewImageUrl) {
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/uri-list", previewImageUrl);
    event.dataTransfer.setData("text/plain", previewImageUrl);

    try {
      event.dataTransfer.setData(
        "DownloadURL",
        `image/png:${isSymbolicMode ? "symbolic-evolution" : "quantikz-circuit"}.png:${previewImageUrl}`
      );
    } catch {
      // Some browsers ignore custom drag payload types; native image dragging still works.
    }
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

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="title-block">
          <p className="eyebrow">Studio Quantikz</p>
          <div className="title-row">
            <h1>Circuit drawer</h1>
            <button
              type="button"
              className="shortcut-launcher"
              aria-label="Show keyboard shortcuts"
              title="Show keyboard shortcuts"
              onClick={() => setShortcutSheetOpen(true)}
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
            aria-labelledby="shortcut-sheet-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shortcut-sheet-header">
              <div>
                <p className="eyebrow">Keyboard</p>
                <h2 id="shortcut-sheet-title">Shortcuts</h2>
              </div>
              <button
                type="button"
                className="secondary-button shortcut-sheet-close"
                onClick={() => setShortcutSheetOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="shortcut-sheet-grid">
              <section className="shortcut-section" aria-label="Tool shortcuts">
                <h3>Tool switching</h3>
                <div className="shortcut-list">
                  {TOOL_SHORTCUTS.map(({ tool, label, description, shortcutKey }) => (
                    <div key={tool} className="shortcut-row">
                      <span className="shortcut-key">{shortcutKey}</span>
                      <div>
                        <strong>{label}</strong>
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
          onPlaceItem={(tool, placement) => {
            clearContextSelection();
            dispatch({ type: "addItem", tool, placement });
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
                    <button type="button" className="secondary-button" onClick={handleLoadFromCode}>
                      Convert to visual
                    </button>
                  ) : (
                    <span className={`export-generated-status ${symbolicLatexResult.state === "error" ? "is-error" : ""}`}>
                      {symbolicStatusText}
                    </span>
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
                  <span className="export-field-label">{previewHeadingLabel}</span>
                  <div className="pdf-preview-actions">
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
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleOpenPdfPreview}
                      disabled={!pdfPreviewUrl}
                    >
                      Open PDF
                    </button>
                    <DownloadMenu
                      isOpen={openDownloadMenuTarget === "main"}
                      onToggle={() => setOpenDownloadMenuTarget((current) => current === "main" ? null : "main")}
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
