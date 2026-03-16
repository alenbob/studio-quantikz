# SVG Render Requirements

This file records the required behavior for Quantikz SVG generation in this project.

## Core Requirements

1. The SVG rendering path must use the same method locally and on Vercel.
2. The rendering method must use LaTeX compilation.
3. Local development must not rely on a separate local-only TeX flow if Vercel uses a different rendering path.
4. The output must be an SVG representing the circuit, not a placeholder, empty box, or unrelated graphic.
5. The rendered result must correspond to the submitted Quantikz circuit content.

## Deployment Parity

1. The request flow used by the local app and by the deployed Vercel app must be equivalent.
2. The same server-side rendering backend and conversion logic must be used in both environments.
3. If a remote LaTeX service is used, both local and Vercel must call that same service through the same code path.

## Rendering Constraints

1. The source of truth is LaTeX/Quantikz input.
2. The project must not replace LaTeX rendering with a hand-built semantic SVG approximation.
3. Any preprocessing or conversion step is acceptable only if it still preserves a LaTeX-based rendering pipeline.
4. The final API response for SVG preview/export must be valid SVG markup.

## Verification Requirements

The implementation is only acceptable if it is checked against both environments.

### Local Check

1. Send a known Quantikz circuit to the local `/api/render-svg` endpoint.
2. Confirm the response indicates success.
3. Confirm the response contains SVG markup.
4. Confirm the returned SVG corresponds to the circuit and is not blank.

### Vercel Check

1. Send the same Quantikz circuit to the deployed `/api/render-svg` endpoint.
2. Confirm the response indicates success.
3. Confirm the response contains SVG markup.
4. Confirm the returned SVG corresponds to the same circuit and is not blank.

## Acceptance Criteria

The SVG rendering work is complete only when all of the following are true:

1. Local and Vercel use the same rendering method.
2. The method is LaTeX-based.
3. The endpoint returns SVG output for the circuit.
4. The returned SVG is visually a circuit render, not a white rectangle or empty placeholder.
5. The same sample circuit behaves consistently in local and deployed environments.