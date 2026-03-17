import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPORT_PREAMBLE } from "../src/renderer/document";
import { renderQuantikzSvg } from "../src/server/renderQuantikz";

describe("renderQuantikzSvg", () => {
  const originalFetch = globalThis.fetch;
  const originalRendererUrl = process.env.FULL_TEX_RENDERER_URL;

  beforeEach(() => {
    process.env.FULL_TEX_RENDERER_URL = "https://renderer.example.test";
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch;
    }

    if (originalRendererUrl === undefined) {
      delete process.env.FULL_TEX_RENDERER_URL;
      return;
    }

    process.env.FULL_TEX_RENDERER_URL = originalRendererUrl;
  });

  it("renders plain tikz through the full tex svg backend", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      svg: "<svg><path d='M0 0L1 1'/></svg>"
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    })) as typeof fetch;

    const code = String.raw`\begin{tikzpicture}
\draw (0,0) circle (1);
\end{tikzpicture}`;

    const result = await renderQuantikzSvg(code, DEFAULT_EXPORT_PREAMBLE);

    expect(result.success).toBe(true);
    expect(result.statusCode).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.svg).toContain("<svg");
    expect(result.svg).toMatch(/<(path|line|rect|circle)\b/);
  });

  it("injects the quantikz package for quantikz input", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<svg><path d='M0 0L1 1'/></svg>", {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml"
      }
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const code = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H} & \ctrl{1} & \meter{} \\
\lstick{$\ket{0}$} & \qw & \targ{} & \qw
\end{quantikz}`;

    const result = await renderQuantikzSvg(code, "\\documentclass[tikz]{standalone}");

    expect(result.success).toBe(true);
    expect(result.statusCode).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.svg).toContain("<svg");

    const request = fetchMock.mock.calls[0]?.[1];
    const payload = JSON.parse(String(request?.body)) as { document: string; format: string };
    expect(payload.format).toBe("svg");
    expect(payload.document).toContain("\\usetikzlibrary{quantikz2}");
    expect(payload.document).toContain("\\usepackage{braket}");
  });

  it("returns service unavailable when the remote renderer is not configured", async () => {
    delete process.env.FULL_TEX_RENDERER_URL;

    const result = await renderQuantikzSvg(
      String.raw`\begin{quantikz}\gate{H}\end{quantikz}`,
      DEFAULT_EXPORT_PREAMBLE
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(501);
  });
});
