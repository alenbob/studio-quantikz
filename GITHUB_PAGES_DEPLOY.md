# GitHub Pages Deployment

This repo can now publish the Vite frontend to GitHub Pages, but GitHub Pages does not run the Node or Python API routes in `api/`.

What still needs a backend:

- `/api/render-pdf`
- `/api/render-svg`
- `/api/symbolic-latex`
- `/api/store-share-code`
- `/api/share-preview-image`
- `/api/share`
- `/api/bug-report`
- `/api/bug-reports`

The Pages deployment is therefore a split setup:

1. Host the static frontend on GitHub Pages.
2. Host the `api/` routes on a separate platform that supports Node and Python.
3. Set the GitHub repository variable `VITE_API_BASE_URL` to that backend base URL, for example `https://your-backend.example.com/`.
4. Set `PUBLIC_APP_URL` on the backend to the final GitHub Pages app URL, for example `https://<user>.github.io/<repo>/`.

Notes:

- The workflow in `.github/workflows/deploy-pages.yml` automatically builds with `VITE_BASE_PATH=/<repo>/` so asset URLs work on project Pages sites.
- Browser CORS support is enabled in the API routes so the Pages frontend can call a separate backend origin.
- The static bug report admin page in `public/bug-reports.html` also supports a separate backend. Open it as `bug-reports.html?apiBase=https://your-backend.example.com/` once, and it will remember that API base in local storage.
- If you keep using Vercel for the backend only, this setup works as a frontend-on-Pages plus backend-on-Vercel split deployment.