import { useEffect, useMemo, useReducer, useRef, useState, type FocusEvent } from "react";
import { buildClipboard, canPasteClipboardAt } from "./clipboard";
import { Palette } from "./components/Palette";
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
  const [clipboard, setClipboard] = useState<CircuitClipboard | null>(null);
  const [isPasteMode, setPasteMode] = useState(false);
  const [selectedWireLabel, setSelectedWireLabel] = useState<{ row: number; side: WireLabelSide } | null>(null);
  const stateRef = useRef(state);
  const clipboardRef = useRef<CircuitClipboard | null>(null);
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
    clipboardRef.current = clipboard;
  }, [clipboard]);

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

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
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

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && hasSelection && !isFormElement) {
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

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v" && !isFormElement) {
        if (!clipboardRef.current) {
          return;
        }

        event.preventDefault();
        setPasteMode(true);
        dispatch({ type: "setTool", tool: "select" });
        dispatch({ type: "setMessage", message: "Click on the grid to place the copied group." });
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

  async function handleDownloadSvg(): Promise<void> {
    const desktopApi = window.quantikzDesktop;
    if (!desktopApi?.exportQuantikzSvg) {
      dispatch({ type: "setMessage", message: "SVG export is only available in the desktop app." });
      return;
    }

    dispatch({ type: "convert" });
    const { code, hasErrors } = computeExportResult();
    if (hasErrors || !code) {
      dispatch({ type: "setMessage", message: "Fix validation errors before exporting SVG." });
      return;
    }

    const result = await desktopApi.exportQuantikzSvg(code);
    if (!result.success && !result.error) {
      dispatch({ type: "clearMessage" });
      return;
    }

    dispatch({
      type: "setMessage",
      message: result.success
        ? `SVG exported to ${result.filePath}.`
        : result.error ?? "Failed to export SVG."
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
      dispatch({ type: "setMessage", message: "Copied group does not fit in that area." });
      return;
    }

    dispatch({ type: "pasteClipboard", clipboard, anchor });
    setSelectedWireLabel(null);
    setPasteMode(false);
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="title-block">
          <p className="eyebrow">Quantikz Desktop Editor</p>
          <h1>Visual circuit to Quantikz</h1>
        </div>
        <div className="toolbar-controls">
          <label className="toolbar-field toolbar-stepper">
            <span>Qubits</span>
            <div className="stepper-control">
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
                value={state.qubits}
                onFocus={selectNumericField}
                onChange={(event) => {
                  const value = parsePositiveInteger(event.target.value);
                  if (value === null) {
                    return;
                  }

                  resizeGrid("qubits", value);
                }}
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
          </label>
          <label className="toolbar-field toolbar-stepper">
            <span>Steps</span>
            <div className="stepper-control">
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
                value={state.steps}
                onFocus={selectNumericField}
                onChange={(event) => {
                  const value = parsePositiveInteger(event.target.value);
                  if (value === null) {
                    return;
                  }

                  resizeGrid("steps", value);
                }}
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
          </label>
          <button type="button" className="primary-button" onClick={() => dispatch({ type: "convert" })}>
            Convert to Quantikz
          </button>
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
        </div>
      </header>

      {state.uiMessage && <div className="message-toast">{state.uiMessage}</div>}

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
            onSelectTool={(tool: ToolType) => dispatch({ type: "setTool", tool })}
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
          onSelectionChange={(itemIds) => {
            setSelectedWireLabel(null);
            dispatch({ type: "setSelectedIds", itemIds });
          }}
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
              <button type="button" className="secondary-button" onClick={() => void handleDownloadSvg()}>
                Download SVG
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
