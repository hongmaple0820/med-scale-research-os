# Explore: medical workflow upgrade from SCALE 0.50.x

Date: 2026-06-15
Level: M
Workspace: `E:\project\yixue-scale-engine`
Reference source: `E:\project\scale-engine`

## User Intent

The existing medical research workflow is the foundation. Recent SCALE Engine upgrades should be migrated into the medical research workflow, and the product/project should get a clearer name.

## Source Capabilities Observed

`E:\project\scale-engine` is a newer SCALE Engine core, not a newer copy of `target-research-platform`.

Useful 0.50.x upgrade surfaces:

- Agent collaboration planning across CLI/runtime/Prompt Studio/status.
- Agent Loop readiness measurement: tool execution, recovery, guardrails, budgets, delegation, termination evidence.
- Dashboard Prompt Studio templates, multi-agent roles, handoffs, review gates, token reserve, copy/download affordances.
- Dashboard resilient bootstrap data and read-only JSON preview.
- Memory/knowledge review actions, exportable packets, gbrain-only memory strategy.
- Setup verification fail-closed for governed capabilities such as gbrain, CodeGraph, Graphify, RTK.
- Multi-project dashboard launch and auto-port probing.
- Token/cost visibility and artifact/prototype discovery.

## Current Medical Workflow Surface

Relevant local files:

- `target-research-platform/src/dashboard/app.py`
- `target-research-platform/src/dashboard/static/index.html`
- `target-research-platform/tests/test_deliverables.py`
- `src/cli/targetCommands.ts`
- `tests/cli/targetCommands.test.ts`

Current medical workflow already has:

- Python 18766 dashboard with `/api/status`.
- Researcher delivery readiness cards for quality, fact check, package audit, memory seed, learning candidate.
- Delivery manifest-based quality/fact/package/memory/learning extraction.
- TS CLI commands for manuscript/package/remember/learn.

## Fit Assessment

Do not copy the SCALE 0.50 TypeScript modules directly into the Python dashboard path. The stable integration point is the status payload rendered by the 18766 dashboard.

Best first migration slice:

- Productize the medical workflow as `MedSCALE Research OS`.
- Add `summary.medical_research_os` to the dashboard status payload.
- Render a researcher-facing OS panel on the 18766 homepage.
- Map SCALE 0.50 features into medical-specific concepts:
  - Agent collaboration -> medical research team roles, handoffs, review gates.
  - Agent Loop readiness -> medical workflow readiness score/signals.
  - Prompt Studio -> medical prompt templates and copy/download-ready template metadata.
  - gbrain-only memory -> medical memory seed and learning candidate state.
  - Setup fail-closed -> future doctor/setup checks for gbrain, RTK, PubMed/OpenAlex, package audit.

## Product Naming

Recommended product/project name:

**MedSCALE Research OS** / **MedSCALE 医研操作系统**

Rationale:

- Keeps SCALE lineage explicit.
- Signals an operating layer, not just a target screening script.
- Fits dashboard, CLI, memory, evidence, and agent-collaboration surfaces.
- Can expand from oncology target research into broader medical research workflows.

Shortlist:

- MedSCALE Research OS
- SCALE BioResearch OS
- ClinSCALE Research Workbench
- YiXue Research OS
- EvidenceOS for Medical Research

Decision for this slice: use `MedSCALE Research OS` as UI/product name and keep Chinese display as `MedSCALE 医研操作系统`.
