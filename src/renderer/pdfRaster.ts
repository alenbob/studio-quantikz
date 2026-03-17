const PREVIEW_RENDER_SCALE = 6;
const PDFJS_WORKER_SRC = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

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
      const viewport = firstPage.getViewport({ scale: PREVIEW_RENDER_SCALE });
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