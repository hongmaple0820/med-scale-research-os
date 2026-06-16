---
paths:
  - "**/*"
---
# Git Workflow

## Commit Format

```
<type>: <description>

[optional body]
```

Types: feat, fix, refactor, test, docs, chore, perf, ci

## Commit Rules

- One logical change per commit
- Describe WHY not HOW
- Tests must pass before commit

## PR Workflow

1. Create feature branch from main
2. Make commits with messages
3. Run all tests locally
4. Push with -u flag
5. Create PR with summary
6. Address review feedback
7. Merge when approved

## PR Description

- Summary of changes
- Link to issue/PRD
- Test plan checklist
- Screenshots (if UI)

## Branch Names

- feature/xxx - new features
- fix/xxx - bug fixes
- refactor/xxx - cleanup
