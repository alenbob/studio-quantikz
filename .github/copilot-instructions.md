# Project Guidelines

## Build And Test

- Use `npm run dev` for local development, `npm run build` for production validation, and `npm test` for the full Vitest suite.
- Prefer targeted Vitest runs for focused changes, especially in `test/` files that mirror the area you changed.
- Do not rely on a local TeX toolchain when working on rendering. The supported preview path is the remote PDF renderer used by `/api/render-pdf`.

## Architecture

- The renderer is a single-state React app. `src/renderer/App.tsx` owns editor state through `historyReducer`, which wraps `editorReducer` for undo and redo.
- Keep circuit mutations inside `src/renderer/reducer.ts`. Changes to items must preserve reducer-managed normalization and derived state such as connector normalization, horizontal segment normalization, `wireMask`, selection, and wire labels.
- Treat `src/renderer/components/Workspace.tsx` as the interaction and rendering surface, not the source of circuit state. Geometry and placement logic belong in helpers such as `layout.ts`, `placement.ts`, `movement.ts`, and `occupancy.ts`.
- Quantikz import and export are centralized in `src/renderer/importer.ts` and `src/renderer/exporter.ts`. Preserve round-trip behavior for visual editor state and Quantikz source.

## Conventions

- Follow the existing TypeScript and React style: functional components, named helpers, explicit unions for actions and item types, and minimal inline comments.
- When editing layout or placement behavior, reuse the existing layout and occupancy helpers instead of duplicating grid math in components.
- When editing reducer behavior, keep changes consistent with the existing pure-function pattern and update the matching tests in `test/reducer.test.ts` or the nearest focused test file.
- When editing Quantikz parsing or export, verify both directions: importer behavior in `test/importer.test.ts` and exporter behavior in `test/exporter.test.ts`.
- Multi-column gates are represented visually in editor state and exported as a real `\gate{...}` plus contiguous `\ghost{...}` cells. Preserve that mapping.
- When changing user-visible symbolic interpretation or website-visible guidance, update both `QUANTIKZ_GUIDE.md` and the in-app symbolic help in `src/renderer/App.tsx` in the same change.
- Before considering a user-visible feature change complete, run the Feature Change Checklist agent or perform the same checks manually: affected docs, in-app help, focused tests, and validation.

## Rendering Constraints

- The active preview path is PDF-only. `src/renderer/useRenderedPdf.ts` calls `/api/render-pdf`.
- Keep local development and deployed behavior aligned. Do not introduce local-only rendering paths that differ from Vercel behavior.
- For Quantikz documents, preserve the server-side preamble normalization in `src/server/renderQuantikz.ts` and the requirements documented in `QUANTIKZ_GUIDE.md`.
- Before changing rendering behavior, review the server entry points in `src/server/renderQuantikz.ts` and `api/render-pdf.ts`.

## Python Backend Scripts

- `quantikz_symbolic_latex.py` is the production Vercel Python handler for `/api/symbolic-latex`. Do not delete or rename it.
- `quantikz_statevector_evolution.py` is imported by `quantikz_symbolic_latex.py` and is included in the Vercel function bundle via `vercel.json`. Do not delete or rename it.
- `pdf2svg.py` is used by `src/server/renderQuantikz.ts` for local SVG conversion. Do not delete or rename it.
- `api/symbolic-latex-dev.ts` is a dev-only TypeScript mirror of the Python handler; it is active only when running `npm run dev`.

## Codebase Boundaries

- The Electron runtime (`src/main/`, `tsconfig.electron.json`, `scripts/launch-electron.cjs`) has been removed. Do not introduce Electron dependencies or revive those paths.
- `api/render-svg.ts` intentionally returns HTTP 501. Do not restore SVG rendering until a deployable full-LaTeX backend exists on Vercel.
- There is no `.gitlab-ci.yml` in this repo; CI runs on GitHub Actions if needed.

## Available Agents

- **Docs Sync** (`.github/agents/docs-sync.agent.md`): use when updating `QUANTIKZ_GUIDE.md` or in-app help to keep them aligned with shipped behavior.
- **Feature Change Checklist** (`.github/agents/feature-change-checklist.agent.md`): use before marking a user-visible feature complete; it validates docs, tests, and in-app help.
- **Quantikz Round-Trip** (`.github/agents/quantikz-roundtrip.agent.md`): use when modifying `importer.ts` or `exporter.ts` to verify both parse and emit directions stay consistent.
- **Reducer Change** (`.github/agents/reducer-change.agent.md`): use when modifying `reducer.ts` to confirm normalization invariants, derived state, and reducer tests are all updated together.