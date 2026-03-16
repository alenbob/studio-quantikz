import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../api/render-svg";
import { DEFAULT_EXPORT_PREAMBLE } from "../src/renderer/document";

describe("render-svg api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a 501 while SVG rendering is reset", async () => {
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

    expect(responseState.statusCode).toBe(501);
    expect(responseState.payload).toMatchObject({ success: false });

    const payload = responseState.payload as { error?: string; svg?: string };
    expect(payload.svg).toBeUndefined();
    expect(payload.error).toContain("disabled pending a full LaTeX-based rewrite");
  });
});
