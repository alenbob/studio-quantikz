import { measureGateWidth, DEFAULT_CIRCUIT_LAYOUT, clampColumnSepCm, clampRowSepCm } from "./layout";
import { normalizeHexColor } from "./color";
import type {
  CircuitItem,
  CircuitLayout,
  GateItem,
  HorizontalSegmentItem,
  ImportedCircuit,
  MeterItem,
  WireLabel
} from "./types";

interface ParsedCommand {
  name: string;
  options: string[];
  args: string[];
}

interface ControlRef {
  row: number;
  col: number;
  offset: number;
  color: string | null;
}

interface SwapRef {
  row: number;
  col: number;
  offset: number;
  color: string | null;
}

interface ConnectorRef {
  row: number;
  col: number;
  length: number;
  color: string | null;
}

function isEscapedAt(value: string, index: number): boolean {
  let backslashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function stripComments(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => {
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] === "%" && !isEscapedAt(line, index)) {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join("\n");
}

function splitTopLevel(source: string, delimiter: "&" | "\\\\"): string[] {
  const parts: string[] = [];
  let braceDepth = 0;
  let bracketDepth = 0;
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (!isEscapedAt(source, index)) {
      if (char === "{") {
        braceDepth += 1;
      } else if (char === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (char === "[") {
        bracketDepth += 1;
      } else if (char === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
      }
    }

    if (braceDepth !== 0 || bracketDepth !== 0) {
      continue;
    }

    if (delimiter === "&" && char === "&" && !isEscapedAt(source, index)) {
      parts.push(source.slice(start, index));
      start = index + 1;
      continue;
    }

    if (delimiter === "\\\\" && char === "\\" && source[index + 1] === "\\" && !isEscapedAt(source, index)) {
      parts.push(source.slice(start, index));
      start = index + 2;
      index += 1;
    }
  }

  parts.push(source.slice(start));
  return parts;
}

function splitOptions(optionText: string): string[] {
  const parts: string[] = [];
  let braceDepth = 0;
  let bracketDepth = 0;
  let start = 0;

  for (let index = 0; index < optionText.length; index += 1) {
    const char = optionText[index];

    if (!isEscapedAt(optionText, index)) {
      if (char === "{") {
        braceDepth += 1;
      } else if (char === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (char === "[") {
        bracketDepth += 1;
      } else if (char === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
      }
    }

    if (braceDepth === 0 && bracketDepth === 0 && char === "," && !isEscapedAt(optionText, index)) {
      parts.push(optionText.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(optionText.slice(start).trim());
  return parts.filter(Boolean);
}

function parseGroup(source: string, start: number, openChar: "{" | "[", closeChar: "}" | "]"): [string, number] {
  if (source[start] !== openChar) {
    throw new Error(`Expected '${openChar}' at position ${start}.`);
  }

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (isEscapedAt(source, index)) {
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return [source.slice(start + 1, index), index + 1];
      }
    }
  }

  throw new Error(`Unterminated '${openChar}${closeChar}' group.`);
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) {
    index += 1;
  }
  return index;
}

function parseCommandSequence(source: string): ParsedCommand[] {
  const commands: ParsedCommand[] = [];
  let index = 0;

  while (index < source.length) {
    index = skipWhitespace(source, index);
    if (index >= source.length) {
      break;
    }

    if (source[index] !== "\\") {
      throw new Error(`Unsupported cell content near '${source.slice(index, index + 20)}'.`);
    }

    let cursor = index + 1;
    while (cursor < source.length && /[A-Za-z]/.test(source[cursor])) {
      cursor += 1;
    }

    const name = source.slice(index + 1, cursor);
    if (!name) {
      throw new Error(`Invalid command near '${source.slice(index, index + 20)}'.`);
    }

    const options: string[] = [];
    const args: string[] = [];
    cursor = skipWhitespace(source, cursor);

    while (cursor < source.length && source[cursor] === "[") {
      const [option, nextCursor] = parseGroup(source, cursor, "[", "]");
      options.push(option.trim());
      cursor = skipWhitespace(source, nextCursor);
    }

    while (cursor < source.length && source[cursor] === "{") {
      const [arg, nextCursor] = parseGroup(source, cursor, "{", "}");
      args.push(arg);
      cursor = skipWhitespace(source, nextCursor);

      if (name !== "wire" && name !== "gate" && name !== "meter" && name !== "ctrl" && name !== "swap" &&
          name !== "lstick" && name !== "rstick" && name !== "control" && name !== "targ" &&
          name !== "targX" && name !== "wireoverride") {
        break;
      }

      if ((name === "gate" || name === "meter" || name === "ctrl" || name === "swap" || name === "lstick" || name === "rstick" ||
          name === "wireoverride") && args.length >= 1) {
        break;
      }

      if ((name === "control" || name === "targ" || name === "targX") && args.length >= 1) {
        break;
      }

      if (name === "wire" && args.length >= 1) {
        break;
      }
    }

    commands.push({ name, options, args });
    index = cursor;
  }

  return commands;
}

function extractEnvironment(source: string): { options: string; body: string } {
  const cleaned = stripComments(source).trim();
  const beginIndex = cleaned.indexOf("\\begin{quantikz}");
  if (beginIndex === -1) {
    return { options: "", body: cleaned };
  }

  let cursor = beginIndex + "\\begin{quantikz}".length;
  cursor = skipWhitespace(cleaned, cursor);
  let options = "";

  if (cleaned[cursor] === "[") {
    [options, cursor] = parseGroup(cleaned, cursor, "[", "]");
  }

  const endIndex = cleaned.lastIndexOf("\\end{quantikz}");
  if (endIndex === -1 || endIndex < cursor) {
    throw new Error("Could not find a matching \\end{quantikz}.");
  }

  return {
    options,
    body: cleaned.slice(cursor, endIndex).trim()
  };
}

function parseSpacing(options: string): CircuitLayout {
  const rowMatch = options.match(/row\s*sep\s*=\s*\{?\s*([0-9]*\.?[0-9]+)cm/i);
  const columnMatch = options.match(/column\s*sep\s*=\s*([0-9]*\.?[0-9]+)cm/i);

  return {
    rowSepCm: rowMatch ? clampRowSepCm(Number(rowMatch[1])) : DEFAULT_CIRCUIT_LAYOUT.rowSepCm,
    columnSepCm: columnMatch ? clampColumnSepCm(Number(columnMatch[1])) : DEFAULT_CIRCUIT_LAYOUT.columnSepCm
  };
}

function toHexColor(red: number, green: number, blue: number): string {
  return `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${blue
    .toString(16)
    .padStart(2, "0")}`.toUpperCase();
}

function extractColor(value: string): string | null {
  const match = value.match(/(?:draw|fill|text)\s*=\s*\{rgb,255:red,(\d+);green,(\d+);blue,(\d+)\}/i);
  if (!match) {
    return null;
  }

  return normalizeHexColor(toHexColor(Number(match[1]), Number(match[2]), Number(match[3])));
}

function decodeLabel(value: string): string {
  const trimmed = value.trim();
  const unwrapped =
    trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length >= 2
      ? trimmed.slice(1, -1).trim()
      : trimmed;

  return unwrapped
    .replace(/\\textbackslash\{\}/g, "\\")
    .replace(/\\textasciitilde\{\}/g, "~")
    .replace(/\\\^\{\}/g, "^")
    .replace(/\\([&%$#_{}])/g, "$1");
}

function parseLabelCommand(source: string, command: "lstick" | "rstick"): string | null {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }

  const commands = parseCommandSequence(trimmed);
  if (commands.length !== 1 || commands[0].name !== command || commands[0].args.length < 1) {
    return null;
  }

  return decodeLabel(commands[0].args[0]);
}

function nextId(type: CircuitItem["type"], counter: { value: number }): string {
  counter.value += 1;
  return `${type}-import-${counter.value}`;
}

function addConnector(
  connectors: Map<string, ConnectorRef>,
  row: number,
  col: number,
  length: number,
  color: string | null
): void {
  if (length <= 0) {
    return;
  }

  const key = `${row}:${col}:${length}`;
  const existing = connectors.get(key);
  if (!existing) {
    connectors.set(key, { row, col, length, color });
    return;
  }

  if (!existing.color && color) {
    existing.color = color;
  }
}

function normalizeConnectorRange(startRow: number, endRow: number): { row: number; length: number } {
  return {
    row: Math.min(startRow, endRow),
    length: Math.abs(endRow - startRow)
  };
}

export function importFromQuantikz(code: string): ImportedCircuit {
  const source = code.trim();
  if (!source) {
    throw new Error("Paste Quantikz code into the text box before importing.");
  }

  const { options, body } = extractEnvironment(source);
  const layout = parseSpacing(options);
  const rawRows = splitTopLevel(body, "\\\\")
    .map((row) => row.trim())
    .filter(Boolean);

  if (rawRows.length === 0) {
    throw new Error("No circuit rows were found in the Quantikz code.");
  }

  const wireLabels: WireLabel[] = Array.from({ length: rawRows.length }, () => ({ left: "", right: "" }));
  const items: CircuitItem[] = [];
  const controlRefs: ControlRef[] = [];
  const swapRefs: SwapRef[] = [];
  const connectorMap = new Map<string, ConnectorRef>();
  const idCounter = { value: 0 };
  let steps = 0;

  rawRows.forEach((rawRow, rowIndex) => {
    const rowCells = splitTopLevel(rawRow, "&").map((cell) => cell.trim());
    const cells = [...rowCells];

    const leftLabel = parseLabelCommand(cells[0] ?? "", "lstick");
    if (leftLabel !== null) {
      wireLabels[rowIndex].left = leftLabel;
      cells.shift();
    } else if ((cells[0] ?? "").trim() === "") {
      cells.shift();
    }

    const rightLabel = parseLabelCommand(cells[cells.length - 1] ?? "", "rstick");
    if (rightLabel !== null) {
      wireLabels[rowIndex].right = rightLabel;
      cells.pop();
    } else if ((cells[cells.length - 1] ?? "").trim() === "") {
      cells.pop();
    }

    steps = Math.max(steps, cells.length);

    cells.forEach((cell, colIndex) => {
      if (!cell || cell === "\\qw") {
        return;
      }

      const commands = parseCommandSequence(cell);

      commands.forEach((command) => {
        const optionText = command.options.join(",");
        const color = extractColor(optionText);

        switch (command.name) {
          case "qw":
            break;
          case "gate": {
            const wires = splitOptions(optionText)
              .find((entry) => entry.startsWith("wires="))
              ?.split("=")[1];
            const rows = wires ? Math.max(1, Number(wires)) : 1;
            const label = decodeLabel(command.args[0] ?? "U") || "U";
            const gate: GateItem = {
              id: nextId("gate", idCounter),
              type: "gate",
              point: { row: rowIndex, col: colIndex },
              span: { rows, cols: 1 },
              label,
              width: measureGateWidth(label),
              color
            };
            items.push(gate);
            break;
          }
          case "meter": {
            const meter: MeterItem = {
              id: nextId("meter", idCounter),
              type: "meter",
              point: { row: rowIndex, col: colIndex },
              color
            };
            items.push(meter);
            break;
          }
          case "ctrl": {
            const offset = Number(command.args[0] ?? "0");
            if (!Number.isFinite(offset)) {
              throw new Error(`Invalid \\ctrl offset at row ${rowIndex + 1}, column ${colIndex + 1}.`);
            }
            items.push({
              id: nextId("controlDot", idCounter),
              type: "controlDot",
              point: { row: rowIndex, col: colIndex },
              color
            });
            controlRefs.push({ row: rowIndex, col: colIndex, offset, color });
            break;
          }
          case "control":
            items.push({
              id: nextId("controlDot", idCounter),
              type: "controlDot",
              point: { row: rowIndex, col: colIndex },
              color
            });
            break;
          case "targ":
            items.push({
              id: nextId("targetPlus", idCounter),
              type: "targetPlus",
              point: { row: rowIndex, col: colIndex },
              color
            });
            break;
          case "swap": {
            const offset = Number(command.args[0] ?? "0");
            if (!Number.isFinite(offset)) {
              throw new Error(`Invalid \\swap offset at row ${rowIndex + 1}, column ${colIndex + 1}.`);
            }
            items.push({
              id: nextId("swapX", idCounter),
              type: "swapX",
              point: { row: rowIndex, col: colIndex },
              color
            });
            swapRefs.push({ row: rowIndex, col: colIndex, offset, color });
            break;
          }
          case "targX":
            items.push({
              id: nextId("swapX", idCounter),
              type: "swapX",
              point: { row: rowIndex, col: colIndex },
              color
            });
            break;
          case "wireoverride":
            items.push({
              id: nextId("horizontalSegment", idCounter),
              type: "horizontalSegment",
              point: { row: rowIndex, col: colIndex },
              mode: "absent",
              color: null
            });
            break;
          case "wire": {
            const direction = command.options[0]?.trim();
            const length = Number(command.options[1] ?? "1");
            const wireColor = extractColor(command.options[2] ?? "") ?? color;

            if (!Number.isFinite(length)) {
              throw new Error(`Invalid \\wire length at row ${rowIndex + 1}, column ${colIndex + 1}.`);
            }

            if (direction === "l" || direction === "r") {
              const horizontal: HorizontalSegmentItem = {
                id: nextId("horizontalSegment", idCounter),
                type: "horizontalSegment",
                point: { row: rowIndex, col: colIndex },
                mode: "present",
                color: wireColor
              };
              items.push(horizontal);
              break;
            }

            if (direction === "d" || direction === "u") {
              const endRow = direction === "d" ? rowIndex + length : rowIndex - length;
              const normalized = normalizeConnectorRange(rowIndex, endRow);
              addConnector(connectorMap, normalized.row, colIndex, normalized.length, wireColor);
              break;
            }

            throw new Error(`Unsupported \\wire direction '${direction}' at row ${rowIndex + 1}, column ${colIndex + 1}.`);
          }
          default:
            throw new Error(`Unsupported Quantikz command '\\${command.name}' at row ${rowIndex + 1}, column ${colIndex + 1}.`);
        }
      });
    });
  });

  const gateTargetsByColumn = new Map<number, Set<number>>();
  for (const item of items) {
    if (item.type !== "gate" && item.type !== "meter" && item.type !== "targetPlus") {
      continue;
    }

    const targetRows = gateTargetsByColumn.get(item.point.col) ?? new Set<number>();
    targetRows.add(item.point.row);
    gateTargetsByColumn.set(item.point.col, targetRows);
  }

  const consumedControls = new Set<number>();

  controlRefs.forEach((control, index) => {
    const targetRow = control.row + control.offset;
    const targets = gateTargetsByColumn.get(control.col);
    if (!targets?.has(targetRow)) {
      return;
    }

    const matchingControls = controlRefs
      .map((entry, entryIndex) => ({ entry, entryIndex }))
      .filter(({ entry, entryIndex }) =>
        !consumedControls.has(entryIndex) &&
        entry.col === control.col &&
        entry.row + entry.offset === targetRow
      );

    if (matchingControls.length === 0) {
      return;
    }

    const rows = matchingControls.map(({ entry }) => entry.row);
    rows.push(targetRow);
    const topRow = Math.min(...rows);
    const bottomRow = Math.max(...rows);
    const connectorColor = matchingControls.find(({ entry }) => entry.color)?.entry.color ?? null;
    addConnector(connectorMap, topRow, control.col, bottomRow - topRow, connectorColor);
    matchingControls.forEach(({ entryIndex }) => consumedControls.add(entryIndex));
  });

  const leftoverEdgesByColumn = new Map<number, Array<{ start: number; end: number; color: string | null }>>();
  controlRefs.forEach((control, index) => {
    if (consumedControls.has(index)) {
      return;
    }

    const start = Math.min(control.row, control.row + control.offset);
    const end = Math.max(control.row, control.row + control.offset);
    const entries = leftoverEdgesByColumn.get(control.col) ?? [];
    entries.push({ start, end, color: control.color });
    leftoverEdgesByColumn.set(control.col, entries);
  });

  leftoverEdgesByColumn.forEach((edges, col) => {
    const sortedEdges = [...edges].sort((left, right) => left.start - right.start || left.end - right.end);
    let active = sortedEdges[0];

    for (let index = 1; index < sortedEdges.length; index += 1) {
      const edge = sortedEdges[index];
      if (edge.start <= active.end) {
        active = {
          start: active.start,
          end: Math.max(active.end, edge.end),
          color: active.color ?? edge.color
        };
        continue;
      }

      addConnector(connectorMap, active.start, col, active.end - active.start, active.color);
      active = edge;
    }

    addConnector(connectorMap, active.start, col, active.end - active.start, active.color);
  });

  swapRefs.forEach((swap) => {
    const normalized = normalizeConnectorRange(swap.row, swap.row + swap.offset);
    addConnector(connectorMap, normalized.row, swap.col, normalized.length, swap.color);
  });

  connectorMap.forEach((connector) => {
    items.push({
      id: nextId("verticalConnector", idCounter),
      type: "verticalConnector",
      point: { row: connector.row, col: connector.col },
      length: connector.length,
      color: connector.color
    });
  });

  return {
    qubits: rawRows.length,
    steps: Math.max(steps, 1),
    layout,
    items,
    wireLabels
  };
}
