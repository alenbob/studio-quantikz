import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPORT_PREAMBLE } from "../src/renderer/document";
import { renderQuantikzSvg } from "../src/server/renderQuantikz";

describe("renderQuantikzSvg", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders plain tikz through the wasm backend", async () => {
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

  it("rejects quantikz input in the wasm-only renderer", async () => {
    const code = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H} & \ctrl{1} & \meter{} \\
\lstick{$\ket{0}$} & \qw & \targ{} & \qw
\end{quantikz}`;

    const result = await renderQuantikzSvg(code, DEFAULT_EXPORT_PREAMBLE);

    expect(result.success).toBe(false);
    expect(result.svg).toBeUndefined();
    expect(result.statusCode).toBe(422);
    expect(result.error).toContain("plain TikZ only");
  });
});
