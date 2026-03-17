# Quantikz Guide

## PDF preview backend

The website preview now uses a single remote full-TeX PDF rendering path for both plain TikZ and Quantikz.

The left-hand code panel in the Quantikz output window posts directly to `/api/render-pdf`, and that endpoint forwards a full LaTeX document to the configured renderer service. The default public backend is `https://texlive.net/cgi-bin/latexcgi`, which accepts multipart form submissions and returns a compiled PDF. When the source contains a `quantikz` environment, the document must load the `quantikz2` TikZ library together with `braket`, `amsmath`, `amssymb`, and `amsfonts`.

This guide is a practical introduction to drawing quantum circuits with Quantikz in LaTeX.

For the remote full-TeX backend, load Quantikz like this:

```latex
\usepackage{tikz}
\usetikzlibrary{quantikz2}
\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{amsfonts}
\usepackage{braket}
```

The renderer can still accept a complete document that already declares its own Quantikz setup, but the default app preamble now uses `\usetikzlibrary{quantikz2}` together with the AMS and `braket` packages so the same full-TeX source can be sent to the remote backend in local development and on Vercel.

The dormant `/api/render-svg` path is no longer used for preview. It currently reports that SVG rendering is unavailable and points callers to the PDF preview instead.

## Minimal working example

```latex
\documentclass{article}
\usepackage{tikz}
\usetikzlibrary{quantikz2}

\begin{document}

\[
\begin{quantikz}
\lstick{\ket{0}} & \gate{H} & \gate{Z} & \meter{}
\end{quantikz}
\]

\end{document}
```

## The core idea

Quantikz circuits are written like a matrix.

- Each row is a wire.
- Each column is a time step.
- Cells are separated by `&`.
- New rows are started with `\\`.
- Most gate commands go in cells after the first `&`, because the first cell in a row has no incoming wire.

This:

```latex
\begin{quantikz}
\lstick{\ket{0}} & \gate{H} & \meter{}
\end{quantikz}
```

means:

- row 1 is one qubit wire
- column 1 has the left label `\ket{0}`
- column 2 has an `H` gate
- column 3 has a measurement

## The commands you will use most

| Command | Meaning | Example |
|---|---|---|
| `\gate{U}` | Single-qubit gate | `& \gate{H} &` |
| `\gate[2]{U}` | Gate spanning 2 wires | `& \gate[2]{U} &` |
| `\ctrl{1}` | Control 1 wire below | `& \ctrl{1} &` |
| `\ctrl{-1}` | Control 1 wire above | `& \ctrl{-1} &` |
| `\octrl{1}` | Open control | `& \octrl{1} &` |
| `\targ{}` | CNOT target | `& \targ{} &` |
| `\swap{1}` | Swap marker with vertical wire | `& \swap{1} &` |
| `\targX{}` | Matching swap marker | `& \targX{} &` |
| `\meter{}` | Measurement | `& \meter{} &` |
| `\phase{\alpha}` | Phase gate | `& \phase{\alpha} &` |
| `\lstick{...}` | Left wire label | `\lstick{\ket{0}}` |
| `\rstick{...}` | Right wire label | `\rstick{out}` |
| `\setwiretype{c}` | Change current wire to classical | `& \meter{} \setwiretype{c} &` |
| `\gategroup[2,steps=3]{...}` | Box around part of circuit | `\gategroup[2,steps=3]{block}` |
| `\slice{step}` | Dashed vertical slice marker | `\gate{H}\slice{step}` |

Two small syntax rules matter a lot:

- Commands like `\targ`, `\meter`, `\control`, and `\targX` should be written with empty braces: `\targ{}`, `\meter{}`.
- If you want a wire to continue past the last gate in a row, leave a trailing `&` after that gate.

## 1. Single-qubit circuits

```latex
\[
\begin{quantikz}
\lstick{\ket{0}} & \gate{H} & \gate{R_Z(\theta)} & \meter{}
\end{quantikz}
\]
```

Notes:

- Gate labels are already in math mode.
- `\lstick` and `\rstick` are the standard ways to label inputs and outputs.

## 2. Controlled gates

The most common two-qubit circuit is a controlled gate:

```latex
\[
\begin{quantikz}
\lstick{\ket{0}} & \gate{H} & \ctrl{1} & \meter{} \\
\lstick{\ket{0}} &          & \targ{}  & \meter{}
\end{quantikz}
\]
```

How it works:

- `\ctrl{1}` draws a filled control and connects to the wire 1 row below.
- `\ctrl{-1}` would connect to the wire above instead.
- `\targ{}` draws the CNOT target.

You can also use open controls:

```latex
\[
\begin{quantikz}
& \octrl{1} & \\
& \gate{Z}  &
\end{quantikz}
\]
```

### Compute AND and uncompute AND corner notation

Some papers use a corner symbol instead of drawing the full Toffoli target when the target qubit is known to start in `\ket{0}` or is guaranteed to end in `\ket{0}`. Figure 4 of Gidney and Babbush's paper on low-overhead quantum chemistry is a standard example.

In Quantikz, this is just two stacked controls plus removal of one horizontal wire segment with `\wireoverride{n}`.

Compute AND / right corner:

```latex
\[
\begin{quantikz}
& \ctrl{1} & \\
& \ctrl{1} & \\
& \wireoverride{n} &
\end{quantikz}
\]
```

This is shorthand for a Toffoli into a fresh `\ket{0}` target:

```latex
\[
\begin{quantikz}
& \ctrl{2} & \\
& \ctrl{1} & \\
\lstick{\ket{0}} & \targ{} &
\end{quantikz}
\]
```

Uncompute AND / left corner:

```latex
\[
\begin{quantikz}
& \ctrl{1} & \\
& \ctrl{1} & \\
& & \wireoverride{n}
\end{quantikz}
\]
```

This is shorthand for a Toffoli whose target is guaranteed to end in `\ket{0}`:

```latex
\[
\begin{quantikz}
& \ctrl{2} & \\
& \ctrl{1} & \\
& \targ{} & \rstick{\ket{0}}
\end{quantikz}
\]
```

The rule is simple:

- Put `\wireoverride{n}` in the bottom corner cell to remove the incoming wire and create the right-facing corner.
- Put `\wireoverride{n}` in the next bottom cell to remove the outgoing wire and create the left-facing corner.

## 3. Multi-wire gates

If one gate spans multiple wires, put it on the top wire and give the span as the optional argument:

```latex
\[
\begin{quantikz}
\lstick{\ket{\psi}} & \gate[2]{U} & \meter{} \\
\lstick{\ket{0}}    &             &
\end{quantikz}
\]
```

Important:

- The spanned rows below the gate should have empty cells in that same column.
- Put the command in the top-left cell of the gate.

## 4. Swap gates

Swaps use a pair of commands:

```latex
\[
\begin{quantikz}
\lstick{\ket{\psi}} & \swap{1} & \gate{H} \\
\lstick{\ket{0}}    & \targX{} &
\end{quantikz}
\]
```

Here:

- `\swap{1}` starts the swap and connects 1 row down.
- `\targX{}` is the matching X marker on the target row.

## 5. Labels

Wire labels:

```latex
\[
\begin{quantikz}
\lstick{\ket{0}} & \gate{H} & \rstick{\ket{+}}
\end{quantikz}
\]
```

Labels spanning multiple wires:

```latex
\[
\begin{quantikz}
\lstick[2]{input register} & \gate[2]{U_f} & \rstick[2]{output} \\
                           &               &
\end{quantikz}
\]
```

## 6. Measurement and classical wires

By default, wires are quantum wires. You can declare classical wires with `wire types={...}` or switch a wire mid-circuit with `\setwiretype{c}`.

Example:

```latex
\[
\begin{quantikz}[wire types={q,c}]
\lstick{\ket{0}} & \gate{H} & \meter{} \\
\lstick{m}       &          & \setwiretype{q}
\end{quantikz}
\]
```

You can also draw an explicit vertical classical wire from the current cell:

```latex
\wire[d][1]{c}
```

That is useful when measurement results classically control later operations.

## 7. Grouping part of a circuit

Use `\gategroup` to draw a box around a logical block:

```latex
\[
\begin{quantikz}
\lstick{\ket{0}} & \gate{H}\gategroup[2,steps=2,style={rounded corners, dashed, inner xsep=2pt},background]{Entangle} & \ctrl{1} & \meter{} \\
\lstick{\ket{0}} &                                                                                                     & \targ{}  & \meter{}
\end{quantikz}
\]
```

The key arguments are:

- the first optional number: how many wires the box spans
- `steps=...`: how many columns it spans
- the mandatory argument: the label

## 8. Slicing a circuit into steps

Slices add vertical dashed separators between stages:

```latex
\[
\begin{quantikz}
& \gate{H}\slice{prepare} & \ctrl{1}\slice{entangle} & \meter{} \\
&                         & \targ{}                  & \meter{}
\end{quantikz}
\]
```

You can also ask Quantikz to slice every column automatically with `slice all`, but this works best when every row has the same number of cells.

## 9. Spacing and layout

These options are useful when a circuit looks cramped:

```latex
\begin{quantikz}[row sep={0.8cm,between origins}, column sep=0.6cm]
...
\end{quantikz}
```

Useful options:

- `row sep=...`
- `column sep=...`
- `between origins`
- `thin lines`
- `transparent`

## 10. Common mistakes

1. Forgetting the empty braces on commands like `\targ{}` or `\meter{}`.
2. Putting a gate command in the very first cell of a row.
3. Forgetting that `\setwiretype{...}` affects the wire drawn from the current cell back to the previous one, so it sometimes needs to appear one column later than expected.
4. Mixing row lengths when using `\slice` or `\gategroup`.
5. Forgetting the trailing `&` when you want an outgoing wire after the final gate.

## 11. A complete example

```latex
\documentclass{article}
\usepackage{tikz}
\usetikzlibrary{quantikz2}

\begin{document}

\[
\begin{quantikz}[row sep={0.8cm,between origins}, column sep=0.7cm]
\lstick{\ket{0}} & \gate{H}\slice{prep} & \ctrl{1} & \meter{} \\
\lstick{\ket{0}} &                      & \targ{}  & \meter{}
\end{quantikz}
\]

\end{document}
```

## Quick reference

- Single gate: `& \gate{H} &`
- Controlled-NOT: `& \ctrl{1} &` on one row, `& \targ{} &` on the other
- Compute AND corner: stacked `\ctrl{1}` controls with bottom `\wireoverride{n}`
- Uncompute AND corner: stacked `\ctrl{1}` controls with bottom-row `\wireoverride{n}` in the next cell
- Multi-wire gate: `\gate[3]{U}`
- Swap: `\swap{1}` with `\targX{}`
- Measurement: `\meter{}`
- Left/right labels: `\lstick{...}`, `\rstick{...}`
- Change wire type: `\setwiretype{c}`
- Add a block label: `\gategroup[2,steps=3]{...}`
- Add a step divider: `\slice{...}`

## Companion example

See `/Users/alessandro.summer/Documents/quantikzz/quantikz_example.tex` for a small LaTeX file with working sample circuits.
