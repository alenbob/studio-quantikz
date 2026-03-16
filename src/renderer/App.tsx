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
  copySvgToClipboard,
  downloadBlob,
  getDownloadFilename,
  svgMarkupToDataUrl,
  svgMarkupToPngBlob,
  type DownloadFormat,
  type ExportAssetSource
} from "./exportAssets";
import { importFromQuantikz } from "./importer";
import { useTikzJax } from "./useTikzJax";
import { editorReducer, initialState, type EditorAction } from "./reducer";
import { getWireLabelGroup, type WireLabelSide } from "./wireLabels";
import type {
  CircuitClipboard,
  CircuitItem,
  EditorState,
  PlacementTarget,
  ToolType
} from "./types";

interface HistoryState {
  past: EditorState[];
  present: EditorState;
  future: EditorState[];
}

type HistoryAction = EditorAction | { type: "undo" } | { type: "redo" };
type ExportEditorTab = "code" | "preamble";
type DownloadMenuTarget = "main" | `history:${string}` | null;

const TOAST_DURATION_MS = 4000;
const DOWNLOAD_FORMATS: DownloadFormat[] = ["tex", "svg", "png", "pdf"];

const TOOL_SHORTCUTS = TOOL_LABELS.filter((entry): entry is (typeof TOOL_LABELS)[number] & { shortcutKey: string } =>
  Boolean(entry.shortcutKey)
);

const TOOL_SHORTCUTS_BY_KEY = new Map<string, ToolType>(
  TOOL_SHORTCUTS.map(({ shortcutKey, tool }) => [shortcutKey.toLowerCase(), tool])
);

const GENERAL_SHORTCUTS: Array<{ key: string; description: string }> = [
  { key: "Cmd/Ctrl + A", description: "Select every drawable item in the circuit." },
  { key: "Cmd/Ctrl + C", description: "Copy the current selection." },
  { key: "Cmd/Ctrl + V", description: "Enter paste mode for the copied selection." },
  { key: "Cmd/Ctrl + Z", description: "Undo the last circuit change." },
  { key: "Cmd/Ctrl + Shift + Z", description: "Redo the last undone change." },
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

function isUndoableAction(action: EditorAction): boolean {
  return ![
    "setTool",
    "setHorizontalSegmentsUnlocked",
    "setSelectedIds",
    "convert",
    "setExportCode",
    "setExportPreamble",
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
  const [exportEditorTab, setExportEditorTab] = useState<ExportEditorTab>("code");
  const [openDownloadMenuTarget, setOpenDownloadMenuTarget] = useState<DownloadMenuTarget>(null);
  const [pendingHistoryCapture, setPendingHistoryCapture] = useState(false);
  const [toastAnimationKey, setToastAnimationKey] = useState(0);
  const [selectedWireLabel, setSelectedWireLabel] = useState<{ row: number; side: WireLabelSide } | null>(null);
  const [previewPngBlob, setPreviewPngBlob] = useState<Blob | null>(null);
  const [previewPngUrl, setPreviewPngUrl] = useState<string | null>(null);
  const stateRef = useRef(state);
  const clipboardRef = useRef<CircuitClipboard | null>(null);
  const shortcutSheetOpenRef = useRef(isShortcutSheetOpen);
  const historySheetOpenRef = useRef(isHistorySheetOpen);
  const selectedWireLabelRef = useRef(selectedWireLabel);

  const selectedItems = useMemo<CircuitItem[]>(
    () => state.items.filter((item) => state.selectedItemIds.includes(item.id)),
    [state.items, state.selectedItemIds]
  );
  const selectedItem = selectedItems.length === 1 ? selectedItems[0] : null;
  const selectedWireLabelGroup = useMemo(
    () =>
      selectedWireLabel
        ? getWireLabelGroup(state.wireLabels, selectedWireLabel.row, selectedWireLabel.side)
        : null,
    [selectedWireLabel, state.wireLabels]
  );
  const hasSelection = selectedItems.length > 0 || selectedWireLabelGroup !== null;
  const resolvedExportSource = useMemo(
    () => splitStandaloneQuantikzSource(state.exportCode, state.exportPreamble),
    [state.exportCode, state.exportPreamble]
  );
  const tikzJaxResult = useTikzJax(
    resolvedExportSource.code,
    resolvedExportSource.preamble
  );
  const svgPreviewMarkup = tikzJaxResult.svg;
  const svgPreviewState = tikzJaxResult.state;
  const svgPreviewError = tikzJaxResult.error;
  const svgPreviewDataUrl = useMemo(
    () => svgPreviewMarkup ? svgMarkupToDataUrl(svgPreviewMarkup) : "",
    [svgPreviewMarkup]
  );

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
    if (selectedItems.length > 0 && selectedWireLabel !== null) {
      setSelectedWireLabel(null);
    }
  }, [selectedItems.length, selectedWireLabel]);

  useEffect(() => {
    if (selectedWireLabel && selectedWireLabel.row >= state.qubits) {
      setSelectedWireLabel(null);
    }
  }, [selectedWireLabel, state.qubits]);

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
    return {
      code: resolvedExportSource.code,
      preamble: resolvedExportSource.preamble,
      svg: svgPreviewMarkup
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

    function onKeyDown(event: KeyboardEvent): void {
      const hasItemSelection = stateRef.current.selectedItemIds.length > 0;
      const selectedLabel = selectedWireLabelRef.current;
      const hasSelection = hasItemSelection || selectedLabel !== null;
      const isFormElement = isEditableTarget(event.target);
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
        setSelectedWireLabel(null);
        dispatch({
          type: "setSelectedIds",
          itemIds: stateRef.current.items
            .filter((item) => stateRef.current.horizontalSegmentsUnlocked || item.type !== "horizontalSegment")
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

      if ((event.key === "Delete" || event.key === "Backspace") && hasSelection) {
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
          }
        }
      }

      if ((event.metaKey || event.ctrlKey) && normalizedKey === "c" && hasSelection && !isFormElement) {
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
          setSelectedWireLabel(null);
          if (shortcutTool !== "select") {
            dispatch({ type: "setSelectedIds", itemIds: [] });
          }
          dispatch({ type: "setTool", tool: shortcutTool });
          return;
        }
      }

      if (event.key === "Escape") {
        setPasteMode(false);
        setSelectedWireLabel(null);
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

    if (svgPreviewState === "error") {
      setPendingHistoryCapture(false);
      return;
    }

    if (svgPreviewState !== "ready" || !svgPreviewMarkup) {
      return;
    }

    const nextHistoryEntries = pushExportHistoryEntry(loadExportHistory(), {
      code: resolvedExportSource.code,
      preamble: resolvedExportSource.preamble,
      svg: svgPreviewMarkup
    });

    persistExportHistory(nextHistoryEntries);
    setExportHistoryEntries(nextHistoryEntries);
    setPendingHistoryCapture(false);
  }, [
    pendingHistoryCapture,
    resolvedExportSource.code,
    resolvedExportSource.preamble,
    svgPreviewMarkup,
    svgPreviewState
  ]);

  useEffect(() => {
    let isActive = true;
    let objectUrl: string | null = null;

    if (svgPreviewState !== "ready" || !svgPreviewMarkup) {
      setPreviewPngBlob(null);
      setPreviewPngUrl((currentUrl) => {
        if (currentUrl) {
          URL.revokeObjectURL(currentUrl);
        }
        return null;
      });
      return;
    }

    void svgMarkupToPngBlob(svgPreviewMarkup)
      .then((blob) => {
        if (!isActive) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setPreviewPngBlob(blob);
        setPreviewPngUrl((currentUrl) => {
          if (currentUrl) {
            URL.revokeObjectURL(currentUrl);
          }
          return objectUrl;
        });
      })
      .catch(() => {
        if (!isActive) {
          return;
        }

        setPreviewPngBlob(null);
        setPreviewPngUrl((currentUrl) => {
          if (currentUrl) {
            URL.revokeObjectURL(currentUrl);
          }
          return null;
        });
      });

    return () => {
      isActive = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [svgPreviewMarkup, svgPreviewState]);

  async function handleDownload(
    format: DownloadFormat,
    source: ExportAssetSource,
    baseName = "quantikz-circuit"
  ): Promise<void> {
    if (!source.code.trim()) {
      dispatch({ type: "setMessage", message: "Add Quantikz code before downloading an export." });
      return;
    }

    if ((format === "svg" || format === "png") && !source.svg.trim()) {
      dispatch({ type: "setMessage", message: "Render the Quantikz preview before downloading this format." });
      return;
    }

    try {
      const blob = await buildDownloadBlob(format, source);
      downloadBlob(blob, getDownloadFilename(baseName, format));
      setOpenDownloadMenuTarget(null);
      dispatch({
        type: "setMessage",
        message: `Downloaded ${getDownloadFilename(baseName, format)}.`
      });
    } catch (error) {
      dispatch({
        type: "setMessage",
        message: error instanceof Error ? error.message : "Unable to download the selected export."
      });
    }
  }

  async function handleCopySvg(): Promise<void> {
    try {
      await copySvgToClipboard(svgPreviewMarkup);
      dispatch({ type: "setMessage", message: "Copied the Quantikz SVG to the clipboard." });
    } catch (error) {
      dispatch({
        type: "setMessage",
        message: error instanceof Error ? error.message : "Unable to copy the SVG."
      });
    }
  }

  function handleLoadFromCode(): void {
    try {
      const nextSource = splitStandaloneQuantikzSource(state.exportCode, state.exportPreamble);
      const imported = importFromQuantikz(nextSource.code);
      setPasteMode(false);
      setSelectedWireLabel(null);
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
      const imported = importFromQuantikz(entry.code);
      setPasteMode(false);
      setSelectedWireLabel(null);
      setOpenDownloadMenuTarget(null);
      dispatch({ type: "loadQuantikz", imported, code: entry.code, preamble: entry.preamble });
      setExportEditorTab("code");
      setHistorySheetOpen(false);
    } catch (error) {
      dispatch({
        type: "setMessage",
        message: error instanceof Error ? error.message : "Unable to load the selected history circuit."
      });
    }
  }

  function handleClearHistory(): void {
    persistExportHistory([]);
    setExportHistoryEntries([]);
  }

  function handlePreviewDragStart(event: DragEvent<HTMLDivElement>): void {
    if (!previewPngBlob || !previewPngUrl) {
      event.preventDefault();
      return;
    }

    const fileName = getDownloadFilename("quantikz-circuit", "png");
    const file = new File([previewPngBlob], fileName, { type: "image/png" });

    if (event.dataTransfer.items) {
      try {
        event.dataTransfer.items.add(file);
      } catch {
        // Chromium still supports DownloadURL as a fallback for dragging files out.
      }
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", fileName);
    event.dataTransfer.setData("DownloadURL", `image/png:${fileName}:${previewPngUrl}`);
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
    setSelectedWireLabel(null);
    setPasteMode(false);
  }

  function handleToolSelection(tool: ToolType): void {
    setPasteMode(false);
    setSelectedWireLabel(null);
    if (tool !== "select") {
      dispatch({ type: "setSelectedIds", itemIds: [] });
    }
    dispatch({ type: "setTool", tool });
  }

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
              setSelectedWireLabel(null);
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
            className="shortcut-sheet"
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
                          <img
                            className="history-card-preview-image"
                            src={svgMarkupToDataUrl(entry.svg)}
                            alt="Quantikz history preview"
                          />
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
                              preamble: entry.preamble,
                              svg: entry.svg
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
                No cached Quantikz exports yet. Convert a circuit and a rendered SVG preview will be stored here.
              </p>
            )}
          </section>
        </div>
      )}

      <main className={`app-body ${hasSelection ? "has-context-sidebar" : ""}`}>
        <div key={hasSelection ? "inspector" : "palette"} className={hasSelection ? "left-panel-slide-in" : "left-panel-slide-back"}>
        {hasSelection ? (
          <Inspector
            selectedItem={selectedItem}
            selectedWireLabelGroup={selectedWireLabelGroup}
            selectedCount={selectedItems.length}
            qubits={state.qubits}
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
            onItemColorChange={(itemId, color) => dispatch({ type: "updateItemColor", itemId, color })}
            onWireLabelChange={(row, side, label) =>
              dispatch({ type: "updateWireLabel", row, side, label })
            }
            onWireLabelGroupChange={(row, side, updates) =>
              dispatch({ type: "updateWireLabelGroup", row, side, ...updates })
            }
            onWireLabelGroupUnmerge={(row, side) =>
              dispatch({ type: "unmergeWireLabelGroup", row, side })
            }
            onDelete={() => dispatch({ type: "deleteSelected" })}
            onClearSelection={() => {
              setSelectedWireLabel(null);
              dispatch({ type: "setSelectedIds", itemIds: [] });
            }}
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
          state={state}
          isPasteMode={isPasteMode}
          pasteClipboard={clipboard}
          selectedWireLabelGroup={selectedWireLabelGroup}
          onLayoutSpacingChange={(dimension, value) =>
            dispatch({ type: "updateLayoutSpacing", dimension, value })
          }
          onWireLabelChange={(row, side, label) =>
            dispatch({ type: "updateWireLabel", row, side, label })
          }
          onSelectWireLabelGroup={(row, side) => {
            dispatch({ type: "setSelectedIds", itemIds: [] });
            setSelectedWireLabel({ row, side });
          }}
          onMergeWireLabelGroup={(row, side) => {
            dispatch({ type: "mergeWireLabelGroup", row, side });
            setSelectedWireLabel({ row, side });
          }}
          onPlaceItem={(tool, placement) => {
            setSelectedWireLabel(null);
            dispatch({ type: "addItem", tool, placement });
            if (state.activeTool !== "select") {
              dispatch({ type: "setSelectedIds", itemIds: [] });
            }
          }}
          onDrawGate={(start, end) => {
            setSelectedWireLabel(null);
            dispatch({ type: "addGateFromArea", start, end });
            dispatch({ type: "setSelectedIds", itemIds: [] });
          }}
          onDrawMeter={(start, endRow) => {
            setSelectedWireLabel(null);
            dispatch({ type: "addMeterFromArea", start, endRow });
            dispatch({ type: "setSelectedIds", itemIds: [] });
          }}
          onDrawAnnotation={(start, end) => {
            setSelectedWireLabel(null);
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
          onSelectionChange={(itemIds) => {
            setSelectedWireLabel(null);
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
                  <div className="export-editor-tabs" role="tablist" aria-label="Quantikz export editor">
                    <button
                      type="button"
                      className={`export-editor-tab ${exportEditorTab === "code" ? "is-active" : ""}`}
                      aria-pressed={exportEditorTab === "code"}
                      onClick={() => setExportEditorTab("code")}
                    >
                      Code
                    </button>
                    <button
                      type="button"
                      className={`export-editor-tab ${exportEditorTab === "preamble" ? "is-active" : ""}`}
                      aria-pressed={exportEditorTab === "preamble"}
                      onClick={() => setExportEditorTab("preamble")}
                    >
                      Preamble
                    </button>
                  </div>
                  <button type="button" className="secondary-button" onClick={handleLoadFromCode}>
                    Convert to visual
                  </button>
                </div>
                <div className="export-pane-body">
                  {exportEditorTab === "code" ? (
                    <textarea
                      aria-label="Quantikz output"
                      className="code-output"
                      spellCheck={false}
                      value={state.exportCode}
                      placeholder="Press “Convert to Quantikz” to generate code, or paste Quantikz here."
                      onChange={(event) => dispatch({ type: "setExportCode", code: event.target.value })}
                    />
                  ) : (
                    <textarea
                      aria-label="Quantikz preamble"
                      className="code-output preamble-output"
                      spellCheck={false}
                      value={state.exportPreamble}
                      placeholder="LaTeX preamble"
                      onChange={(event) => dispatch({ type: "setExportPreamble", preamble: event.target.value })}
                    />
                  )}
                </div>
              </div>
              <div className="export-pane svg-preview-panel" aria-live="polite">
                <div className="export-pane-header export-pane-header-preview">
                  <div className="svg-preview-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void handleCopySvg()}
                      disabled={!svgPreviewMarkup}
                    >
                      Copy SVG
                    </button>
                    <DownloadMenu
                      isOpen={openDownloadMenuTarget === "main"}
                      onToggle={() => setOpenDownloadMenuTarget((current) => current === "main" ? null : "main")}
                      onSelect={(format) => void handleDownload(format, currentExportAssetSource)}
                    />
                  </div>
                </div>
                <div
                  className={`svg-preview-surface ${svgPreviewState === "ready" ? "is-draggable" : ""}`}
                  draggable={svgPreviewState === "ready"}
                  onDragStart={handlePreviewDragStart}
                  title={svgPreviewState === "ready" ? "Drag out as PNG" : undefined}
                >
                  {svgPreviewState === "ready" ? (
                    <div className="svg-preview-stage">
                      <img
                        className="svg-preview-image"
                        src={svgPreviewDataUrl}
                        alt="Rendered Quantikz preview"
                      />
                      <p className="svg-preview-drag-hint">Drag out as PNG</p>
                    </div>
                  ) : (
                    <p className="svg-preview-placeholder">
                      {svgPreviewState === "loading"
                        ? "Rendering preview..."
                        : svgPreviewState === "error"
                          ? svgPreviewError ?? "Unable to render SVG preview."
                          : "Generate or paste Quantikz code to preview the circuit."}
                    </p>
                  )}
                </div>
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
    </div>
  );
}
