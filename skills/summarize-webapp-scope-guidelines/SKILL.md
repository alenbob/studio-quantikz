---
name: summarize-webapp-scope-guidelines
description: Summarize the product scope, supported workflows, architecture, and implementation guardrails of the Quantikz Studio webapp. Use when Codex needs a repo-grounded brief for onboarding, planning, documentation, feature scoping, or change review covering the visual circuit editor, Quantikz round-tripping, PDF preview pipeline, symbolic LaTeX mode, and explicit rendering constraints.
---

# Summarize Webapp Scope Guidelines

## Start with the bundled brief

Read [references/webapp-scope-guidelines.md](references/webapp-scope-guidelines.md) first. Use it as the baseline summary of the current product surface, workflow boundaries, and engineering guardrails.

## Reconfirm the current repo state

Verify the parts of the app that matter for the request before answering.

- Read `package.json` for the active product description and runtime stack.
- Read `QUANTIKZ_GUIDE.md` for Quantikz and PDF preview requirements.
- Read `src/renderer/App.tsx` for the visible UI surface, workflows, and export behavior.
- Read `src/renderer/types.ts`, `src/renderer/reducer.ts`, `src/renderer/exporter.ts`, and `src/renderer/validation.ts` for the circuit model, editing rules, export semantics, and validation rules.
- Read `src/server/renderQuantikz.ts` and `src/server/renderSymbolicLatex.ts` for backend behavior and environment constraints.

Read only the files needed for the user request. For a broad summary, use the files above in that order.

## Structure the summary

Separate confirmed behavior into these buckets when helpful:

1. Product scope
2. Supported user workflows
3. Technical architecture
4. Guardrails and non-goals
5. Open gaps or environment-dependent behavior

Prefer concise sections or flat bullets. Cite repo files when the user wants evidence or when a claim could be disputed.

## Preserve repo-specific constraints

- State that the app is a visual Quantikz editor and export tool, not a general quantum IDE.
- State that Quantikz or TeX is the source of truth for rendered output.
- State that the active preview path is PDF through `/api/render-pdf`.
- State that `/api/render-svg` is intentionally unavailable until a real deployable SVG backend exists.
- State that symbolic evolution is a secondary view derived from Quantikz and depends on the symbolic Python pipeline being available.
- State that local and deployed preview behavior are expected to use the same server-side rendering path.
- State that the editor favors snapped-grid constraints, explicit validation, and truthful failure states over permissive freeform drawing.

## Avoid inaccurate claims

- Do not claim SVG preview currently works.
- Do not present hand-built semantic SVG as an acceptable rendering fallback.
- Do not imply symbolic LaTeX is guaranteed in every environment.
- Do not invent authentication, collaboration, server persistence, or external execution features that are not present in the repo.
- Do not treat cached browser export history as durable backend storage.

## Use this answer shape when useful

```md
**Scope**
...

**Guidelines**
...

**Non-goals**
...
```
