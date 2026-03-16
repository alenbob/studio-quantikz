import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const SVG_RENDER_DISABLED_MESSAGE = "SVG rendering is disabled pending a full LaTeX-based rewrite.";

interface RenderQuantikzSvgResult {
  success: boolean;
  svg?: string;
  error?: string;
  statusCode?: number;
}

function buildStandaloneDocument(code: string, preamble: string): string {
  return [preamble.trim(), "\\begin{document}", code.trim(), "\\end{document}"]
    .filter(Boolean)
    .join("\n");
}

export async function renderQuantikzSvg(
  code: string,
  preamble: string
): Promise<RenderQuantikzSvgResult> {
  if (!code.trim()) {
    return { success: false, error: "Quantikz code is required." };
  }

  if (!preamble.trim()) {
    return { success: false, error: "A LaTeX preamble is required." };
  }

  return {
    success: false,
    error: SVG_RENDER_DISABLED_MESSAGE,
    statusCode: 501
  };
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
