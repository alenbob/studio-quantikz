# GitHub Pages Frontend + Render Backend

This repo is set up for a split deployment:

- frontend on GitHub Pages
- backend on Render

GitHub Pages does not run the Node or Python API routes in `api/`, so the app still needs a real backend for:

- `/api/render-pdf`
- `/api/render-svg`
- `/api/symbolic-latex`
- `/api/store-share-code`
- `/api/share-preview-image`
- `/api/share`
- `/api/bug-report`
- `/api/bug-reports`

The checked-in backend path is now a standalone Node server started with `npm run start:backend`, packaged by the root `Dockerfile`, and provisioned on Render with `render.yaml`.

## One-time setup

1. In Render, create a new Blueprint from this repository.
2. Render will provision the `quantikzz-backend` web service and the `quantikzz-db` Postgres database from `render.yaml`.
3. During the Blueprint setup flow, provide these environment values for the backend service:
	- `PUBLIC_APP_URL=https://<user>.github.io/<repo>/`
	- `BUG_REPORT_ADMIN_TOKEN=<your-secret-token>`
4. After the backend is live, copy its public URL, for example `https://quantikzz-backend.onrender.com`.
5. In the GitHub repository, add this Actions variable:
	- `VITE_API_BASE_URL=https://quantikzz-backend.onrender.com`
6. Enable GitHub Pages for the repository if you have not already.

## How Deploys Work

- `.github/workflows/deploy-pages.yml` deploys the frontend to GitHub Pages.
- Render auto-deploys the backend from this repository through its GitHub integration and `render.yaml`.
- The Pages workflow fails fast if `VITE_API_BASE_URL` is missing, so it does not publish a frontend that points at nowhere.

## Validation

- Use `VITE_BASE_PATH=/quantikzz/ npm run build` to validate the Pages frontend build locally.
- Use `npm run test:backend` to validate the backend API routes.
- The backend exposes `/health`, which Render uses for health checks.

## Notes

- The workflow in `.github/workflows/deploy-pages.yml` automatically builds with `VITE_BASE_PATH=/<repo>/` so asset URLs work on project Pages sites.
- Browser CORS support is enabled in the API routes so the Pages frontend can call the Render backend directly.
- The static bug report admin page in `public/bug-reports.html` also supports a separate backend. Open it as `bug-reports.html?apiBase=https://quantikzz-backend.onrender.com` once, and it will remember that API base in local storage.
- No custom domain is required. GitHub Pages gives you `https://<user>.github.io/<repo>/` for the frontend, and Render gives you `https://<service>.onrender.com` for the backend.
- Render free services can spin down when idle, so the first backend request after inactivity can be slower.