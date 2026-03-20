# GitLab Migration

This repository is ready to run from GitLab. The remaining migration work is the remote-side setup that requires your GitLab account.

## What Was Prepared In The Repo

- The app footer link is now host-agnostic through `VITE_REPOSITORY_URL` and `VITE_REPOSITORY_LABEL`.
- A GitLab CI pipeline was added in `.gitlab-ci.yml` to run `npm test` and `npm run build` with Python available for the symbolic LaTeX tests.
- Existing Vercel runtime configuration in `vercel.json` remains valid. It does not depend on GitHub-specific settings.

## 1. Create The GitLab Repository

Create an empty GitLab repository, then add it as a new remote locally:

```bash
git remote add gitlab git@gitlab.com:<namespace>/quantikzz.git
```

If you prefer HTTPS:

```bash
git remote add gitlab https://gitlab.com/<namespace>/quantikzz.git
```

Verify:

```bash
git remote -v
```

## 2. Push The Repository To GitLab

Push all branches and tags:

```bash
git push gitlab --all
git push gitlab --tags
```

If you want GitLab to become the primary remote afterward:

```bash
git remote rename origin github
git remote rename gitlab origin
```

## 3. Enable GitLab CI

Once the repository is in GitLab, the pipeline in `.gitlab-ci.yml` should run automatically on push.

Expected jobs:

- `test`: runs the full Vitest suite.
- `build`: runs the Vite production build and stores `dist/` as an artifact.

## 4. Reconnect Vercel To GitLab

Vercel can deploy from GitLab, but the Git integration has to be switched in the Vercel project settings.

Recommended path:

1. In Vercel, open the existing project.
2. Go to the Git settings for the project.
3. Connect the new GitLab repository that contains this codebase.
4. Keep these settings unchanged unless you have a reason to override them:
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. Confirm the project still exposes the same production domain.

If Vercel does not allow swapping the connected repo cleanly from the UI, import the GitLab repo as a new Vercel project and copy over the same environment variables and domain assignments before cutting traffic over.

## 5. Optional Vercel Environment Variables

If you want the in-app footer link to point at GitLab instead of GitHub, set these in Vercel for all relevant environments:

```text
VITE_REPOSITORY_URL=https://gitlab.com/<namespace>/quantikzz
VITE_REPOSITORY_LABEL=gitlab.com/<namespace>/quantikzz
```

They are optional. Without them, the app keeps the current GitHub fallback.

## 6. Post-Migration Checks

Run these after the GitLab push and Vercel reconnection:

```bash
npm test
npm run build
```

Then verify in Vercel:

- Preview deployment builds successfully from GitLab.
- `/api/render-pdf` still returns a PDF.
- `/api/symbolic-latex` still runs successfully.
- Production domain still resolves to the expected project.

## Notes

- This repository currently has unrelated local modifications and untracked files. Review those before pushing to GitLab so you do not accidentally publish work in progress.
- No GitHub Actions workflow exists in this repository today, so there was no GitHub CI configuration to translate.