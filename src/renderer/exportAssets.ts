import { buildStandaloneQuantikzDocument } from "./document";

export type DownloadFormat = "tex" | "pdf";

export interface ExportAssetSource {
  code: string;
  preamble: string;
  svg: string;
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

export function svgMarkupToDataUrl(svgMarkup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
}

export async function svgMarkupToPngBlob(svgMarkup: string): Promise<Blob> {
  if (!svgMarkup.trim()) {
    throw new Error("Render the Quantikz preview before exporting PNG.");
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" }));

    const cleanup = (): void => {
      URL.revokeObjectURL(objectUrl);
    };

    image.onload = () => {
      const width = Math.max(1, Math.ceil(image.naturalWidth || image.width || 1));
      const height = Math.max(1, Math.ceil(image.naturalHeight || image.height || 1));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");

      if (!context) {
        reject(new Error("Canvas export is unavailable in this browser."));
        return;
      }

      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((nextBlob) => {
        cleanup();

        if (!nextBlob) {
          reject(new Error("Unable to rasterize the Quantikz preview."));
          return;
        }

        resolve(nextBlob);
      }, "image/png");
    };

    image.onerror = () => {
      cleanup();
      reject(new Error("Unable to load the Quantikz SVG preview."));
    };
    image.src = objectUrl;
  });

  return blob;
}

export async function copySvgToClipboard(svgMarkup: string): Promise<void> {
  if (!svgMarkup.trim()) {
    throw new Error("Render the Quantikz preview before copying the SVG.");
  }

  if (!navigator.clipboard) {
    throw new Error("Clipboard access is unavailable in this browser.");
  }

  if (typeof ClipboardItem !== "undefined" && typeof navigator.clipboard.write === "function") {
    const item = new ClipboardItem({
      "image/svg+xml": new Blob([svgMarkup], { type: "image/svg+xml" }),
      "text/plain": new Blob([svgMarkup], { type: "text/plain" })
    });
    await navigator.clipboard.write([item]);
    return;
  }

  await navigator.clipboard.writeText(svgMarkup);
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

  if (format === "svg") {
    return new Blob([source.svg], { type: "image/svg+xml;charset=utf-8" });
  }

  if (format === "png") {
    return svgMarkupToPngBlob(source.svg);
  }

  return fetchQuantikzPdf(source.code, source.preamble);
}
