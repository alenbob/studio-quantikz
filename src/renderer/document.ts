export const DEFAULT_EXPORT_PREAMBLE = [
  "\\documentclass[tikz,border=4pt]{standalone}",
  "\\usepackage{tikz}",
  "\\usepackage{xcolor}",
  "\\usetikzlibrary{quantikz2}",
  "\\usepackage{amsmath}",
  "\\usepackage{amssymb}",
  "\\usepackage{amsfonts}",
  "\\usepackage{braket}"
].join("\n");

export const DEFAULT_SYMBOLIC_PREAMBLE = [
  "\\documentclass[border=4pt]{standalone}",
  "\\usepackage{xcolor}",
  "\\usepackage{amsmath}",
  "\\usepackage{amssymb}",
  "\\usepackage{amsfonts}",
  "\\usepackage{braket}"
].join("\n");

const LEGACY_FIXED_WIDTH_SYMBOLIC_PREAMBLE = [
  "\\documentclass[varwidth=2400pt,border=4pt]{standalone}",
  "\\usepackage{xcolor}",
  "\\usepackage{amsmath}",
  "\\usepackage{amssymb}",
  "\\usepackage{amsfonts}",
  "\\usepackage{braket}"
].join("\n");

const LEGACY_LINE_WIDTH_SYMBOLIC_PREAMBLE = [
  "\\documentclass[varwidth,border=4pt]{standalone}",
  "\\usepackage{xcolor}",
  "\\usepackage{amsmath}",
  "\\usepackage{amssymb}",
  "\\usepackage{amsfonts}",
  "\\usepackage{braket}"
].join("\n");

export interface StandaloneQuantikzSource {
  code: string;
  preamble: string;
}

export function normalizeSymbolicPreamble(preamble: string): string {
  const trimmed = preamble.trim();

  if (
    trimmed === LEGACY_FIXED_WIDTH_SYMBOLIC_PREAMBLE ||
    trimmed === LEGACY_LINE_WIDTH_SYMBOLIC_PREAMBLE
  ) {
    return DEFAULT_SYMBOLIC_PREAMBLE;
  }

  return preamble;
}

export function splitStandaloneQuantikzSource(
  source: string,
  fallbackPreamble = DEFAULT_EXPORT_PREAMBLE
): StandaloneQuantikzSource {
  const trimmed = source.trim();
  const beginDocumentMatch = /\\begin\{document\}/.exec(trimmed);

  if (!beginDocumentMatch) {
    return {
      code: trimmed,
      preamble: fallbackPreamble
    };
  }

  const preamble = trimmed.slice(0, beginDocumentMatch.index).trim() || fallbackPreamble;
  const bodyStart = beginDocumentMatch.index + beginDocumentMatch[0].length;
  const endDocumentIndex = trimmed.lastIndexOf("\\end{document}");
  const code = (endDocumentIndex === -1 ? trimmed.slice(bodyStart) : trimmed.slice(bodyStart, endDocumentIndex)).trim();

  return { code, preamble };
}

export function buildStandaloneQuantikzDocument(preamble: string, code: string): string {
  return [preamble.trim(), "\\begin{document}", code.trim(), "\\end{document}"]
    .filter(Boolean)
    .join("\n");
}
