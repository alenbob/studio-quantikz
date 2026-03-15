import { useEffect, useState, type FocusEvent } from "react";
import { COLOR_SWATCHES, DEFAULT_ITEM_COLOR, normalizeHexColor } from "../color";
import type { WireLabelSide } from "../wireLabels";
import type {
  CircuitItem,
  ControlState,
  FrameItem,
  GateItem,
  HorizontalSegmentItem,
  SliceItem,
  VerticalConnectorItem,
  WireLabelBracket,
  WireType,
  WireLabel
} from "../types";

const ITEM_LABELS: Record<CircuitItem["type"], string> = {
  gate: "Gate",
  meter: "Meter",
  frame: "Frame",
  slice: "Slice",
  verticalConnector: "Vertical line",
  horizontalSegment: "Horizontal line",
  controlDot: "Control dot",
  targetPlus: "Target plus",
  swapX: "Swap X"
};

interface InspectorProps {
  selectedItem: CircuitItem | null;
  selectedWireLabelGroup?: {
    row: number;
    side: WireLabelSide;
    span: number;
    bracket: WireLabelBracket;
    text: string;
  } | null;
  selectedCount: number;
  qubits: number;
  wireLabels: WireLabel[];
  onGateLabelChange: (itemId: string, label: string) => void;
  onGateSpanChange: (itemId: string, rows: number, cols: number) => void;
  onFrameLabelChange: (itemId: string, label: string) => void;
  onFrameSpanChange: (itemId: string, rows: number, cols: number) => void;
  onFrameStyleChange: (itemId: string, updates: Partial<Pick<FrameItem, "rounded" | "dashed" | "background" | "innerXSepPt">>) => void;
  onSliceLabelChange: (itemId: string, label: string) => void;
  onVerticalLengthChange: (itemId: string, length: number) => void;
  onVerticalWireTypeChange: (itemId: string, wireType: WireType) => void;
  onControlStateChange: (itemId: string, controlState: ControlState) => void;
  onHorizontalModeChange: (itemId: string, mode: HorizontalSegmentItem["mode"]) => void;
  onHorizontalWireTypeChange: (itemId: string, wireType: WireType) => void;
  onItemColorChange: (itemId: string, color: string | null) => void;
  onWireLabelChange: (row: number, side: "left" | "right", label: string) => void;
  onWireLabelGroupChange?: (
    row: number,
    side: WireLabelSide,
    updates: { span?: number; bracket?: WireLabelBracket }
  ) => void;
  onWireLabelGroupUnmerge?: (row: number, side: WireLabelSide) => void;
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
      <div className="inspector-field-row">
        <label className="inspector-field">
          <span>Rows</span>
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

              onGateSpanChange(item.id, value, item.span.cols);
            }}
          />
        </label>
        <label className="inspector-field">
          <span>Cols</span>
          <input
            aria-label="Gate column span"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={item.span.cols}
            onFocus={selectNumericField}
            onChange={(event) => {
              const value = parsePositiveInteger(event.target.value);
              if (value === null) {
                return;
              }

              onGateSpanChange(item.id, item.span.rows, value);
            }}
          />
        </label>
      </div>
      <dl className="inspector-meta">
        <div>
          <dt>Anchor</dt>
          <dd>q{item.point.row + 1}, step {item.point.col + 1}</dd>
        </div>
        <div>
          <dt>Bounds</dt>
          <dd>
            {item.span.rows} rows, {item.span.cols} cols
          </dd>
        </div>
      </dl>
    </>
  );
}

function renderWireLabelGroupInspector(
  selectedWireLabelGroup: NonNullable<InspectorProps["selectedWireLabelGroup"]>,
  onWireLabelChange: InspectorProps["onWireLabelChange"],
  onWireLabelGroupChange: NonNullable<InspectorProps["onWireLabelGroupChange"]>,
  onWireLabelGroupUnmerge: NonNullable<InspectorProps["onWireLabelGroupUnmerge"]>
): JSX.Element {
  return (
    <>
      <label className="inspector-field">
        <span>Label / TeX</span>
        <input
          aria-label={`${selectedWireLabelGroup.side} wire label`}
          type="text"
          value={selectedWireLabelGroup.text}
          spellCheck={false}
          placeholder="\\ket{0}"
          onChange={(event) =>
            onWireLabelChange(selectedWireLabelGroup.row, selectedWireLabelGroup.side, event.target.value)
          }
        />
      </label>
      <div className="inspector-field-row">
        <label className="inspector-field">
          <span>Rows</span>
          <input
            aria-label="Wire label row span"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={selectedWireLabelGroup.span}
            onFocus={selectNumericField}
            onChange={(event) => {
              const value = parsePositiveInteger(event.target.value);
              if (value === null) {
                return;
              }
              onWireLabelGroupChange(selectedWireLabelGroup.row, selectedWireLabelGroup.side, { span: value });
            }}
          />
        </label>
        <label className="inspector-field">
          <span>Bracket</span>
          <select
            aria-label="Wire label bracket"
            value={selectedWireLabelGroup.bracket}
            onChange={(event) =>
              onWireLabelGroupChange(selectedWireLabelGroup.row, selectedWireLabelGroup.side, {
                bracket: event.target.value as WireLabelBracket
              })
            }
          >
            <option value="none">None</option>
            <option value="brace">Brace</option>
            <option value="bracket">Bracket</option>
            <option value="paren">Paren</option>
          </select>
        </label>
      </div>
      <dl className="inspector-meta">
        <div>
          <dt>Side</dt>
          <dd>{selectedWireLabelGroup.side === "left" ? "Left" : "Right"}</dd>
        </div>
        <div>
          <dt>Start</dt>
          <dd>q{selectedWireLabelGroup.row + 1}</dd>
        </div>
      </dl>
      {selectedWireLabelGroup.span > 1 && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => onWireLabelGroupUnmerge(selectedWireLabelGroup.row, selectedWireLabelGroup.side)}
        >
          Unmerge
        </button>
      )}
    </>
  );
}

function renderFrameInspector(
  item: FrameItem,
  onFrameLabelChange: InspectorProps["onFrameLabelChange"],
  onFrameSpanChange: InspectorProps["onFrameSpanChange"],
  onFrameStyleChange: InspectorProps["onFrameStyleChange"]
): JSX.Element {
  return (
    <>
      <label className="inspector-field">
        <span>Frame label / TeX</span>
        <input
          aria-label="Frame label"
          type="text"
          value={item.label}
          spellCheck={false}
          placeholder="Entangle"
          onChange={(event) => onFrameLabelChange(item.id, event.target.value)}
        />
      </label>
      <div className="inspector-field-row">
        <label className="inspector-field">
          <span>Rows</span>
          <input
            aria-label="Frame rows"
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
              onFrameSpanChange(item.id, value, item.span.cols);
            }}
          />
        </label>
        <label className="inspector-field">
          <span>Steps</span>
          <input
            aria-label="Frame steps"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={item.span.cols}
            onFocus={selectNumericField}
            onChange={(event) => {
              const value = parsePositiveInteger(event.target.value);
              if (value === null) {
                return;
              }
              onFrameSpanChange(item.id, item.span.rows, value);
            }}
          />
        </label>
      </div>
      <div className="inspector-checkbox-grid">
        <label className="inspector-checkbox">
          <input
            aria-label="Rounded frame"
            type="checkbox"
            checked={item.rounded}
            onChange={(event) => onFrameStyleChange(item.id, { rounded: event.target.checked })}
          />
          <span>Rounded</span>
        </label>
        <label className="inspector-checkbox">
          <input
            aria-label="Dashed frame"
            type="checkbox"
            checked={item.dashed}
            onChange={(event) => onFrameStyleChange(item.id, { dashed: event.target.checked })}
          />
          <span>Dashed</span>
        </label>
        <label className="inspector-checkbox">
          <input
            aria-label="Background frame"
            type="checkbox"
            checked={item.background}
            onChange={(event) => onFrameStyleChange(item.id, { background: event.target.checked })}
          />
          <span>Behind</span>
        </label>
      </div>
      <label className="inspector-field">
        <span>Inner x sep (pt)</span>
        <input
          aria-label="Frame inner x sep"
          type="text"
          inputMode="decimal"
          value={String(item.innerXSepPt)}
          onFocus={selectNumericField}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (!Number.isFinite(value) || value < 0) {
              return;
            }
            onFrameStyleChange(item.id, { innerXSepPt: value });
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

function renderSliceInspector(
  item: SliceItem,
  onSliceLabelChange: InspectorProps["onSliceLabelChange"]
): JSX.Element {
  return (
    <>
      <label className="inspector-field">
        <span>Slice label / TeX</span>
        <input
          aria-label="Slice label"
          type="text"
          value={item.label}
          spellCheck={false}
          placeholder="prepare"
          onChange={(event) => onSliceLabelChange(item.id, event.target.value)}
        />
      </label>
      <dl className="inspector-meta">
        <div>
          <dt>Column</dt>
          <dd>step {item.point.col + 1}</dd>
        </div>
      </dl>
    </>
  );
}

function renderVerticalInspector(
  item: VerticalConnectorItem,
  qubits: number,
  onVerticalLengthChange: InspectorProps["onVerticalLengthChange"],
  onVerticalWireTypeChange: InspectorProps["onVerticalWireTypeChange"]
): JSX.Element {
  return (
    <>
      <div className="inspector-field-row">
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
        <label className="inspector-field">
          <span>Wire style</span>
          <select
            aria-label="Vertical wire style"
            value={item.wireType}
            onChange={(event) => onVerticalWireTypeChange(item.id, event.target.value as WireType)}
          >
            <option value="quantum">Quantum</option>
            <option value="classical">Classical</option>
          </select>
        </label>
      </div>
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
  onHorizontalModeChange: InspectorProps["onHorizontalModeChange"],
  onHorizontalWireTypeChange: InspectorProps["onHorizontalWireTypeChange"]
): JSX.Element {
  return (
    <>
      <div className="inspector-field-row">
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
        <label className="inspector-field">
          <span>Wire style</span>
          <select
            aria-label="Horizontal wire style"
            value={item.wireType}
            onChange={(event) => onHorizontalWireTypeChange(item.id, event.target.value as WireType)}
          >
            <option value="quantum">Quantum</option>
            <option value="classical">Classical</option>
          </select>
        </label>
      </div>
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

function renderControlInspector(
  item: Extract<CircuitItem, { type: "controlDot" }>,
  onControlStateChange: InspectorProps["onControlStateChange"]
): JSX.Element {
  return (
    <>
      <label className="inspector-field">
        <span>Control type</span>
        <select
          aria-label="Control type"
          value={item.controlState ?? "filled"}
          onChange={(event) => onControlStateChange(item.id, event.target.value as ControlState)}
        >
          <option value="filled">Filled (c1)</option>
          <option value="open">Open (c0)</option>
        </select>
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

export function Inspector({
  selectedItem,
  selectedWireLabelGroup = null,
  selectedCount,
  qubits,
  wireLabels,
  onGateLabelChange,
  onGateSpanChange,
  onFrameLabelChange,
  onFrameSpanChange,
  onFrameStyleChange,
  onSliceLabelChange,
  onVerticalLengthChange,
  onVerticalWireTypeChange,
  onControlStateChange,
  onHorizontalModeChange,
  onHorizontalWireTypeChange,
  onItemColorChange,
  onWireLabelChange,
  onWireLabelGroupChange,
  onWireLabelGroupUnmerge,
  onDelete,
  onClearSelection,
  showWireLabels = true,
  showSelectionControls = true,
  eyebrow = "Inspector",
  heading = "Labels and style",
  panelClassName = ""
}: InspectorProps): JSX.Element {
  const [hexInput, setHexInput] = useState("");
  const showingWireLabelGroup = Boolean(selectedWireLabelGroup);

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
            <div className="selection-header-row">
              {onClearSelection && (
                <button
                  type="button"
                  className="selected-pill selected-pill-action"
                  aria-label="Back to tools"
                  onClick={onClearSelection}
                >
                  ←
                </button>
              )}
              <div className="selected-pill selected-pill-name">{selectedCount} elements</div>
            </div>
            <p className="empty-panel-copy">
              Group selection is active. Use copy/paste to duplicate it or delete to remove the whole group.
            </p>
            <button type="button" className="danger-button" onClick={onDelete}>
              Delete selected
            </button>
          </>
        ) : !selectedItem && !selectedWireLabelGroup ? (
          <p className="empty-panel-copy">
            Select an object to edit its text, span, or color.
          </p>
        ) : (
          <>
            <div className="selection-header-row">
              {onClearSelection && (
                <button
                  type="button"
                  className="selected-pill selected-pill-action"
                  aria-label="Back to tools"
                  onClick={onClearSelection}
                >
                  ←
                </button>
              )}
              <div className="selected-pill selected-pill-name">
                {selectedWireLabelGroup
                  ? `${selectedWireLabelGroup.side === "left" ? "Left" : "Right"} label`
                  : ITEM_LABELS[selectedItem!.type]}
              </div>
            </div>

            {selectedWireLabelGroup && onWireLabelGroupChange && onWireLabelGroupUnmerge &&
              renderWireLabelGroupInspector(
                selectedWireLabelGroup,
                onWireLabelChange,
                onWireLabelGroupChange,
                onWireLabelGroupUnmerge
              )}
            {selectedItem?.type === "gate" &&
              renderGateInspector(selectedItem, onGateLabelChange, onGateSpanChange)}
            {selectedItem?.type === "frame" &&
              renderFrameInspector(selectedItem, onFrameLabelChange, onFrameSpanChange, onFrameStyleChange)}
            {selectedItem?.type === "slice" &&
              renderSliceInspector(selectedItem, onSliceLabelChange)}
            {selectedItem?.type === "verticalConnector" &&
              renderVerticalInspector(selectedItem, qubits, onVerticalLengthChange, onVerticalWireTypeChange)}
            {selectedItem?.type === "controlDot" &&
              renderControlInspector(selectedItem, onControlStateChange)}
            {selectedItem?.type === "horizontalSegment" &&
              renderHorizontalInspector(selectedItem, onHorizontalModeChange, onHorizontalWireTypeChange)}
            {selectedItem &&
              selectedItem.type !== "gate" &&
              selectedItem.type !== "frame" &&
              selectedItem.type !== "slice" &&
              selectedItem.type !== "verticalConnector" &&
              selectedItem.type !== "controlDot" &&
              selectedItem.type !== "horizontalSegment" && (
                <dl className="inspector-meta">
                  <div>
                    <dt>Anchor</dt>
                    <dd>q{selectedItem.point.row + 1}, step {selectedItem.point.col + 1}</dd>
                  </div>
                </dl>
              )}

            {!showingWireLabelGroup && selectedItem && (
            <div className="color-editor">
              <div className="subsection-heading">
                <h3>Element color</h3>
                <p>Choose a swatch or enter a hex code.</p>
              </div>
              <div className="color-swatch-grid" role="list" aria-label="Color swatches">
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
                <button
                  type="button"
                  className={`secondary-button color-reset-button ${!selectedItem.color ? "is-active" : ""}`}
                  onClick={() => {
                    setHexInput("");
                    applyColor(null);
                  }}
                >
                  Default
                </button>
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
            )}

            {showingWireLabelGroup ? (
              <button
                type="button"
                className="danger-button"
                onClick={() => onWireLabelChange(selectedWireLabelGroup.row, selectedWireLabelGroup.side, "")}
              >
                Clear label
              </button>
            ) : (
              <button type="button" className="danger-button" onClick={onDelete}>
                Delete selected
              </button>
            )}
          </>
        ))}
    </section>
  );
}
