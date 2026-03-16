import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import tex2svg, { load, dumpMemfs } from "node-tikzjax";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEX_FILES_DIR = path.join(__dirname, "tex-files");

// Inject the bundled quantikz files into the node-tikzjax in-memory filesystem
// so that \usepackage{quantikz} and \usetikzlibrary{quantikz2} become available.
let quantikzInjected = false;
async function ensureQuantikzInjected(): Promise<void> {
  if (quantikzInjected) {
    return;
  }
  await load();
  const memfs = await dumpMemfs();
  const fileNames = await fs.readdir(TEX_FILES_DIR);
  for (const file of fileNames) {
    const content = await fs.readFile(path.join(TEX_FILES_DIR, file));
    memfs.writeFileSync(`/tex_files/${file}`, content);
  }
  quantikzInjected = true;
}

function buildStandaloneDocument(code: string, preamble: string): string {
  return [preamble.trim(), "\\begin{document}", code.trim(), "\\end{document}"]
    .filter(Boolean)
    .join("\n");
}

// Extract preamble additions that node-tikzjax needs as options (usepackage /
// usetikzlibrary calls are already handled via the injected files, so we only
// need to forward everything else as addToPreamble).
function extractPreambleAdditions(preamble: string): string {
  return preamble
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      // These are already set up by the node-tikzjax standalone preamble or injected files
      if (t.startsWith("\\documentclass")) return false;
      if (t === "\\usepackage{tikz}") return false;
      return true;
    })
    .join("\n")
    .trim();
}

export async function renderQuantikzSvg(
  code: string,
  preamble: string
): Promise<{ success: boolean; svg?: string; error?: string }> {
  if (!code.trim()) {
    return { success: false, error: "Quantikz code is required." };
  }

  if (!preamble.trim()) {
    return { success: false, error: "A LaTeX preamble is required." };
  }

  try {
    await ensureQuantikzInjected();

    const addToPreamble = extractPreambleAdditions(preamble);
    const body = `\\begin{document}\n${code.trim()}\n\\end{document}`;

    const svg = await tex2svg(body, {
      addToPreamble,
      embedFontCss: false,
      disableOptimize: false,
      showConsole: true
    });

    return { success: true, svg };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to render SVG."
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
