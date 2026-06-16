# MedSCALE Research OS Release Readiness

Date: 2026-06-16

## Verdict

MedSCALE Research OS is ready as a local delivery candidate and ready to move to GitHub-driven release preparation.

Actual public npm release should be performed by GitHub Actions, not from this machine.

It is not ready for GitHub-driven public npm release until one npm authentication path is configured:

- GitHub repository secret `NPM_TOKEN` is configured with npm publish permission; or
- npm Trusted Publishing is configured for this GitHub repository and workflow;
- `.github/workflows/publish.yml` is present on the default branch;
- the release owner accepts that full `target-research-platform` pytest still has 3 external/fixture integration failures recorded in verification.

## Passing Gates

- `npm run release:medscale`: passed.
- `npm audit --omit=dev --registry=https://registry.npmjs.org`: 0 vulnerabilities.
- `npm publish --dry-run --json --registry=https://registry.npmjs.org`: passed.
- `.github/workflows/publish.yml` defines an automatic GitHub Actions release path for `v*.*.*` tag pushes and a manual workflow dispatch fallback.
- `npm pack` / publish dry-run includes:
  - `dist/api/medscale.js`
  - `target-research-platform/main.py`
  - `target-research-platform/src/output/usage_envelope.py`
  - `scripts/workflow/medscale-release-smoke.mjs`
  - `.scale/skills.json`
  - `.scale/mcp-servers.yaml`
- Package dry-run excludes:
  - root runtime `output/`
  - `target-research-platform/output/`
  - Python `__pycache__/`
  - Python bytecode files such as `.pyc`

## Current Package Facts

- Package: `@hongmaple0820/med-scale-research-os`
- Version: `0.43.0`
- Bin: `medscale`
- Publish dry-run entries: `1104`
- Tarball size: `1758695`
- Unpacked size: `8298392`
- Registry package lookup: npmjs.org currently returns `E404`, so the package is not visible there yet or the account lacks access.

## Remaining Release Blockers

- npm authentication has not been verified. Use either `NPM_TOKEN` or npm Trusted Publishing.
- The existing `v0.43.0` tag was pushed before automatic tag publishing was added, so it will not retro-trigger the new workflow.
- Full `target-research-platform` pytest still has 3 external/fixture integration failures recorded in verification.

## Repository Delivery State

- GitHub remote: `https://github.com/hongmaple0820/med-scale-research-os.git`
- Target default branch: `main`
- First commit scope: MedSCALE Research OS baseline, GitHub release workflow, native `medscale` CLI, memory review flow, Runtime Doctor cards, release smoke checks, docs, and medical workflow assets.
- Excluded from first commit: runtime outputs, query caches, local databases, logs, Python bytecode, temporary dashboard artifacts, and local `.tmp-*` files.

## Automatic GitHub Release Setup

1. Configure one npm authentication path.
   Option A: add repository secret `NPM_TOKEN` in GitHub:
   `Settings -> Secrets and variables -> Actions -> New repository secret`.

   Option B: configure npm Trusted Publishing for package `@hongmaple0820/med-scale-research-os`, repository `hongmaple0820/med-scale-research-os`, workflow `.github/workflows/publish.yml`, environment `npm`.
2. Push release changes to the remote default branch `main`.
3. Push a version tag that exactly matches `package.json`, for example `v0.43.0`.
4. Let GitHub Actions run automatically:
   - `npm ci`
   - `npm run release:medscale`
   - `npm audit --omit=dev --registry=https://registry.npmjs.org`
   - `npm publish --dry-run --json --registry=https://registry.npmjs.org`
   - `npm publish --access public --registry=https://registry.npmjs.org`
   - post-publish `npx` setup/doctor smoke
   - automatic GitHub Release creation

If the GitHub repository is public, the workflow also adds npm provenance. If the repository remains private, the workflow skips provenance because npm does not support provenance generation from private repositories.

After GitHub Actions publish:

```powershell
npx -y @hongmaple0820/med-scale-research-os setup --visual --lang zh
npx -y @hongmaple0820/med-scale-research-os doctor --json
```

## GitHub Delivery Path

```powershell
git status --short
git add <reviewed release files>
git commit -m "Prepare MedSCALE Research OS release"
git push origin main
git tag v0.43.0
git push origin v0.43.0
```

Pushing the tag is the release trigger. GitHub Actions will publish npm and create the GitHub Release after the publish smoke passes.

For the already-pushed `v0.43.0` tag, use one of these paths after npm authentication is configured:

- run `MedSCALE GitHub Release` manually with `publish = true`; or
- intentionally recreate the `v0.43.0` tag on the current release commit, then push it again.

Do not add runtime outputs, caches, local databases, logs, screenshots, or temporary dashboard artifacts to the first commit.
