import { useEffect, useMemo, useReducer, useRef, useState, type FocusEvent } from "react";
import { buildClipboard, canPasteClipboardAt } from "./clipboard";
import { Palette } from "./components/Palette";
import { Inspector } from "./components/Inspector";
import { Workspace } from "./components/Workspace";
import { exportToQuantikz } from "./exporter";
import { importFromQuantikz } from "./importer";
import { editorReducer, initialState } from "./reducer";
import { placementFromViewportPoint } from "./placement";
import { validateCircuit } from "./validation";
import type {
  BoardMetrics,
  CircuitClipboard,
  CircuitItem,
  ItemType,
  PlacementTarget,
  ToolType
} from "./types";

interface PaletteDragState {
  tool: ItemType;
  clientX: number;
  clientY: number;
}

async function copyText(text: string): Promise<void> {
  if (window.quantikzDesktop?.copyText) {
    await window.quantikzDesktop.copyText(text);
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

export default function App(): JSX.Element {
  const [state, dispatch] = useReducer(editorReducer, initialState);
  const [paletteDrag, setPaletteDrag] = useState<PaletteDragState | null>(null);
  const [clipboard, setClipboard] = useState<CircuitClipboard | null>(null);
  const [isPasteMode, setPasteMode] = useState(false);
  const [boardMetrics, setBoardMetrics] = useState<BoardMetrics | null>(null);
  const stateRef = useRef(state);
  const clipboardRef = useRef<CircuitClipboard | null>(null);
  const boardMetricsRef = useRef<BoardMetrics | null>(null);

  const selectedItems = useMemo<CircuitItem[]>(
    () => state.items.filter((item) => state.selectedItemIds.includes(item.id)),
    [state.items, state.selectedItemIds]
  );
  const selectedItem = selectedItems.length === 1 ? selectedItems[0] : null;
  const hasSelection = selectedItems.length > 0;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    clipboardRef.current = clipboard;
  }, [clipboard]);

  useEffect(() => {
    boardMetricsRef.current = boardMetrics;
  }, [boardMetrics]);

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
      const hasSelection = state.selectedItemIds.length > 0;
      const isFormElement = isEditableTarget(event.target);

      if ((event.key === "Delete" || event.key === "Backspace") && hasSelection) {
        if (!isFormElement) {
          event.preventDefault();
          dispatch({ type: "deleteSelected" });
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
        dispatch({ type: "setMessage", message: "Selection copied. Press paste and click a destination." });
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
        dispatch({ type: "setTool", tool: "select" });
        dispatch({ type: "clearMessage" });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.selectedItemIds]);

  async function handleCopy(): Promise<void> {
    if (!state.exportCode) {
      dispatch({ type: "setMessage", message: "Generate code before copying it." });
      return;
    }

    await copyText(state.exportCode);
    dispatch({ type: "setMessage", message: "Quantikz code copied to the clipboard." });
  }

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
      setPaletteDrag(null);
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

  function handlePaletteDragStart(tool: ItemType, clientX: number, clientY: number): void {
    setPaletteDrag({ tool, clientX, clientY });
  }

  function handlePaletteDragMove(clientX: number, clientY: number): void {
    setPaletteDrag((current) => (current ? { ...current, clientX, clientY } : current));
  }

  function handlePaletteDragEnd(tool: ItemType, clientX: number, clientY: number): void {
    if (boardMetricsRef.current) {
      const placement = placementFromViewportPoint(
        clientX,
        clientY,
        boardMetricsRef.current,
        tool,
        stateRef.current
      );

      if (placement) {
        dispatch({ type: "addItem", tool, placement });
      }
    }

    setPaletteDrag(null);
  }

  function handleCopySelection(): void {
    const nextClipboard = buildClipboard(state.items.filter((item) => state.selectedItemIds.includes(item.id)));
    if (!nextClipboard) {
      dispatch({ type: "setMessage", message: "Select at least one element to copy." });
      return;
    }

    setClipboard(nextClipboard);
    setPasteMode(false);
    dispatch({ type: "setMessage", message: "Selection copied. Press paste and click a destination." });
  }

  function handlePasteRequest(): void {
    if (!clipboard) {
      dispatch({ type: "setMessage", message: "Copy a selection before pasting it." });
      return;
    }

    setPasteMode(true);
    dispatch({ type: "setTool", tool: "select" });
    dispatch({ type: "setMessage", message: "Click on the grid to place the copied group." });
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
          <label className="toolbar-field">
            <span>Qubits</span>
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

                dispatch({
                  type: "resizeGrid",
                  dimension: "qubits",
                  value
                });
              }}
            />
          </label>
          <label className="toolbar-field">
            <span>Steps</span>
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

                dispatch({
                  type: "resizeGrid",
                  dimension: "steps",
                  value
                });
              }}
            />
          </label>
          <button type="button" className="primary-button" onClick={() => dispatch({ type: "convert" })}>
            Convert to Quantikz
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handleCopySelection}
            disabled={state.selectedItemIds.length === 0}
          >
            Copy selected
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handlePasteRequest}
            disabled={!clipboard}
          >
            Paste
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setPasteMode(false);
              dispatch({ type: "resetCircuit" });
            }}
          >
            Reset
          </button>
        </div>
      </header>

      {state.uiMessage && <div className="message-banner">{state.uiMessage}</div>}

      <main className={`app-body ${hasSelection ? "has-context-sidebar" : ""}`}>
        {hasSelection ? (
          <Inspector
            selectedItem={selectedItem}
            selectedCount={selectedItems.length}
            qubits={state.qubits}
            wireLabels={state.wireLabels}
            onGateLabelChange={(itemId, label) => dispatch({ type: "updateGateLabel", itemId, label })}
            onGateSpanChange={(itemId, rows) => dispatch({ type: "updateGateSpan", itemId, rows })}
            onVerticalLengthChange={(itemId, length) =>
              dispatch({ type: "updateVerticalLength", itemId, length })
            }
            onHorizontalModeChange={(itemId, mode) =>
              dispatch({ type: "updateHorizontalMode", itemId, mode })
            }
            onItemColorChange={(itemId, color) => dispatch({ type: "updateItemColor", itemId, color })}
            onWireLabelChange={(row, side, label) =>
              dispatch({ type: "updateWireLabel", row, side, label })
            }
            onDelete={() => dispatch({ type: "deleteSelected" })}
            onClearSelection={() => dispatch({ type: "setSelectedIds", itemIds: [] })}
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
            onStartDrag={handlePaletteDragStart}
            onDragMove={handlePaletteDragMove}
            onEndDrag={handlePaletteDragEnd}
          />
        )}

        <Workspace
          state={state}
          externalDrag={paletteDrag}
          isPasteMode={isPasteMode}
          pasteClipboard={clipboard}
          onLayoutSpacingChange={(dimension, value) =>
            dispatch({ type: "updateLayoutSpacing", dimension, value })
          }
          onWireLabelChange={(row, side, label) =>
            dispatch({ type: "updateWireLabel", row, side, label })
          }
          onPlaceItem={(tool: ItemType, placement: PlacementTarget) =>
            dispatch({ type: "addItem", tool, placement })
          }
          onPasteAt={handlePastePlacement}
          onMoveItem={(itemId: string, placement: PlacementTarget) =>
            dispatch({ type: "moveItem", itemId, placement })
          }
          onSelectionChange={(itemIds) => dispatch({ type: "setSelectedIds", itemIds })}
          onBoardMetricsChange={setBoardMetrics}
        />

        <div className="right-rail">
          <Inspector
            selectedItem={selectedItem}
            selectedCount={selectedItems.length}
            qubits={state.qubits}
            wireLabels={state.wireLabels}
            onGateLabelChange={(itemId, label) => dispatch({ type: "updateGateLabel", itemId, label })}
            onGateSpanChange={(itemId, rows) => dispatch({ type: "updateGateSpan", itemId, rows })}
            onVerticalLengthChange={(itemId, length) =>
              dispatch({ type: "updateVerticalLength", itemId, length })
            }
            onHorizontalModeChange={(itemId, mode) =>
              dispatch({ type: "updateHorizontalMode", itemId, mode })
            }
            onItemColorChange={(itemId, color) => dispatch({ type: "updateItemColor", itemId, color })}
            onWireLabelChange={(row, side, label) =>
              dispatch({ type: "updateWireLabel", row, side, label })
            }
            onDelete={() => dispatch({ type: "deleteSelected" })}
            showWireLabels
            showSelectionControls={!hasSelection}
            eyebrow={hasSelection ? "Circuit" : "Inspector"}
            heading={hasSelection ? "Wire labels" : "Labels and style"}
          />

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
              <button type="button" className="secondary-button" onClick={() => void handleCopy()}>
                Copy code
              </button>
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
