# GitLab Flow Branch and Worktree Policy

SCALE Engine uses a GitLab Flow variant for this repository:

```text
feat/* / fix/* / chore/* / docs/* / codex/*
        -> dev
        -> master
        -> vX.Y.Z tag
        -> npm publish

hotfix:
        fix forward on dev first when possible
        -> cherry-pick to hotfix/*
        -> master
        -> vX.Y.Z tag
        -> sync master back to dev

selective release, only when dev contains work that must not ship:
        master
        -> release/vX.Y.Z
        -> cherry-pick selected commits
        -> master
        -> vX.Y.Z tag
        -> sync master back to dev
```

## Branch Roles

| Branch | Role | Rule |
| --- | --- | --- |
| `dev` | Integration and test branch | Merge reviewed short branches here. Do not create direct governed commits on `dev`. |
| `master` | Production branch | Only verified release/hotfix results land here. Publish from user-created `vX.Y.Z` tags on `master`. |
| `feat/*`, `feature/*` | Feature branches | Start from current `dev`, merge back to `dev`, then delete. |
| `fix/*` | Normal bug fix branches | Start from current `dev`, merge back to `dev`, then delete. |
| `chore/*`, `docs/*`, `codex/*` | Maintenance branches | Short-lived work branches that merge back to `dev`. |
| `hotfix/*` | Production patch branches | Use only for production fixes. Fix forward to `dev` first when possible, then cherry-pick to hotfix/master. |
| `release/*` | Selective release branch | Use only when `dev` contains work that must not ship. Start from `master` and cherry-pick the release list. |

## Required Checks

Run the release-grade verification set before merging to `master` or tagging:

```bash
npm run build
npx vitest run
git diff --check
npm pack --dry-run
```

Every merge request should run the relevant build/lint/test checks before review is accepted. Do not wait until `master` to discover broken tests.

## Merge and Conflict Rules

- Public branches are not rebased: `dev`, `master`, `release/*`, and `hotfix/*` keep realistic history.
- Personal short branches may be rebased before merge, but only with `--force-with-lease` and only before review is accepted.
- Prefer squash merge from short branches into `dev` when one logical change should be easy to revert.
- Resolve conflicts on the source branch, rerun verification, then merge. Do not resolve release conflicts directly on `master`.
- Fix bugs forward first: land the fix on `dev` when possible, then cherry-pick the same commit to `hotfix/*` or the selected patch release branch.
- Commit messages should explain intent and why the chosen path was selected when the decision is not obvious.

## Ship Gate Rules

`scale ship <task-id>` now enforces the branch lifecycle:

- blocked on `dev`, `master`, `main`, and detached HEAD
- allowed on configured short branches such as `feat/*`, `fix/*`, `chore/*`, `docs/*`, `codex/*`, `release/*`, and `hotfix/*`
- still requires verification evidence, passing review evidence, and reviewed-file-only staging
- still blocks dirty or unsafe child repositories in MOE/submodule workspaces

Use:

```bash
scale workspace status --summary
scale workspace finish --summary
scale workspace finish --json
```

The report includes branch role, whether governed shipping is allowed, and cleanup blockers.

## Worktree Lifecycle

Temporary agent worktrees are safe to remove only when all of these are true:

- root worktree is clean
- child repositories are clean and pushed when required
- the temporary branch has no unpushed commits
- a branch with no upstream is already merged into `dev`/`master`, or it contains no unique work

Cleanup remains dry-run by default:

```bash
scale workspace cleanup --dir <temporary-worktree> --dry-run --json
scale workspace cleanup --dir <temporary-worktree> --apply --confirm <branch-or-head> --json
```

If cleanup is blocked, push the branch, merge it, cherry-pick it into the selected release, or explicitly discard it before removing the worktree.

## Repository Bootstrap

This repository currently treats `dev` as the integration branch and `master` as production. If `dev` falls behind `master` and has no unique commits, fast-forward `dev` to `master` before starting new feature work:

```bash
git fetch --all --prune
git switch dev
git merge --ff-only master
git push origin dev
git push github dev
```

After that, normal work should start from `dev`:

```bash
git switch dev
git pull --ff-only origin dev
git switch -c feat/<short-name>
```

Before creating a normal release from `dev`, inspect the release delta:

```bash
git log --oneline master..dev
```

If every listed commit is intended for the next production release, merge `dev` through the normal release path. If any commit must be excluded, create `release/vX.Y.Z` from `master` and cherry-pick only the approved release list.
