import { buildStandaloneQuantikzDocument } from "./document";
import { buildApiUrl } from "./api";
import { renderPdfBlobToPngBlob } from "./pdfRaster";

export type DownloadFormat = "tex" | "pdf" | "svg";

export interface ExportAssetSource {
  code: string;
  preamble: string;
}

interface SvgRenderResponse {
  success?: boolean;
  svg?: string;
  error?: string;
}

export function getDownloadFilename(baseName: string, format: DownloadFormat): string {
  return `${baseName}.${format}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

export async function fetchQuantikzPdf(code: string, preamble: string): Promise<Blob> {
  const response = await fetch(buildApiUrl("/api/render-pdf"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ code, preamble })
  });

  if (!response.ok) {
    let message = "Unable to render PDF.";

    try {
      const parsed = await response.json() as { error?: string };
      if (parsed.error) {
        message = parsed.error;
      }
    } catch {
      // Keep the generic message for non-JSON failures.
    }

    throw new Error(message);
  }

  return response.blob();
}

function supportsClipboardMimeType(mimeType: string): boolean {
  if (typeof ClipboardItem === "undefined") {
    return false;
  }

  if (typeof ClipboardItem.supports === "function") {
    return ClipboardItem.supports(mimeType);
  }

  return mimeType === "image/png";
}

export async function copyQuantikzImageToClipboard(code: string, preamble: string): Promise<void> {
  if (!code.trim()) {
    throw new Error("Add Quantikz code before copying the figure.");
  }

  if (!navigator.clipboard || typeof navigator.clipboard.write !== "function") {
    throw new Error("Clipboard access is unavailable in this browser.");
  }

  if (!supportsClipboardMimeType("image/png")) {
    throw new Error("This browser cannot write PNG images to the clipboard.");
  }

  const pdfBlob = await fetchQuantikzPdf(code, preamble);
  const pngBlob = await renderPdfBlobToPngBlob(pdfBlob);
  const item = new ClipboardItem({
    "image/png": pngBlob
  });
  await navigator.clipboard.write([item]);
}

export async function copyQuantikzSvgToClipboard(
  source: ExportAssetSource,
  options: { svgMarkup?: string } = {}
): Promise<void> {
  if (!source.code.trim()) {
    throw new Error("Add Quantikz code before copying the figure.");
  }

  if (!navigator.clipboard || typeof navigator.clipboard.write !== "function") {
    throw new Error("Clipboard access is unavailable in this browser.");
  }

  if (!supportsClipboardMimeType("image/svg+xml")) {
    throw new Error("This browser cannot write SVG images to the clipboard.");
  }

  const svgBlob = await buildDownloadBlob("svg", source, options);
  const item = new ClipboardItem({
    "image/svg+xml": svgBlob
  });
  await navigator.clipboard.write([item]);
}

export async function buildDownloadBlob(
  format: DownloadFormat,
  source: ExportAssetSource,
  options: { svgMarkup?: string } = {}
): Promise<Blob> {
  if (format === "tex") {
    return new Blob(
      [buildStandaloneQuantikzDocument(source.preamble, source.code)],
      { type: "text/x-tex;charset=utf-8" }
    );
  }

  if (format === "svg") {
    if (options.svgMarkup?.trim()) {
      return new Blob([options.svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    }

    const response = await fetch(buildApiUrl("/api/render-svg"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: source.code,
        preamble: source.preamble
      })
    });

    const parsed = await response.json() as SvgRenderResponse;

    if (!response.ok || !parsed.success || !parsed.svg?.trim()) {
      throw new Error(parsed.error?.trim() || "SVG rendering is unavailable on this machine.");
    }

    return new Blob([parsed.svg], { type: "image/svg+xml;charset=utf-8" });
  }

  return fetchQuantikzPdf(source.code, source.preamble);
}
