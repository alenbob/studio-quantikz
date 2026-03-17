import { buildStandaloneQuantikzDocument } from "./document";
import { renderPdfBlobToPngBlob } from "./pdfRaster";

export type DownloadFormat = "tex" | "pdf";

export interface ExportAssetSource {
  code: string;
  preamble: string;
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
  const response = await fetch("/api/render-pdf", {
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

export async function buildDownloadBlob(
  format: DownloadFormat,
  source: ExportAssetSource
): Promise<Blob> {
  if (format === "tex") {
    return new Blob(
      [buildStandaloneQuantikzDocument(source.preamble, source.code)],
      { type: "text/x-tex;charset=utf-8" }
    );
  }

  return fetchQuantikzPdf(source.code, source.preamble);
}
