import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPORT_PREAMBLE } from "../src/renderer/document";
import { renderQuantikzSvg } from "../src/server/renderQuantikz";

describe("renderQuantikzSvg", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a reset-state error while SVG rendering is disabled", async () => {
    const code = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H} & \ctrl{1} & \meter{} \\
\lstick{$\ket{0}$} & \qw & \targ{} & \qw
\end{quantikz}`;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await renderQuantikzSvg(code, DEFAULT_EXPORT_PREAMBLE);

    expect(result.success).toBe(false);
    expect(result.svg).toBeUndefined();
    expect(result.statusCode).toBe(501);
    expect(result.error).toContain("disabled pending a full LaTeX-based rewrite");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
