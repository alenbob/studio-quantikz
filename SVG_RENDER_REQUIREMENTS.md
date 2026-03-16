# SVG Render Requirements

This file records the required behavior for the website SVG generation path in this project.

## Core Requirements

1. The SVG rendering path must use the same method locally and on Vercel. Never use a local TeX compiler for the website SVG API.
2. The rendering method must run inside the deployable Node/Vercel environment.
3. Local development must not rely on a separate local-only TeX flow if Vercel uses a different rendering path.
4. The output must be either valid SVG markup for supported TikZ input or an explicit unsupported-input error.
5. The response must never pretend Quantikz rendered successfully when the backend cannot actually compile it.

## Deployment Parity

1. The request flow used by the local app and by the deployed Vercel app must be equivalent.
2. The same server-side rendering backend and conversion logic must be used in both environments.
3. If a remote service is introduced later, both local and Vercel must call that same service through the same code path.

## Rendering Constraints

1. The source of truth is TeX/TikZ input.
2. The project must not replace TeX rendering with a hand-built semantic SVG approximation.
3. The current Vercel-safe backend is pure Node/WASM and supports plain TikZ, not Quantikz.
4. The final API response for supported preview/export requests must be valid SVG markup.

## Verification Requirements

The implementation is only acceptable if it is checked against both environments.

### Local Check

1. Send a known plain TikZ example to the local `/api/render-svg` endpoint.
2. Confirm the response indicates success.
3. Confirm the response contains SVG markup.
4. Confirm the returned SVG corresponds to the diagram and is not blank.
5. Send a Quantikz example and confirm the response is an explicit unsupported-input error.

### Vercel Check

1. Send the same plain TikZ example to the deployed `/api/render-svg` endpoint.
2. Confirm the response indicates success.
3. Confirm the response contains SVG markup.
4. Confirm the returned SVG corresponds to the same diagram and is not blank.
5. Send the same Quantikz example and confirm the response is an explicit unsupported-input error.

## Acceptance Criteria

The SVG rendering work is complete only when all of the following are true:

1. Local and Vercel use the same rendering method.
2. The method never invokes a local TeX compiler.
3. The endpoint returns SVG output for supported TikZ input.
4. Unsupported Quantikz input fails explicitly instead of returning fake or empty output.
5. The same samples behave consistently in local and deployed environments.