import type {
  CircuitItem,
  ControlDotItem,
  EditorState,
  GateItem,
  HorizontalSegmentItem,
  SwapXItem,
  TargetPlusItem,
  VerticalConnectorItem
} from "./types";
import { mixHexWithWhite, toTikzRgb } from "./color";
import { formatGateLabelForQuantikz, formatLabelForQuantikz } from "./tex";

function itemKey(item: CircuitItem): string {
  return item.id;
}

function wireKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function rangeForConnector(item: VerticalConnectorItem): [number, number] {
  return [item.point.row, item.point.row + item.length];
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

function gateStyleOptions(color?: string | null): string {
  const options: string[] = [];

  if (color) {
    const tikzColor = toTikzRgb(color);
    const fillColor = toTikzRgb(mixHexWithWhite(color, 0.9));
    options.push(
      `style={draw=${tikzColor},text=${tikzColor},fill=${fillColor}}`,
      `label style={text=${tikzColor}}`
    );
  }

  return wrapOptionBlock(options);
}

function commandColorOptions(
  color?: string | null,
  options: { fill?: boolean; wire?: boolean } = {}
): string {
  if (!color) {
    return "";
  }

  const tikzColor = toTikzRgb(color);
  const parts = [`style={draw=${tikzColor}${options.fill ? `,fill=${tikzColor}` : ""}}`];

  if (options.wire) {
    parts.push(`wire style={draw=${tikzColor}}`);
  }

  return wrapOptionBlock(parts);
}

function wireStyleOption(color?: string | null): string {
  return color ? `draw=${toTikzRgb(color)}` : "";
}

function formatSpacingCm(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return `${rounded.toFixed(1)}cm`;
  }

  return `${rounded.toString().replace(/0+$/, "").replace(/\.$/, "")}cm`;
}

export function exportToQuantikz(state: EditorState): string {
  const maxCellCol = state.items.reduce((maxCol, item) => {
    if (item.type === "horizontalSegment") {
      return maxCol;
    }
    return Math.max(maxCol, item.point.col);
  }, 0);

  const maxWireCol = Object.keys(state.wireMask).reduce((maxCol, key) => {
    const [, rawCol] = key.split(":");
    return Math.max(maxCol, Number(rawCol));
  }, 0);

  const effectiveSteps = Math.max(state.steps, maxCellCol + 1, maxWireCol + 1, 1);
  const cells = buildMatrix(state.qubits, effectiveSteps);
  const used = new Set<string>();
  const suppressedCells = new Set<string>();

  const gates = state.items.filter((item): item is GateItem => item.type === "gate");
  const controls = state.items.filter((item): item is ControlDotItem => item.type === "controlDot");
  const targets = state.items.filter((item): item is TargetPlusItem => item.type === "targetPlus");
  const swaps = state.items.filter((item): item is SwapXItem => item.type === "swapX");
  const horizontals = state.items.filter(
    (item): item is HorizontalSegmentItem => item.type === "horizontalSegment"
  );
  const connectors = state.items.filter(
    (item): item is VerticalConnectorItem => item.type === "verticalConnector"
  );

  for (const gate of gates) {
    const formattedLabel = formatGateLabelForQuantikz(gate.label);
    const styleOptions = gateStyleOptions(gate.color);
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

    for (let row = gate.point.row + 1; row < gate.point.row + gate.span.rows; row += 1) {
      suppressedCells.add(wireKey(row, gate.point.col));
    }
  }

  for (const connector of connectors) {
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

    const connectorGateTargets = gates.filter(
      (gate) => gate.point.col === column && gate.point.row >= start && gate.point.row <= end
    );

    if (connectorSwaps.length === 2) {
      const swapStartOptions = commandColorOptions(connectorSwaps[0].color ?? connector.color, { wire: true });
      const swapEndOptions = commandColorOptions(connectorSwaps[1].color ?? connector.color);
      cells[start][column].push(
        swapStartOptions ? `\\swap[${swapStartOptions}]{${end - start}}` : `\\swap{${end - start}}`
      );
      cells[end][column].push(swapEndOptions ? `\\targX[${swapEndOptions}]{}`
        : "\\targX{}");
      used.add(itemKey(connector));
      used.add(itemKey(connectorSwaps[0]));
      used.add(itemKey(connectorSwaps[1]));
      continue;
    }

    const targetRow = connectorTargets[0]?.point.row ?? connectorGateTargets[0]?.point.row;
    if (typeof targetRow === "number") {
      for (const control of connectorControls) {
        const controlOptions = commandColorOptions(control.color ?? connector.color, {
          fill: true,
          wire: true
        });
        cells[control.point.row][column].push(
          controlOptions
            ? `\\ctrl[${controlOptions}]{${targetRow - control.point.row}}`
            : `\\ctrl{${targetRow - control.point.row}}`
        );
        used.add(itemKey(control));
      }

      if (connectorTargets[0]) {
        const targetOptions = commandColorOptions(connectorTargets[0].color ?? connector.color);
        cells[targetRow][column].push(targetOptions ? `\\targ[${targetOptions}]{}`
          : "\\targ{}");
        used.add(itemKey(connectorTargets[0]));
      }

      used.add(itemKey(connector));
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
        const controlOptions = commandColorOptions(control.color ?? connector.color, {
          fill: true,
          wire: true
        });
        cells[control.point.row][column].push(
          controlOptions ? "\\ctrl[" + controlOptions + "]{1}" : "\\ctrl{1}"
        );
        used.add(itemKey(control));
      }
      used.add(itemKey(connector));
      continue;
    }

    const fallbackWireOptions = wireStyleOption(connector.color);
    cells[start][column].push(
      fallbackWireOptions
        ? `\\wire[d][${connector.length}][${fallbackWireOptions}]{q}`
        : `\\wire[d][${connector.length}]{q}`
    );
    used.add(itemKey(connector));
  }

  for (const control of controls) {
    if (!used.has(itemKey(control))) {
      const controlOptions = commandColorOptions(control.color, { fill: true });
      cells[control.point.row][control.point.col].push(
        controlOptions ? `\\control[${controlOptions}]{}`
          : "\\control{}"
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
    if (horizontal.mode !== "present" || !horizontal.color) {
      continue;
    }

    const wireOptions = wireStyleOption(horizontal.color);
    if (!wireOptions) {
      continue;
    }

    while (cells[horizontal.point.row].length <= horizontal.point.col) {
      cells[horizontal.point.row].push([]);
    }

    cells[horizontal.point.row][horizontal.point.col].push(`\\wire[l][1][${wireOptions}]{q}`);
  }

  for (const [key, value] of Object.entries(state.wireMask)) {
    if (value !== "absent") {
      continue;
    }

    const [row, col] = key.split(":").map(Number);
    if (!Number.isFinite(row) || !Number.isFinite(col)) {
      continue;
    }

    if (row < 0 || row >= state.qubits) {
      continue;
    }

    while (cells[row].length <= col) {
      cells[row].push([]);
    }

    cells[row][col].push("\\wireoverride{n}");
  }

  const exportedRows = cells.map((rowCells, rowIndex) => {
    const rendered = rowCells
      .map((cell, colIndex) => {
        if (cell.length > 0) {
          return cell.join(" ").trim();
        }

        return suppressedCells.has(wireKey(rowIndex, colIndex)) ? "" : "\\qw";
      })
      .join(" & ");
    const leftLabel = formatLabelForQuantikz(state.wireLabels[rowIndex]?.left ?? "");
    const rightLabel = formatLabelForQuantikz(state.wireLabels[rowIndex]?.right ?? "");
    const leftCell = leftLabel ? `\\lstick{${leftLabel}}` : "";

    if (rightLabel) {
      return `${leftCell} & ${rendered} & \\rstick{${rightLabel}}`;
    }

    return `${leftCell} & ${rendered} &`;
  });

  return [
    `\\begin{quantikz}[row sep={${formatSpacingCm(state.layout.rowSepCm)},between origins}, column sep=${formatSpacingCm(state.layout.columnSepCm)}]`,
    exportedRows.join(" \\\\\n"),
    "\\end{quantikz}"
  ].join("\n");
}
