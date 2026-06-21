# Verification - 2026-06-19-authoritative-evidence-platform

Date: 2026-06-19
Level: CRITICAL
Verified slice: `PLAN-2026-06-19-GOVERNANCE-FOUNDATION`

## Verified

- 来源注册表只允许已批准且用途匹配的数据源进入采集。
- 来源 URL 必须位于批准端点内；授权来源禁止公开导出。
- raw/normalized/analysis 三层产物具有稳定 ID、SHA-256、来源、许可、稳定记录 ID、
  producer、方法卡和父子谱系。
- 派生产物必须等待所有父产物人工批准。
- 审批必须包含人工 reviewer 和 signature；重复审批等非法状态转换会被拒绝。
- 上游失效会级联撤销所有下游审批。
- 文件内容篡改和 manifest 来源/许可元数据篡改均会被审核账本摘要发现。
- 审核记录写入失败时，产物文件和 manifest 会回滚，不留下可误用的孤儿产物。
- HTTP 参考适配器保留 URL、查询参数、请求头、响应头、稳定 ID 和下载字节。
- 固定 SHA-256 对照不匹配时，下载阻断且不生成 manifest。
- 存储与审核账本可从磁盘重载；核心路径不依赖 LLM。

## Commands and Results

From `target-research-platform`:

```text
python -m pytest tests/test_research_governance.py --cov=src.research_os --cov-report=term-missing -q
14 passed; research_os total coverage 89%

python -m pytest tests/test_validators.py tests/test_pipeline_integration.py \
  tests/test_full_pipeline_gates.py tests/test_manuscript_fact_check.py \
  tests/test_manuscript_generator.py tests/test_manuscript_enhanced.py \
  tests/test_research_governance.py -q
46 passed

python -m pytest -q
186 passed, 14 deselected

python -m py_compile src/research_os/__init__.py src/research_os/governance.py \
  src/research_os/artifacts.py src/research_os/adapters.py
passed
```

From repository root:

```text
git diff --check
passed
```

## Not Verified / Not Implemented

- 14 个 `integration` 测试需要真实外部 API，按仓库默认策略未运行。
- 尚未对任一真实权威数据库执行生产下载；当前 HTTP 适配器通过注入响应完成确定性合同测试。
- 尚未完成七维各两个来源、schema 漂移检测、断点续传和来源版本监控。
- 尚未完成各数据库格式分析、分维标准化、诊断图和跨来源可比性报告。
- 尚未完成证据矩阵、确定性靶点筛选 UI、项目阳性对照、情报证据包和四阶段工作台。
- JSONL 审核账本目前是单进程追加模型；多用户并发锁和外部签名/防篡改存储仍待实现。

## Phase 2 Adapter SDK Verification

### Offline contracts

```text
python -m pytest tests/test_adapter_sdk.py tests/test_research_governance.py \
  --cov=src.research_os --cov-report=term-missing -q
24 passed; research_os total coverage 90%

python -m pytest -q
196 passed, 15 deselected
```

The 15 deselected tests are explicitly marked live `integration` tests.

### Explicit live NCBI control

```text
python -m pytest tests/test_geo_reference_integration.py -m integration -q
1 passed
```

Observed from the official NCBI HTTPS object on 2026-06-19:

- URL: `https://ftp.ncbi.nlm.nih.gov/geo/series/GSEnnn/GSE1/matrix/GSE1_series_matrix.txt.gz`
- Bytes: `920305`
- SHA-256: `c648d83d234783f11b0bac9325727c3679914b87828f9274f0893d3829139f1f`
- GEO accession: `GSE1`
- Series type: `Expression profiling by array`
- Platform: `GPL7`
- Samples: `38`
- Matrix rows: `8192`
- Schema fingerprint: `7c5be69fd842f038d1e32e50a9bb549acfc5d3e9cf4aecd3d5538f6402776a8c`

The checksum is a MedSCALE local fixed control measured from the official file. It is not described
as an NCBI-published checksum.

### Persistent local audit output

- Run summary:
  `target-research-platform/output/reference-controls/2026-06-19-gse1/run-summary.json`
- Raw artifact:
  `target-research-platform/output/reference-controls/2026-06-19-gse1/artifact-store/ncbi-geo-reference-controls/raw/msa-019327c7bcb7795660400522-GSE1_series_matrix.txt.gz`
- Manifest:
  `target-research-platform/output/reference-controls/2026-06-19-gse1/artifact-store/ncbi-geo-reference-controls/manifests/msa-019327c7bcb7795660400522.json`
- Review ledger:
  `target-research-platform/output/reference-controls/2026-06-19-gse1/audit/reviews.jsonl`

Reload verification returned `True`; raw bytes were `920305`; review status remains
`review_required`.

### Still not approved

- No human acquisition signature has been recorded.
- No expression-value normalization or probe-to-gene mapping method has been selected.
- GSE1 is an adapter fixed control, not a disease-project positive control and not evidence for a
  target.
- Only one GEO reference file was tested; this does not satisfy the two-source-per-omics acceptance
  criterion.

## Phase 3 GEO Format and Normalization Assessment

The user explicitly approved the GSE1 acquisition artifact on 2026-06-19. The append-only ledger
contains the original encoding-corrupted signature, its invalidation/reopen events, and the
canonical replacement signature:

```text
chat-confirmation:conforms:2026-06-19:acquisition-only
```

### Real format profile

- Matrix shape: 8,192 probe rows × 38 samples.
- Finite values: 311,244.
- Missing values: 52 (`0.0167%`).
- Minimum / median / maximum: `-3.0000003 / 0.0034613 / 4.1258153`.
- Negative fraction: `49.3536%`.
- Unique submitted sample-source labels: 21.
- Non-empty per-sample processing metadata: 1 of 38 (`2.63%`).
- Platform: `GPL7`.
- Identifier level: platform probe ID; no admitted probe-to-gene mapping.

### Deterministic decision

The normalization assessment is `blocked` because the file is an adapter structural control,
contains already centered/processed values, has incomplete processing metadata, has heterogeneous
sample sources, and lacks an admitted platform mapping.

The method card prohibits:

- log2 transformation;
- repeated quantile normalization;
- automatic case/control assignment;
- gene-level cross-source comparison;
- target screening.

### Verification

```text
python -m pytest tests/test_geo_normalization_assessment.py \
  tests/test_adapter_sdk.py tests/test_research_governance.py \
  --cov=src.research_os --cov-report=term-missing -q
27 passed; research_os total coverage 91%; normalization module 96%

python -m pytest -q
199 passed, 15 deselected

python -m py_compile src/research_os/normalization.py
passed

git diff --check
passed
```

### Persistent assessment

- Artifact: `msa-eac1bd86ec5e891ceb5a44bd`
- Local JSON:
  `target-research-platform/output/reference-controls/2026-06-19-gse1/artifact-store/ncbi-geo-reference-controls/analysis/msa-eac1bd86ec5e891ceb5a44bd-GSE1_normalization_assessment.json`
- Manifest:
  `target-research-platform/output/reference-controls/2026-06-19-gse1/artifact-store/ncbi-geo-reference-controls/manifests/msa-eac1bd86ec5e891ceb5a44bd.json`
- Integrity: passed.
- Review stage/status: `normalization / review_required`.
- Normalized output files: `0`.

## Phase 3 Research Project Admission

The user approved the GSE1 normalization block. The canonical ledger signature is:

```text
chat-confirmation:conforms:2026-06-19:approve-normalization-block-only
```

The project admission contract now requires canonical disease/tissue IDs, explicit group
definitions, one of seven omics dimensions, sample thresholds, and source-bound project positive
controls.

### Verification

```text
python -m pytest tests/test_project_admission.py \
  tests/test_geo_normalization_assessment.py tests/test_adapter_sdk.py \
  tests/test_research_governance.py --cov=src.research_os \
  --cov-report=term-missing -q
37 passed; research_os total coverage 89%; projects module 83%

python -m pytest -q
209 passed, 15 deselected

python -m py_compile src/research_os/projects.py
passed

git diff --check
passed
```

### Current fail-closed state

- Template: `target-research-platform/config/templates/research_project_v1.json`
- Diagnostic:
  `target-research-platform/output/project-setup/project-definition-required.json`
- Status: `blocked`
- Validation issues: 30, including unresolved placeholders and missing approved evidence source.
- Project records created: 0.
- Project cohort searches/downloads started: 0.

## Supplied Medical AI Guide Evidence Audit

- Input size: approximately 13,000 Chinese characters and more than 40 implementation units.
- Review depth: deep adversarial document review.
- High-impact findings: 28.
- Official-source checks included NLM/NCBI, PubMedBERT primary research, Cochrane/GRADE,
  Semantic Scholar, Chinese government/CAC/NMPA, and provider model documentation.
- Accepted requirements were added to the V2 architecture, frozen spec, and plan.
- Rejected assertions were not added to executable code or default configuration.

Artifacts:

- `docs/architecture/MEDICAL_AI_GUIDE_EVIDENCE_AUDIT_2026-06-19.md`
- `docs/architecture/adr/0006-terminology-retrieval-and-evidence-methodology.md`
- `.planning/tasks/2026-06-19-authoritative-evidence-platform/medical-ai-guide-audit.md`

## Phase 4 MeSH Terminology and PubMed Claim Ledger

### Real official controls

NLM MeSH 2026 descriptor release:

- URL:
  `https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/xmlmesh/desc2026.gz`
- Bytes: `16,812,636`
- SHA-256: `9fe35b3170652376a592daf69e91a80d6c693ecaf9c571ceb701d04204cb357d`
- Descriptor count: `31,110`
- Fixed descriptor: `D008545` / `Melanoma`
- Terms: public NLM MeSH terms; attribution and version disclosure are recorded.

NCBI PubMed EFetch:

- PMID: `10952317`
- Bytes: `8,376`
- SHA-256: `e00b22c33fbbc6ffdf85fbe8221d485da25e5faa64a17ab25c5016bd3f197ed3`
- DOI: `10.1038/35020115`
- MeSH includes `D008545` / `Melanoma`
- Abstract sections are represented by locator and SHA-256, not copied into claims.

### Failure evidence

One live NLM connection ended silently at 599,829 bytes while the official Content-Length remained
16,812,636. The downloader rejected admission and retained the partial. A bounded silent-EOF retry
with `Range` continuation was added and tested; the next live run passed both controls.

### Commands and results

```text
python -m pytest tests/test_mesh_pubmed_integration.py -m integration -q
1 passed

python -m pytest tests/test_terminology_literature.py \
  tests/test_adapter_sdk.py tests/test_research_governance.py \
  --cov=src.research_os --cov-report=term-missing -q
34 passed; terminology 89%; literature 84%; transport 95%

python -m pytest -q
219 passed, 16 deselected

python -m py_compile src/research_os/transport.py \
  src/research_os/terminology.py src/research_os/literature.py
passed

git diff --check
passed
```

### Persistent local audit output

- Run summary:
  `target-research-platform/output/terminology-literature/2026-06-19/run-summary.json`
- MeSH manifest:
  `target-research-platform/output/terminology-literature/2026-06-19/artifact-store/terminology-literature-controls/manifests/msa-daec5e91e73fe31ed3584305.json`
- PubMed manifest:
  `target-research-platform/output/terminology-literature/2026-06-19/artifact-store/terminology-literature-controls/manifests/msa-b383f5e01765240aed0aab3c.json`
- Review ledger:
  `target-research-platform/output/terminology-literature/2026-06-19/audit/reviews.jsonl`

Reload verification passed for both artifacts. Current states:

- MeSH: `acquisition / review_required`
- PubMed: `acquisition / review_required`
- Terminology selections created: `0`
- Claims created: `0`

## Phase 4 Mapping Queue and Evidence Worksheet

After human acquisition approval of MeSH 2026 and PMID 10952317, the approved raw artifacts were
used to create two derived review artifacts.

### Terminology mapping request

- Query: `melanoma`
- Domain: `disease`
- Candidate: `D008545` / `Melanoma`
- Candidate count: 1
- Selected ID: `null`
- Automatic selection: false
- Artifact: `msa-2f353ed501f2b320c7bb4eae`
- Review stage/status: `normalization / review_required`

### PubMed evidence worksheet

- Source: `PMID:10952317`
- Record count: 1
- Locator count: 1
- Claim count: 0
- Source abstract text copied: false
- Evidence fields: study design, risk of bias, certainty, applicability — all empty.
- Artifact: `msa-8afc43dbbc0605fcf9c44a82`
- Review stage/status: `intelligence / review_required`

### Verification

```text
python -m pytest tests/test_mapping_evidence_workflow.py \
  tests/test_terminology_literature.py tests/test_adapter_sdk.py \
  tests/test_research_governance.py --cov=src.research_os \
  --cov-report=term-missing -q
38 passed; evidence_workflow coverage 91%

python -m pytest -q
223 passed, 16 deselected

python -m py_compile src/research_os/evidence_workflow.py
passed

git diff --check
passed
```

No terminology selection or medical claim was created.

## Phase 4 Decision Entrypoints

Date: 2026-06-20

This continuation adds executable entrypoints for the human decisions that were previously only
represented as pending review artifacts.

### Verified behavior

- A terminology decision cannot be created until the mapping request artifact is approved.
- A selected terminology ID must exist in the exact candidate snapshot from the reviewed request.
- Review rationale is mandatory.
- Reject-all can be recorded as an explicit decision artifact.
- A terminology decision remains `normalization / review_required` until separately approved.
- A PubMed claim cannot be submitted through a worksheet until the worksheet artifact is approved.
- Worksheet-based claim submission binds to the worksheet locator hash and the underlying approved
  raw PubMed source artifact.
- Claim output remains `intelligence / review_required` until separately approved.
- Approved selected decisions can be read as canonical selections; approved reject-all decisions
  cannot be read as selected mappings.
- `target-research-platform/docs/JSON_SCHEMA.md` documents the mapping request, mapping decision,
  PubMed worksheet, and claim record schemas.

### Commands and results

```text
python -m pytest tests/test_mapping_evidence_workflow.py -q
9 passed

python -m pytest tests/test_mapping_evidence_workflow.py \
  tests/test_terminology_literature.py tests/test_research_governance.py -q
32 passed

python -m py_compile src/research_os/evidence_workflow.py src/research_os/__init__.py
passed

python -m pytest -q
228 passed, 16 deselected

git diff --check
passed

After adding schema docs and approved-selection assertions:

python -m pytest tests/test_mapping_evidence_workflow.py -q
9 passed

python -m pytest tests/test_mapping_evidence_workflow.py \
  tests/test_terminology_literature.py tests/test_research_governance.py -q
32 passed

python -m pytest -q
228 passed, 16 deselected

git diff --check
passed
```

No real terminology selection or medical claim was created by this verification run.

## Phase 4 GenUI Review Workbench

Date: 2026-06-20

This continuation applies the GenUI SDK article's interaction pattern to the local Research OS
dashboard without adopting a live LLM-generated UI runtime yet.

### Verified behavior

- Dashboard status exposes `summary.genui_review_workbench` with schema
  `medscale.genui_review_workbench.v1`.
- The same workbench payload is embedded under `summary.medical_research_os.genui_review_workbench`.
- Empty dashboard state renders an empty workbench with `card_count == 0`.
- Local review manifests for PubMed evidence worksheets and terminology mapping requests are
  converted into GenUI-style cards.
- Frontend HTML exposes `GenUI Review Workbench`, `renderGenuiReviewWorkbench`, and
  `renderGenuiControl`.
- Browser smoke confirmed the populated panel, PubMed worksheet card, terminology mapping request
  card, locked reviewer controls, and matching API schema.

### Commands and results

```text
npm view @opentiny/genui-sdk-vue version description dist-tags
latest observed version 1.2.1

npm view @opentiny/genui-sdk-server version description dist-tags
latest observed version 1.2.0

python -m pytest tests/test_deliverables.py -q
27 passed

python -m py_compile src/dashboard/app.py
passed

python -m pytest -q
230 passed, 16 deselected

npm test -- tests/dashboard/medicalWorkflowData.test.ts tests/cli/targetCommands.test.ts tests/cli/medscaleCli.test.ts
3 test suites passed; 29 tests passed

npm run typecheck
passed

Browser smoke at http://127.0.0.1:18766
hasPanel=true, hasPubMedCard=true, hasMappingCard=true, hasReviewControls=true,
apiSchema=medscale.genui_review_workbench.v1, apiCardCount=2, osHasWorkbench=true
```

No review artifact approval, terminology selection, or medical claim submission was performed by
this verification run.

## Phase 4 GenUI Action Drafts

Date: 2026-06-20

This continuation adds dry-run validation for GenUI Review Workbench actions. It does not execute
review writes or create medical artifacts.

### Verified behavior

- `POST /api/genui-review-action-draft` returns schema
  `medscale.genui_review_action_draft.v1`.
- The endpoint returns `dry_run=true` and `write_enabled=false`.
- Approved mapping request + known selected ID produces a
  `TerminologyMappingDecisionRecorder.select` draft.
- Unknown mapping selected IDs are rejected because they are outside the reviewed candidate
  snapshot.
- Unapproved PubMed worksheets are rejected before claim drafts are considered executable.
- PubMed claim drafts require a reviewed locator, claim text, stance, and four-part evidence
  assessment.
- Browser smoke confirmed a UI click can produce a ready dry-run draft without writing anything.

### Commands and results

```text
python -m pytest tests/test_deliverables.py -q
30 passed

python -m py_compile src/dashboard/app.py
passed

Browser dry-run smoke at http://127.0.0.1:18766
note="Dry-run draft ready: TerminologyMappingDecisionRecorder.select"
apiSchema=medscale.genui_review_action_draft.v1
ok=true, dryRun=true, writeEnabled=false
entrypoint=TerminologyMappingDecisionRecorder.select
selectedId=D008545

python -m pytest -q
233 passed, 16 deselected

npm test -- tests/dashboard/medicalWorkflowData.test.ts tests/cli/targetCommands.test.ts tests/cli/medscaleCli.test.ts
3 test suites passed; 29 tests passed

npm run typecheck
passed

git diff --check
passed with CRLF warning for target-research-platform/src/dashboard/static/index.html
```

No review event, terminology decision artifact, PubMed claim record, or ledger write was created by
this verification run.

## Phase 4 GenUI Draft Artifacts

Date: 2026-06-21

This continuation persists validated GenUI action drafts as audit artifacts when `persist=true`.
The persisted draft remains a dry-run object and does not execute medical review writes.

### Verified behavior

- `persist=true` writes a `medscale.genui_review_action_draft.v1` payload.
- The persisted draft has a matching `medscale.artifact_manifest.v1` manifest.
- Persisted drafts keep `dry_run=true` and `write_enabled=false`.
- Draft manifests are `review_required` and point back to the source review artifact.
- The GenUI Review Workbench rediscoveres persisted draft artifacts.
- The frontend action path saves draft artifacts and displays the saved draft ID.

### Commands and results

```text
python -m pytest tests/test_deliverables.py -q
32 passed

python -m py_compile src/dashboard/app.py
passed

Browser persisted-draft smoke at http://127.0.0.1:18766
note includes "saved msa-genui-draft-"
apiSchema=medscale.genui_review_action_draft.v1
ok=true, dryRun=true, writeEnabled=false, persisted=true
entrypoint=TerminologyMappingDecisionRecorder.select
selectedId=D008545

python -m pytest -q
235 passed, 16 deselected

npm test -- tests/dashboard/medicalWorkflowData.test.ts tests/cli/targetCommands.test.ts tests/cli/medscaleCli.test.ts
3 test suites passed; 29 tests passed

npm run typecheck
passed

git diff --check
passed with CRLF warning for target-research-platform/src/dashboard/static/index.html
```

No review approval, terminology decision artifact, PubMed claim record, or claim ledger write was
created by this verification run.

## Phase 4 GenUI Draft Confirmations

Date: 2026-06-21

This continuation adds confirmation envelopes for persisted GenUI action drafts. Confirmation
artifacts are still dry-run audit objects and do not execute medical writes.

### Verified behavior

- `POST /api/genui-review-action-confirmation` persists
  `medscale.genui_review_action_confirmation.v1`.
- Confirmation requires reviewer ID, reviewer role, rationale, and `acknowledge_no_execution`.
- Missing acknowledgement is rejected.
- Confirmation manifests are `review_required`.
- Confirmation artifacts reference the draft artifact and source review artifact.
- The workbench renders draft confirmation cards.
- Browser smoke confirmed source card -> saved draft -> draft card -> saved confirmation.

### Commands and results

```text
python -m pytest tests/test_deliverables.py -q
35 passed

python -m py_compile src/dashboard/app.py
passed

Browser confirmation smoke at http://127.0.0.1:18766
draftId=msa-genui-draft-48cfa2f9bd225927
note="Confirmation envelope saved msa-genui-confirm-68498fd665e0dca4."

python -m pytest -q
238 passed, 16 deselected

npm test -- tests/dashboard/medicalWorkflowData.test.ts tests/cli/targetCommands.test.ts tests/cli/medscaleCli.test.ts
3 test suites passed; 29 tests passed

npm run typecheck
passed

git diff --check
passed with CRLF warning for target-research-platform/src/dashboard/static/index.html
```

No review approval, terminology decision artifact, PubMed claim record, or claim ledger write was
created by this verification run.
