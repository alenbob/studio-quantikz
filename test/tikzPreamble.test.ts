import { describe, expect, it } from "vitest";
import { resolveTikzRenderPreamble } from "../src/shared/tikzPreamble";

describe("resolveTikzRenderPreamble", () => {
  it("adds a pgfplots package and supported compat line for axis environments", () => {
    const resolved = resolveTikzRenderPreamble(
      String.raw`\begin{tikzpicture}
\begin{axis}[domain=0:4]
\addplot {x};
\end{axis}
\end{tikzpicture}`,
      String.raw`\documentclass[tikz,border=4pt]{standalone}
\usepackage{tikz}`
    );

    expect(resolved.texPackages).toMatchObject({ pgfplots: "" });
    expect(resolved.addToPreamble).toContain("\\pgfplotsset{compat=1.16}");
  });

  it("preserves an explicit pgfplots compat setting from the user preamble", () => {
    const resolved = resolveTikzRenderPreamble(
      String.raw`\begin{tikzpicture}
\begin{axis}[domain=0:4]
\addplot {x};
\end{axis}
\end{tikzpicture}`,
      String.raw`\documentclass[tikz,border=4pt]{standalone}
\usepackage{tikz}
\usepackage{pgfplots}
\pgfplotsset{compat=1.12}`
    );

    expect(resolved.texPackages).toMatchObject({ pgfplots: "" });
    expect(resolved.addToPreamble).toContain("\\pgfplotsset{compat=1.12}");
    expect(resolved.addToPreamble).not.toContain("\\pgfplotsset{compat=1.16}");
  });
});