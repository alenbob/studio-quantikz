# SVG Render Requirements

This file records the current status of the paused SVG generation path in this project.

The active preview path is PDF, not SVG. The app preview calls `/api/render-pdf`, which renders through the hosted full-TeX backend at `https://texlive.net/cgi-bin/latexcgi` unless a PDF renderer override is configured.

## Core Requirements

1. The inactive SVG route must fail explicitly rather than returning fake or partial SVG.
2. The active PDF preview path must use the same method locally and on Vercel.
3. The rendering method must run inside the deployable Node/Vercel environment.
4. Local development must not rely on a different rendering flow than the deployed app.
5. The response must never pretend rendering succeeded when compilation failed.

## Deployment Parity

1. The request flow used by the local app and by the deployed Vercel app must be equivalent.
2. The same server-side PDF rendering backend must be used in both environments.
3. If SVG support is reintroduced later, both local and Vercel must call that same service through the same code path.

## Rendering Constraints

1. The source of truth is TeX/TikZ input.
2. The project must not replace TeX rendering with a hand-built semantic SVG approximation.
3. The current active backend is a remote full-TeX PDF renderer reached by `/api/render-pdf`.
4. Quantikz documents must be sent as full LaTeX documents and must load `\usetikzlibrary{quantikz2}` together with `braket`, `amsmath`, `amssymb`, and `amsfonts` when the source uses a `quantikz` environment.
5. The `/api/render-svg` route must return an explicit unavailability error until a real deployable SVG backend exists.

## Verification Requirements

The current implementation is only acceptable if it is checked against both environments.

### Local PDF Check

1. Send a known plain TikZ example to the local `/api/render-pdf` endpoint.
2. Confirm the response indicates success.
3. Confirm the response contains PDF bytes.
4. Confirm the returned PDF corresponds to the diagram and is not blank.
5. Send a Quantikz example and confirm the response also succeeds with PDF output.

### Vercel PDF Check

1. Send the same plain TikZ example to the deployed `/api/render-pdf` endpoint.
2. Confirm the response indicates success.
3. Confirm the response contains PDF bytes.
4. Confirm the returned PDF corresponds to the same diagram and is not blank.
5. Send the same Quantikz example and confirm it also returns PDF output.

### SVG Route Check

1. Send any sample request to `/api/render-svg` locally and on Vercel.
2. Confirm the response is a structured failure.
3. Confirm the error message directs callers to the PDF preview instead of implying SVG support exists.

## Acceptance Criteria

The current preview work is complete only when all of the following are true:

1. Local and Vercel use the same rendering method.
2. The PDF endpoint returns PDF output for supported TikZ input.
3. The PDF endpoint returns PDF output for supported Quantikz input.
4. The SVG endpoint fails explicitly instead of returning fake or empty output.
5. The same samples behave consistently in local and deployed environments.