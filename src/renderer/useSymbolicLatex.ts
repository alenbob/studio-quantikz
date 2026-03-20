import { useEffect, useRef, useState } from "react";
import type { SymbolicLatexResponse } from "../shared/symbolicLatex";

type SymbolicLatexState = "idle" | "loading" | "ready" | "error";

interface SymbolicLatexResult {
  latex: string;
  state: SymbolicLatexState;
  error: string | null;
}

function parseJsonResponse(body: string): SymbolicLatexResponse | null {
  try {
    return JSON.parse(body) as SymbolicLatexResponse;
  } catch {
    return null;
  }
}

function summarizeResponseBody(body: string): string {
  const normalized = body
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || "Unable to generate symbolic LaTeX.";
}

async function generateWithApi(code: string, signal: AbortSignal): Promise<string> {
  const endpoint = import.meta.env.DEV ? "/api/symbolic-latex-dev" : "/api/symbolic-latex";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ code }),
    signal
  });

  const responseBody = await response.text();
  const parsed = parseJsonResponse(responseBody);

  if (parsed) {
    if (!response.ok || !parsed.success) {
      throw new Error(parsed.success ? "Unable to generate symbolic LaTeX." : parsed.error);
    }

    return parsed.latex;
  }

  if (!response.ok) {
    throw new Error(summarizeResponseBody(responseBody));
  }

  const plainText = responseBody.trim();
  if (!plainText) {
    throw new Error("Symbolic LaTeX endpoint returned an empty response.");
  }

  return plainText;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function useSymbolicLatex(code: string): SymbolicLatexResult {
  const [latex, setLatex] = useState("");
  const [state, setState] = useState<SymbolicLatexState>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!code.trim()) {
      setLatex("");
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

    void generateWithApi(code, controller.signal)
      .then((nextLatex) => {
        setLatex(nextLatex);
        setError(null);
        setState("ready");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) {
          return;
        }

        setLatex("");
        setError(err instanceof Error ? err.message : "Unable to generate symbolic LaTeX.");
        setState("error");
      });

    return () => {
      controller.abort();
    };
  }, [code]);

  useEffect(() => () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  return { latex, state, error };
}
