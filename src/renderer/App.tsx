import { useEffect, useMemo, useReducer, useRef, useState, type FocusEvent, type JSX } from "react";
import { buildClipboard, canPasteClipboardAt } from "./clipboard";
import cmdIcon from "./assets/cmd.svg";
import { Palette, TOOL_LABELS } from "./components/Palette";
import { Inspector } from "./components/Inspector";
import { Workspace } from "./components/Workspace";
import { exportToQuantikz } from "./exporter";
import { importFromQuantikz } from "./importer";
import { editorReducer, initialState, type EditorAction } from "./reducer";
import { validateCircuit } from "./validation";
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

const TOAST_DURATION_MS = 4000;

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
  { key: "Delete / Backspace", description: "Delete the current selection or wire label." },
  { key: "Escape", description: "Close the shortcuts sheet, leave paste mode, and return to select." }
];

function isUndoableAction(action: EditorAction): boolean {
  return ![
    "setTool",
    "setHorizontalSegmentsUnlocked",
    "setSelectedIds",
    "convert",
    "setExportCode",
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
  const [toastAnimationKey, setToastAnimationKey] = useState(0);
  const [selectedWireLabel, setSelectedWireLabel] = useState<{ row: number; side: WireLabelSide } | null>(null);
  const stateRef = useRef(state);
  const clipboardRef = useRef<CircuitClipboard | null>(null);
  const shortcutSheetOpenRef = useRef(isShortcutSheetOpen);
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

      if (shortcutSheetOpenRef.current) {
        if (event.key === "Escape") {
          event.preventDefault();
          setShortcutSheetOpen(false);
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

      if ((event.metaKey || event.ctrlKey) && normalizedKey === "z") {
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

  function computeExportResult(): { code: string; hasErrors: boolean } {
    const issues = validateCircuit(state);
    const hasErrors = issues.some((entry) => entry.severity === "error");
    return {
      code: hasErrors ? "" : exportToQuantikz(state),
      hasErrors
    };
  }

  function handleDownloadTex(): void {
    dispatch({ type: "convert" });
    const { code, hasErrors } = computeExportResult();
    if (hasErrors || !code) {
      dispatch({ type: "setMessage", message: "Fix validation errors before downloading the Quantikz file." });
      return;
    }

    const blob = new Blob([code], { type: "text/x-tex;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "quantikz-circuit.tex";
    link.click();
    URL.revokeObjectURL(objectUrl);

    dispatch({
      type: "setMessage",
      message: "Downloaded quantikz-circuit.tex."
    });
  }

  function handleLoadFromCode(): void {
    try {
      const imported = importFromQuantikz(state.exportCode);
      setPasteMode(false);
      setSelectedWireLabel(null);
      dispatch({ type: "loadQuantikz", imported, code: state.exportCode });
    } catch (error) {
      dispatch({
        type: "setMessage",
        message: error instanceof Error ? error.message : "Failed to parse Quantikz code."
      });
    }
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

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="title-block">
          <p className="eyebrow">Quantikz Studio</p>
          <div className="title-row">
            <h1>Circuit drawer</h1>
            <button
              type="button"
              className="shortcut-launcher"
              aria-label="Show keyboard shortcuts"
              title="Show keyboard shortcuts"
              onClick={() => setShortcutSheetOpen(true)}
            >
              <span className="shortcut-chip" aria-hidden="true">Cmd</span>
              <img src={cmdIcon} alt="" className="shortcut-help-icon" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="toolbar-controls">
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
          <button
            type="button"
            className="secondary-button"
            aria-pressed={state.autoWireNewGrid}
            onClick={() =>
              dispatch({
                type: "setAutoWireNewGrid",
                enabled: !state.autoWireNewGrid
              })
            }
          >
            {state.autoWireNewGrid ? "Auto wires" : "No auto wires"}
          </button>
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
            onClick={() => dispatch({ type: "convert" })}
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

      <main className={`app-body ${hasSelection ? "has-context-sidebar" : ""}`}>
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
            <textarea
              aria-label="Quantikz output"
              className="code-output"
              spellCheck={false}
              value={state.exportCode}
              placeholder="Press “Convert to Quantikz” to generate code, or paste Quantikz here."
              onChange={(event) => dispatch({ type: "setExportCode", code: event.target.value })}
            />
            <div className="export-actions">
              <button type="button" className="secondary-button" onClick={handleLoadFromCode}>
                Convert to visual
              </button>
              <button type="button" className="secondary-button" onClick={handleDownloadTex}>
                Download .tex
              </button>
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
