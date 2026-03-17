import { useEffect, useRef, useState } from "react";

type RenderedSvgState = "idle" | "loading" | "ready" | "error";

interface RenderedSvgResult {
  svg: string;
  state: RenderedSvgState;
  error: string | null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function renderWithApi(code: string, preamble: string, signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/render-svg", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ code, preamble }),
    signal
  });

  const parsed = await response.json() as { success?: boolean; svg?: string; error?: string };
  if (!response.ok || !parsed.success || !parsed.svg) {
    throw new Error(parsed.error ?? "Unable to render SVG preview.");
  }

  return parsed.svg;
}

export function useRenderedSvg(code: string, preamble: string): RenderedSvgResult {
  const [svg, setSvg] = useState("");
  const [state, setState] = useState<RenderedSvgState>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!code.trim()) {
      setSvg("");
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
      .then((renderedSvg) => {
        setSvg(renderedSvg);
        setError(null);
        setState("ready");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) {
          return;
        }

        setSvg("");
        setError(err instanceof Error ? err.message : "Failed to render preview.");
        setState("error");
      });

    return () => {
      controller.abort();
    };
  }, [code, preamble]);

  return { svg, state, error };
}