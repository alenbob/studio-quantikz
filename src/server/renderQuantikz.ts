import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

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
  ].filter((value): value is string => Boolean(value));

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

function buildStandaloneDocument(code: string, preamble: string): string {
  return [preamble.trim(), "\\begin{document}", code.trim(), "\\end{document}"]
    .filter(Boolean)
    .join("\n");
}

async function compileQuantikzDocument(
  code: string,
  preamble: string,
  tempDir: string
): Promise<{ dviFilePath: string }> {
  const texFilePath = path.join(tempDir, "circuit.tex");
  const dviFilePath = path.join(tempDir, "circuit.dvi");

  await fs.writeFile(texFilePath, buildStandaloneDocument(code, preamble), "utf8");

  await runCommand(
    resolveTeXBinary("latex"),
    ["-interaction=nonstopmode", "-halt-on-error", "-output-directory", tempDir, texFilePath],
    tempDir
  );

  return { dviFilePath };
}

export async function renderQuantikzSvg(
  code: string,
  preamble: string
): Promise<{ success: boolean; svg?: string; error?: string }> {
  if (!code.trim()) {
    return {
      success: false,
      error: "Quantikz code is required."
    };
  }

  if (!preamble.trim()) {
    return {
      success: false,
      error: "A LaTeX preamble is required."
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "quantikzz-render-"));
  const svgFilePath = path.join(tempDir, "circuit.svg");
  const dvisvgmArgs = ["-n"];
  const libgsPath = resolveGhostscriptLibrary();

  if (libgsPath) {
    dvisvgmArgs.push(`--libgs=${libgsPath}`);
  }

  try {
    const { dviFilePath } = await compileQuantikzDocument(code, preamble, tempDir);
    dvisvgmArgs.push("-o", svgFilePath, dviFilePath);

    await runCommand(
      resolveTeXBinary("dvisvgm"),
      dvisvgmArgs,
      tempDir
    );

    return {
      success: true,
      svg: await fs.readFile(svgFilePath, "utf8")
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to render SVG."
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function renderQuantikzPdf(
  code: string,
  preamble: string
): Promise<{ success: boolean; pdf?: Buffer; error?: string }> {
  if (!code.trim()) {
    return {
      success: false,
      error: "Quantikz code is required."
    };
  }

  if (!preamble.trim()) {
    return {
      success: false,
      error: "A LaTeX preamble is required."
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "quantikzz-render-"));
  const pdfFilePath = path.join(tempDir, "circuit.pdf");

  try {
    const { dviFilePath } = await compileQuantikzDocument(code, preamble, tempDir);

    await runCommand(
      resolveTeXBinary("dvipdfmx"),
      ["-o", pdfFilePath, dviFilePath],
      tempDir
    );

    return {
      success: true,
      pdf: await fs.readFile(pdfFilePath)
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to render PDF."
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
