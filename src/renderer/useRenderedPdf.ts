import { useEffect, useRef, useState } from "react";
import { renderPdfBlobToPngBlob } from "./pdfRaster";

type RenderedPdfState = "idle" | "loading" | "ready" | "error";

interface RenderedPdfResult {
  pdfUrl: string | null;
  previewImageUrl: string | null;
  state: RenderedPdfState;
  error: string | null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function renderWithApi(code: string, preamble: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch("/api/render-pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ code, preamble }),
    signal
  });

  if (!response.ok) {
    let message = "Unable to render PDF preview.";

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

export function useRenderedPdf(code: string, preamble: string): RenderedPdfResult {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [state, setState] = useState<RenderedPdfState>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function clearPreviewUrls(): void {
    setPdfUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
      return null;
    });
    setPreviewImageUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
      return null;
    });
  }

  useEffect(() => {
    if (!code.trim()) {
      clearPreviewUrls();
      setError(null);
      setState("idle");
      return;
    }

    if (import.meta.env.MODE === "test") {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState("loading");
    setError(null);

    void renderWithApi(code, preamble, controller.signal)
      .then(async (pdfBlob) => {
        const pngBlob = await renderPdfBlobToPngBlob(pdfBlob);
        const nextPdfUrl = URL.createObjectURL(pdfBlob);
        const nextPreviewImageUrl = URL.createObjectURL(pngBlob);

        setPdfUrl((currentUrl) => {
          if (currentUrl) {
            URL.revokeObjectURL(currentUrl);
          }
          return nextPdfUrl;
        });
        setPreviewImageUrl((currentUrl) => {
          if (currentUrl) {
            URL.revokeObjectURL(currentUrl);
          }
          return nextPreviewImageUrl;
        });
        setError(null);
        setState("ready");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) {
          return;
        }

        clearPreviewUrls();
        setError(err instanceof Error ? err.message : "Failed to render preview.");
        setState("error");
      });

    return () => {
      controller.abort();
    };
  }, [code, preamble]);

  useEffect(() => () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  useEffect(() => () => {
    clearPreviewUrls();
  }, []);

  return { pdfUrl, previewImageUrl, state, error };
}