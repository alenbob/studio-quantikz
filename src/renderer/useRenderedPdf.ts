import { useEffect, useRef, useState } from "react";

type RenderedPdfState = "idle" | "loading" | "ready" | "error";

interface RenderedPdfResult {
  pdfUrl: string | null;
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
  const [state, setState] = useState<RenderedPdfState>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!code.trim()) {
      setPdfUrl((currentUrl) => {
        if (currentUrl) {
          URL.revokeObjectURL(currentUrl);
        }
        return null;
      });
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
      .then((pdfBlob) => {
        const nextUrl = URL.createObjectURL(pdfBlob);
        setPdfUrl((currentUrl) => {
          if (currentUrl) {
            URL.revokeObjectURL(currentUrl);
          }
          return nextUrl;
        });
        setError(null);
        setState("ready");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) {
          return;
        }

        setPdfUrl((currentUrl) => {
          if (currentUrl) {
            URL.revokeObjectURL(currentUrl);
          }
          return null;
        });
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
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
    }
  }, [pdfUrl]);

  return { pdfUrl, state, error };
}