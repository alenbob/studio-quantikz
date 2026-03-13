import type {
  CircuitItem,
  ControlDotItem,
  EditorState,
  FrameItem,
  GateItem,
  HorizontalSegmentItem,
  MeterItem,
  SliceItem,
  SwapXItem,
  TargetPlusItem,
  VerticalConnectorItem,
  WireType
} from "./types";
import { mixHexWithWhite, toTikzRgb } from "./color";
import {
  formatGateLabelForQuantikz,
  formatLabelForQuantikz,
  isLikelyTexMath,
  stripMathDelimiters
} from "./tex";
import { getWireLabelBracket, getWireLabelSpan, isWireLabelGroupStart, type WireLabelSide } from "./wireLabels";

function itemKey(item: CircuitItem): string {
  return item.id;
}

function wireKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function rangeForConnector(item: Pick<VerticalConnectorItem, "point" | "length">): [number, number] {
  return [item.point.row, item.point.row + item.length];
}

interface NormalizedConnectorGroup {
  point: { row: number; col: number };
  length: number;
  wireType: WireType;
  color: string | null;
  members: VerticalConnectorItem[];
}

function isConsecutive(rows: number[]): boolean {
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index] !== rows[index - 1] + 1) {
      return false;
    }
  }

  return true;
}

function buildMatrix(qubits: number, steps: number): string[][][] {
  return Array.from({ length: qubits }, () =>
    Array.from({ length: steps }, () => [] as string[])
  );
}

function wrapOptionBlock(options: string[]): string {
  return options.filter(Boolean).join(",");
}

function controlStateFor(item: ControlDotItem): "filled" | "open" {
  return item.controlState ?? "filled";
}

function toQuantikzWireType(wireType: WireType): "q" | "c" {
  return wireType === "classical" ? "c" : "q";
}

function isHorizontalSegmentAbsent(item: HorizontalSegmentItem): boolean {
  return item.mode === "absent" || item.autoSuppressed === true;
}

function horizontalSegmentNeedsCommand(item: HorizontalSegmentItem): boolean {
  if (isHorizontalSegmentAbsent(item)) {
    return true;
  }

  return item.wireType !== "quantum" || Boolean(wireStyleOption(item.color));
}

function gateStyleOptions(color?: string | null, minimumWidthCm?: number | null): string {
  const options: string[] = [];
  const styleParts: string[] = [];

  if (color) {
    const tikzColor = toTikzRgb(color);
    const fillColor = toTikzRgb(mixHexWithWhite(color, 0.9));
    styleParts.push(`draw=${tikzColor}`, `text=${tikzColor}`, `fill=${fillColor}`);
    options.push(`label style={text=${tikzColor}}`);
  }

  if (minimumWidthCm && minimumWidthCm > 0) {
    styleParts.push(`minimum width=${formatSpacingCm(minimumWidthCm)}`);
  }

  if (styleParts.length > 0) {
    options.unshift(`style={${styleParts.join(",")}}`);
  }

  return wrapOptionBlock(options);
}

function labelColorOption(color?: string | null): string {
  return color ? `label style={text=${toTikzRgb(color)}}` : "";
}

function frameStyleOptions(frame: FrameItem): string {
  const styleParts: string[] = [];

  if (frame.rounded) {
    styleParts.push("rounded corners");
  }
  if (frame.dashed) {
    styleParts.push("dashed");
  }
  if (frame.innerXSepPt > 0) {
    styleParts.push(`inner xsep=${frame.innerXSepPt}pt`);
  }
  if (frame.color) {
    styleParts.push(`draw=${toTikzRgb(frame.color)}`);
  }

  const options = [
    `${frame.span.rows}`,
    `steps=${frame.span.cols}`,
    styleParts.length > 0 ? `style={${styleParts.join(",")}}` : "",
    frame.background ? "background" : "",
    labelColorOption(frame.color)
  ];

  return wrapOptionBlock(options);
}

function sliceOptions(slice: SliceItem): string {
  const styleParts: string[] = [];
  const options: string[] = [];

  if (slice.color) {
    styleParts.push(`draw=${toTikzRgb(slice.color)}`);
  }
  if (styleParts.length > 0) {
    options.push(`style={${styleParts.join(",")}}`);
  }
  if (slice.color) {
    options.push(labelColorOption(slice.color));
  }

  return wrapOptionBlock(options);
}

function meterStyleOptions(color?: string | null): string {
  const styleParts: string[] = [];

  if (color) {
    const tikzColor = toTikzRgb(color);
    const fillColor = toTikzRgb(mixHexWithWhite(color, 0.9));
    styleParts.push(`draw=${tikzColor}`, `text=${tikzColor}`, `fill=${fillColor}`);
  }

  if (styleParts.length === 0) {
    return "";
  }

  return `style={${styleParts.join(",")}}`;
}

function commandColorOptions(
  color?: string | null,
  options: { fill?: "solid" | "open"; wire?: boolean } = {}
): string {
  if (!color) {
    return "";
  }

  const tikzColor = toTikzRgb(color);
  const fillPart =
    options.fill === "solid"
      ? `,fill=${tikzColor}`
      : options.fill === "open"
        ? ",fill=white"
        : "";
  const parts = [`style={draw=${tikzColor}${fillPart}}`];

  if (options.wire) {
    parts.push(`wire style={draw=${tikzColor}}`);
  }

  return wrapOptionBlock(parts);
}

function wireStyleOption(color?: string | null): string {
  return color ? `draw=${toTikzRgb(color)}` : "";
}

function appendConnectorWireOption(options: string[], wireType: WireType): void {
  if (wireType === "classical") {
    options.push("vertical wire=c");
  }
}

function normalizeConnectors(connectors: VerticalConnectorItem[]): NormalizedConnectorGroup[] {
  const byColumn = new Map<number, VerticalConnectorItem[]>();

  for (const connector of connectors) {
    const bucket = byColumn.get(connector.point.col) ?? [];
    bucket.push(connector);
    byColumn.set(connector.point.col, bucket);
  }

  const normalized: NormalizedConnectorGroup[] = [];

  for (const [col, columnConnectors] of byColumn.entries()) {
    const sorted = [...columnConnectors].sort((left, right) =>
      left.point.row - right.point.row || left.length - right.length
    );

    let active: NormalizedConnectorGroup | null = null;

    for (const connector of sorted) {
      const [start, end] = rangeForConnector(connector);

      if (!active) {
        active = {
          point: { row: start, col },
          length: end - start,
          wireType: connector.wireType,
          color: connector.color ?? null,
          members: [connector]
        };
        continue;
      }

      const activeEnd = active.point.row + active.length;
      if (start <= activeEnd) {
        active = {
          point: active.point,
          length: Math.max(activeEnd, end) - active.point.row,
          wireType: active.wireType === "classical" || connector.wireType === "classical"
            ? "classical"
            : "quantum",
          color: active.color ?? connector.color ?? null,
          members: [...active.members, connector]
        };
        continue;
      }

      normalized.push(active);
      active = {
        point: { row: start, col },
        length: end - start,
        wireType: connector.wireType,
        color: connector.color ?? null,
        members: [connector]
      };
    }

    if (active) {
      normalized.push(active);
    }
  }

  return normalized;
}

function formatSpacingCm(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return `${rounded.toFixed(1)}cm`;
  }

  return `${rounded.toString().replace(/0+$/, "").replace(/\.$/, "")}cm`;
}

function meterSpanRows(meter: MeterItem): number {
  return meter.span?.rows ?? 1;
}

function bracketDelimiter(side: WireLabelSide, bracket: "bracket" | "paren"): string {
  if (bracket === "bracket") {
    return side === "left" ? "]" : "[";
  }

  return side === "left" ? ")" : "(";
}

function labelPhantom(span: number): string {
  if (span <= 1) {
    return "";
  }

  const rows = Array.from({ length: span }, () => ".").join("\\\\");
  return `\\vphantom{\\begin{matrix}${rows}\\end{matrix}}`;
}

function labelMathBody(label: string): string {
  const formatted = formatLabelForQuantikz(label);
  if (!formatted) {
    return "";
  }

  if (formatted.startsWith("$") && formatted.endsWith("$")) {
    return stripMathDelimiters(formatted);
  }

  if (isLikelyTexMath(label)) {
    return stripMathDelimiters(label);
  }

  return `\\text{${formatted}}`;
}

function decorateMergedLabel(label: string, side: WireLabelSide, span: number, bracket: "bracket" | "paren"): string {
  const body = labelMathBody(label);
  const phantom = labelPhantom(span);
  const delimiter = bracketDelimiter(side, bracket);

  if (side === "left") {
    return `$${body}${body ? "\\," : ""}\\left.${phantom}\\right${delimiter}$`;
  }

  return `$\\left${delimiter}${phantom}\\right.${body ? "\\," : ""}${body}$`;
}

export function exportToQuantikz(state: EditorState): string {
  const gates = state.items.filter((item): item is GateItem => item.type === "gate");
  const meters = state.items.filter((item): item is MeterItem => item.type === "meter");
  const frames = state.items.filter((item): item is FrameItem => item.type === "frame");
  const slices = state.items.filter((item): item is SliceItem => item.type === "slice");
  const gateLikes = [...gates, ...meters];
  const controls = state.items.filter((item): item is ControlDotItem => item.type === "controlDot");
  const targets = state.items.filter((item): item is TargetPlusItem => item.type === "targetPlus");
  const swaps = state.items.filter((item): item is SwapXItem => item.type === "swapX");
  const horizontals = state.items.filter(
    (item): item is HorizontalSegmentItem => item.type === "horizontalSegment"
  );
  const connectors = state.items.filter(
    (item): item is VerticalConnectorItem => item.type === "verticalConnector"
  );
  const normalizedConnectors = normalizeConnectors(connectors);

  const maxCellCol = state.items.reduce((maxCol, item) => {
    if (item.type === "horizontalSegment") {
      return maxCol;
    }
    if (item.type === "gate") {
      return Math.max(maxCol, item.point.col + item.span.cols - 1);
    }
    return Math.max(maxCol, item.point.col);
  }, 0);

  const maxHorizontalCommandCol = horizontals.reduce((maxCol, item) => {
    if (!horizontalSegmentNeedsCommand(item)) {
      return maxCol;
    }

    return Math.max(maxCol, item.point.col);
  }, -1);

  const effectiveSteps = Math.max(state.steps, maxCellCol + 1, maxHorizontalCommandCol + 1, 1);
  const cells = buildMatrix(state.qubits, effectiveSteps);
  const used = new Set<string>();
  const suppressedCells = new Set<string>();

  for (const gate of gates) {
    const formattedLabel = formatGateLabelForQuantikz(gate.label);
    const minimumWidthCm = gate.span.cols > 1 ? gate.span.cols * state.layout.columnSepCm : null;
    const styleOptions = gateStyleOptions(gate.color, minimumWidthCm);
    const options: string[] = [];
    if (gate.span.rows > 1) {
      options.push(`wires=${gate.span.rows}`);
    }
    if (styleOptions) {
      options.push(styleOptions);
    }
    const optionBlock = wrapOptionBlock(options);
    const command = optionBlock
      ? `\\gate[${optionBlock}]{${formattedLabel}}`
      : `\\gate{${formattedLabel}}`;
    cells[gate.point.row][gate.point.col].push(command);

    for (let row = gate.point.row; row < gate.point.row + gate.span.rows; row += 1) {
      for (let col = gate.point.col; col < gate.point.col + gate.span.cols; col += 1) {
        if (row === gate.point.row && col === gate.point.col) {
          continue;
        }
        suppressedCells.add(wireKey(row, col));
      }
    }
  }

  for (const meter of meters) {
    const options: string[] = [];
    const rows = meterSpanRows(meter);
    if (rows > 1) {
      options.push(`wires=${rows}`);
    }
    const styleBlock = meterStyleOptions(meter.color);
    if (styleBlock) {
      options.push(styleBlock);
    }
    const optionBlock = wrapOptionBlock(options);
    cells[meter.point.row][meter.point.col].push(
      optionBlock ? `\\meter[${optionBlock}]{}`
        : "\\meter{}"
    );

    for (let row = meter.point.row + 1; row < meter.point.row + rows; row += 1) {
      suppressedCells.add(wireKey(row, meter.point.col));
    }
  }

  for (const frame of frames) {
    const formattedLabel = formatGateLabelForQuantikz(frame.label);
    const optionBlock = frameStyleOptions(frame);
    cells[frame.point.row][frame.point.col].push(`\\gategroup[${optionBlock}]{${formattedLabel}}`);
  }

  for (const slice of slices) {
    const formattedLabel = formatGateLabelForQuantikz(slice.label);
    const options = sliceOptions(slice);
    cells[slice.point.row][slice.point.col].push(
      options ? `\\slice[${options}]{${formattedLabel}}` : `\\slice{${formattedLabel}}`
    );
  }

  for (const connector of normalizedConnectors) {
    const [start, end] = rangeForConnector(connector);
    const column = connector.point.col;
    const connectorControls = controls
      .filter((item) => item.point.col === column)
      .filter((item) => item.point.row >= start && item.point.row <= end)
      .sort((left, right) => left.point.row - right.point.row);

    const connectorTargets = targets
      .filter((item) => item.point.col === column)
      .filter((item) => item.point.row >= start && item.point.row <= end);

    const connectorSwaps = swaps
      .filter((item) => item.point.col === column)
      .filter((item) => item.point.row === start || item.point.row === end)
      .sort((left, right) => left.point.row - right.point.row);

    const connectorGateTargets = gateLikes.filter(
      (gate) => gate.point.col === column && gate.point.row >= start && gate.point.row <= end
    ).sort((left, right) => left.point.row - right.point.row);

    if (connectorSwaps.length === 2) {
      const swapStartOptionParts: string[] = [];
      const swapStartStyle = commandColorOptions(connectorSwaps[0].color ?? connector.color, { wire: true });
      if (swapStartStyle) {
        swapStartOptionParts.push(swapStartStyle);
      }
      appendConnectorWireOption(swapStartOptionParts, connector.wireType);
      const swapEndOptions = commandColorOptions(connectorSwaps[1].color ?? connector.color);
      cells[start][column].push(
        swapStartOptionParts.length > 0
          ? `\\swap[${wrapOptionBlock(swapStartOptionParts)}]{${end - start}}`
          : `\\swap{${end - start}}`
      );
      cells[end][column].push(swapEndOptions ? `\\targX[${swapEndOptions}]{}`
        : "\\targX{}");
      connector.members.forEach((member) => used.add(itemKey(member)));
      used.add(itemKey(connectorSwaps[0]));
      used.add(itemKey(connectorSwaps[1]));
      continue;
    }

    const targetRows = [...new Set([
      ...connectorTargets.map((item) => item.point.row),
      ...(connectorControls.length > 0 ? connectorGateTargets.map((item) => item.point.row) : [])
    ])].sort((left, right) => left - right);

    if (connectorControls.length > 0 && targetRows.length > 0) {
      for (const control of connectorControls) {
        const controlOptionParts: string[] = [];
        const controlStyle = commandColorOptions(control.color ?? connector.color, {
          fill: controlStateFor(control) === "open" ? "open" : "solid",
          wire: true
        });
        if (controlStyle) {
          controlOptionParts.push(controlStyle);
        }
        appendConnectorWireOption(controlOptionParts, connector.wireType);
        const controlCommand = controlStateFor(control) === "open" ? "\\octrl" : "\\ctrl";
        for (const targetRow of targetRows) {
          if (targetRow === control.point.row) {
            continue;
          }
          cells[control.point.row][column].push(
            controlOptionParts.length > 0
              ? `${controlCommand}[${wrapOptionBlock(controlOptionParts)}]{${targetRow - control.point.row}}`
              : `${controlCommand}{${targetRow - control.point.row}}`
          );
        }
        used.add(itemKey(control));
      }

      for (const target of connectorTargets) {
        const targetOptions = commandColorOptions(target.color ?? connector.color);
        cells[target.point.row][column].push(targetOptions ? `\\targ[${targetOptions}]{}`
          : "\\targ{}");
        used.add(itemKey(target));
      }

      connector.members.forEach((member) => used.add(itemKey(member)));
      continue;
    }

    const controlRows = connectorControls.map((item) => item.point.row);
    if (
      connectorControls.length > 0 &&
      connectorControls.length === connector.length &&
      controlRows[0] === start &&
      isConsecutive(controlRows)
    ) {
      for (const control of connectorControls) {
        const controlOptionParts: string[] = [];
        const controlStyle = commandColorOptions(control.color ?? connector.color, {
          fill: controlStateFor(control) === "open" ? "open" : "solid",
          wire: true
        });
        if (controlStyle) {
          controlOptionParts.push(controlStyle);
        }
        appendConnectorWireOption(controlOptionParts, connector.wireType);
        const controlCommand = controlStateFor(control) === "open" ? "\\octrl" : "\\ctrl";
        cells[control.point.row][column].push(
          controlOptionParts.length > 0
            ? `${controlCommand}[${wrapOptionBlock(controlOptionParts)}]{1}`
            : `${controlCommand}{1}`
        );
        used.add(itemKey(control));
      }
      connector.members.forEach((member) => used.add(itemKey(member)));
      continue;
    }

    const fallbackWireOptions = wireStyleOption(connector.color);
    cells[start][column].push(
      fallbackWireOptions
        ? `\\wire[d][${connector.length}][${fallbackWireOptions}]{${toQuantikzWireType(connector.wireType)}}`
        : `\\wire[d][${connector.length}]{${toQuantikzWireType(connector.wireType)}}`
    );
    connector.members.forEach((member) => used.add(itemKey(member)));
  }

  for (const control of controls) {
    if (!used.has(itemKey(control))) {
      const controlOptions = commandColorOptions(control.color, {
        fill: controlStateFor(control) === "open" ? "open" : "solid"
      });
      const controlCommand = controlStateFor(control) === "open" ? "\\ocontrol" : "\\control";
      cells[control.point.row][control.point.col].push(
        controlOptions ? `${controlCommand}[${controlOptions}]{}`
          : `${controlCommand}{}`
      );
    }
  }

  for (const target of targets) {
    if (!used.has(itemKey(target))) {
      const targetOptions = commandColorOptions(target.color);
      cells[target.point.row][target.point.col].push(
        targetOptions ? `\\targ[${targetOptions}]{}`
          : "\\targ{}"
      );
    }
  }

  for (const swap of swaps) {
    if (!used.has(itemKey(swap))) {
      const swapOptions = commandColorOptions(swap.color);
      cells[swap.point.row][swap.point.col].push(
        swapOptions ? `\\targX[${swapOptions}]{}`
          : "\\targX{}"
      );
    }
  }

  for (const horizontal of horizontals) {
    if (!horizontalSegmentNeedsCommand(horizontal)) {
      continue;
    }

    const rowCells = cells[horizontal.point.row];
    if (!rowCells || horizontal.point.col < 0 || horizontal.point.col >= rowCells.length) {
      continue;
    }

    if (isHorizontalSegmentAbsent(horizontal)) {
      rowCells[horizontal.point.col].unshift("\\wireoverride{n}");
      continue;
    }

    const wireOptions = wireStyleOption(horizontal.color);
    if (!wireOptions) {
      cells[horizontal.point.row][horizontal.point.col].unshift(
        `\\wireoverride{${toQuantikzWireType(horizontal.wireType)}}`
      );
      continue;
    }

    cells[horizontal.point.row][horizontal.point.col].unshift(
      `\\wire[l][1][${wireOptions}]{${toQuantikzWireType(horizontal.wireType)}}`
    );
    cells[horizontal.point.row][horizontal.point.col].unshift("\\wireoverride{n}");
  }

  const exportedRows = cells.map((rowCells, rowIndex) => {
    const rendered = rowCells
      .map((cell, colIndex) => {
        if (cell.length > 0) {
          return cell.join(" ").trim();
        }

        if (suppressedCells.has(wireKey(rowIndex, colIndex))) {
          return "";
        }

        return "\\qw";
      })
      .join(" & ");
    const leftSpan = getWireLabelSpan(state.wireLabels[rowIndex], "left");
    const rightSpan = getWireLabelSpan(state.wireLabels[rowIndex], "right");
    const leftBracket = getWireLabelBracket(state.wireLabels[rowIndex], "left");
    const rightBracket = getWireLabelBracket(state.wireLabels[rowIndex], "right");
    const leftLabel =
      leftSpan > 1 && (leftBracket === "bracket" || leftBracket === "paren")
        ? decorateMergedLabel(state.wireLabels[rowIndex]?.left ?? "", "left", leftSpan, leftBracket)
        : formatLabelForQuantikz(state.wireLabels[rowIndex]?.left ?? "");
    const rightLabel =
      rightSpan > 1 && (rightBracket === "bracket" || rightBracket === "paren")
        ? decorateMergedLabel(state.wireLabels[rowIndex]?.right ?? "", "right", rightSpan, rightBracket)
        : formatLabelForQuantikz(state.wireLabels[rowIndex]?.right ?? "");
    const leftOptions =
      leftSpan > 1
        ? `wires=${leftSpan},braces=${leftBracket === "brace" ? "right" : "none"}`
        : "";
    const rightOptions =
      rightSpan > 1
        ? `wires=${rightSpan},braces=${rightBracket === "brace" ? "left" : "none"}`
        : "";
    const leftCell =
      isWireLabelGroupStart(state.wireLabels, rowIndex, "left") && leftLabel
        ? leftOptions
          ? `\\lstick[${leftOptions}]{${leftLabel}}`
          : `\\lstick{${leftLabel}}`
        : "";
    const rightCell =
      isWireLabelGroupStart(state.wireLabels, rowIndex, "right") && rightLabel
        ? rightOptions
          ? `\\rstick[${rightOptions}]{${rightLabel}}`
          : `\\rstick{${rightLabel}}`
        : "";

    if (rightCell) {
      return `${leftCell} & ${rendered} & ${rightCell}`;
    }

    return `${leftCell} & ${rendered} &`;
  });

  const quantikzOptions = [
    `row sep={${formatSpacingCm(state.layout.rowSepCm)},between origins}`,
    `column sep=${formatSpacingCm(state.layout.columnSepCm)}`
  ];

  return [
    `\\begin{quantikz}[${quantikzOptions.join(", ")}]`,
    exportedRows.join(" \\\\\n"),
    "\\end{quantikz}"
  ].join("\n");
}
