export interface TikzRenderPreambleOptions {
  addToPreamble: string;
  texPackages: Record<string, string>;
  tikzLibraries: string[];
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