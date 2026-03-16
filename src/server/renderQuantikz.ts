import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveTikzRenderPreamble } from "../shared/tikzPreamble";

const DEFAULT_WASM_PREAMBLE = [
  "\\usepackage{tikz}",
  "\\providecommand{\\ket}[1]{\\left|#1\\right\\rangle}",
  "\\providecommand{\\bra}[1]{\\left\\langle#1\\right|}",
  "\\providecommand{\\proj}[1]{\\left|#1\\right\\rangle\\left\\langle#1\\right|}"
].join("\n");

const UNSUPPORTED_QUANTIKZ_MESSAGE = "Quantikz SVG rendering is not available in the Vercel/WASM renderer yet. This endpoint currently supports plain TikZ only.";
const NODE_TIKZJAX_FONT_CSS_URL = "/node-tikzjax/fonts.css";

type TikzJaxRenderOptions = {
  addToPreamble?: string;
  texPackages?: Record<string, string>;
  tikzLibraries?: string;
  embedFontCss?: boolean;
  fontCssUrl?: string;
  disableOptimize?: boolean;
};

type TikzJaxModule = {
  default?: (input: string, options?: TikzJaxRenderOptions) => Promise<string>;
};

interface RenderQuantikzSvgResult {
  success: boolean;
  svg?: string;
  error?: string;
  statusCode?: number;
}

let svgRenderQueue: Promise<void> = Promise.resolve();

function buildStandaloneDocument(code: string, preamble: string): string {
  return [preamble.trim(), "\\begin{document}", code.trim(), "\\end{document}"]
    .filter(Boolean)
    .join("\n");
}

function ensureDocumentBody(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) {
    return "";
  }

  if (/\\begin\{document\}/.test(trimmed)) {
    return trimmed;
  }

  return ["\\begin{document}", trimmed, "\\end{document}"].join("\n");
}

function looksLikeQuantikz(code: string): boolean {
  return /\\begin\{quantikz\}|\\end\{quantikz\}|\\(lstick|rstick|gate|phase|ctrl|octrl|control|ocontrol|targX?|meter|qw|qwbundle|swap|slice|gategroup|setwiretype)\b/.test(code);
}

function hasGraphicPrimitives(svgMarkup: string): boolean {
  const body = svgMarkup.includes("</defs>") ? svgMarkup.split("</defs>", 2)[1] : svgMarkup;
  return /<(path|line|rect|circle|ellipse|polygon|polyline|text)\b/.test(body);
}

function validateSvgMarkup(svgMarkup: string): string {
  if (!svgMarkup.includes("<svg")) {
    throw new Error("Renderer did not return SVG markup.");
  }

  if (!hasGraphicPrimitives(svgMarkup)) {
    throw new Error("Renderer returned SVG markup without drawing primitives.");
  }

  return svgMarkup;
}

async function withSvgRenderLock<T>(work: () => Promise<T>): Promise<T> {
  const nextRun = svgRenderQueue.then(work, work);
  svgRenderQueue = nextRun.then(() => undefined, () => undefined);
  return nextRun;
}

async function renderTikzToSvgWithWasm(code: string, preamble: string): Promise<string> {
  const source = ensureDocumentBody(code);
  const preambleOptions = resolveTikzRenderPreamble(code, [DEFAULT_WASM_PREAMBLE, preamble].filter(Boolean).join("\n"), {
    stripTexPackages: ["quantikz"],
    stripTikzLibraries: ["quantikz2"]
  });
  const tikzjaxModule = (await import("node-tikzjax")) as TikzJaxModule;
  const tex2svg = tikzjaxModule.default;

  if (!tex2svg) {
    throw new Error("node-tikzjax is not available.");
  }

  return withSvgRenderLock(() =>
    tex2svg(source, {
      addToPreamble: preambleOptions.addToPreamble,
      texPackages: preambleOptions.texPackages,
      tikzLibraries: preambleOptions.tikzLibraries.join(","),
      embedFontCss: true,
      fontCssUrl: NODE_TIKZJAX_FONT_CSS_URL,
      disableOptimize: false
    })
  );
}

export async function renderQuantikzSvg(
  code: string,
  preamble: string
): Promise<RenderQuantikzSvgResult> {
  if (!code.trim()) {
    return { success: false, error: "Quantikz code is required." };
  }

  if (looksLikeQuantikz(code)) {
    return {
      success: false,
      error: UNSUPPORTED_QUANTIKZ_MESSAGE,
      statusCode: 422
    };
  }

  try {
    const svg = await renderTikzToSvgWithWasm(code, preamble);
    return {
      success: true,
      svg: validateSvgMarkup(svg)
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to render SVG.",
      statusCode: 400
    };
  }
}

// PDF rendering still relies on local latex/dvipdfmx binaries (not available on
// Vercel serverless, but works locally and in Electron).
function resolveTeXBinary(binaryName: string): string {
  if (process.env.TEXBIN_PATH) {
    return path.join(process.env.TEXBIN_PATH, binaryName);
  }
  const macTeXBinary = path.join("/Library/TeX/texbin", binaryName);
  return existsSync(macTeXBinary) ? macTeXBinary : binaryName;
}

function resolveGhostscriptLibrary(): string | null {
  const candidates = [
    process.env.DVISVGM_LIBGS,
    process.env.LIBGS,
    "/opt/homebrew/lib/libgs.dylib",
    "/usr/local/lib/libgs.dylib",
    "/usr/lib/libgs.so",
    "/usr/lib64/libgs.so"
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function runCommand(binary: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
        reject(new Error(output || error.message));
        return;
      }
      resolve();
    });
  });
}

export async function renderQuantikzPdf(
  code: string,
  preamble: string
): Promise<{ success: boolean; pdf?: Buffer; error?: string }> {
  if (!code.trim()) {
    return { success: false, error: "Quantikz code is required." };
  }

  if (!preamble.trim()) {
    return { success: false, error: "A LaTeX preamble is required." };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "quantikzz-render-"));
  const texFilePath = path.join(tempDir, "circuit.tex");
  const dviFilePath = path.join(tempDir, "circuit.dvi");
  const pdfFilePath = path.join(tempDir, "circuit.pdf");
  const document = [preamble.trim(), "\\begin{document}", code.trim(), "\\end{document}"]
    .filter(Boolean)
    .join("\n");

  try {
    await fs.writeFile(texFilePath, document, "utf8");

    await runCommand(
      resolveTeXBinary("latex"),
      ["-interaction=nonstopmode", "-halt-on-error", "-output-directory", tempDir, texFilePath],
      tempDir
    );

    await runCommand(
      resolveTeXBinary("dvipdfmx"),
      ["-o", pdfFilePath, dviFilePath],
      tempDir
    );

    return { success: true, pdf: await fs.readFile(pdfFilePath) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to render PDF."
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
