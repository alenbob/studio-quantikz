import { useEffect, useRef, useState } from "react";

type TikzJaxState = "idle" | "loading" | "ready" | "error";

interface TikzJaxResult {
  svg: string;
  state: TikzJaxState;
  error: string | null;
}

export function useTikzJax(code: string, preamble: string): TikzJaxResult {
  const [svg, setSvg] = useState("");
  const [state, setState] = useState<TikzJaxState>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!code.trim()) {
      setSvg("");
      setError(null);
      setState("idle");
      return;
    }

    // In test mode, skip rendering.
    if (import.meta.env.MODE === "test") {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState("loading");
    setError(null);
    void fetch("/api/render-svg", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ code, preamble }),
      signal: controller.signal
    })
      .then(async (response) => {
        const parsed = await response.json() as { success?: boolean; svg?: string; error?: string };
        if (!response.ok || !parsed.success || !parsed.svg) {
          throw new Error(parsed.error ?? "Unable to render SVG preview.");
        }

        setSvg(parsed.svg);
        setError(null);
        setState("ready");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
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
