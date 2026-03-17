import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPORT_PREAMBLE } from "../src/renderer/document";

import { renderQuantikzPdf } from "../src/server/renderQuantikz";

describe("renderQuantikzPdf", () => {
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

  it("proxies quantikz input to the full tex pdf backend", async () => {
    const expectedPdf = Buffer.from("%PDF-1.7\n", "utf8");
    const fetchMock = vi.fn().mockResolvedValue(new Response(expectedPdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf"
      }
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const code = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H} & \ctrl{1} & \meter{} \\
\lstick{$\ket{0}$} & \qw & \targ{} & \qw
\end{quantikz}`;

    const result = await renderQuantikzPdf(code, DEFAULT_EXPORT_PREAMBLE);

    expect(result).toEqual({ success: true, pdf: expectedPdf });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://renderer.example.test/render-pdf",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const request = fetchMock.mock.calls[0]?.[1];
    const payload = JSON.parse(String(request?.body)) as { document: string; format: string };
    expect(payload.format).toBe("pdf");
    expect(payload.document).toContain("\\usetikzlibrary{quantikz2}");
    expect(payload.document).toContain("\\usepackage{amsmath}");
    expect(payload.document).toContain("\\usepackage{amssymb}");
    expect(payload.document).toContain("\\usepackage{amsfonts}");
    expect(payload.document).toContain("\\usepackage{braket}");
    expect(payload.document).toContain("\\begin{document}");
    expect(payload.document).toContain(code.trim());
  });

  it("reports upstream pdf failures with the remote status code", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Undefined control sequence"
    }), {
      status: 400,
      headers: {
        "Content-Type": "application/json"
      }
    })) as typeof fetch;

    const result = await renderQuantikzPdf(String.raw`\begin{quantikz}\gate{H}\end{quantikz}`, DEFAULT_EXPORT_PREAMBLE);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.error).toContain("Undefined control sequence");
  });

  it("falls back to texlive.net when no remote renderer is configured", async () => {
    delete process.env.FULL_TEX_RENDERER_URL;

    const expectedPdf = Buffer.from("%PDF-1.7\n", "utf8");
    const fetchMock = vi.fn().mockResolvedValue(new Response(expectedPdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf"
      }
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await renderQuantikzPdf(String.raw`\begin{quantikz}\gate{H}\end{quantikz}`, DEFAULT_EXPORT_PREAMBLE);

    expect(result).toEqual({ success: true, pdf: expectedPdf });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://texlive.net/cgi-bin/latexcgi",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData)
      })
    );
  });
});