import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SymbolicLatexResponse } from "../shared/symbolicLatex";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SYMBOLIC_SCRIPT_PATH = path.join(REPO_ROOT, "quantikz_symbolic_latex.py");

interface ExecError extends Error {
  code?: string | number;
  stderr?: string;
  stdout?: string;
}

function runPython(binary: string, inputPath: string, envIndex: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      [SYMBOLIC_SCRIPT_PATH, inputPath, "--env-index", String(envIndex)],
      {
        cwd: REPO_ROOT,
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          const execError = error as ExecError;
          execError.stdout = stdout;
          execError.stderr = stderr;
          reject(execError);
          return;
        }

        resolve(stdout);
      }
    );
  });
}

function extractErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unable to generate symbolic LaTeX.";
  }

  const execError = error as ExecError;
  const parts = [execError.stderr, execError.stdout, execError.message]
    .map((part) => part?.trim())
    .filter(Boolean);
  const combined = parts.join("\n").trim();
  return combined || "Unable to generate symbolic LaTeX.";
}

function isMissingBinary(error: unknown): boolean {
  return error instanceof Error && (error as ExecError).code === "ENOENT";
}

function resolvePythonCandidates(): string[] {
  return Array.from(
    new Set([process.env.PYTHON_BIN, "python3", "python"].filter((value): value is string => Boolean(value)))
  );
}

export async function renderSymbolicLatex(code: string, envIndex = 0): Promise<SymbolicLatexResponse> {
  if (!code.trim()) {
    return {
      success: false,
      error: "Quantikz code is required."
    };
  }

  if (!Number.isInteger(envIndex) || envIndex < 0) {
    return {
      success: false,
      error: "The quantikz environment index must be a non-negative integer."
    };
  }

  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "quantikzz-symbolic-"));
  const inputPath = path.join(workspaceDir, "circuit.tex");

  try {
    await fs.writeFile(inputPath, code, "utf8");

    for (const binary of resolvePythonCandidates()) {
      try {
        const latex = (await runPython(binary, inputPath, envIndex)).trim();
        return {
          success: true,
          latex,
          envIndex
        };
      } catch (error) {
        if (isMissingBinary(error)) {
          continue;
        }

        return {
          success: false,
          error: extractErrorMessage(error),
          statusCode: 400
        };
      }
    }

    return {
      success: false,
      error: "Python is not available in this environment, so symbolic LaTeX generation cannot run.",
      statusCode: 503
    };
  } catch (error) {
    return {
      success: false,
      error: extractErrorMessage(error),
      statusCode: 500
    };
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}
