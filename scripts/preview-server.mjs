import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile as compileLatex, isAvailable as isLatexCompilerAvailable } from "node-latex-compiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "..", "dist");
const PORT = Number(process.env.PORT || 4173);
const QUANTIKZ_LIBRARY_FILE = path.resolve(__dirname, "..", "tikzlibraryquantikz2.code.tex");

function buildStandaloneDocument(code, preamble) {
  const trimmedCode = code.trim();
  if (/^\\documentclass/.test(trimmedCode)) {
    return trimmedCode;
  }

  const body = /\\begin\{document\}/.test(trimmedCode)
    ? trimmedCode
    : ["\\begin{document}", trimmedCode, "\\end{document}"].filter(Boolean).join("\n");

  return [preamble.trim(), body].filter(Boolean).join("\n");
}

function extractCompilerError(parts) {
  const message = parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return message || "Unable to render PDF.";
}

function resolvePdfToCairoBinary() {
  const explicitPath = process.env.PDFTOCAIRO_PATH;

  if (explicitPath) {
    return explicitPath;
  }

  const knownCandidates = [
    "/opt/homebrew/bin/pdftocairo",
    "/usr/local/bin/pdftocairo"
  ];

  return knownCandidates.find((candidate) => existsSync(candidate)) ?? "pdftocairo";
}

function runBinary(binary, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        const enrichedError = new Error([stdout.trim(), stderr.trim(), error.message].filter(Boolean).join("\n"));
        enrichedError.code = error.code;
        reject(enrichedError);
        return;
      }

      resolve();
    });
  });
}

async function stageQuantikzCompilerInputs(workspaceDir) {
  if (existsSync(QUANTIKZ_LIBRARY_FILE)) {
    await fs.copyFile(QUANTIKZ_LIBRARY_FILE, path.join(workspaceDir, "tikzlibraryquantikz2.code.tex"));
  }
}

function normalizeFullLatexPreamble(preamble) {
  const rawLines = preamble
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "\\begin{document}" && line !== "\\end{document}");

  const normalizedLines = [];
  let hasTikzPackage = false;
  let hasQuantikz2Library = false;

  for (const line of rawLines) {
    if (/^\\usepackage(?:\[[^\]]*\])?\{quantikz\}$/.test(line)) {
      continue;
    }

    if (/^\\usepackage(?:\[[^\]]*\])?\{tikz\}$/.test(line)) {
      hasTikzPackage = true;
      normalizedLines.push(line);
      continue;
    }

    const tikzLibraryMatch = /^\\usetikzlibrary\{(?<libraries>[^}]*)\}$/.exec(line);
    if (tikzLibraryMatch?.groups) {
      const libraries = tikzLibraryMatch.groups.libraries
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry && entry !== "quantikz");

      if (libraries.includes("quantikz2")) {
        hasQuantikz2Library = true;
      }

      normalizedLines.push(`\\usetikzlibrary{${libraries.join(",")}}`);
      continue;
    }

    normalizedLines.push(line);
  }

  if (!hasTikzPackage) {
    normalizedLines.splice(1, 0, "\\usepackage{tikz}");
  }

  if (!hasQuantikz2Library) {
    const documentclassIndex = normalizedLines.findIndex((line) => /^\\documentclass/.test(line));
    normalizedLines.splice(documentclassIndex === -1 ? 0 : documentclassIndex + 2, 0, "\\usetikzlibrary{quantikz2}");
  }

  return normalizedLines.join("\n");
}

function hasGraphicPrimitives(svgMarkup) {
  const body = svgMarkup.includes("</defs>") ? svgMarkup.split("</defs>", 2)[1] : svgMarkup;
  return /<(path|line|rect|circle|ellipse|polygon|polyline|text)\b/.test(body);
}

function validateSvgMarkup(svgMarkup) {
  if (!svgMarkup.includes("<svg")) {
    throw new Error("Renderer did not return SVG markup.");
  }

  if (!hasGraphicPrimitives(svgMarkup)) {
    throw new Error("Renderer returned SVG markup without drawing primitives.");
  }

  return svgMarkup;
}

async function renderQuantikzPdf(code, preamble) {
  if (!code.trim()) {
    return { success: false, error: "Quantikz code is required." };
  }

  if (!preamble.trim()) {
    return { success: false, error: "A LaTeX preamble is required." };
  }

  if (!isLatexCompilerAvailable()) {
    return {
      success: false,
      error: "The bundled Tectonic compiler is not available in this environment.",
      statusCode: 503
    };
  }

  const document = buildStandaloneDocument(code, normalizeFullLatexPreamble(preamble));
  const stdoutChunks = [];
  const stderrChunks = [];
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "quantikzz-preview-"));
  const texFilePath = path.join(workspaceDir, "circuit.tex");

  try {
    await stageQuantikzCompilerInputs(workspaceDir);
    await fs.writeFile(texFilePath, document, "utf8");

    const result = await compileLatex({
      texFile: texFilePath,
      outputDir: workspaceDir,
      returnBuffer: true,
      onStdout: (chunk) => {
        stdoutChunks.push(chunk);
      },
      onStderr: (chunk) => {
        stderrChunks.push(chunk);
      }
    });

    if (result.status !== "success" || !result.pdfBuffer) {
      return {
        success: false,
        error: extractCompilerError([result.error, result.stderr, stderrChunks.join(""), stdoutChunks.join("")]),
        statusCode: 400
      };
    }

    return { success: true, pdf: result.pdfBuffer };
  } catch (error) {
    return {
      success: false,
      error: extractCompilerError([
        error instanceof Error ? error.message : "Unable to render PDF.",
        stderrChunks.join(""),
        stdoutChunks.join("")
      ]),
      statusCode: 400
    };
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

async function renderQuantikzSvg(code, preamble) {
  if (!code.trim()) {
    return { success: false, error: "Quantikz code is required." };
  }

  const pdfResult = await renderQuantikzPdf(code, preamble);

  if (!pdfResult.success || !pdfResult.pdf) {
    return {
      success: false,
      error: pdfResult.error ?? "Unable to render SVG.",
      statusCode: pdfResult.statusCode ?? 400
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "quantikzz-preview-svg-"));
  const pdfPath = path.join(tempDir, "circuit.pdf");
  const svgPrefixPath = path.join(tempDir, "circuit");

  try {
    await fs.writeFile(pdfPath, pdfResult.pdf);
    await runBinary(resolvePdfToCairoBinary(), ["-svg", "-f", "1", "-l", "1", pdfPath, svgPrefixPath], tempDir);

    const svg = await fs.readFile(svgPrefixPath, "utf8");
    return {
      success: true,
      svg: validateSvgMarkup(svg)
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to render SVG.",
      statusCode: error?.code === "ENOENT" ? 503 : 400
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";

    request.on("data", (chunk) => {
      data += chunk.toString();
    });

    request.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function getContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".woff2")) return "font/woff2";
  if (filePath.endsWith(".woff")) return "font/woff";
  if (filePath.endsWith(".ttf")) return "font/ttf";
  return "application/octet-stream";
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/render-svg") {
      const body = await readJsonBody(request);
      const result = await renderQuantikzSvg(body.code ?? "", body.preamble ?? "");
      sendJson(response, result.success ? 200 : (result.statusCode ?? 400), result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/render-pdf") {
      const body = await readJsonBody(request);
      const result = await renderQuantikzPdf(body.code ?? "", body.preamble ?? "");
      if (!result.success || !result.pdf) {
        sendJson(response, result.statusCode ?? 400, {
          success: false,
          error: result.error ?? "Unable to render PDF."
        });
        return;
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader("Content-Disposition", "attachment; filename=\"quantikz-circuit.pdf\"");
      response.end(result.pdf);
      return;
    }

    if (!request.url || request.method !== "GET") {
      response.statusCode = 405;
      response.end("Method not allowed");
      return;
    }

    const requestPath = request.url === "/" ? "/index.html" : request.url.split("?")[0];
    const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
    let filePath = path.join(DIST_DIR, safePath);

    if (!existsSync(filePath) || (await fs.stat(filePath)).isDirectory()) {
      filePath = path.join(DIST_DIR, "index.html");
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", getContentType(filePath));
    createReadStream(filePath).pipe(response);
  } catch (error) {
    sendJson(response, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Server error."
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Preview server running at http://127.0.0.1:${PORT}`);
});
