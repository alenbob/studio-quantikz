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

export interface StandaloneQuantikzSource {
  code: string;
  preamble: string;
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
