import type { ItemType, ToolType } from "../types";

const TOOL_LABELS: Array<{ tool: ToolType; label: string; shortLabel: string; description: string }> = [
  { tool: "select", label: "Select/Move", shortLabel: "Sel", description: "Select and drag existing items." },
  { tool: "gate", label: "Gate", shortLabel: "Gate", description: "Place an auto-sized gate box." },
  { tool: "verticalConnector", label: "Vertical line", shortLabel: "Vert", description: "Connect items on one column." },
  { tool: "horizontalSegment", label: "Horizontal line", shortLabel: "Horiz", description: "Edit a wire segment on a row." },
  { tool: "controlDot", label: "Control dot", shortLabel: "Ctrl", description: "Place a filled control dot." },
  { tool: "targetPlus", label: "Target plus", shortLabel: "Targ", description: "Place a target plus sign." },
  { tool: "swapX", label: "Swap X", shortLabel: "Swap", description: "Place a swap endpoint marker." }
];

interface PaletteProps {
  activeTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
  onStartDrag: (tool: ItemType, clientX: number, clientY: number) => void;
  onDragMove: (clientX: number, clientY: number) => void;
  onEndDrag: (tool: ItemType, clientX: number, clientY: number) => void;
}

function ToolPreview({ tool }: { tool: ToolType }): JSX.Element {
  if (tool === "select") {
    return (
      <svg className="palette-preview-svg" viewBox="0 0 40 40" aria-hidden="true">
        <path
          d="M9 7L23 18L17 19L21 31L16 33L12 22L8 27Z"
          className="palette-preview-fill"
        />
        <path d="M29 10V27M21.5 18.5H36.5" className="palette-preview-stroke palette-preview-soft" />
      </svg>
    );
  }

  if (tool === "gate") {
    return (
      <svg className="palette-preview-svg" viewBox="0 0 40 40" aria-hidden="true">
        <line x1="4" y1="20" x2="11" y2="20" className="palette-preview-wire" />
        <rect x="11" y="11" width="18" height="18" className="palette-preview-box" />
        <text x="20" y="24" textAnchor="middle" className="palette-preview-text">U</text>
        <line x1="29" y1="20" x2="36" y2="20" className="palette-preview-wire" />
      </svg>
    );
  }

  if (tool === "verticalConnector") {
    return (
      <svg className="palette-preview-svg" viewBox="0 0 40 40" aria-hidden="true">
        <line x1="8" y1="12" x2="32" y2="12" className="palette-preview-wire" />
        <line x1="8" y1="28" x2="32" y2="28" className="palette-preview-wire" />
        <line x1="20" y1="12" x2="20" y2="28" className="palette-preview-stroke" />
      </svg>
    );
  }

  if (tool === "horizontalSegment") {
    return (
      <svg className="palette-preview-svg" viewBox="0 0 40 40" aria-hidden="true">
        <line x1="7" y1="20" x2="33" y2="20" className="palette-preview-stroke palette-preview-strong" />
      </svg>
    );
  }

  if (tool === "controlDot") {
    return (
      <svg className="palette-preview-svg" viewBox="0 0 40 40" aria-hidden="true">
        <line x1="7" y1="20" x2="33" y2="20" className="palette-preview-wire" />
        <circle cx="20" cy="20" r="4.8" className="palette-preview-dot" />
      </svg>
    );
  }

  if (tool === "targetPlus") {
    return (
      <svg className="palette-preview-svg" viewBox="0 0 40 40" aria-hidden="true">
        <line x1="7" y1="20" x2="33" y2="20" className="palette-preview-wire" />
        <circle cx="20" cy="20" r="7.2" className="palette-preview-stroke" />
        <line x1="15" y1="20" x2="25" y2="20" className="palette-preview-stroke" />
        <line x1="20" y1="15" x2="20" y2="25" className="palette-preview-stroke" />
      </svg>
    );
  }

  return (
    <svg className="palette-preview-svg" viewBox="0 0 40 40" aria-hidden="true">
      <line x1="7" y1="20" x2="33" y2="20" className="palette-preview-wire" />
      <line x1="15" y1="15" x2="25" y2="25" className="palette-preview-stroke" />
      <line x1="15" y1="25" x2="25" y2="15" className="palette-preview-stroke" />
    </svg>
  );
}

export function Palette({
  activeTool,
  onSelectTool,
  onStartDrag,
  onDragMove,
  onEndDrag
}: PaletteProps): JSX.Element {
  function beginToolDrag(tool: ToolType, clientX: number, clientY: number): void {
    onSelectTool(tool);
    if (tool === "select") {
      return;
    }

    onStartDrag(tool, clientX, clientY);

    const handlePointerMove = (event: PointerEvent) => {
      onDragMove(event.clientX, event.clientY);
    };

    const finishDrag = (event: PointerEvent) => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      onEndDrag(tool, event.clientX, event.clientY);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
  }

  return (
    <aside className="panel palette-panel" aria-label="Palette">
      <div className="panel-heading">
        <p className="eyebrow">Palette</p>
        <h2>Objects</h2>
      </div>
      <div className="palette-list">
        {TOOL_LABELS.map(({ tool, label, shortLabel, description }) => (
          <button
            key={tool}
            type="button"
            onClick={() => onSelectTool(tool)}
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return;
              }

              event.preventDefault();
              beginToolDrag(tool, event.clientX, event.clientY);
            }}
            className={`palette-button ${activeTool === tool ? "is-active" : ""}`}
            aria-pressed={activeTool === tool}
            aria-label={label}
            title={`${label} — ${description}`}
          >
            <span className="palette-preview" aria-hidden="true">
              <ToolPreview tool={tool} />
            </span>
            <span className="palette-label">{shortLabel}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
