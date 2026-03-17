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
import {
  getMeterSuppressedHorizontalKeys,
  isAbsentHorizontalSegment,
  wireKey
} from "./horizontalWires";
import { mixHexWithWhite, toTikzColor } from "./color";
import {
  formatGateLabelForQuantikz,
  formatLabelForQuantikz,
  isLikelyTexMath,
  stripMathDelimiters
} from "./tex";
import {
  normalizeConnectors,
  pickControlledSwapAnchorRow
} from "./swapAnalysis";
import { getWireLabelBracket, getWireLabelSpan, isWireLabelGroupStart, type WireLabelSide } from "./wireLabels";

function itemKey(item: CircuitItem): string {
  return item.id;
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

function isOnlyAbsentWireOverride(tokens: string[]): boolean {
  return tokens.length === 1 && tokens[0] === "\\wireoverride{n}";
}

function prependToken(tokens: string[], token: string): string[] {
  if (tokens[0] === token) {
    return tokens;
  }

  return [token, ...tokens];
}

function commandPriority(token: string): number {
  const match = token.match(/^\\([A-Za-z]+)/);
  const command = match?.[1] ?? "";

  if (["gate", "meter", "ctrl", "octrl", "control", "ocontrol", "targ", "targX", "swap"].includes(command)) {
    return 0;
  }

  if (["wire", "wireoverride", "setwiretype", "vqw", "vcw"].includes(command)) {
    return 1;
  }

  if (command === "ghost") {
    return 1;
  }

  if (["gategroup", "slice"].includes(command)) {
    return 2;
  }

  return 1;
}

function orderCellCommands(tokens: string[]): string[] {
  return tokens
    .map((token, index) => ({ token, index, priority: commandPriority(token) }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ token }) => token);
}

function compactAbsentWireRuns(
  rowCells: string[][],
  rowDefaultWireType: WireType,
  lastIncludedCol: number
): string[][] {
  if (lastIncludedCol < 0) {
    return rowCells;
  }

  const compacted = rowCells.map((tokens) => [...tokens]);
  const restoreToken = `\\setwiretype{${toQuantikzWireType(rowDefaultWireType)}}`;
  const boundedLastIncludedCol = Math.min(lastIncludedCol, compacted.length - 1);
  let col = 0;

  while (col <= boundedLastIncludedCol) {
    if (!isOnlyAbsentWireOverride(compacted[col])) {
      col += 1;
      continue;
    }

    let end = col;
    while (end + 1 <= boundedLastIncludedCol && isOnlyAbsentWireOverride(compacted[end + 1])) {
      end += 1;
    }

    if (end > col) {
      compacted[col] = ["\\setwiretype{n}"];
      for (let runCol = col + 1; runCol <= end; runCol += 1) {
        compacted[runCol] = [];
      }

      if (end + 1 <= boundedLastIncludedCol) {
        compacted[end + 1] = prependToken(compacted[end + 1], restoreToken);
      }
    }

    col = end + 1;
  }

  return compacted;
}

function horizontalSegmentNeedsCommand(item: HorizontalSegmentItem, implicitlyAbsent = false): boolean {
  if (isAbsentHorizontalSegment(item)) {
    return true;
  }

  if (implicitlyAbsent) {
    return true;
  }

  return item.wireType !== "quantum" || Boolean(wireStyleOption(item.color));
}

function gateStyleOptions(color?: string | null, minimumWidthCm?: number | null): string {
  const options: string[] = [];
  const styleParts: string[] = [];

  if (color) {
    const tikzColor = toTikzColor(color);
    const fillColor = toTikzColor(mixHexWithWhite(color, 0.9));
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
  return color ? `label style={text=${toTikzColor(color)}}` : "";
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
    styleParts.push(`draw=${toTikzColor(frame.color)}`);
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
    styleParts.push(`draw=${toTikzColor(slice.color)}`);
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
    const tikzColor = toTikzColor(color);
    const fillColor = toTikzColor(mixHexWithWhite(color, 0.9));
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

  const tikzColor = toTikzColor(color);
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
  return color ? `draw=${toTikzColor(color)}` : "";
}

function appendConnectorWireOption(options: string[], wireType: WireType): void {
  if (wireType === "classical") {
    options.push("vertical wire=c");
  }
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
  const horizontalSegmentsByKey = new Map(
    horizontals.map((item) => [wireKey(item.point.row, item.point.col), item])
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
  const implicitlyAbsentHorizontalKeys = getMeterSuppressedHorizontalKeys(state.items, effectiveSteps);

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

    for (let col = gate.point.col + 1; col < gate.point.col + gate.span.cols; col += 1) {
      cells[gate.point.row][col].push(`\\ghost{${formattedLabel}}`);
    }

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
    const formattedLabel = formatLabelForQuantikz(frame.label);
    const optionBlock = frameStyleOptions(frame);
    cells[frame.point.row][frame.point.col].push(`\\gategroup[${optionBlock}]{${formattedLabel}}`);
  }

  for (const slice of slices) {
    const formattedLabel = formatLabelForQuantikz(slice.label);
    const options = sliceOptions(slice);
    cells[slice.point.row][slice.point.col].push(
      options ? `\\slice[${options}]{${formattedLabel}}` : `\\slice{${formattedLabel}}`
    );
  }

  for (const connector of normalizedConnectors) {
    const start = connector.point.row;
    const end = connector.point.row + connector.length;
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
      .filter((item) => item.point.row >= start && item.point.row <= end)
      .sort((left, right) => left.point.row - right.point.row);

    const connectorGateTargets = gateLikes.filter(
      (gate) => gate.point.col === column && gate.point.row >= start && gate.point.row <= end
    ).sort((left, right) => left.point.row - right.point.row);

    if (connectorSwaps.length === 2) {
      const sortedSwaps = [...connectorSwaps].sort((left, right) => left.point.row - right.point.row);
      const topSwap = sortedSwaps[0];
      const bottomSwap = sortedSwaps[1];
      const swapStartOptionParts: string[] = [];
      const swapStartStyle = commandColorOptions(topSwap.color ?? connector.color, { wire: true });
      if (swapStartStyle) {
        swapStartOptionParts.push(swapStartStyle);
      }
      appendConnectorWireOption(swapStartOptionParts, connector.wireType);

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
        const targetRow = pickControlledSwapAnchorRow(control.point.row, topSwap.point.row, bottomSwap.point.row);
        cells[control.point.row][column].push(
          controlOptionParts.length > 0
            ? `${controlCommand}[${wrapOptionBlock(controlOptionParts)}]{${targetRow - control.point.row}}`
            : `${controlCommand}{${targetRow - control.point.row}}`
        );
        used.add(itemKey(control));
      }

      const swapEndOptions = commandColorOptions(bottomSwap.color ?? connector.color);
      cells[topSwap.point.row][column].push(
        swapStartOptionParts.length > 0
          ? `\\swap[${wrapOptionBlock(swapStartOptionParts)}]{${bottomSwap.point.row - topSwap.point.row}}`
          : `\\swap{${bottomSwap.point.row - topSwap.point.row}}`
      );
      cells[bottomSwap.point.row][column].push(
        swapEndOptions ? `\\targX[${swapEndOptions}]{}`
          : "\\targX{}"
      );
      connector.members.forEach((member) => used.add(itemKey(member)));
      used.add(itemKey(topSwap));
      used.add(itemKey(bottomSwap));
      continue;
    }

    const targetRows = [...new Set([
      ...connectorTargets.map((item) => item.point.row),
      ...(connectorControls.length > 0 ? connectorGateTargets.map((item) => item.point.row) : [])
    ])].sort((left, right) => left - right);
    const controlRows = connectorControls.map((item) => item.point.row);

    if (
      connectorControls.length > 0 &&
      targetRows.length === 1 &&
      connectorControls.length === connector.length &&
      controlRows[0] === start &&
      targetRows[0] === end &&
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

      for (const target of connectorTargets) {
        const targetOptions = commandColorOptions(target.color ?? connector.color);
        cells[target.point.row][column].push(
          targetOptions ? `\\targ[${targetOptions}]{}`
            : "\\targ{}"
        );
        used.add(itemKey(target));
      }

      connector.members.forEach((member) => used.add(itemKey(member)));
      continue;
    }

    if (connectorControls.length === 1 && connectorTargets.length > 1) {
      const control = connectorControls[0];
      const sortedTargets = [...connectorTargets].sort((left, right) => left.point.row - right.point.row);
      const firstTarget = sortedTargets.find((target) => target.point.row !== control.point.row);

      if (firstTarget) {
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
            ? `${controlCommand}[${wrapOptionBlock(controlOptionParts)}]{${firstTarget.point.row - control.point.row}}`
            : `${controlCommand}{${firstTarget.point.row - control.point.row}}`
        );
        used.add(itemKey(control));

        for (let index = 0; index < sortedTargets.length; index += 1) {
          const target = sortedTargets[index];
          const targetOptions = commandColorOptions(target.color ?? connector.color);
          cells[target.point.row][column].push(
            targetOptions ? `\\targ[${targetOptions}]{}`
              : "\\targ{}"
          );
          used.add(itemKey(target));

          const nextTarget = sortedTargets[index + 1];
          if (nextTarget) {
            const span = nextTarget.point.row - target.point.row;
            const fallbackWireOptions = wireStyleOption(connector.color);
            cells[target.point.row][column].push(
              fallbackWireOptions
                ? `\\wire[d][${span}][${fallbackWireOptions}]{${toQuantikzWireType(connector.wireType)}}`
                : `\\wire[d][${span}]{${toQuantikzWireType(connector.wireType)}}`
            );
          }
        }

        connector.members.forEach((member) => used.add(itemKey(member)));
        continue;
      }
    }

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
        cells[target.point.row][column].push(
          targetOptions ? `\\targ[${targetOptions}]{}`
            : "\\targ{}"
        );
        used.add(itemKey(target));
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

  const exportedRows = cells.map((rowCells, rowIndex) => {
    const rowDefaultWireType = state.wireTypes[rowIndex] ?? "quantum";
    const renderedCells = rowCells.map((cell, colIndex) => {
      const key = wireKey(rowIndex, colIndex);
      const suppressed = suppressedCells.has(key);
      const tokens = [...cell];

      if (suppressed) {
        return tokens;
      }

      const explicitHorizontal = horizontalSegmentsByKey.get(key);
      const wireSuppressed = explicitHorizontal
        ? isAbsentHorizontalSegment(explicitHorizontal)
        : implicitlyAbsentHorizontalKeys.has(key);

      if (wireSuppressed) {
        return prependToken(tokens, "\\wireoverride{n}");
      }

      const wireType = explicitHorizontal?.wireType ?? rowDefaultWireType;
      const wireOptions = wireStyleOption(explicitHorizontal?.color ?? null);

      if (wireOptions) {
        return [
          "\\wireoverride{n}",
          `\\wire[l][1][${wireOptions}]{${toQuantikzWireType(wireType)}}`,
          ...tokens
        ];
      }

      if (wireType !== rowDefaultWireType) {
        return prependToken(tokens, `\\wireoverride{${toQuantikzWireType(wireType)}}`);
      }

      return tokens;
    });

    let lastIncludedCol = -1;
    for (let colIndex = renderedCells.length - 1; colIndex >= 0; colIndex -= 1) {
      const key = wireKey(rowIndex, colIndex);
      const explicitHorizontal = horizontalSegmentsByKey.get(key);
      const preservesExplicitAbsentOverride = Boolean(
        explicitHorizontal &&
          explicitHorizontal.autoSuppressed !== true &&
          isAbsentHorizontalSegment(explicitHorizontal)
      );
      const preservesBlankWire = Boolean(
        explicitHorizontal &&
          !isAbsentHorizontalSegment(explicitHorizontal) &&
          !explicitHorizontal.color &&
          explicitHorizontal.wireType === rowDefaultWireType
      );

      if (!preservesExplicitAbsentOverride && !preservesBlankWire) {
        if (renderedCells[colIndex].length === 0 || isOnlyAbsentWireOverride(renderedCells[colIndex])) {
          continue;
        }
      }

      lastIncludedCol = colIndex;
      break;
    }

    const trailingBoundaryCol = lastIncludedCol + 1;
    const trailingBoundaryKey = wireKey(rowIndex, trailingBoundaryCol);
    const trailingBoundaryHorizontal = horizontalSegmentsByKey.get(trailingBoundaryKey);
    const rowEndsWithWire = lastIncludedCol >= 0 && trailingBoundaryCol <= state.steps && !suppressedCells.has(trailingBoundaryKey) && !(
      trailingBoundaryHorizontal
        ? isAbsentHorizontalSegment(trailingBoundaryHorizontal)
        : implicitlyAbsentHorizontalKeys.has(trailingBoundaryKey)
    );

    const compactedCells = compactAbsentWireRuns(renderedCells, rowDefaultWireType, lastIncludedCol);
    const renderedParts = lastIncludedCol >= 0
      ? compactedCells
        .slice(0, Math.min(lastIncludedCol, compactedCells.length - 1) + 1)
        .map((tokens) => orderCellCommands(tokens).join(" ").trim())
      : [];

    if (rowEndsWithWire) {
      renderedParts.push("");
    }

    const rendered = renderedParts.join(" & ");
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

    return `${leftCell} & ${rendered}`;
  });

  const quantikzOptions = [
    `row sep={${formatSpacingCm(state.layout.rowSepCm)},between origins}`,
    `column sep=${formatSpacingCm(state.layout.columnSepCm)}`
  ];

  if (state.wireTypes.some((wireType) => wireType !== "quantum")) {
    quantikzOptions.push(`wire types={${state.wireTypes.map(toQuantikzWireType).join(",")}}`);
  }

  return [
    `\\begin{quantikz}[${quantikzOptions.join(", ")}]`,
    exportedRows.join(" \\\\\n"),
    "\\end{quantikz}"
  ].join("\n");
}
