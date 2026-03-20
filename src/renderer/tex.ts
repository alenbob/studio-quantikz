import katex from "katex";

const KATEX_MACROS = {
  "\\ket": "\\left|#1\\right\\rangle",
  "\\bra": "\\left\\langle#1\\right|",
  "\\proj": "\\left|#1\\right\\rangle\\left\\langle#1\\right|"
};

export type KatexMacroMap = Record<string, string>;

function mergeKatexMacros(customMacros?: KatexMacroMap): KatexMacroMap {
  return customMacros ? { ...KATEX_MACROS, ...customMacros } : KATEX_MACROS;
}

function getMacroCacheKey(customMacros?: KatexMacroMap): string {
  if (!customMacros || Object.keys(customMacros).length === 0) {
    return "";
  }

  return Object.entries(customMacros)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, body]) => `${name}:${body}`)
    .join("|");
}

export function getKatexMacroCacheKey(customMacros?: KatexMacroMap): string {
  return getMacroCacheKey(customMacros);
}

export function normalizeLabel(label: string, fallback = ""): string {
  return label.trim() || fallback;
}

export function normalizeGateLabel(label: string): string {
  return normalizeLabel(label, "U");
}

function isEscapedAt(value: string, index: number): boolean {
  let backslashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function countUnescapedCharacter(value: string, target: string): number {
  let count = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === target && !isEscapedAt(value, index)) {
      count += 1;
    }
  }

  return count;
}

function hasBalancedBraces(value: string): boolean {
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (isEscapedAt(value, index)) {
      continue;
    }

    if (value[index] === "{") {
      depth += 1;
    }

    if (value[index] === "}") {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }

  return depth === 0;
}

function hasUnescapedCharacter(value: string, target: string): boolean {
  return countUnescapedCharacter(value, target) > 0;
}

function isWrappedInMathDelimiters(label: string): boolean {
  const normalized = normalizeLabel(label);
  return normalized.startsWith("$") && normalized.endsWith("$") && normalized.length >= 2;
}

function containsInlineMathSegments(label: string): boolean {
  const normalized = normalizeLabel(label);

  if (isWrappedInMathDelimiters(normalized)) {
    return false;
  }

  return countUnescapedCharacter(normalized, "$") > 0;
}

function escapeLatexText(label: string): string {
  const escapedParts: string[] = [];

  for (const char of label) {
    switch (char) {
      case "\\":
        escapedParts.push("\\textbackslash{}");
        break;
      case "&":
      case "%":
      case "$":
      case "#":
      case "_":
      case "{":
      case "}":
        escapedParts.push(`\\${char}`);
        break;
      case "^":
        escapedParts.push("\\^{}");
        break;
      case "~":
        escapedParts.push("\\textasciitilde{}");
        break;
      default:
        escapedParts.push(char);
        break;
    }
  }

  return escapedParts.join("");
}

function escapeGateLabel(label: string): string {
  return escapeLatexText(label);
}

function renderKatexHtml(expression: string, customMacros?: KatexMacroMap): string | null {
  try {
    return katex.renderToString(expression, {
      displayMode: false,
      macros: mergeKatexMacros(customMacros),
      output: "html",
      strict: "ignore",
      throwOnError: false
    });
  } catch {
    return null;
  }
}

export function renderMathExpressionHtml(expression: string, customMacros?: KatexMacroMap): string | null {
  const normalized = normalizeLabel(expression);

  if (!normalized) {
    return null;
  }

  return renderKatexHtml(stripMathDelimiters(normalized), customMacros);
}

export function stripMathDelimiters(label: string): string {
  const normalized = normalizeLabel(label);

  if (isWrappedInMathDelimiters(normalized)) {
    return normalized.slice(1, -1).trim();
  }

  return normalized;
}

export function isLikelyTexMath(label: string): boolean {
  const normalized = normalizeLabel(label);

  if (isWrappedInMathDelimiters(normalized)) {
    return true;
  }

  return /\\[A-Za-z]+|[_^]/.test(normalized);
}

export function getLabelMeasurementText(label: string): string {
  const normalized = stripMathDelimiters(label);
  const simplified = normalized
    .replace(/\\[A-Za-z]+\*?/g, "x")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return simplified || "U";
}

export function renderGateLabelHtml(label: string, customMacros?: KatexMacroMap): string | null {
  return renderKatexHtml(stripMathDelimiters(label) || "U", customMacros);
}

export function renderGateDisplayHtml(label: string, customMacros?: KatexMacroMap): string | null {
  return renderGateLabelHtml(normalizeGateLabel(label), customMacros);
}

export function formatLabelForQuantikz(label: string, fallback = ""): string {
  const normalized = normalizeLabel(label, fallback);

  if (!normalized) {
    return "";
  }

  if (isWrappedInMathDelimiters(normalized)) {
    return normalized;
  }

  if (isLikelyTexMath(normalized)) {
    return `$${stripMathDelimiters(normalized)}$`;
  }

  if (containsInlineMathSegments(normalized)) {
    return normalized;
  }

  return escapeLatexText(normalized);
}

export function formatGateLabelForQuantikz(label: string): string {
  const normalized = normalizeLabel(label, "U");

  if (!normalized) {
    return "U";
  }

  if (isWrappedInMathDelimiters(normalized)) {
    return stripMathDelimiters(normalized);
  }

  if (isLikelyTexMath(normalized)) {
    return stripMathDelimiters(normalized);
  }

  if (containsInlineMathSegments(normalized)) {
    return normalized;
  }

  return escapeGateLabel(normalized);
}

export function getLabelIssues(
  label: string,
  labelName: string,
  options: { allowEmpty?: boolean; fallback?: string } = {}
): Array<{ message: string; severity: "error" | "warning" }> {
  const normalized = normalizeLabel(label, options.fallback ?? "");
  const issues: Array<{ message: string; severity: "error" | "warning" }> = [];
  const allowEmpty = options.allowEmpty ?? false;

  if (!normalized && allowEmpty) {
    return issues;
  }

  const exportsAsRawLatex = containsInlineMathSegments(normalized) || isLikelyTexMath(normalized);

  if (countUnescapedCharacter(normalized, "$") % 2 !== 0) {
    issues.push({
      severity: "error",
      message: `${labelName} has unmatched $ delimiters.`
    });
  }

  if (exportsAsRawLatex && !hasBalancedBraces(stripMathDelimiters(normalized))) {
    issues.push({
      severity: "error",
      message: `${labelName} has unbalanced braces.`
    });
  }

  if (exportsAsRawLatex &&
      (hasUnescapedCharacter(normalized, "&") || hasUnescapedCharacter(normalized, "%"))) {
    issues.push({
      severity: "error",
      message: `${labelName} contains an unescaped '&' or '%' that would break LaTeX.`
    });
  }

  return issues;
}

export function getGateLabelIssues(label: string): Array<{ message: string; severity: "error" | "warning" }> {
  return getLabelIssues(label, "Gate label", { fallback: "U" });
}
