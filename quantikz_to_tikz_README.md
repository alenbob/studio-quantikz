# Quantikz on a TikZ-only server

The Quantikz paper/manual says that when the target platform does not have a recent enough Quantikz installation, you can include `tikzlibraryquantikz2.code.tex` in the source tree and load it with TikZ. That is usually the best approach.

This folder also contains `quantikz_to_tikz.py`, a best-effort transpiler for a useful subset of Quantikz into ordinary TikZ primitives.

## Preferred option

```tex
\usepackage{tikz}
\usetikzlibrary{quantikz2}
```

If the server lacks the library, copy `tikzlibraryquantikz2.code.tex` next to your main `.tex` file.

## Transpiler usage

```bash
python quantikz_to_tikz.py circuit.tex > circuit_tikz.tex
```

or

```bash
cat circuit.tex | python quantikz_to_tikz.py --stdin > circuit_tikz.tex
```

## Supported subset

- `\gate{...}` and `\gate[n]{...}`
- `\phase{...}`
- `\meter{}`
- `\ctrl{d}`, `\control{}`, `\targ{}`, `\targX{}`, `\swap{d}`
- `\lstick{...}`, `\rstick{...}`
- `\setwiretype{q|c|b|n}`
- global `wire types={...}`

Unsupported material is emitted as comments in the generated TikZ so you can patch it manually.
