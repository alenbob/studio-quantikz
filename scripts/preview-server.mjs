import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "..", "dist");
const PORT = Number(process.env.PORT || 4173);

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

  if (!preamble.trim()) {
    return { success: false, error: "A LaTeX preamble is required." };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "quantikzz-preview-"));
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
      sendJson(response, result.success ? 200 : 400, result);
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
