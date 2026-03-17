import { describe, expect, it } from "vitest";
import { shouldPreferBrowserTikzJax } from "../src/renderer/useTikzJax";

describe("shouldPreferBrowserTikzJax", () => {
  it("prefers the browser renderer for quantikz environments", () => {
    const code = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H}
\end{quantikz}`;

    expect(shouldPreferBrowserTikzJax(code, "")).toBe(true);
  });

  it("does not force plain tikz onto the browser path just because the preamble loads quantikz", () => {
    const code = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const preamble = String.raw`\documentclass[tikz]{standalone}
\usepackage{tikz}
\usetikzlibrary{quantikz2}`;

    expect(shouldPreferBrowserTikzJax(code, preamble)).toBe(false);
  });

  it("keeps plain tikz on the api path", () => {
    const code = String.raw`\begin{tikzpicture}
\draw (0,0) circle (1);
\end{tikzpicture}`;

    expect(shouldPreferBrowserTikzJax(code, "")).toBe(false);
  });
});