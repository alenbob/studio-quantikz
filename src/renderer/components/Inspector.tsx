import { useEffect, useMemo, useState, type FocusEvent } from "react";
import { COLOR_SWATCHES, DEFAULT_ITEM_COLOR, normalizeHexColor } from "../color";
import type { WireLabelSide } from "../wireLabels";
import type {
  CircuitItem,
  ControlState,
  EqualsColumnItem,
  FrameItem,
  GateItem,
  HorizontalSegmentItem,
  SliceItem,
  StructureSelection,
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
  equalsColumn: "Equals column",
  verticalConnector: "Vertical line",
  horizontalSegment: "Horizontal line",
  controlDot: "Control dot",
  targetPlus: "Target plus",
  swapX: "Swap X"
};

interface InspectorProps {
  selectedItem: CircuitItem | null;
  selectedItems: CircuitItem[];
  selectedStructure?: StructureSelection | null;
  selectedColumnHasEquals?: boolean;
  selectedWireLabelGroup?: {
    row: number;
    side: WireLabelSide;
    span: number;
    bracket: WireLabelBracket;
    text: string;
  } | null;
  selectedCount: number;
  qubits: number;
  steps: number;
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
  onHorizontalBundledChange: (itemId: string, bundled: boolean) => void;
  onHorizontalBundleLabelChange: (itemId: string, bundleLabel: string) => void;
  onItemColorChange: (itemId: string, color: string | null) => void;
  onSelectedItemsColorChange: (color: string | null) => void;
  onSelectedGateLabelChange: (label: string) => void;
  onSelectedControlStateChange: (controlState: ControlState) => void;
  onSelectedWireTypeChange: (wireType: WireType) => void;
  onWireLabelChange: (row: number, side: "left" | "right", label: string) => void;
  onWireLabelGroupChange?: (
    row: number,
    side: WireLabelSide,
    updates: { span?: number; bracket?: WireLabelBracket }
  ) => void;
  onWireLabelGroupUnmerge?: (row: number, side: WireLabelSide) => void;
  onInsertStructure?: (selection: StructureSelection, side: "before" | "after") => void;
  onDeleteStructure?: (selection: StructureSelection) => void;
  onConvertColumnToEquals?: (col: number) => void;
  onDelete: () => void;
  onClearSelection?: () => void;
  showWireLabels?: boolean;
  showSelectionControls?: boolean;
  eyebrow?: string;
  heading?: string;
  panelClassName?: string;
}

type BulkSelectionKind = "gate" | "controlDot" | "wire" | null;

function renderVerticalWireTypeOptions(): JSX.Element[] {
  return [
    <option key="quantum" value="quantum">Quantum</option>,
    <option key="classical" value="classical">Classical</option>
  ];
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

function renderEqualsColumnInspector(
  item: EqualsColumnItem,
  qubits: number
): JSX.Element {
  return (
    <dl className="inspector-meta">
      <div>
        <dt>Step</dt>
        <dd>{item.point.col + 1}</dd>
      </div>
      <div>
        <dt>Span</dt>
        <dd>{qubits} wires</dd>
      </div>
    </dl>
  );
}

function renderStructureInspector(
  selection: StructureSelection,
  qubits: number,
  steps: number,
  hasEquals: boolean,
  onInsertStructure: NonNullable<InspectorProps["onInsertStructure"]>,
  onDeleteStructure: NonNullable<InspectorProps["onDeleteStructure"]>,
  onConvertColumnToEquals: NonNullable<InspectorProps["onConvertColumnToEquals"]>
): JSX.Element {
  const isRow = selection.kind === "row";
  const insertBeforeLabel = isRow ? "Add above" : "Add left";
  const insertAfterLabel = isRow ? "Add below" : "Add right";
  const deleteLabel = isRow ? "Delete row" : "Delete column";
  const deleteDisabled = isRow ? qubits <= 1 : steps <= 1;

  return (
    <>
      <dl className="inspector-meta">
        <div>
          <dt>Type</dt>
          <dd>{isRow ? "Row" : "Column"}</dd>
        </div>
        <div>
          <dt>Index</dt>
          <dd>{selection.index + 1}</dd>
        </div>
      </dl>
      <div className="structure-action-grid">
        <button
          type="button"
          className="secondary-button"
          onClick={() => onInsertStructure(selection, "before")}
        >
          {insertBeforeLabel}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onInsertStructure(selection, "after")}
        >
          {insertAfterLabel}
        </button>
      </div>
      {!isRow && (
        <button
          type="button"
          className="secondary-button structure-equals-button"
          disabled={hasEquals}
          onClick={() => onConvertColumnToEquals(selection.index)}
        >
          {hasEquals ? "Already equal" : "Convert to equal"}
        </button>
      )}
      <button
        type="button"
        className="danger-button"
        disabled={deleteDisabled}
        onClick={() => onDeleteStructure(selection)}
      >
        {deleteLabel}
      </button>
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
  _qubits: number,
  _onVerticalLengthChange: InspectorProps["onVerticalLengthChange"],
  onVerticalWireTypeChange: InspectorProps["onVerticalWireTypeChange"]
): JSX.Element {
  return (
    <>
      <label className="inspector-field">
        <span>Wire style</span>
        <select
          aria-label="Vertical wire style"
          value={item.wireType}
          onChange={(event) => onVerticalWireTypeChange(item.id, event.target.value as WireType)}
        >
          {renderVerticalWireTypeOptions()}
        </select>
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
  onHorizontalWireTypeChange: InspectorProps["onHorizontalWireTypeChange"],
  onHorizontalBundledChange: InspectorProps["onHorizontalBundledChange"],
  onHorizontalBundleLabelChange: InspectorProps["onHorizontalBundleLabelChange"]
): JSX.Element {
  return (
    <>
      <div className="inspector-field-row">
        <label className="inspector-field">
          <span>Classical wire</span>
          <input
            aria-label="Classical wire"
            type="checkbox"
            checked={item.wireType === "classical"}
            onChange={(event) => onHorizontalWireTypeChange(item.id, event.target.checked ? "classical" : "quantum")}
          />
        </label>
        <label className="inspector-field">
          <span>Bundle</span>
          <input
            aria-label="Bundle wire"
            type="checkbox"
            checked={item.bundled === true}
            onChange={(event) => onHorizontalBundledChange(item.id, event.target.checked)}
          />
        </label>
      </div>
      <label className="inspector-field">
        <span>Text above line / Math</span>
        <input
          aria-label="Bundle label"
          type="text"
          value={item.bundleLabel ?? ""}
          spellCheck={false}
          placeholder="2N_a"
          onChange={(event) => onHorizontalBundleLabelChange(item.id, event.target.value)}
        />
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
  selectedItems,
  selectedStructure = null,
  selectedColumnHasEquals = false,
  selectedWireLabelGroup = null,
  selectedCount,
  qubits,
  steps,
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
  onHorizontalBundledChange,
  onHorizontalBundleLabelChange,
  onItemColorChange,
  onSelectedItemsColorChange,
  onSelectedGateLabelChange,
  onSelectedControlStateChange,
  onSelectedWireTypeChange,
  onWireLabelChange,
  onWireLabelGroupChange,
  onWireLabelGroupUnmerge,
  onInsertStructure,
  onDeleteStructure,
  onConvertColumnToEquals,
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
  const showingStructureSelection = Boolean(selectedStructure);
  const bulkSelectionKind = useMemo<BulkSelectionKind>(() => {
    if (selectedItems.length <= 1) {
      return null;
    }

    if (selectedItems.every((item) => item.type === "gate")) {
      return "gate";
    }

    if (selectedItems.every((item) => item.type === "controlDot")) {
      return "controlDot";
    }

    if (selectedItems.every((item) => item.type === "horizontalSegment" || item.type === "verticalConnector")) {
      return "wire";
    }

    return null;
  }, [selectedItems]);
  const bulkColor = useMemo(() => {
    if (selectedItems.length === 0) {
      return null;
    }

    const firstColor = selectedItems[0].color ?? null;
    return selectedItems.every((item) => (item.color ?? null) === firstColor) ? firstColor : null;
  }, [selectedItems]);
  const bulkGateLabel = useMemo(() => {
    if (bulkSelectionKind !== "gate") {
      return "";
    }

    const firstLabel = (selectedItems[0] as GateItem).label;
    return selectedItems.every((item) => item.type === "gate" && item.label === firstLabel) ? firstLabel : "";
  }, [bulkSelectionKind, selectedItems]);
  const bulkControlState = useMemo(() => {
    if (bulkSelectionKind !== "controlDot") {
      return "";
    }

    const firstState = (selectedItems[0].type === "controlDot" ? (selectedItems[0].controlState ?? "filled") : "filled");
    return selectedItems.every((item) => item.type === "controlDot" && (item.controlState ?? "filled") === firstState)
      ? firstState
      : "";
  }, [bulkSelectionKind, selectedItems]);
  const bulkWireType = useMemo(() => {
    if (bulkSelectionKind !== "wire") {
      return "";
    }

    const firstType = selectedItems[0].type === "horizontalSegment" || selectedItems[0].type === "verticalConnector"
      ? selectedItems[0].wireType
      : "quantum";
    return selectedItems.every((item) =>
      (item.type === "horizontalSegment" || item.type === "verticalConnector") && item.wireType === firstType
    )
      ? firstType
      : "";
  }, [bulkSelectionKind, selectedItems]);

  useEffect(() => {
    if (selectedItems.length > 1) {
      setHexInput(bulkColor ?? "");
      return;
    }

    setHexInput(selectedItem?.color ?? "");
  }, [bulkColor, selectedItem?.color, selectedItem?.id, selectedItems.length]);

  function applyColor(color: string | null): void {
    if (selectedItems.length > 1) {
      onSelectedItemsColorChange(color);
      return;
    }

    if (!selectedItem) {
      return;
    }

    onItemColorChange(selectedItem.id, color);
  }

  function renderSelectionColorEditor(): JSX.Element | null {
    if (showingWireLabelGroup || showingStructureSelection || (!selectedItem && selectedItems.length === 0)) {
      return null;
    }

    const activeColor = selectedItems.length > 1 ? bulkColor : (selectedItem?.color ?? null);

    return (
      <div className="color-editor">
        <div className="subsection-heading">
          <h3>{selectedItems.length > 1 ? "Selected color" : "Element color"}</h3>
          <p>Choose a swatch or enter a hex code.</p>
        </div>
        <div className="color-swatch-grid" role="list" aria-label="Color swatches">
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className={`color-swatch ${activeColor === color ? "is-active" : ""}`}
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
            className={`secondary-button color-reset-button ${!activeColor ? "is-active" : ""}`}
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
            value={activeColor ?? DEFAULT_ITEM_COLOR}
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
    );
  }

  function renderBulkSelectionInspector(): JSX.Element | null {
    if (selectedItems.length <= 1) {
      return null;
    }

    if (bulkSelectionKind === "gate") {
      return (
        <label className="inspector-field inspector-field-wide">
          <span>Gate label / TeX</span>
          <input
            aria-label="Gate label"
            type="text"
            value={bulkGateLabel}
            spellCheck={false}
            placeholder="\theta_0"
            onChange={(event) => onSelectedGateLabelChange(event.target.value)}
          />
        </label>
      );
    }

    if (bulkSelectionKind === "controlDot") {
      return (
        <label className="inspector-field">
          <span>Control type</span>
          <select
            aria-label="Control type"
            value={bulkControlState}
            onChange={(event) => {
              if (event.target.value === "") {
                return;
              }

              onSelectedControlStateChange(event.target.value as ControlState);
            }}
          >
            <option value="">Mixed</option>
            <option value="filled">Filled (c1)</option>
            <option value="open">Open (c0)</option>
          </select>
        </label>
      );
    }

    if (bulkSelectionKind === "wire") {
      return (
        <label className="inspector-field">
          <span>Wire style</span>
          <select
            aria-label="Horizontal wire style"
            value={bulkWireType}
            onChange={(event) => {
              if (event.target.value === "") {
                return;
              }

              onSelectedWireTypeChange(event.target.value as WireType);
            }}
          >
            <option value="">Mixed</option>
            <option value="quantum">Quantum</option>
            <option value="classical">Classical</option>
          </select>
        </label>
      );
    }

    return null;
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
              Group selection is active.
            </p>
            {renderBulkSelectionInspector()}
            {renderSelectionColorEditor()}
            <button type="button" className="danger-button" onClick={onDelete}>
              Delete selected
            </button>
          </>
        ) : !selectedItem && !selectedWireLabelGroup && !selectedStructure ? (
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
                {selectedStructure
                  ? `${selectedStructure.kind === "row" ? "Row" : "Column"} controls`
                  : selectedWireLabelGroup
                  ? `${selectedWireLabelGroup.side === "left" ? "Left" : "Right"} label`
                  : ITEM_LABELS[selectedItem!.type]}
              </div>
            </div>

            {selectedStructure && onInsertStructure && onDeleteStructure && onConvertColumnToEquals &&
              renderStructureInspector(
                selectedStructure,
                qubits,
                steps,
                selectedColumnHasEquals,
                onInsertStructure,
                onDeleteStructure,
                onConvertColumnToEquals
              )}
            {selectedWireLabelGroup && onWireLabelGroupChange && onWireLabelGroupUnmerge &&
              renderWireLabelGroupInspector(
                selectedWireLabelGroup,
                onWireLabelChange,
                onWireLabelGroupChange,
                onWireLabelGroupUnmerge
              )}
            {!selectedStructure && selectedItem?.type === "gate" &&
              renderGateInspector(selectedItem, onGateLabelChange, onGateSpanChange)}
            {!selectedStructure && selectedItem?.type === "frame" &&
              renderFrameInspector(selectedItem, onFrameLabelChange, onFrameSpanChange, onFrameStyleChange)}
            {!selectedStructure && selectedItem?.type === "slice" &&
              renderSliceInspector(selectedItem, onSliceLabelChange)}
            {!selectedStructure && selectedItem?.type === "equalsColumn" &&
              renderEqualsColumnInspector(selectedItem, qubits)}
            {!selectedStructure && selectedItem?.type === "verticalConnector" &&
              renderVerticalInspector(selectedItem, qubits, onVerticalLengthChange, onVerticalWireTypeChange)}
            {!selectedStructure && selectedItem?.type === "controlDot" &&
              renderControlInspector(selectedItem, onControlStateChange)}
            {!selectedStructure && selectedItem?.type === "horizontalSegment" &&
              renderHorizontalInspector(
                selectedItem,
                onHorizontalWireTypeChange,
                onHorizontalBundledChange,
                onHorizontalBundleLabelChange
              )}
            {!selectedStructure && selectedItem &&
              selectedItem.type !== "gate" &&
              selectedItem.type !== "frame" &&
              selectedItem.type !== "slice" &&
              selectedItem.type !== "equalsColumn" &&
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

            {renderSelectionColorEditor()}

            {showingStructureSelection ? null : showingWireLabelGroup ? (
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
