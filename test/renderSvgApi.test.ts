import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../api/render-svg";
import { DEFAULT_EXPORT_PREAMBLE } from "../src/renderer/document";

describe("render-svg api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders plain tikz svg over the api", async () => {
    const request = {
      method: "POST",
      body: JSON.stringify({
        code: String.raw`\begin{tikzpicture}
\draw (0,0) circle (1);
\end{tikzpicture}`,
        preamble: DEFAULT_EXPORT_PREAMBLE
      }),
      on: () => request
    };

    const responseState: { statusCode?: number; payload?: unknown } = {};
    const response = {
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        responseState.payload = payload;
        return this;
      }
    };

    await handler(request, response);

    expect(responseState.statusCode).toBe(200);
    expect(responseState.payload).toMatchObject({ success: true });

    const payload = responseState.payload as { error?: string; svg?: string };
    expect(payload.error).toBeUndefined();
    expect(payload.svg).toContain("<svg");
    expect(payload.svg).toMatch(/<(path|line|rect|circle)\b/);
  });

  it("renders pgfplots axis svg over the api", async () => {
    const request = {
      method: "POST",
      body: JSON.stringify({
        code: String.raw`\begin{tikzpicture}
\begin{axis}[domain=0:4]
\addplot {x};
\end{axis}
\end{tikzpicture}`,
        preamble: DEFAULT_EXPORT_PREAMBLE
      }),
      on: () => request
    };

    const responseState: { statusCode?: number; payload?: unknown } = {};
    const response = {
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        responseState.payload = payload;
        return this;
      }
    };

    await handler(request, response);

    expect(responseState.statusCode).toBe(200);
    expect(responseState.payload).toMatchObject({ success: true });

    const payload = responseState.payload as { error?: string; svg?: string };
    expect(payload.error).toBeUndefined();
    expect(payload.svg).toContain("<svg");
    expect(payload.svg).toMatch(/<(path|line|rect|circle)\b/);
  });

  it("preserves math glyph font css over the api", async () => {
    const request = {
      method: "POST",
      body: JSON.stringify({
        code: String.raw`\begin{tikzpicture}
\node {$\gamma$};
\end{tikzpicture}`,
        preamble: DEFAULT_EXPORT_PREAMBLE + String.raw`
\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{amsfonts}`
      }),
      on: () => request
    };

    const responseState: { statusCode?: number; payload?: unknown } = {};
    const response = {
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        responseState.payload = payload;
        return this;
      }
    };

    await handler(request, response);

    expect(responseState.statusCode).toBe(200);
    const payload = responseState.payload as { error?: string; svg?: string };
    expect(payload.error).toBeUndefined();
    expect(payload.svg).toContain("@import url(/node-tikzjax/fonts.css)");
    expect(payload.svg).toContain("font-family=\"cmmi10\"");
  });

  it("returns a 422 for quantikz input on the wasm api", async () => {
    const request = {
      method: "POST",
      body: JSON.stringify({
        code: String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H} & \ctrl{1} & \meter{} \\
\lstick{$\ket{0}$} & \qw & \targ{} & \qw
\end{quantikz}`,
        preamble: DEFAULT_EXPORT_PREAMBLE
      }),
      on: () => request
    };

    const responseState: { statusCode?: number; payload?: { success?: boolean; error?: string; svg?: string } } = {};
    const response = {
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      json(payload: { success?: boolean; error?: string; svg?: string }) {
        responseState.payload = payload;
        return this;
      }
    };

    await handler(request, response);

    expect(responseState.statusCode).toBe(422);
    expect(responseState.payload).toMatchObject({ success: false });

    const payload = responseState.payload as { error?: string; svg?: string };
    expect(payload.svg).toBeUndefined();
    expect(payload.error).toContain("expl3 primitives");
  });
});
