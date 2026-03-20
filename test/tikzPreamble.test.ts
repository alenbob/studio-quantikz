import { describe, expect, it } from "vitest";
import { resolveTikzRenderPreamble, resolveVisualPreambleDefinitions } from "../src/shared/tikzPreamble";

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

  it("extracts custom KaTeX macros and color definitions for the visual editor", () => {
    const resolved = resolveVisualPreambleDefinitions(String.raw`\newcommand{\rixs}{\mathrm{RIXS}}
\DeclareMathOperator{\SpecOp}{Spec}
\definecolor{X1}{RGB}{200,93,45}
\colorlet{Accent}{X1!40}`);

    expect(resolved.katexMacros).toMatchObject({
      "\\rixs": "\\mathrm{RIXS}",
      "\\SpecOp": "\\operatorname{Spec}"
    });
    expect(resolved.latexColors).toMatchObject({
      x1: "#C85D2D",
      accent: "#E9BEAB"
    });
  });
});