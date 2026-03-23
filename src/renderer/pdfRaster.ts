const PREVIEW_RENDER_SCALE = 6;
const MAX_PREVIEW_CANVAS_DIMENSION = 8192;
const MAX_PREVIEW_CANVAS_PIXELS = 33_554_432;
const PDFJS_WORKER_SRC = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export function getPreviewRenderScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return PREVIEW_RENDER_SCALE;
  }

  const dimensionLimitedScale = Math.min(
    MAX_PREVIEW_CANVAS_DIMENSION / width,
    MAX_PREVIEW_CANVAS_DIMENSION / height
  );
  const pixelLimitedScale = Math.sqrt(MAX_PREVIEW_CANVAS_PIXELS / (width * height));
  const safeScale = Math.min(PREVIEW_RENDER_SCALE, dimensionLimitedScale, pixelLimitedScale);

  return safeScale > 0 ? safeScale : 1;
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("Unable to prepare the preview image."));
    }, type);
  });
}

export async function renderPdfBlobToPngBlob(pdfBlob: Blob): Promise<Blob> {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;

  const pdfBytes = new Uint8Array(await blobToArrayBuffer(pdfBlob));
  const loadingTask = getDocument({ data: pdfBytes });

  try {
    const pdfDocument = await loadingTask.promise;

    try {
      const firstPage = await pdfDocument.getPage(1);
      const baseViewport = firstPage.getViewport({ scale: 1 });
      const viewport = firstPage.getViewport({
        scale: getPreviewRenderScale(baseViewport.width, baseViewport.height)
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas rendering is unavailable in this browser.");
      }

      await firstPage.render({ canvasContext: context, viewport }).promise;
      return canvasToBlob(canvas, "image/png");
    } finally {
      await pdfDocument.destroy();
    }
  } finally {
    await loadingTask.destroy();
  }
}