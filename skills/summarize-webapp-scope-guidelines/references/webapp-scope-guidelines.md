# Webapp Scope and Guidelines

## Product definition

- Quantikz Studio is a React and Vite web app for visually building quantum circuit diagrams and round-tripping them to Quantikz LaTeX.
- The main product surface is a three-part editor: tool palette or object inspector, snapped circuit workspace, and export plus preview panel.
- The app is optimized for authoring, editing, validating, previewing, and exporting circuit diagrams, not for backend account workflows or quantum job execution.

## Supported user workflows

- Place and edit gates, meters, control dots, target pluses, swap markers, vertical connectors, horizontal wire segments, frames, slices, and wire labels.
- Resize the grid, change row and column spacing, toggle auto wires, lock or unlock wire selection, and apply colors or wire types to supported items.
- Convert the visual circuit into Quantikz, edit or paste Quantikz directly, and convert Quantikz back into the visual model.
- Review validation issues before export when items overlap, spans are invalid, labels are malformed, or swap relationships are inconsistent.
- Preview rendered output as PDF, copy the preview image, open the PDF, and download `.tex` or `.pdf`.
- Cache recent exports in browser history and reload or redownload them later.
- Switch to symbolic mode to derive symbolic LaTeX from Quantikz and preview the symbolic output as PDF when the symbolic pipeline is available.

## Editing model

- The circuit model is grid-based. Items anchor to cells or horizontal segments rather than arbitrary pixel coordinates.
- The visible tool set is intentionally constrained: select, wires, gate, meter, frame or slice annotation, control dot, target plus, and swap X.
- Selection changes the left rail from the palette to a contextual inspector so edits stay object-specific.
- Undo and redo operate on circuit state changes, while non-structural UI state such as tool switching or messages is excluded from history.
- Wire labels support left and right placement, row spans, and bracket styles.
- Horizontal wires can be explicit, absent, classical, or bundled, and some wire suppression is derived automatically from other circuit objects.

## Export and rendering architecture

- The exported source uses a standalone LaTeX preamble that defaults to `tikz`, `xcolor`, `quantikz2`, `amsmath`, `amssymb`, `amsfonts`, and `braket`.
- Quantikz export is generated from editor state and then validated against overlap rules, span rules, label rules, and swap consistency rules.
- The active preview path is `/api/render-pdf`, which forwards a full LaTeX document to a full-TeX renderer.
- The default PDF renderer is `https://texlive.net/cgi-bin/latexcgi` unless a renderer override is configured.
- When the source uses a `quantikz` environment, the server normalizes the preamble so the required Quantikz and AMS packages are present before rendering.
- Preview output is rasterized client-side for inline display, but the source of truth remains the PDF or LaTeX document.

## Symbolic mode

- Symbolic mode is a secondary output mode, not the primary editing representation.
- The symbolic view starts from Quantikz code, calls the symbolic conversion pipeline, and then renders the resulting LaTeX as PDF.
- The symbolic pipeline depends on Python availability and can fail explicitly when Python or the script environment is missing.
- Symbolic output should be described as derived analytical output, not as a replacement for the visual editor or Quantikz export.

## Hard guardrails

- Keep TeX rendering as the rendering authority. Do not replace it with a semantic SVG approximation.
- Keep local and deployed preview behavior aligned on the same server-side rendering path.
- Fail explicitly when rendering is unavailable or compilation fails. Do not imply success when rendering did not succeed.
- Keep `/api/render-svg` unavailable until a real deployable SVG backend exists.
- Treat browser export history as a convenience cache, not durable persistence.
- Preserve the snapped-grid editor model and validation rules when describing or extending the product.

## Non-goals and absent features

- No working SVG preview pipeline today.
- No evidence of authentication, multi-user collaboration, cloud document storage, or project backends beyond rendering endpoints.
- No evidence of quantum hardware execution, simulator orchestration, or notebook-style computation workflows.
- No evidence that Electron is the active primary runtime, even though some Electron-era files remain in the repo.

## Key source files
- `package.json`
- `QUANTIKZ_GUIDE.md`
- `src/renderer/App.tsx`
- `src/renderer/types.ts`
- `src/renderer/reducer.ts`
- `src/renderer/exporter.ts`
- `src/renderer/validation.ts`
- `src/server/renderQuantikz.ts`
- `src/server/renderSymbolicLatex.ts`
- `test/App.test.tsx`
