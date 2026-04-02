import { useEffect, useRef, useState } from "react";

type SvgAvailabilityState = "checking" | "enabled" | "disabled";
type RenderedSvgState = "idle" | "loading" | "ready" | "error";

interface SvgStatusResponse {
  success?: boolean;
  localSvgEnabled?: boolean;
  message?: string;
}

interface SvgRenderResponse {
  success?: boolean;
  svg?: string;
  error?: string;
}

export interface RenderedSvgResult {
  svgUrl: string | null;
  svgMarkup: string | null;
  state: RenderedSvgState;
  error: string | null;
  availabilityState: SvgAvailabilityState;
  availabilityMessage: string;
  isAvailable: boolean;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function fetchSvgStatus(signal: AbortSignal): Promise<SvgStatusResponse> {
  const response = await fetch("/api/render-svg", {
    method: "GET",
    signal
  });

  if (!response.ok) {
    throw new Error("Unable to check local SVG support.");
  }

  return response.json() as Promise<SvgStatusResponse>;
}

async function fetchSvgMarkup(code: string, preamble: string, signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/render-svg", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ code, preamble }),
    signal
  });

  const parsed = await response.json() as SvgRenderResponse;

  if (!response.ok || !parsed.success || !parsed.svg?.trim()) {
    throw new Error(parsed.error?.trim() || "Unable to render SVG preview.");
  }

  return parsed.svg;
}

export function useRenderedSvg(code: string, preamble: string, enabled: boolean): RenderedSvgResult {
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const [state, setState] = useState<RenderedSvgState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [availabilityState, setAvailabilityState] = useState<SvgAvailabilityState>("checking");
  const [availabilityMessage, setAvailabilityMessage] = useState("Checking local SVG support...");
  const statusAbortRef = useRef<AbortController | null>(null);
  const renderAbortRef = useRef<AbortController | null>(null);

  function clearSvgPreview(): void {
    setSvgUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }

      return null;
    });
    setSvgMarkup(null);
  }

  useEffect(() => {
    if (import.meta.env.MODE === "test") {
      setAvailabilityState("disabled");
      setAvailabilityMessage("SVG not enabled (using PDF preview).");
      return;
    }

    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;

    setAvailabilityState("checking");
    setAvailabilityMessage("Checking local SVG support...");

    void (async () => {
      try {
        const status = await fetchSvgStatus(controller.signal);
        if (controller.signal.aborted) {
          return;
        }

        if (status.success && status.localSvgEnabled) {
          setAvailabilityState("enabled");
          setAvailabilityMessage(status.message?.trim() || "SVG enabled: local Python converter detected.");
          return;
        }

        setAvailabilityState("disabled");
        setAvailabilityMessage(status.message?.trim() || "SVG not enabled (using PDF preview).");
      } catch (statusError) {
        if (controller.signal.aborted || isAbortError(statusError)) {
          return;
        }

        setAvailabilityState("disabled");
        setAvailabilityMessage("SVG not enabled (using PDF preview).");
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!enabled || availabilityState !== "enabled" || !code.trim()) {
      renderAbortRef.current?.abort();
      clearSvgPreview();
      setError(null);
      setState("idle");
      return;
    }

    if (import.meta.env.MODE === "test") {
      return;
    }

    renderAbortRef.current?.abort();
    const controller = new AbortController();
    renderAbortRef.current = controller;

    setState("loading");
    setError(null);

    void (async () => {
      try {
        const svg = await fetchSvgMarkup(code, preamble, controller.signal);
        if (controller.signal.aborted) {
          return;
        }

        const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        const nextSvgUrl = URL.createObjectURL(svgBlob);

        setSvgUrl((currentUrl) => {
          if (currentUrl) {
            URL.revokeObjectURL(currentUrl);
          }

          return nextSvgUrl;
        });
        setSvgMarkup(svg);
        setState("ready");
        setError(null);
      } catch (renderError) {
        if (controller.signal.aborted || isAbortError(renderError)) {
          return;
        }

        clearSvgPreview();
        setState("error");
        setError(renderError instanceof Error ? renderError.message : "Failed to render SVG preview.");
      }
    })();

    return () => {
      controller.abort();
    };
  }, [availabilityState, code, enabled, preamble]);

  return {
    svgUrl,
    svgMarkup,
    state,
    error,
    availabilityState,
    availabilityMessage,
    isAvailable: availabilityState === "enabled"
  };
}
