import { useEffect, useState, type FocusEvent } from "react";
import { COLOR_SWATCHES, DEFAULT_ITEM_COLOR, normalizeHexColor } from "../color";
import type {
  CircuitItem,
  GateItem,
  HorizontalSegmentItem,
  VerticalConnectorItem,
  WireLabel
} from "../types";

const ITEM_LABELS: Record<CircuitItem["type"], string> = {
  gate: "Gate",
  meter: "Meter",
  verticalConnector: "Vertical line",
  horizontalSegment: "Horizontal line",
  controlDot: "Control dot",
  targetPlus: "Target plus",
  swapX: "Swap X"
};

interface InspectorProps {
  selectedItem: CircuitItem | null;
  selectedCount: number;
  qubits: number;
  wireLabels: WireLabel[];
  onGateLabelChange: (itemId: string, label: string) => void;
  onGateSpanChange: (itemId: string, rows: number) => void;
  onVerticalLengthChange: (itemId: string, length: number) => void;
  onHorizontalModeChange: (itemId: string, mode: HorizontalSegmentItem["mode"]) => void;
  onItemColorChange: (itemId: string, color: string | null) => void;
  onWireLabelChange: (row: number, side: "left" | "right", label: string) => void;
  onDelete: () => void;
  onClearSelection?: () => void;
  showWireLabels?: boolean;
  showSelectionControls?: boolean;
  eyebrow?: string;
  heading?: string;
  panelClassName?: string;
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

function renderGateInspector(
  item: GateItem,
  qubits: number,
  onGateLabelChange: InspectorProps["onGateLabelChange"],
  onGateSpanChange: InspectorProps["onGateSpanChange"]
): JSX.Element {
  return (
    <>
      <label className="inspector-field">
        <span>Gate label / TeX</span>
        <input
          aria-label="Gate label"
          type="text"
          value={item.label}
          spellCheck={false}
          placeholder="\\theta_0"
          onChange={(event) => onGateLabelChange(item.id, event.target.value)}
        />
      </label>
      <label className="inspector-field">
        <span>Gate row span</span>
        <input
          aria-label="Gate row span"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={item.span.rows}
          onFocus={selectNumericField}
          onChange={(event) => {
            const value = parsePositiveInteger(event.target.value);
            if (value === null) {
              return;
            }

            onGateSpanChange(item.id, value);
          }}
        />
      </label>
      <dl className="inspector-meta">
        <div>
          <dt>Anchor</dt>
          <dd>q{item.point.row + 1}, step {item.point.col + 1}</dd>
        </div>
      </dl>
    </>
  );
}

function renderVerticalInspector(
  item: VerticalConnectorItem,
  qubits: number,
  onVerticalLengthChange: InspectorProps["onVerticalLengthChange"]
): JSX.Element {
  return (
    <>
      <label className="inspector-field">
        <span>Line length</span>
        <input
          aria-label="Line length"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={item.length}
          onFocus={selectNumericField}
          onChange={(event) => {
            const value = parsePositiveInteger(event.target.value);
            if (value === null) {
              return;
            }

            onVerticalLengthChange(item.id, value);
          }}
        />
      </label>
      <dl className="inspector-meta">
        <div>
          <dt>Orientation</dt>
          <dd>Vertical</dd>
        </div>
        <div>
          <dt>Anchor</dt>
          <dd>q{item.point.row + 1}, step {item.point.col + 1}</dd>
        </div>
      </dl>
    </>
  );
}

function renderHorizontalInspector(
  item: HorizontalSegmentItem,
  onHorizontalModeChange: InspectorProps["onHorizontalModeChange"]
): JSX.Element {
  return (
    <>
      <label className="inspector-field">
        <span>Segment mode</span>
        <select
          aria-label="Segment mode"
          value={item.mode}
          onChange={(event) =>
            onHorizontalModeChange(item.id, event.target.value as HorizontalSegmentItem["mode"])
          }
        >
          <option value="absent">Absent</option>
          <option value="present">Present</option>
        </select>
      </label>
      <dl className="inspector-meta">
        <div>
          <dt>Orientation</dt>
          <dd>Horizontal</dd>
        </div>
        <div>
          <dt>Segment</dt>
          <dd>q{item.point.row + 1}, slot {item.point.col + 1}</dd>
        </div>
      </dl>
    </>
  );
}

export function Inspector({
  selectedItem,
  selectedCount,
  qubits,
  wireLabels,
  onGateLabelChange,
  onGateSpanChange,
  onVerticalLengthChange,
  onHorizontalModeChange,
  onItemColorChange,
  onWireLabelChange,
  onDelete,
  onClearSelection,
  showWireLabels = true,
  showSelectionControls = true,
  eyebrow = "Inspector",
  heading = "Labels and style",
  panelClassName = ""
}: InspectorProps): JSX.Element {
  const [hexInput, setHexInput] = useState("");

  useEffect(() => {
    setHexInput(selectedItem?.color ?? "");
  }, [selectedItem?.id, selectedItem?.color]);

  function applyColor(color: string | null): void {
    if (!selectedItem) {
      return;
    }

    onItemColorChange(selectedItem.id, color);
  }

  const sectionDivider = showWireLabels && showSelectionControls;
  const resolvedPanelClassName = ["panel", "inspector-panel", panelClassName].filter(Boolean).join(" ");

  return (
    <section className={resolvedPanelClassName} aria-label="Inspector">
      <div className="panel-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{heading}</h2>
      </div>

      {showWireLabels && (
        <div className="wire-label-editor">
          <div className="subsection-heading">
            <h3>Wire labels</h3>
            <p>Set left and right labels for each qubit row.</p>
          </div>
          <div className="wire-label-list">
            {wireLabels.map((labels, row) => (
              <div key={`wire-label-${row}`} className="wire-label-row">
                <span className="wire-label-name">q{row + 1}</span>
                <input
                  aria-label={`Left label q${row + 1}`}
                  type="text"
                  spellCheck={false}
                  placeholder="\\ket{0}"
                  value={labels.left}
                  onChange={(event) => onWireLabelChange(row, "left", event.target.value)}
                />
                <input
                  aria-label={`Right label q${row + 1}`}
                  type="text"
                  spellCheck={false}
                  placeholder="\\ket{+}"
                  value={labels.right}
                  onChange={(event) => onWireLabelChange(row, "right", event.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {sectionDivider && <div className="inspector-divider" />}

      {showSelectionControls &&
        (selectedCount > 1 ? (
          <>
            <div className="selected-pill">{selectedCount} elements</div>
            <p className="empty-panel-copy">
              Group selection is active. Use copy/paste to duplicate it or delete to remove the whole group.
            </p>
            {onClearSelection && (
              <button type="button" className="secondary-button inspector-action-button" onClick={onClearSelection}>
                Back to tools
              </button>
            )}
            <button type="button" className="danger-button" onClick={onDelete}>
              Delete selected
            </button>
          </>
        ) : !selectedItem ? (
          <p className="empty-panel-copy">
            Select an object to edit its text, span, or color.
          </p>
        ) : (
          <>
            <div className="selected-pill">{ITEM_LABELS[selectedItem.type]}</div>

            {onClearSelection && (
              <button type="button" className="secondary-button inspector-action-button" onClick={onClearSelection}>
                Back to tools
              </button>
            )}

            {selectedItem.type === "gate" &&
              renderGateInspector(selectedItem, qubits, onGateLabelChange, onGateSpanChange)}
            {selectedItem.type === "verticalConnector" &&
              renderVerticalInspector(selectedItem, qubits, onVerticalLengthChange)}
            {selectedItem.type === "horizontalSegment" &&
              renderHorizontalInspector(selectedItem, onHorizontalModeChange)}
            {selectedItem.type !== "gate" &&
              selectedItem.type !== "verticalConnector" &&
              selectedItem.type !== "horizontalSegment" && (
                <dl className="inspector-meta">
                  <div>
                    <dt>Anchor</dt>
                    <dd>q{selectedItem.point.row + 1}, step {selectedItem.point.col + 1}</dd>
                  </div>
                </dl>
              )}

            <div className="color-editor">
              <div className="subsection-heading">
                <h3>Element color</h3>
                <p>Choose a swatch or enter a hex code.</p>
              </div>
              <div className="color-swatch-grid" role="list" aria-label="Color swatches">
                <button
                  type="button"
                  className={`color-swatch color-swatch-default ${!selectedItem.color ? "is-active" : ""}`}
                  onClick={() => {
                    setHexInput("");
                    applyColor(null);
                  }}
                >
                  Default
                </button>
                {COLOR_SWATCHES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-swatch ${selectedItem.color === color ? "is-active" : ""}`}
                    style={{ backgroundColor: color }}
                    aria-label={`Set color ${color}`}
                    onClick={() => {
                      setHexInput(color);
                      applyColor(color);
                    }}
                  />
                ))}
              </div>
              <div className="color-input-row">
                <input
                  aria-label="Element color picker"
                  className="native-color-input"
                  type="color"
                  value={selectedItem.color ?? DEFAULT_ITEM_COLOR}
                  onChange={(event) => {
                    setHexInput(event.target.value.toUpperCase());
                    applyColor(event.target.value);
                  }}
                />
                <input
                  aria-label="Element color hex"
                  type="text"
                  spellCheck={false}
                  placeholder="#C85D2D"
                  value={hexInput}
                  onChange={(event) => {
                    const nextValue = event.target.value.toUpperCase();
                    setHexInput(nextValue);
                    const normalized = normalizeHexColor(nextValue);
                    if (normalized || nextValue === "") {
                      applyColor(normalized);
                    }
                  }}
                  onBlur={() => {
                    const normalized = normalizeHexColor(hexInput);
                    setHexInput(normalized ?? "");
                    if (hexInput === "") {
                      applyColor(null);
                    }
                  }}
                />
              </div>
            </div>

            <button type="button" className="danger-button" onClick={onDelete}>
              Delete selected
            </button>
          </>
        ))}
    </section>
  );
}
