import { measureGateWidth, DEFAULT_CIRCUIT_LAYOUT, clampColumnSepCm, clampRowSepCm } from "./layout.js";
import { normalizeHexColor } from "./color.js";
import { normalizeWireLabels } from "./wireLabels.js";
import type {
  CircuitItem,
  CircuitLayout,
  FrameItem,
  GateItem,
  HorizontalSegmentItem,
  ImportedCircuit,
  MeterItem,
  SliceItem,
  WireLabelBracket,
  WireType,
  WireLabel
} from "./types.js";

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
  wireType: WireType;
}

interface SwapRef {
  row: number;
  col: number;
  offset: number;
  color: string | null;
  wireType: WireType;
}

interface ConnectorRef {
  row: number;
  col: number;
  length: number;
  color: string | null;
  wireType: WireType;
}

interface LabelCommandData {
  label: string;
  span: number;
  bracket: WireLabelBracket;
}

interface WireLabelMetadata {
  row: number;
  side: "left" | "right";
  span: number;
  bracket: WireLabelBracket;
}

interface ExtractedLabelCommand {
  label: LabelCommandData | null;
  remainder: string;
}

type ParsedHorizontalWireToken = WireType | "none";

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
      } else if (char === "[" && braceDepth === 0) {
        bracketDepth += 1;
      } else if (char === "]" && braceDepth === 0) {
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
      } else if (char === "[" && braceDepth === 0) {
        bracketDepth += 1;
      } else if (char === "]" && braceDepth === 0) {
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

      if (name !== "wire" && name !== "vqw" && name !== "vcw" &&
          name !== "gate" && name !== "meter" && name !== "gategroup" &&
          name !== "slice" && name !== "ctrl" && name !== "octrl" && name !== "swap" &&
          name !== "lstick" && name !== "rstick" && name !== "control" &&
          name !== "ocontrol" && name !== "targ" &&
          name !== "targX" && name !== "wireoverride" && name !== "setwiretype") {
        break;
      }

      if ((name === "gate" || name === "meter" || name === "gategroup" || name === "slice" ||
          name === "ctrl" || name === "octrl" || name === "swap" ||
          name === "lstick" || name === "rstick" || name === "vqw" || name === "vcw" ||
          name === "wireoverride" || name === "setwiretype") && args.length >= 1) {
        break;
      }

      if ((name === "control" || name === "ocontrol" || name === "targ" || name === "targX") && args.length >= 1) {
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

function extractEditorStepCount(source: string): number | null {
  const match = source.match(/^\s*%\s*quantikzz-steps\s*:\s*(\d+)\s*$/m);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : null;
}

function extractWireLabelMetadata(source: string): WireLabelMetadata[] {
  const matches = source.matchAll(
    /^\s*%\s*quantikzz-wirelabel:(left|right):(\d+):(\d+):(none|brace|bracket|paren)\s*$/gm
  );

  return [...matches].map((match) => ({
    side: match[1] as "left" | "right",
    row: Number(match[2]),
    span: Math.max(1, Number(match[3])),
    bracket: match[4] as WireLabelBracket
  }));
}

function parseSpacing(options: string): CircuitLayout {
  const rowMatch = options.match(/row\s*sep\s*=\s*\{?\s*([0-9]*\.?[0-9]+)cm/i);
  const columnMatch = options.match(/column\s*sep\s*=\s*([0-9]*\.?[0-9]+)cm/i);

  return {
    rowSepCm: rowMatch ? clampRowSepCm(Number(rowMatch[1])) : DEFAULT_CIRCUIT_LAYOUT.rowSepCm,
    columnSepCm: columnMatch ? clampColumnSepCm(Number(columnMatch[1])) : DEFAULT_CIRCUIT_LAYOUT.columnSepCm
  };
}

function parseEnvironmentWireTypes(options: string, qubits: number): WireType[] {
  const match = options.match(/wire\s*types\s*=\s*\{([^}]*)\}/i);
  const defaults = Array.from({ length: qubits }, () => "quantum" as const);

  if (!match) {
    return defaults;
  }

  const entries = splitOptions(match[1]).map((entry) => entry.trim().toLowerCase());
  return defaults.map((wireType, row) => (entries[row] === "c" ? "classical" : wireType));
}

function parseWiresOption(optionText: string): number {
  const match = splitOptions(optionText)
    .map((entry) => entry.trim())
    .find((entry) => /^wires\s*=/.test(entry));

  if (match) {
    const value = Number(match.split("=")[1]);
    return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : 1;
  }

  const bareNumber = splitOptions(optionText)
    .map((entry) => entry.trim())
    .find((entry) => /^\d+$/.test(entry));

  if (!bareNumber) {
    return 1;
  }

  return Math.max(1, Number(bareNumber));
}

function parseColumnSpan(optionText: string, layout: CircuitLayout): number {
  const match = optionText.match(/minimum\s*width\s*=\s*([0-9]*\.?[0-9]+)cm/i);
  if (!match) {
    return 1;
  }

  const widthCm = Number(match[1]);
  if (!Number.isFinite(widthCm) || widthCm <= 0) {
    return 1;
  }

  return Math.max(1, Math.round(widthCm / layout.columnSepCm));
}

function parseGroupRows(optionText: string): number {
  const firstOption = splitOptions(optionText)
    .map((entry) => entry.trim())
    .find((entry) => /^\d+$/.test(entry));

  return firstOption ? Math.max(1, Number(firstOption)) : 1;
}

function parseGroupSteps(optionText: string): number {
  const match = splitOptions(optionText)
    .map((entry) => entry.trim())
    .find((entry) => /^steps\s*=/.test(entry));

  if (!match) {
    return 1;
  }

  const value = Number(match.split("=")[1]);
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : 1;
}

function hasOption(optionText: string, name: string): boolean {
  return splitOptions(optionText)
    .map((entry) => entry.trim().toLowerCase())
    .includes(name.toLowerCase());
}

function parseInnerXSepPt(optionText: string): number {
  const styleMatch = optionText.match(/inner\s*xsep\s*=\s*([0-9]*\.?[0-9]+)pt/i);
  if (!styleMatch) {
    return 2;
  }

  const value = Number(styleMatch[1]);
  return Number.isFinite(value) && value >= 0 ? value : 2;
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

function parseLabelBracket(optionText: string, command: "lstick" | "rstick"): WireLabelBracket {
  const match = optionText.match(/braces\s*=\s*(none|left|right|both)/i);
  if (!match) {
    return "none";
  }

  const value = match[1].toLowerCase();
  if (value === "none") {
    return "none";
  }

  if (value === "both") {
    return "brace";
  }

  if (command === "lstick") {
    return value === "right" ? "brace" : "none";
  }

  return value === "left" ? "brace" : "none";
}

function parseLabelCommand(source: string, command: "lstick" | "rstick"): LabelCommandData | null {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }

  const commands = parseCommandSequence(trimmed);
  if (commands.length !== 1 || commands[0].name !== command || commands[0].args.length < 1) {
    return null;
  }

  return {
    label: decodeLabel(commands[0].args[0]),
    span: parseWiresOption(commands[0].options.join(",")),
    bracket: parseLabelBracket(commands[0].options.join(","), command)
  };
}

function stringifyParsedCommand(command: ParsedCommand): string {
  const options = command.options.map((option) => `[${option}]`).join("");
  const args = command.args.map((arg) => `{${arg}}`).join("");
  return `\\${command.name}${options}${args}`;
}

function extractLabelCommand(source: string, command: "lstick" | "rstick"): ExtractedLabelCommand {
  const trimmed = source.trim();
  if (!trimmed) {
    return { label: null, remainder: "" };
  }

  const commands = parseCommandSequence(trimmed);
  const labelIndex = commands.findIndex((entry) => entry.name === command && entry.args.length >= 1);
  if (labelIndex === -1) {
    return { label: null, remainder: trimmed };
  }

  const labelCommand = commands[labelIndex];
  const remainder = commands
    .filter((_, index) => index !== labelIndex)
    .map(stringifyParsedCommand)
    .join(" ")
    .trim();

  return {
    label: {
      label: decodeLabel(labelCommand.args[0]),
      span: parseWiresOption(labelCommand.options.join(",")),
      bracket: parseLabelBracket(labelCommand.options.join(","), command)
    },
    remainder
  };
}

function nextId(type: CircuitItem["type"], counter: { value: number }): string {
  counter.value += 1;
  return `${type}-import-${counter.value}`;
}

function parseHorizontalWireToken(token: string | undefined): ParsedHorizontalWireToken {
  const normalized = token?.trim().toLowerCase();

  if (normalized === "n") {
    return "none";
  }

  return normalized === "c" ? "classical" : "quantum";
}

function parseWireTypeToken(token: string | undefined): WireType {
  const parsed = parseHorizontalWireToken(token);
  return parsed === "classical" ? "classical" : "quantum";
}

function extractVerticalWireType(options: string[]): WireType {
  const entry = options
    .flatMap((option) => splitOptions(option))
    .find((option) => option.replace(/\s+/g, "").toLowerCase() === "verticalwire=c");

  return entry ? "classical" : "quantum";
}

function extractControlState(name: string, options: string[]): "filled" | "open" {
  if (name === "octrl" || name === "ocontrol") {
    return "open";
  }

  const openOption = options
    .flatMap((option) => splitOptions(option))
    .some((option) => option.trim().toLowerCase() === "open");

  return openOption ? "open" : "filled";
}

function addConnector(
  connectors: Map<string, ConnectorRef>,
  row: number,
  col: number,
  length: number,
  color: string | null,
  wireType: WireType
): void {
  if (length <= 0) {
    return;
  }

  const key = `${row}:${col}:${length}`;
  const existing = connectors.get(key);
  if (!existing) {
    connectors.set(key, { row, col, length, color, wireType });
    return;
  }

  if (!existing.color && color) {
    existing.color = color;
  }
  if (existing.wireType !== "classical" && wireType === "classical") {
    existing.wireType = wireType;
  }
}

function ensureControlDot(
  items: CircuitItem[],
  idCounter: { value: number },
  row: number,
  col: number,
  color: string | null,
  controlState: "filled" | "open"
): void {
  const existing = items.find(
    (item) => item.type === "controlDot" && item.point.row === row && item.point.col === col
  );

  if (existing && existing.type === "controlDot") {
    existing.color ??= color;
    if (controlState === "open") {
      existing.controlState = "open";
    }
    return;
  }

  items.push({
    id: nextId("controlDot", idCounter),
    type: "controlDot",
    point: { row, col },
    controlState,
    color
  });
}

function mergedConnectors(connectors: ConnectorRef[]): ConnectorRef[] {
  const byColumn = new Map<number, ConnectorRef[]>();
  for (const connector of connectors) {
    const bucket = byColumn.get(connector.col) ?? [];
    bucket.push(connector);
    byColumn.set(connector.col, bucket);
  }

  const merged: ConnectorRef[] = [];
  for (const [col, columnConnectors] of byColumn.entries()) {
    const sorted = [...columnConnectors].sort(
      (left, right) => left.row - right.row || left.length - right.length
    );
    let active: ConnectorRef | null = null;

    for (const connector of sorted) {
      const end = connector.row + connector.length;
      if (!active) {
        active = { ...connector };
        continue;
      }

      const activeEnd = active.row + active.length;
      if (connector.row <= activeEnd) {
        active = {
          row: active.row,
          col,
          length: Math.max(activeEnd, end) - active.row,
          color: active.color ?? connector.color,
          wireType: active.wireType === "classical" || connector.wireType === "classical" ? "classical" : "quantum"
        };
        continue;
      }

      merged.push(active);
      active = { ...connector };
    }

    if (active) {
      merged.push(active);
    }
  }

  return merged;
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

  const editorStepCount = extractEditorStepCount(source);
  const wireLabelMetadata = extractWireLabelMetadata(source);
  const { options, body } = extractEnvironment(source);
  const layout = parseSpacing(options);
  const rawRows = splitTopLevel(body, "\\\\")
    .map((row) => row.trim())
    .filter(Boolean);

  if (rawRows.length === 0) {
    throw new Error("No circuit rows were found in the Quantikz code.");
  }

  const wireLabels: WireLabel[] = Array.from({ length: rawRows.length }, () => ({ left: "", right: "" }));
  const wireTypes = parseEnvironmentWireTypes(options, rawRows.length);
  const items: CircuitItem[] = [];
  const controlRefs: ControlRef[] = [];
  const swapRefs: SwapRef[] = [];
  const connectorMap = new Map<string, ConnectorRef>();
  const idCounter = { value: 0 };
  let steps = 0;
  const helperColumns: boolean[] = [];
  const substantiveColumns: boolean[] = [];

  rawRows.forEach((rawRow, rowIndex) => {
    const rowCells = splitTopLevel(rawRow, "&").map((cell) => cell.trim());
    const cells = [...rowCells];

    const leftLabel = extractLabelCommand(cells[0] ?? "", "lstick");
    if (leftLabel.label !== null) {
      wireLabels[rowIndex].left = leftLabel.label.label;
      wireLabels[rowIndex].leftSpan = leftLabel.label.span;
      wireLabels[rowIndex].leftBracket = leftLabel.label.bracket;
      if (leftLabel.remainder) {
        cells[0] = leftLabel.remainder;
      } else {
        cells.shift();
      }
    } else if ((cells[0] ?? "").trim() === "") {
      cells.shift();
    }

    const rightLabel = extractLabelCommand(cells[cells.length - 1] ?? "", "rstick");
    if (rightLabel.label !== null) {
      wireLabels[rowIndex].right = rightLabel.label.label;
      wireLabels[rowIndex].rightSpan = rightLabel.label.span;
      wireLabels[rowIndex].rightBracket = rightLabel.label.bracket;
      if (rightLabel.remainder) {
        cells[cells.length - 1] = rightLabel.remainder;
      } else {
        cells.pop();
      }
    } else if ((cells[cells.length - 1] ?? "").trim() === "") {
      cells.pop();
    }

    steps = Math.max(steps, cells.length);

    let persistentWireType: ParsedHorizontalWireToken = wireTypes[rowIndex] ?? "quantum";

    cells.forEach((cell, colIndex) => {
      if (!cell || cell === "\\qw") {
        return;
      }

      const commands = parseCommandSequence(cell);
      const hasHelperCommand = commands.some((entry) => {
        if (entry.name === "wireoverride" || entry.name === "setwiretype") {
          return true;
        }

        return entry.name === "wire" && ["l", "r"].includes(entry.options[0]?.trim() ?? "");
      });
      const hasSubstantiveCommand = commands.some((entry) => {
        if (entry.name === "qw" || entry.name === "wireoverride" || entry.name === "setwiretype") {
          return false;
        }

        if (entry.name === "wire") {
          const direction = entry.options[0]?.trim();
          return direction !== "l" && direction !== "r";
        }

        return true;
      });

      if (hasHelperCommand) {
        helperColumns[colIndex] = true;
      }
      if (hasSubstantiveCommand) {
        substantiveColumns[colIndex] = true;
      }

      const hasHorizontalWireCommand = commands.some((entry) =>
        entry.name === "wire" &&
        (entry.options[0]?.trim() === "l" || entry.options[0]?.trim() === "r")
      );

      let setWireType: ParsedHorizontalWireToken | null = null;
      let wireOverrideType: ParsedHorizontalWireToken | null = null;

      commands.forEach((command) => {
        const optionText = command.options.join(",");
        const color = extractColor(optionText);

        switch (command.name) {
          case "qw":
            break;
          case "gate": {
            const rows = parseWiresOption(optionText);
            const cols = parseColumnSpan(optionText, layout);
            const label = decodeLabel(command.args[0] ?? "U") || "U";
            const gate: GateItem = {
              id: nextId("gate", idCounter),
              type: "gate",
              point: { row: rowIndex, col: colIndex },
              span: { rows, cols },
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
              span: { rows: parseWiresOption(optionText), cols: 1 },
              color
            };
            items.push(meter);
            break;
          }
          case "gategroup": {
            const frame: FrameItem = {
              id: nextId("frame", idCounter),
              type: "frame",
              point: { row: rowIndex, col: colIndex },
              span: {
                rows: parseGroupRows(optionText),
                cols: parseGroupSteps(optionText)
              },
              label: decodeLabel(command.args[0] ?? "Group") || "Group",
              rounded: /rounded\s+corners/i.test(optionText),
              dashed: /dashed/i.test(optionText),
              background: hasOption(optionText, "background"),
              innerXSepPt: parseInnerXSepPt(optionText),
              color
            };
            items.push(frame);
            break;
          }
          case "slice": {
            const slice: SliceItem = {
              id: nextId("slice", idCounter),
              type: "slice",
              point: { row: rowIndex, col: colIndex },
              label: decodeLabel(command.args[0] ?? "slice") || "slice",
              color
            };
            items.push(slice);
            break;
          }
          case "ctrl":
          case "octrl": {
            const offset = Number(command.args[0] ?? "0");
            if (!Number.isFinite(offset)) {
              throw new Error(`Invalid \\${command.name} offset at row ${rowIndex + 1}, column ${colIndex + 1}.`);
            }
            const wireType = extractVerticalWireType(command.options);
            const controlState = extractControlState(command.name, command.options);
            ensureControlDot(items, idCounter, rowIndex, colIndex, color, controlState);
            controlRefs.push({ row: rowIndex, col: colIndex, offset, color, wireType });
            break;
          }
          case "ocontrol":
          case "control":
            ensureControlDot(items, idCounter, rowIndex, colIndex, color, extractControlState(command.name, command.options));
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
            const wireType = extractVerticalWireType(command.options);
            items.push({
              id: nextId("swapX", idCounter),
              type: "swapX",
              point: { row: rowIndex, col: colIndex },
              color
            });
            swapRefs.push({ row: rowIndex, col: colIndex, offset, color, wireType });
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
            wireOverrideType = parseHorizontalWireToken(command.args[0]);
            if (hasHorizontalWireCommand) {
              break;
            }
            items.push({
              id: nextId("horizontalSegment", idCounter),
              type: "horizontalSegment",
              point: { row: rowIndex, col: colIndex },
              mode: wireOverrideType === "none" ? "absent" : "present",
              wireType: wireOverrideType === "classical" ? "classical" : "quantum",
              color: null
            });
            break;
          case "setwiretype":
            setWireType = parseHorizontalWireToken(command.args[0]);
            break;
          case "wire": {
            const direction = command.options[0]?.trim();
            const length = Number(command.options[1] ?? "1");
            const wireColor = extractColor(command.options[2] ?? "") ?? color;
            const wireType = parseWireTypeToken(command.args[0]);

            if (!Number.isFinite(length)) {
              throw new Error(`Invalid \\wire length at row ${rowIndex + 1}, column ${colIndex + 1}.`);
            }

            if (direction === "l" || direction === "r") {
              const horizontal: HorizontalSegmentItem = {
                id: nextId("horizontalSegment", idCounter),
                type: "horizontalSegment",
                point: { row: rowIndex, col: colIndex },
                mode: "present",
                wireType,
                color: wireColor
              };
              items.push(horizontal);
              break;
            }

            if (direction === "d" || direction === "u") {
              const endRow = direction === "d" ? rowIndex + length : rowIndex - length;
              const normalized = normalizeConnectorRange(rowIndex, endRow);
              addConnector(connectorMap, normalized.row, colIndex, normalized.length, wireColor, wireType);
              break;
            }

            throw new Error(`Unsupported \\wire direction '${direction}' at row ${rowIndex + 1}, column ${colIndex + 1}.`);
          }
          case "vqw":
          case "vcw": {
            const offset = Number(command.args[0] ?? "0");
            if (!Number.isFinite(offset)) {
              throw new Error(`Invalid \\${command.name} offset at row ${rowIndex + 1}, column ${colIndex + 1}.`);
            }

            const normalized = normalizeConnectorRange(rowIndex, rowIndex + offset);
            addConnector(
              connectorMap,
              normalized.row,
              colIndex,
              normalized.length,
              color,
              command.name === "vcw" ? "classical" : "quantum"
            );
            break;
          }
          default:
            throw new Error(`Unsupported Quantikz command '\\${command.name}' at row ${rowIndex + 1}, column ${colIndex + 1}.`);
        }
      });

      if (setWireType !== null && !hasHorizontalWireCommand && wireOverrideType === null && setWireType !== persistentWireType) {
        items.push({
          id: nextId("horizontalSegment", idCounter),
          type: "horizontalSegment",
          point: { row: rowIndex, col: colIndex },
          mode: setWireType === "none" ? "absent" : "present",
          wireType: setWireType === "classical" ? "classical" : "quantum",
          color: null
        });
      }

      if (setWireType !== null) {
        persistentWireType = setWireType;
      }
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
    const connectorWireType = matchingControls.some(({ entry }) => entry.wireType === "classical")
      ? "classical"
      : "quantum";
    addConnector(connectorMap, topRow, control.col, bottomRow - topRow, connectorColor, connectorWireType);
    matchingControls.forEach(({ entryIndex }) => consumedControls.add(entryIndex));
  });

  const leftoverEdgesByColumn = new Map<number, Array<{ start: number; end: number; color: string | null; wireType: WireType }>>();
  controlRefs.forEach((control, index) => {
    if (consumedControls.has(index)) {
      return;
    }

    const start = Math.min(control.row, control.row + control.offset);
    const end = Math.max(control.row, control.row + control.offset);
    const entries = leftoverEdgesByColumn.get(control.col) ?? [];
    entries.push({ start, end, color: control.color, wireType: control.wireType });
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
          color: active.color ?? edge.color,
          wireType: active.wireType === "classical" || edge.wireType === "classical" ? "classical" : "quantum"
        };
        continue;
      }

      addConnector(connectorMap, active.start, col, active.end - active.start, active.color, active.wireType);
      active = edge;
    }

    addConnector(connectorMap, active.start, col, active.end - active.start, active.color, active.wireType);
  });

  swapRefs.forEach((swap) => {
    const normalized = normalizeConnectorRange(swap.row, swap.row + swap.offset);
    addConnector(connectorMap, normalized.row, swap.col, normalized.length, swap.color, swap.wireType);
  });

  mergedConnectors([...connectorMap.values()]).forEach((connector) => {
    items.push({
      id: nextId("verticalConnector", idCounter),
      type: "verticalConnector",
      point: { row: connector.row, col: connector.col },
      length: connector.length,
      wireType: connector.wireType,
      color: connector.color
    });
  });

  let inferredSteps = Math.max(steps, 1);
  while (inferredSteps > 1 && helperColumns[inferredSteps - 1] && !substantiveColumns[inferredSteps - 1]) {
    inferredSteps -= 1;
  }

  return {
    qubits: rawRows.length,
    steps: editorStepCount ?? inferredSteps,
    layout,
    items,
    wireTypes,
    wireLabels: normalizeWireLabels(
      wireLabelMetadata.reduce((nextLabels, metadata) => {
        if (metadata.row < 0 || metadata.row >= nextLabels.length) {
          return nextLabels;
        }

        const rowLabels = nextLabels[metadata.row];
        if (metadata.side === "left") {
          rowLabels.leftSpan = metadata.span;
          rowLabels.leftBracket = metadata.bracket;
        } else {
          rowLabels.rightSpan = metadata.span;
          rowLabels.rightBracket = metadata.bracket;
        }

        return nextLabels;
      }, wireLabels),
      rawRows.length
    )
  };
}
