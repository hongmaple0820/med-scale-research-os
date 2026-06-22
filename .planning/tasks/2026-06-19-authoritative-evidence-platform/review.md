# Review - 2026-06-19-authoritative-evidence-platform

Date: 2026-06-19
Level: CRITICAL

## Review Decision

`PLAN-2026-06-19-GOVERNANCE-FOUNDATION` 可作为后续适配器的治理内核继续使用。

理由：

- 数据来源、许可、下载证据、内容哈希、manifest 元数据哈希和审核状态已形成闭环。
- 所有下游派生均以人工批准和完整性验证为硬前置条件。
- 失败路径采用关闭策略；账本写入失败会回滚文件。
- 实现不依赖 LLM，磁盘重载和离线回归已通过。

## Review Findings Resolved

- 将 `verify()` 的异常处理缩窄到预期的审核缺失/解析失败，不隐藏未知程序错误。
- 增加 reviewer/signature 必填和重复审批拒绝测试。
- 增加 manifest 来源、许可元数据篡改检测。
- manifest 改为临时文件写入后原子替换。
- 增加审核账本写入失败的产物回滚测试。

## Residual Risks

- JSONL 账本尚无跨进程锁、哈希链或外部签名服务，当前仅适合单进程本地 V1。
- 来源注册表仍需真实维护流程、到期策略和定期可用性检查。
- HTTP 参考适配器尚无断点续传、重试预算、限速和 schema 漂移检测。
- 当前测试证明合同正确，不证明 NCBI GEO 或其他真实来源在 2026-06-19 的在线可用性。
- 七维标准化与跨来源比较方法仍需逐数据库方法卡和专家审核。

## Recommendation

Phase 2 实现可进入人工采集审核。真实 GSE1 下载已经通过本地固定控制，但不得把适配器
控制通过解释为研究数据集适用性、疾病相关性或标准化方法通过。

人工审核应核对：

1. 来源域名和官方 URL。
2. raw 文件 SHA-256 与字节数。
3. manifest 中的 stable ID、许可、下载响应头和 schema profile。
4. GSE1 仅作为固定技术对照的角色。
5. 审核范围只批准 acquisition，不批准 normalization/screening/intelligence。

## Normalization Review Gate

The acquisition gate is now approved. The next artifact does not contain a normalized matrix; it
contains a fail-closed normalization assessment.

Recommended review decision: approve the block. GSE1 should remain an adapter structural control
because:

- 49.35% of finite values are negative, so another log2 transform is invalid.
- Submitted processing metadata is non-empty for only 1 of 38 samples.
- Sample sources are heterogeneous and cannot be automatically converted into case/control groups.
- Rows are GPL7 probe IDs without an admitted versioned gene mapping.
- The control role itself prohibits promotion into target screening.

## Project Admission Review

The project admission implementation is acceptable. It preserves the user's machine-executes-only
boundary by refusing to infer disease, tissue, groups, or project controls.

Current workflow decision: blocked pending human project input. This is a required governance stop,
not an implementation failure.

## Supplied Medical AI Guide Review

The guide is approved as a requirements-discovery input, not as an authoritative specification.
The evidence audit found useful principles alongside unsupported universal accuracy figures,
provider/API assumptions, pseudo-GRADE scoring, and overbroad compliance claims.

Only the decisions recorded in ADR-0006 and the V2 architecture are admitted into implementation.

## Terminology and PubMed Review Gate

The implementation is acceptable for acquisition review:

- MeSH is versioned and its license obligations are explicit.
- Candidate resolution cannot silently choose an ID.
- PubMed records preserve stable IDs and exact locator hashes.
- Claim text must be human-authored and requires approved raw evidence.
- Study design, risk of bias, certainty, and applicability remain separate.
- PubMed abstract data is treated as research-only in the persistent source registry.

Recommended decision scope: approve the two raw fixed controls only. Do not approve a term mapping
or a medical claim in the same decision.

## Mapping and Evidence Review Gate

The raw controls are now approved. The derived artifacts correctly stop at two separate decisions:

1. Select or reject the sole MeSH candidate `D008545 / Melanoma`.
2. Approve the PubMed worksheet structure only; it contains no claim and no evidence judgment.

These decisions must not be collapsed into one implicit approval.
