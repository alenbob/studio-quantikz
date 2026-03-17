const REMOTE_RENDERER_URL_ENV = "FULL_TEX_RENDERER_URL";
const REMOTE_RENDERER_SVG_URL_ENV = "FULL_TEX_RENDERER_SVG_URL";
const REMOTE_RENDERER_PDF_URL_ENV = "FULL_TEX_RENDERER_PDF_URL";
const TEXLIVE_PDF_ENDPOINT = "https://texlive.net/cgi-bin/latexcgi";

interface RenderQuantikzSvgResult {
  success: boolean;
  svg?: string;
  error?: string;
  statusCode?: number;
}

interface RenderQuantikzPdfResult {
  success: boolean;
  pdf?: Buffer;
  error?: string;
  statusCode?: number;
}

interface RemoteRendererErrorResult {
  success: false;
  error: string;
  statusCode: number;
}

interface RemoteSvgPayload {
  success?: boolean;
  svg?: string;
  error?: string;
}

interface RemotePdfPayload {
  success?: boolean;
  pdfBase64?: string;
  error?: string;
}

interface TexliveRendererErrorResult {
  success: false;
  error: string;
  statusCode: number;
}

function buildStandaloneDocument(code: string, preamble: string): string {
  const trimmedCode = code.trim();
  if (/^\\documentclass/.test(trimmedCode)) {
    return trimmedCode;
  }

  const body = /\\begin\{document\}/.test(trimmedCode)
    ? trimmedCode
    : ["\\begin{document}", trimmedCode, "\\end{document}"].filter(Boolean).join("\n");

  return [preamble.trim(), body].filter(Boolean).join("\n");
}

function extractCompilerError(parts: Array<string | undefined>): string {
  const message = parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return message || "Unable to render PDF.";
}

function needsQuantikzSupport(code: string): boolean {
  return /\\begin\{quantikz\}/.test(code);
}

function normalizeFullLatexPreamble(preamble: string, code: string): string {
  const rawLines = preamble
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "\\begin{document}" && line !== "\\end{document}");

  const normalizedLines: string[] = [];
  let hasTikzPackage = false;
  let hasQuantikzLibrary = false;
  let hasAmsMathPackage = false;
  let hasAmsSymbPackage = false;
  let hasAmsFontsPackage = false;
  let hasBraketPackage = false;
  let hasDocumentClass = false;

  for (const line of rawLines) {
    if (/^\\documentclass/.test(line)) {
      hasDocumentClass = true;
      normalizedLines.push(line);
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
        .filter(Boolean);

      if (libraries.includes("quantikz2")) {
        hasQuantikzLibrary = true;
      }

      normalizedLines.push(`\\usetikzlibrary{${libraries.join(",")}}`);
      continue;
    }

    if (/^\\usepackage(?:\[[^\]]*\])?\{amsmath\}$/.test(line)) {
      hasAmsMathPackage = true;
      normalizedLines.push(line);
      continue;
    }

    if (/^\\usepackage(?:\[[^\]]*\])?\{amssymb\}$/.test(line)) {
      hasAmsSymbPackage = true;
      normalizedLines.push(line);
      continue;
    }

    if (/^\\usepackage(?:\[[^\]]*\])?\{amsfonts\}$/.test(line)) {
      hasAmsFontsPackage = true;
      normalizedLines.push(line);
      continue;
    }

    if (/^\\usepackage(?:\[[^\]]*\])?\{braket\}$/.test(line)) {
      hasBraketPackage = true;
      normalizedLines.push(line);
      continue;
    }

    normalizedLines.push(line);
  }

  if (!hasDocumentClass) {
    normalizedLines.unshift("\\documentclass[tikz,border=4pt]{standalone}");
  }

  const documentclassIndex = normalizedLines.findIndex((line) => /^\\documentclass/.test(line));
  const insertionIndex = documentclassIndex === -1 ? 0 : documentclassIndex + 1;

  if (!hasTikzPackage) {
    normalizedLines.splice(insertionIndex, 0, "\\usepackage{tikz}");
  }

  let nextInsertionIndex = insertionIndex + (hasTikzPackage ? 1 : 1);

  if (needsQuantikzSupport(code) && !hasQuantikzLibrary) {
    normalizedLines.splice(nextInsertionIndex, 0, "\\usetikzlibrary{quantikz2}");
    nextInsertionIndex += 1;
  }

  if (needsQuantikzSupport(code) && !hasAmsMathPackage) {
    normalizedLines.splice(nextInsertionIndex, 0, "\\usepackage{amsmath}");
    nextInsertionIndex += 1;
  }

  if (needsQuantikzSupport(code) && !hasAmsSymbPackage) {
    normalizedLines.splice(nextInsertionIndex, 0, "\\usepackage{amssymb}");
    nextInsertionIndex += 1;
  }

  if (needsQuantikzSupport(code) && !hasAmsFontsPackage) {
    normalizedLines.splice(nextInsertionIndex, 0, "\\usepackage{amsfonts}");
    nextInsertionIndex += 1;
  }

  if (needsQuantikzSupport(code) && !hasBraketPackage) {
    normalizedLines.splice(nextInsertionIndex, 0, "\\usepackage{braket}");
  }

  return normalizedLines.join("\n");
}

function resolveRemoteRendererEndpoint(format: "svg" | "pdf"): string | null {
  const specific = format === "svg"
    ? process.env[REMOTE_RENDERER_SVG_URL_ENV]
    : process.env[REMOTE_RENDERER_PDF_URL_ENV];

  if (specific?.trim()) {
    return specific.trim();
  }

  const baseUrl = process.env[REMOTE_RENDERER_URL_ENV]?.trim();
  if (!baseUrl) {
    return null;
  }

  return new URL(format === "svg" ? "/render-svg" : "/render-pdf", `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

function resolvePdfRendererEndpoint(): string {
  return resolveRemoteRendererEndpoint("pdf") ?? TEXLIVE_PDF_ENDPOINT;
}

function missingRemoteRendererResult(): RemoteRendererErrorResult {
  return {
    success: false,
    error: `Full TeX renderer is not configured. Set ${REMOTE_RENDERER_URL_ENV} or a format-specific renderer URL.`,
    statusCode: 503
  };
}

async function readErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const parsed = await response.json() as { error?: string };
      return parsed.error?.trim() || fallbackMessage;
    } catch {
      return fallbackMessage;
    }
  }

  try {
    const text = (await response.text()).trim();
    return text || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

async function requestTexlivePdf(document: string): Promise<Response | TexliveRendererErrorResult> {
  const endpoint = resolvePdfRendererEndpoint();

  if (endpoint === TEXLIVE_PDF_ENDPOINT) {
    const form = new FormData();
    form.append("filecontents[]", document);
    form.append("filename[]", "document.tex");
    form.append("engine", "pdflatex");
    form.append("return", "pdf");

    try {
      return await fetch(endpoint, {
        method: "POST",
        body: form
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unable to reach the PDF renderer.",
        statusCode: 503
      };
    }
  }

  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        document,
        format: "pdf"
      })
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to reach the PDF renderer.",
      statusCode: 503
    };
  }
}

async function requestRemoteRenderer(format: "svg" | "pdf", document: string): Promise<Response | RemoteRendererErrorResult> {
  const endpoint = resolveRemoteRendererEndpoint(format);

  if (!endpoint) {
    return missingRemoteRendererResult();
  }

  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        document,
        format
      })
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to reach the full TeX renderer.",
      statusCode: 503
    };
  }
}

function isRemoteRendererErrorResult(result: Response | RemoteRendererErrorResult): result is RemoteRendererErrorResult {
  return !(result instanceof Response);
}

async function parseRemotePdf(response: Response): Promise<RenderQuantikzPdfResult> {
  if (!response.ok) {
    return {
      success: false,
      error: await readErrorMessage(response, "Unable to render PDF."),
      statusCode: response.status
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/pdf")) {
    return {
      success: true,
      pdf: Buffer.from(await response.arrayBuffer())
    };
  }

  try {
    const parsed = await response.json() as RemotePdfPayload;

    if (!parsed.success || !parsed.pdfBase64) {
      return {
        success: false,
        error: parsed.error?.trim() || "Unable to render PDF.",
        statusCode: response.status || 502
      };
    }

    return {
      success: true,
      pdf: Buffer.from(parsed.pdfBase64, "base64")
    };
  } catch {
    return {
      success: false,
      error: "Full TeX renderer returned an invalid PDF response.",
      statusCode: 502
    };
  }
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

async function parseRemoteSvg(response: Response): Promise<RenderQuantikzSvgResult> {
  if (!response.ok) {
    return {
      success: false,
      error: await readErrorMessage(response, "Unable to render SVG."),
      statusCode: response.status
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("image/svg+xml")) {
    try {
      return {
        success: true,
        svg: validateSvgMarkup(await response.text())
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unable to render SVG.",
        statusCode: 502
      };
    }
  }

  try {
    const parsed = await response.json() as RemoteSvgPayload;

    if (!parsed.success || !parsed.svg) {
      return {
        success: false,
        error: parsed.error?.trim() || "Unable to render SVG.",
        statusCode: response.status || 502
      };
    }

    return {
      success: true,
      svg: validateSvgMarkup(parsed.svg)
    };
  } catch {
    return {
      success: false,
      error: "Full TeX renderer returned an invalid SVG response.",
      statusCode: 502
    };
  }
}

export async function renderQuantikzSvg(
  code: string,
  preamble: string
): Promise<RenderQuantikzSvgResult> {
  if (!resolveRemoteRendererEndpoint("svg")) {
    return {
      success: false,
      error: "SVG rendering is currently unavailable. Use the PDF preview instead.",
      statusCode: 501
    };
  }

  return renderQuantikzSvgFullLatex(code, preamble);
}

export async function renderQuantikzPdf(
  code: string,
  preamble: string
): Promise<RenderQuantikzPdfResult> {
  if (!code.trim()) {
    return { success: false, error: "Quantikz code is required." };
  }

  if (!preamble.trim()) {
    return { success: false, error: "A LaTeX preamble is required." };
  }

  const document = buildStandaloneDocument(code, normalizeFullLatexPreamble(preamble, code));
  const remoteResponse = await requestTexlivePdf(document);

  if (isRemoteRendererErrorResult(remoteResponse)) {
    return remoteResponse;
  }

  return parseRemotePdf(remoteResponse);
}

export async function renderQuantikzSvgFullLatex(
  code: string,
  preamble: string
): Promise<RenderQuantikzSvgResult> {
  if (!code.trim()) {
    return { success: false, error: "Quantikz code is required." };
  }

  if (!preamble.trim()) {
    return { success: false, error: "A LaTeX preamble is required." };
  }

  const document = buildStandaloneDocument(code, normalizeFullLatexPreamble(preamble, code));
  const remoteResponse = await requestRemoteRenderer("svg", document);

  if (isRemoteRendererErrorResult(remoteResponse)) {
    return remoteResponse;
  }

  return parseRemoteSvg(remoteResponse);
}
