import { useEffect, useRef, useState } from "react";

type TikzJaxState = "idle" | "loading" | "ready" | "error";

declare global {
  interface Window {
    TikzJax?: boolean;
  }
}

interface TikzJaxResult {
  svg: string;
  state: TikzJaxState;
  error: string | null;
}

const TIKZJAX_SCRIPT_ID = "quantikzz-browser-tikzjax";
const BROWSER_RENDER_TIMEOUT_MS = 15000;

let tikzJaxScriptPromise: Promise<void> | null = null;
let browserRenderQueue: Promise<void> = Promise.resolve();

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted.", "AbortError");
  }

  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function sanitizePreambleForBrowser(preamble: string): string {
  const sanitizedLines = preamble
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\\documentclass\b/.test(line))
    .filter((line) => line !== "\\begin{document}" && line !== "\\end{document}");

  return Array.from(new Set(sanitizedLines)).join("\n");
}

async function ensureTikzJaxScript(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("The browser TikzJax renderer is not available in this environment.");
  }

  if (window.TikzJax) {
    return;
  }

  if (tikzJaxScriptPromise) {
    return tikzJaxScriptPromise;
  }

  tikzJaxScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(TIKZJAX_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => window.setTimeout(resolve, 0), { once: true });
      existing.addEventListener("error", () => reject(new Error("Unable to load the TikzJax browser renderer.")), { once: true });
      if (window.TikzJax) {
        resolve();
      }
      return;
    }

    const script = document.createElement("script");
    script.id = TIKZJAX_SCRIPT_ID;
    script.async = true;
    script.src = "/tikzjax.js";
    script.addEventListener("load", () => window.setTimeout(resolve, 0), { once: true });
    script.addEventListener("error", () => reject(new Error("Unable to load the TikzJax browser renderer.")), { once: true });
    document.head.appendChild(script);
  });

  return tikzJaxScriptPromise;
}

async function renderWithBrowserTikzJax(code: string, preamble: string, signal: AbortSignal): Promise<string> {
  const runRender = async (): Promise<string> => {
    await ensureTikzJaxScript();
    if (signal.aborted) {
      throw createAbortError();
    }

    return new Promise<string>((resolve, reject) => {
      const host = document.createElement("div");
      host.setAttribute("aria-hidden", "true");
      host.style.position = "fixed";
      host.style.left = "-100000px";
      host.style.top = "0";
      host.style.width = "1px";
      host.style.height = "1px";
      host.style.overflow = "hidden";

      let settled = false;

      const cleanup = (): void => {
        observer.disconnect();
        signal.removeEventListener("abort", handleAbort);
        host.removeEventListener("tikzjax-load-finished", handleLoadFinished as EventListener);
        window.clearTimeout(timeoutId);
        host.remove();
      };

      const finishSuccess = (value: string): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve(value);
      };

      const finishError = (error: Error): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      };

      const inspectHost = (): void => {
        const renderedNode = host.firstElementChild;
        if (!renderedNode || renderedNode.tagName.toLowerCase() === "script") {
          return;
        }

        if (renderedNode.tagName.toLowerCase() === "svg") {
          finishSuccess(renderedNode.outerHTML);
          return;
        }

        finishError(new Error("Unable to render the Quantikz preview in the browser."));
      };

      const handleAbort = (): void => finishError(createAbortError());
      const handleLoadFinished = (event: Event): void => {
        const target = event.target;
        if (target instanceof SVGElement) {
          finishSuccess(target.outerHTML);
          return;
        }

        inspectHost();
      };

      const observer = new MutationObserver(() => inspectHost());
      const timeoutId = window.setTimeout(
        () => finishError(new Error("Timed out while rendering the Quantikz preview.")),
        BROWSER_RENDER_TIMEOUT_MS
      );

      signal.addEventListener("abort", handleAbort, { once: true });
      host.addEventListener("tikzjax-load-finished", handleLoadFinished as EventListener);
      observer.observe(host, { childList: true });

      const script = document.createElement("script");
      script.type = "text/tikz";
      script.textContent = code;

      const sanitizedPreamble = sanitizePreambleForBrowser(preamble);
      if (sanitizedPreamble) {
        script.dataset.addToPreamble = sanitizedPreamble;
      }

      document.body.appendChild(host);
      host.appendChild(script);
      inspectHost();
    });
  };

  const queuedRun = browserRenderQueue.then(runRender, runRender);
  browserRenderQueue = queuedRun.then(() => undefined, () => undefined);
  return queuedRun;
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
    void renderWithApi(code, preamble, controller.signal)
      .catch(async (apiError: unknown) => {
        if (controller.signal.aborted) {
          throw apiError;
        }

        return renderWithBrowserTikzJax(code, preamble, controller.signal);
      })
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
