import { describe, expect, it } from "vitest";
import { DEFAULT_SYMBOLIC_PREAMBLE, normalizeSymbolicPreamble } from "../src/renderer/document";

describe("symbolic preamble normalization", () => {
  it("maps the old cropped symbolic default to the fixed-width standalone default", () => {
    expect(normalizeSymbolicPreamble(String.raw`\documentclass[border=4pt]{standalone}
\usepackage{xcolor}
\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{amsfonts}
\usepackage{braket}`)).toBe(DEFAULT_SYMBOLIC_PREAMBLE);
  });

  it("maps the old fixed-width symbolic default to the fixed-width standalone default", () => {
    expect(normalizeSymbolicPreamble(String.raw`\documentclass[varwidth=2400pt,border=4pt]{standalone}
\usepackage{xcolor}
\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{amsfonts}
\usepackage{braket}`)).toBe(DEFAULT_SYMBOLIC_PREAMBLE);
  });

  it("maps the bare varwidth symbolic default to the fixed-width standalone default", () => {
    expect(normalizeSymbolicPreamble(String.raw`\documentclass[varwidth,border=4pt]{standalone}
\usepackage{xcolor}
\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{amsfonts}
\usepackage{braket}`)).toBe(DEFAULT_SYMBOLIC_PREAMBLE);
  });

  it("leaves custom symbolic preambles unchanged", () => {
    const preamble = String.raw`\documentclass[border=6pt]{standalone}
\usepackage{amsmath}
\newcommand{\foo}{bar}`;

    expect(normalizeSymbolicPreamble(preamble)).toBe(preamble);
  });
});
