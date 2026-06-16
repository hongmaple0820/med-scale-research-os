# MedSCALE Research OS

MedSCALE Research OS is a local research operating system for medical research workflows. It connects target/disease research, literature review, medical fact checking, delivery package audit, memory seeding, learning-candidate review, and a researcher-facing dashboard into a verifiable evidence loop.

> MedSCALE is for research workflow governance and evidence organization only. It is not clinical advice, medical diagnosis, treatment guidance, or a submission guarantee. Human expert review is required.

Source: https://github.com/hongmaple0820/med-scale-research-os
npm package: `@hongmaple0820/med-scale-research-os`
Language: [Chinese](README.md) | [English](README.en.md)

## Current State

- Product name: **MedSCALE Research OS**
- Main CLI: `medscale`
- Local dashboard: `http://127.0.0.1:18766`
- Medical execution kernel: `target-research-platform`
- Memory provider: gbrain ready, agentmemory not enabled
- Code/knowledge graph: Graphify ready, CodeGraph partial
- MCP: MedSCALE server map exists; live health checks are still pending
- Native doctor: PubMed/OpenAlex, package audit, figure refs, and token/cost deep checks are wired
- Local visual setup guide: `medscale setup --visual --lang en`
- Token/cost: local ledger, CLI record/report/ingest, usage envelopes, and 18766 panel are wired; delivery packaging automatically scans real medical usage artifacts
- Planned gaps: post-publish npx verification, live MCP health, real external model-call replay verification

## Quick Start

Local development:

```bash
npm install
npm run build
npm run medscale -- doctor --json
npm run medscale -- setup --lang en
npm run medscale -- setup --visual --lang en
npm run medscale -- dashboard
```

Run after build:

```bash
node dist/api/medscale.js doctor --json
node dist/api/medscale.js setup --lang en
node dist/api/medscale.js setup --visual --lang en
node dist/api/medscale.js dashboard
```

Target entry after package publication:

```bash
npx -y @hongmaple0820/med-scale-research-os setup --lang en
npx -y @hongmaple0820/med-scale-research-os setup --visual --lang en
npx -y @hongmaple0820/med-scale-research-os doctor --json
npx -y @hongmaple0820/med-scale-research-os dashboard
```

## Core Commands

```bash
medscale doctor --json
medscale setup --lang zh
medscale setup --lang en
medscale setup --visual --lang en
medscale os-plan --json
medscale token report --json
medscale token record --provider anthropic --medical-lane literature --usage-file usage.json --json
medscale token ingest --target CDK4 --disease "breast cancer" --json
medscale token ingest --file artifact-usage.json --provider anthropic --json
medscale dashboard
medscale memory-review approve --candidate-id <id> --json
medscale memory-review reject --candidate-id <id> --json
medscale memory-review stale --candidate-id <id> --json
medscale memory-review restore --candidate-id <id> --json
```

## 18766 Researcher View

The dashboard home card layer now shows:

- manuscript quality gate
- medical fact check
- delivery ZIP / package audit
- gbrain memory seed
- learning candidate
- Memory Brain review status
- Token / Cost panel
- MedSCALE Research OS runtime doctor
- medical Prompt Studio templates

The learning-candidate card supports four explicit review actions:

- approve: promote to an active Memory Brain node
- reject: mark as rejected
- stale: mark as stale
- restore: restore to candidate review state

These actions write audit records to:

- `.scale/memory/learning-candidates/<candidate>.review.json`
- `.scale/memory/learning-candidates/<candidate>.review.md`

## Medical Capabilities

Configured MedSCALE skill domains:

- `medicalLiteratureReview`
- `medicalFactCheck`
- `medicalEvidenceGrading`
- `medicalStatisticalReview`
- `medicalPackageAudit`
- `medicalMemoryCurator`

Configured MedSCALE MCP route ids:

- `medical-literature`
- `medical-fact-check`
- `medical-memory-review`
- `medical-package-audit`
- `medical-evidence-manifest`

## Cross-Platform Goal

`medscale setup` returns explicit install and verification commands for:

- Windows
- macOS
- Linux

Third-party tools are not installed silently. Missing capabilities are reported as ready, partial, missing, or planned.

## Verification

Recommended minimum checks:

```bash
npm run typecheck
npm run build
npm run smoke:medscale-release
npm test -- tests/memory/MemoryReview.test.ts tests/cli/targetCommands.test.ts tests/cli/medscaleCli.test.ts
cd target-research-platform
python -m pytest tests/test_deliverables.py
```

Recently verified:

- MedSCALE release smoke: `medscale.release_smoke.v1 passed`
- Dashboard deliverables tests: `25 passed`
- Memory review CLI tests cover approve / reject / stale / restore
- 18766 render smoke: Memory review buttons visible, no page errors

## Repository Note

This repository evolved from the general SCALE Engine governance kernel. Historical governance modules remain in source so MedSCALE can reuse workflow gates, skills, MCP, memory, and evidence structures. The medical research workflow user entrypoint is `medscale`; users should not need the `scale` CLI to run MedSCALE workflows.

## License

[MIT](LICENSE)
