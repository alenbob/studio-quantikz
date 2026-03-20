import { normalizeHexColor, resolveLatexColorExpression } from "../renderer/color";

export interface TikzRenderPreambleOptions {
  addToPreamble: string;
  texPackages: Record<string, string>;
  tikzLibraries: string[];
}

export interface VisualPreambleDefinitions {
  katexMacros: Record<string, string>;
  latexColors: Record<string, string>;
}

interface ResolveTikzRenderPreambleOptions {
  stripTexPackages?: string[];
  stripTikzLibraries?: string[];
}

const PGFPLOTS_COMPAT_LINE = "\\pgfplotsset{compat=1.16}";
const RAW_USEPACKAGE_PASSTHROUGH = new Set(["tikz"]);

function splitCommaSeparatedEntries(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function codeUsesPgfplots(code: string): boolean {
  return /\\begin\{axis\}|\\addplot\b|\\pgfplotstableread\b/.test(code);
}

function isEscapedAt(value: string, index: number): boolean {
  let backslashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function stripComments(source: string): string {
  return source
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

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) {
    index += 1;
  }
  return index;
}

function parseBalancedGroup(
  source: string,
  start: number,
  openChar: "{" | "[",
  closeChar: "}" | "]"
): [string, number] {
  if (source[start] !== openChar) {
    throw new Error(`Expected '${openChar}' at ${start}.`);
  }

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (isEscapedAt(source, index)) {
      continue;
    }

    const char = source[index];
    if (char === openChar) {
      depth += 1;
      continue;
    }

    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return [source.slice(start + 1, index), index + 1];
      }
    }
  }

  throw new Error(`Unterminated '${openChar}${closeChar}' group.`);
}

function parseControlSequence(source: string, start: number): [string | null, number] {
  if (source[start] !== "\\") {
    return [null, start];
  }

  let index = start + 1;
  while (index < source.length && /[A-Za-z@]/.test(source[index])) {
    index += 1;
  }

  const name = source.slice(start + 1, index).trim();
  return [name || null, index];
}

function parseMacroTarget(source: string, start: number): [string | null, number] {
  const cursor = skipWhitespace(source, start);

  if (source[cursor] === "{") {
    const [groupValue, nextCursor] = parseBalancedGroup(source, cursor, "{", "}");
    const trimmed = groupValue.trim();
    if (!trimmed.startsWith("\\")) {
      return [null, nextCursor];
    }
    const [name] = parseControlSequence(trimmed, 0);
    return [name, nextCursor];
  }

  return parseControlSequence(source, cursor);
}

function parseColorDefinition(model: string, spec: string): string | null {
  const normalizedModel = model.trim().toLowerCase();
  const normalizedSpec = spec.trim();

  if (normalizedModel === "rgb") {
    const floatChannels = normalizedSpec.split(",").map((entry) => Number(entry.trim()));
    if (floatChannels.length === 3 && floatChannels.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      return normalizeHexColor(
        `#${floatChannels
          .map((value) => Math.round(value * 255).toString(16).padStart(2, "0"))
          .join("")}`
      );
    }

    const channels = normalizedSpec.split(",").map((entry) => Number(entry.trim()));
    if (channels.length === 3 && channels.every((value) => Number.isFinite(value) && value >= 0 && value <= 255)) {
      return normalizeHexColor(
        `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`
      );
    }
  }

  if (normalizedModel === "html") {
    return normalizeHexColor(`#${normalizedSpec.replace(/^#/, "")}`);
  }

  return null;
}

export function resolveVisualPreambleDefinitions(preamble: string): VisualPreambleDefinitions {
  const source = stripComments(preamble);
  const katexMacros: Record<string, string> = {};
  const latexColors: Record<string, string> = {};
  let index = 0;

  while (index < source.length) {
    if (source[index] !== "\\") {
      index += 1;
      continue;
    }

    if (
      source.startsWith("\\newcommand", index) ||
      source.startsWith("\\renewcommand", index) ||
      source.startsWith("\\providecommand", index)
    ) {
      const commandLength = source.startsWith("\\renewcommand", index)
        ? "\\renewcommand".length
        : source.startsWith("\\providecommand", index)
          ? "\\providecommand".length
          : "\\newcommand".length;
      let cursor = skipWhitespace(source, index + commandLength);
      if (source[cursor] === "*") {
        cursor = skipWhitespace(source, cursor + 1);
      }

      const [name, nextCursor] = parseMacroTarget(source, cursor);
      cursor = skipWhitespace(source, nextCursor);
      if (source[cursor] === "[") {
        [, cursor] = parseBalancedGroup(source, cursor, "[", "]");
        cursor = skipWhitespace(source, cursor);
      }
      if (source[cursor] === "[") {
        [, cursor] = parseBalancedGroup(source, cursor, "[", "]");
        cursor = skipWhitespace(source, cursor);
      }

      if (name && source[cursor] === "{") {
        const [body, nextBodyCursor] = parseBalancedGroup(source, cursor, "{", "}");
        katexMacros[`\\${name}`] = body.trim();
        index = nextBodyCursor;
        continue;
      }
    }

    if (source.startsWith("\\def", index)) {
      let cursor = skipWhitespace(source, index + "\\def".length);
      const [name, nextCursor] = parseControlSequence(source, cursor);
      cursor = skipWhitespace(source, nextCursor);

      while (source[cursor] === "#" || /\d/.test(source[cursor] ?? "")) {
        cursor += 1;
      }
      cursor = skipWhitespace(source, cursor);

      if (name && source[cursor] === "{") {
        const [body, nextBodyCursor] = parseBalancedGroup(source, cursor, "{", "}");
        katexMacros[`\\${name}`] = body.trim();
        index = nextBodyCursor;
        continue;
      }
    }

    if (source.startsWith("\\DeclareMathOperator", index)) {
      let cursor = skipWhitespace(source, index + "\\DeclareMathOperator".length);
      if (source[cursor] === "*") {
        cursor = skipWhitespace(source, cursor + 1);
      }

      const [name, nextCursor] = parseMacroTarget(source, cursor);
      cursor = skipWhitespace(source, nextCursor);
      if (name && source[cursor] === "{") {
        const [body, nextBodyCursor] = parseBalancedGroup(source, cursor, "{", "}");
        katexMacros[`\\${name}`] = `\\operatorname{${body.trim()}}`;
        index = nextBodyCursor;
        continue;
      }
    }

    if (source.startsWith("\\definecolor", index)) {
      let cursor = skipWhitespace(source, index + "\\definecolor".length);
      if (source[cursor] === "{") {
        const [name, nextNameCursor] = parseBalancedGroup(source, cursor, "{", "}");
        cursor = skipWhitespace(source, nextNameCursor);
        if (source[cursor] === "{") {
          const [model, nextModelCursor] = parseBalancedGroup(source, cursor, "{", "}");
          cursor = skipWhitespace(source, nextModelCursor);
          if (source[cursor] === "{") {
            const [spec, nextSpecCursor] = parseBalancedGroup(source, cursor, "{", "}");
            const color = parseColorDefinition(model, spec);
            if (color) {
              latexColors[name.trim().toLowerCase()] = color;
            }
            index = nextSpecCursor;
            continue;
          }
        }
      }
    }

    if (source.startsWith("\\colorlet", index)) {
      let cursor = skipWhitespace(source, index + "\\colorlet".length);
      if (source[cursor] === "{") {
        const [name, nextNameCursor] = parseBalancedGroup(source, cursor, "{", "}");
        cursor = skipWhitespace(source, nextNameCursor);
        if (source[cursor] === "{") {
          const [target, nextTargetCursor] = parseBalancedGroup(source, cursor, "{", "}");
          const color = resolveLatexColorExpression(target.trim(), latexColors);
          if (color) {
            latexColors[name.trim().toLowerCase()] = color;
          }
          index = nextTargetCursor;
          continue;
        }
      }
    }

    index += 1;
  }

  return { katexMacros, latexColors };
}

export function resolveTikzRenderPreamble(
  code: string,
  preamble: string,
  options: ResolveTikzRenderPreambleOptions = {}
): TikzRenderPreambleOptions {
  const stripTexPackages = new Set(options.stripTexPackages ?? []);
  const stripTikzLibraries = new Set(options.stripTikzLibraries ?? []);
  const texPackages = new Map<string, string>();
  const tikzLibraries: string[] = [];
  const rawPreambleLines: string[] = [];

  for (const rawLine of preamble.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^\\documentclass\b/.test(line)) {
      continue;
    }

    if (line === "\\begin{document}" || line === "\\end{document}") {
      continue;
    }

    const usePackageMatch = /^\\usepackage(?:\[(?<options>[^\]]*)\])?\{(?<packages>[^}]*)\}$/.exec(line);
    if (usePackageMatch?.groups) {
      const packageOptions = usePackageMatch.groups.options ?? "";
      for (const packageName of splitCommaSeparatedEntries(usePackageMatch.groups.packages)) {
        if (stripTexPackages.has(packageName)) {
          continue;
        }

        if (RAW_USEPACKAGE_PASSTHROUGH.has(packageName)) {
          rawPreambleLines.push(
            `\\usepackage${packageOptions ? `[${packageOptions}]` : ""}{${packageName}}`
          );
          continue;
        }

        texPackages.set(packageName, packageOptions);
      }
      continue;
    }

    const tikzLibraryMatch = /^\\usetikzlibrary\{(?<libraries>[^}]*)\}$/.exec(line);
    if (tikzLibraryMatch?.groups) {
      for (const libraryName of splitCommaSeparatedEntries(tikzLibraryMatch.groups.libraries)) {
        if (!stripTikzLibraries.has(libraryName)) {
          tikzLibraries.push(libraryName);
        }
      }
      continue;
    }

    rawPreambleLines.push(line);
  }

  if (codeUsesPgfplots(code) && !stripTexPackages.has("pgfplots")) {
    texPackages.set("pgfplots", texPackages.get("pgfplots") ?? "");

    if (!rawPreambleLines.some((line) => /^\\pgfplotsset\b/.test(line))) {
      rawPreambleLines.push(PGFPLOTS_COMPAT_LINE);
    }
  }

  return {
    addToPreamble: uniqueStrings(rawPreambleLines).join("\n"),
    texPackages: Object.fromEntries(texPackages),
    tikzLibraries: uniqueStrings(tikzLibraries)
  };
}
