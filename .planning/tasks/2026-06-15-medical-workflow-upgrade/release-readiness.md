# MedSCALE Research OS Release Readiness

Date: 2026-06-16

## Verdict

MedSCALE Research OS is ready as a local delivery candidate and ready to move to GitHub-driven release preparation.

Actual public npm release should be performed by GitHub Actions, not from this machine.

It is not ready for GitHub-driven public npm release until:

- GitHub repository secret `NPM_TOKEN` is configured with npm publish permission;
- `.github/workflows/publish.yml` is present on the default branch;
- the release owner accepts that full `target-research-platform` pytest still has 3 external/fixture integration failures recorded in verification.

## Passing Gates

- `npm run release:medscale`: passed.
- `npm audit --omit=dev --registry=https://registry.npmjs.org`: 0 vulnerabilities.
- `npm publish --dry-run --json --registry=https://registry.npmjs.org`: passed.
- `.github/workflows/publish.yml` defines a GitHub Actions release path for release events and manual workflow dispatch.
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

- `NPM_TOKEN` has not been verified as a GitHub repository secret.
- A GitHub Release has not been published yet. This is intentional until the repository secret is configured.
- Full `target-research-platform` pytest still has 3 external/fixture integration failures recorded in verification.

## Repository Delivery State

- GitHub remote: `https://github.com/hongmaple0820/med-scale-research-os.git`
- Target default branch: `main`
- First commit scope: MedSCALE Research OS baseline, GitHub release workflow, native `medscale` CLI, memory review flow, Runtime Doctor cards, release smoke checks, docs, and medical workflow assets.
- Excluded from first commit: runtime outputs, query caches, local databases, logs, Python bytecode, temporary dashboard artifacts, and local `.tmp-*` files.

## GitHub Release Setup

1. Add repository secret `NPM_TOKEN` in GitHub:
   `Settings -> Secrets and variables -> Actions -> New repository secret`.
2. Push the first commit to the remote default branch `main`.
3. Create and publish a GitHub Release for tag `v0.43.0`, or run `MedSCALE GitHub Release` manually with `publish = true`.
4. Let GitHub Actions run:
   - `npm ci`
   - `npm run release:medscale`
   - `npm audit --omit=dev --registry=https://registry.npmjs.org`
   - `npm publish --dry-run --json --registry=https://registry.npmjs.org`
   - `npm publish --access public --registry=https://registry.npmjs.org`
   - post-publish `npx` setup/doctor smoke

After GitHub Actions publish:

```powershell
npx -y @hongmaple0820/med-scale-research-os setup --visual --lang zh
npx -y @hongmaple0820/med-scale-research-os doctor --json
```

## GitHub Delivery Path After First Commit Is Organized

```powershell
git status --short
git add <reviewed release files>
git commit -m "Release MedSCALE Research OS initial version"
git branch -M main
git push -u origin main
git tag v0.43.0
git push origin v0.43.0
```

Then publish through GitHub, not from the local machine:

```powershell
gh release create v0.43.0 --title "MedSCALE Research OS v0.43.0" --notes "Initial MedSCALE Research OS release candidate."
```

Or publish the release from the GitHub web UI after verifying `NPM_TOKEN` is configured.

Pushing the tag alone does not publish npm. The npm publish step is intentionally gated behind the GitHub Release `published` event, or a manual workflow dispatch with `publish = true`.

Do not add runtime outputs, caches, local databases, logs, screenshots, or temporary dashboard artifacts to the first commit.
