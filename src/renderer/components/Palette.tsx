import controlDotIcon from "../assets/ctrl.svg";
import swapXIcon from "../assets/cross.svg";
import calygraphicPenIcon from "../assets/calygraphic_pen.svg";
import gateIcon from "../assets/gate.svg";
import annotationIcon from "../assets/mark.svg";
import meterIcon from "../assets/meter.svg";
import selectIcon from "../assets/sel.svg";
import targetPlusIcon from "../assets/targ.svg";
import type { JSX } from "react";
import type { ToolType } from "../types";

const TOOL_LABELS: Array<{
  tool: ToolType;
  label: string;
  shortLabel: string;
  description: string;
  icon: string;
}> = [
  { tool: "select", label: "Select/Move", shortLabel: "Sel", description: "Select and drag existing items.", icon: selectIcon },
  { tool: "pencil", label: "Pencil", shortLabel: "Pen", description: "Paint horizontal or vertical wires.", icon: calygraphicPenIcon },
  { tool: "gate", label: "Gate", shortLabel: "Gate", description: "Place an auto-sized gate box.", icon: gateIcon },
  { tool: "meter", label: "Meter", shortLabel: "Meas", description: "Place a measurement box.", icon: meterIcon },
  { tool: "annotation", label: "Frame/Slice", shortLabel: "Mark", description: "Drag for a frame or click for a slice.", icon: annotationIcon },
  { tool: "controlDot", label: "Control dot", shortLabel: "Ctrl", description: "Place a filled or open control dot.", icon: controlDotIcon },
  { tool: "targetPlus", label: "Target plus", shortLabel: "Targ", description: "Place a target plus sign.", icon: targetPlusIcon },
  { tool: "swapX", label: "Swap X", shortLabel: "Swap", description: "Place a swap endpoint marker.", icon: swapXIcon }
];

interface PaletteProps {
  activeTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
}

function ToolPreview({ icon }: { icon: string }): JSX.Element {
  return <img src={icon} className="palette-preview-svg palette-preview-image" alt="" aria-hidden="true" />;
}

export function Palette({
  activeTool,
  onSelectTool
}: PaletteProps): JSX.Element {
  return (
    <aside className="panel palette-panel" aria-label="Palette">
      <div className="panel-heading">
        <p className="eyebrow">Palette</p>
        <h2>Objects</h2>
      </div>
      <div className="palette-list">
        {TOOL_LABELS.map(({ tool, label, shortLabel, description, icon }) => (
          <button
            key={tool}
            type="button"
            onClick={() => onSelectTool(tool)}
            className={`palette-button ${activeTool === tool ? "is-active" : ""}`}
            aria-pressed={activeTool === tool}
            aria-label={label}
            title={`${label} — ${description}`}
          >
            <span className={`palette-preview palette-preview-${tool}`} aria-hidden="true">
              <ToolPreview icon={icon} />
            </span>
            <span className="palette-label">{shortLabel}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
