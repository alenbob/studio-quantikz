/**
 * Client-side TikZ/quantikz rendering using the artisticat1/tikzjax WASM bundle
 * (public/tikzjax.js). This replaces the server-side latex+dvisvgm pipeline for
 * the SVG preview, making it work in both local dev and on Vercel.
 *
 * The tikzjax.js is a 7 MB self-contained bundle that includes the TeX WASM
 * engine with quantikz pre-compiled into the format. It is loaded lazily on
 * first use and cached by the browser thereafter.
 */

import { useEffect, useRef, useState } from "react";

type TikzJaxState = "idle" | "loading" | "ready" | "error";

interface TikzJaxResult {
  svg: string;
  state: TikzJaxState;
  error: string | null;
}

// Load tikzjax.js once per page. The script watches the DOM for
// <script type="text/tikz"> elements and replaces them with SVGs.
let scriptLoadPromise: Promise<void> | null = null;

function loadTikzJaxScript(): Promise<void> {
  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    // Already loaded (e.g. hot-reload scenario)
    if (document.getElementById("tikzjax-script")) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.id = "tikzjax-script";
    script.src = "/tikzjax.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load tikzjax.js"));
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

/**
 * Renders a quantikz / TikZ source string to SVG using the client-side WASM.
 *
 * @param code  - The body of the tikz/quantikz environment, WITHOUT \begin{document}.
 * @param preamble - The full LaTeX preamble (used only to extract addToPreamble lines).
 * @returns An object with { svg, state, error }.
 */
export function useTikzJax(code: string, preamble: string): TikzJaxResult {
  const [svg, setSvg] = useState("");
  const [state, setState] = useState<TikzJaxState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Keep a ref to cancel in-flight renders when code/preamble changes.
  const cancelRef = useRef(false);

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

    cancelRef.current = false;
    setState("loading");
    setError(null);

    // Build the addToPreamble: strip \documentclass, \usepackage{tikz}, and any
    // \usetikzlibrary{quantikz*} — quantikz is loaded via data-tex-packages instead.
    const addToPreamble = preamble
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return (
          t !== "" &&
          !t.startsWith("\\documentclass") &&
          t !== "\\usepackage{tikz}" &&
          !t.startsWith("\\usetikzlibrary{quantikz")
        );
      })
      .join("\n")
      .trim();

    let container: HTMLDivElement | null = null;
    let observer: MutationObserver | null = null;

    // Listen at document level so bubbling works regardless of container attachment.
    const finishedHandler = (event: Event) => {
      if (cancelRef.current) return;
      // Make sure this event came from inside our container.
      if (!container || !container.contains(event.target as Node)) return;
      document.removeEventListener("tikzjax-load-finished", finishedHandler);
      // Grab the live SVG from the container — safer than event.target, which may
      // be an intermediate node in some tikzjax versions.
      const svgEl = container.querySelector("svg");
      const rendered = svgEl?.outerHTML ?? (event.target as Element)?.outerHTML ?? "";
      cleanup();
      setSvg(rendered);
      setError(null);
      setState("ready");
    };

    function cleanup() {
      document.removeEventListener("tikzjax-load-finished", finishedHandler);
      observer?.disconnect();
      observer = null;
      if (container && document.body.contains(container)) {
        document.body.removeChild(container);
        container = null;
      }
    }

    loadTikzJaxScript()
      .then(() => {
        if (cancelRef.current) return;

        // Create a hidden container in the document body so tikzjax can detect it.
        container = document.createElement("div");
        container.style.cssText = "position:fixed;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;";

        const scriptEl = document.createElement("script");
        scriptEl.type = "text/tikz";
        // The obsidian-tikzjax bundle has quantikz compiled into its WASM format as
        // a package (not as a TikZ library). Use texPackages to load it.
        scriptEl.dataset["texPackages"] = '{"quantikz": ""}';
        // Bust previously cached broken renders after renderer bundle updates.
        scriptEl.dataset["quantikzzVersion"] = "2";
        // Enable TeX console output in the browser console for debugging.
        scriptEl.dataset["showConsole"] = "true";
        if (addToPreamble) {
          scriptEl.dataset["addToPreamble"] = addToPreamble;
        }
        // The content is the body of the tikz environment, without \begin{document}.
        scriptEl.textContent = code.trim();

        container.appendChild(scriptEl);

        // tikzjax fires "tikzjax-load-finished" (bubbles:true) on the final rendered SVG.
        // Listen at document level to avoid any container-subtree bubbling edge cases.
        document.addEventListener("tikzjax-load-finished", finishedHandler);

        // Fallback: tikzjax replaces the loader with <img .../> on rendering error.
        observer = new MutationObserver(() => {
          if (cancelRef.current) { observer?.disconnect(); return; }
          if (container?.querySelector("img")) {
            cleanup();
            setSvg("");
            setError("TikZ rendering failed.");
            setState("error");
          }
        });

        observer.observe(container, { childList: true, subtree: true });
        document.body.appendChild(container);
      })
      .catch((err: unknown) => {
        if (cancelRef.current) return;
        document.removeEventListener("tikzjax-load-finished", finishedHandler);
        setSvg("");
        setError(err instanceof Error ? err.message : "Failed to load renderer.");
        setState("error");
      });

    return () => {
      cancelRef.current = true;
      cleanup();
    };
  }, [code, preamble]);

  return { svg, state, error };
}
