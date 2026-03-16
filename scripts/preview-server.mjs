import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tikzjaxModule from "node-tikzjax";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "..", "dist");
const PORT = Number(process.env.PORT || 4173);
const DEFAULT_WASM_PREAMBLE = [
  "\\usepackage{tikz}",
  "\\providecommand{\\ket}[1]{\\left|#1\\right\\rangle}",
  "\\providecommand{\\bra}[1]{\\left\\langle#1\\right|}",
  "\\providecommand{\\proj}[1]{\\left|#1\\right\\rangle\\left\\langle#1\\right|}"
].join("\n");
const UNSUPPORTED_QUANTIKZ_MESSAGE = "Quantikz SVG rendering is not available in the Vercel/WASM renderer yet. This endpoint currently supports plain TikZ only.";
const tex2svg = tikzjaxModule?.default ?? tikzjaxModule;
let svgRenderQueue = Promise.resolve();

function resolveTeXBinary(binaryName) {
  if (process.env.TEXBIN_PATH) {
    return path.join(process.env.TEXBIN_PATH, binaryName);
  }

  const macTeXBinary = path.join("/Library/TeX/texbin", binaryName);
  return existsSync(macTeXBinary) ? macTeXBinary : binaryName;
}

function resolveGhostscriptLibrary() {
  const candidates = [
    process.env.DVISVGM_LIBGS,
    process.env.LIBGS,
    "/opt/homebrew/lib/libgs.dylib",
    "/usr/local/lib/libgs.dylib",
    "/usr/lib/libgs.so",
    "/usr/lib64/libgs.so"
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function runCommand(binary, args, cwd) {
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

function buildStandaloneDocument(code, preamble) {
  return [preamble.trim(), "\\begin{document}", code.trim(), "\\end{document}"]
    .filter(Boolean)
    .join("\n");
}

function ensureDocumentBody(code) {
  const trimmed = code.trim();
  if (!trimmed) {
    return "";
  }

  if (/\\begin\{document\}/.test(trimmed)) {
    return trimmed;
  }

  return ["\\begin{document}", trimmed, "\\end{document}"].join("\n");
}

function sanitizeUsePackageLine(line) {
  const match = /^\s*\\usepackage(?:\[(?<options>[^\]]*)\])?\{(?<packages>[^}]*)\}\s*$/.exec(line);
  if (!(match && match.groups)) {
    return line;
  }

  const packages = match.groups.packages
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry !== "quantikz");

  if (!packages.length) {
    return null;
  }

  const options = match.groups.options ? `[${match.groups.options}]` : "";
  return `\\usepackage${options}{${packages.join(",")}}`;
}

function sanitizeTikzLibraryLine(line) {
  const match = /^\s*\\usetikzlibrary\{(?<libraries>[^}]*)\}\s*$/.exec(line);
  if (!(match && match.groups)) {
    return line;
  }

  const libraries = match.groups.libraries
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry !== "quantikz2");

  if (!libraries.length) {
    return null;
  }

  return `\\usetikzlibrary{${libraries.join(",")}}`;
}

function sanitizePreambleForWasm(preamble) {
  const sanitizedLines = [DEFAULT_WASM_PREAMBLE]
    .concat(preamble.split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line && !/^\\documentclass\b/.test(line))
    .filter((line) => line !== "\\begin{document}" && line !== "\\end{document}")
    .map((line) => sanitizeUsePackageLine(line))
    .filter(Boolean)
    .map((line) => sanitizeTikzLibraryLine(line))
    .filter(Boolean);

  return Array.from(new Set(sanitizedLines)).join("\n");
}

function looksLikeQuantikz(code) {
  return /\\begin\{quantikz\}|\\end\{quantikz\}|\\(lstick|rstick|gate|phase|ctrl|octrl|control|ocontrol|targX?|meter|qw|qwbundle|swap|slice|gategroup|setwiretype)\b/.test(code);
}

function hasGraphicPrimitives(svgMarkup) {
  const body = svgMarkup.includes("</defs>") ? svgMarkup.split("</defs>", 2)[1] : svgMarkup;
  return /<(path|line|rect|circle|ellipse|polygon|polyline)\b/.test(body);
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

async function withSvgRenderLock(work) {
  const nextRun = svgRenderQueue.then(work, work);
  svgRenderQueue = nextRun.then(() => undefined, () => undefined);
  return nextRun;
}

async function compileQuantikzDocument(code, preamble, tempDir) {
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

async function renderQuantikzSvg(code, preamble) {
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
    const svg = await withSvgRenderLock(() =>
      tex2svg(ensureDocumentBody(code), {
        addToPreamble: sanitizePreambleForWasm(preamble),
        embedFontCss: false,
        disableOptimize: false
      })
    );

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

async function renderQuantikzPdf(code, preamble) {
  if (!code.trim()) {
    return { success: false, error: "Quantikz code is required." };
  }

  if (!preamble.trim()) {
    return { success: false, error: "A LaTeX preamble is required." };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "quantikzz-preview-"));
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
        sendJson(response, 400, {
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
