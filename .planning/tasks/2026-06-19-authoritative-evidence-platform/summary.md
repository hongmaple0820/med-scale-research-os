# Summary - 2026-06-19-authoritative-evidence-platform

Date: 2026-06-19
Level: CRITICAL

## What Changed

- 完成疾病无关、本地优先的权威证据平台 V2 架构、冻结规格、六阶段计划和五项 ADR。
- 完成首个治理底座垂直切片：
  - 版本化来源白名单和许可/用途门禁。
  - raw/normalized/analysis 三层本地产物存储。
  - 可回溯 artifact manifest、内容摘要和 manifest 元数据摘要。
  - 强制人工签署的四阶段审核状态机。
  - 上游失效向下游级联撤销。
  - 一个不解释数据、只下载并保存检索证据的 HTTP 参考适配器。
  - 固定 SHA-256 阳性/完整性对照。
- 新增 14 个治理合同与失败路径测试，并通过现有离线全量回归。
- 完成 Phase 2 适配器 SDK：
  - byte-range 断点续传与连接中断 `.part` 保留。
  - SHA-256、字节数和官方端点硬门禁。
  - 严格 GSE accession 与 NCBI 官方 Series Matrix 路径生成。
  - gzip、accession、表起止标记、样本数、数据行数和 schema 指纹检查。
  - GSE1 固定参考控制与显式 live integration。
- 已真实下载 GSE1，生成 raw artifact、manifest 和审核账本；当前状态为
  `approved`（仅 acquisition）。
- 完成 GSE1 格式剖析和标准化方法卡评估：
  - 识别为已处理、约一半负值且接近零中心的探针级矩阵。
  - 识别 21 种样本来源标签和仅 1/38 非空处理说明。
  - 禁止重复 log2、重复 quantile normalization、自动病例/对照分组和基因级跨来源比较。
  - 生成 `blocked` 诊断 artifact，没有生成 normalized matrix。
- 完成疾病项目准入合同：
  - 要求 MONDO/UBERON/NCBITaxon 等标准实体。
  - 要求明确病例、对照、样本阈值和七维组学类型。
  - 要求项目阳性对照、预期观察和已准入来源证据。
  - 项目定义具有不可变 JSON、SHA-256、人工审核和篡改检测。
  - 未提供具体项目时输出 `blocked` 诊断，不搜索或下载队列。
- 完成用户补充《医学 AI 全链路指南》的证据审计：
  - 形成 28 项采纳、修订、拒绝和待授权决策。
  - 将 Terminology Registry、原文语言分库、claim ledger 和正确循证方法写入 V2。
  - 拒绝伪 GRADE 数字评分、未经基准验证的固定检索权重和自动创新/投资建议。
  - 将知识图谱降级为有来源回链的派生索引，不作为真值库。
- 完成 MeSH/文献证据链基础切片：
  - 真实下载并验证 NLM MeSH 2026 的 31,110 个 Descriptor。
  - 候选解析永远不自动选择 canonical ID。
  - 真实下载 PMID 10952317，记录 PMID、DOI、MeSH、发表类型和 abstract locator 哈希。
  - 实现 NCBI 限速、claim 人工输入、伪 GRADE 拒绝、重载和篡改检测。
  - 一次 NLM 静默截断被阻断，补充有限 Range 续传后控制通过。
  - 当前术语选择和医学 claim 均为 0。
- 完成术语映射与文献审核工作流：
  - 从已批准 MeSH raw 生成 `melanoma` 候选映射请求。
  - 唯一候选为 `D008545 / Melanoma`，但 `selected_id` 保持为空。
  - 从已批准 PubMed raw 生成空白证据工作表。
  - 工作表只含 locator/哈希和空白人工评价字段，不复制 abstract、不生成 claim。

## Outcome

这次完成的是“可信执行边界”，不是完整研究平台。它已经能阻止未准入来源、许可违规、
未审批派生、内容/manifest 篡改、非法审批和对照失败，为后续真实数据库适配器提供统一
合同。

## Next

1. 获取人工提供的具体疾病项目定义。
2. 通过权威本体服务检索 MONDO/UBERON 候选 ID，并交由人工确认。
3. 准入项目阳性对照的权威证据来源和记录。
4. 项目记录签署后，才允许搜索和下载独立研究队列。
5. 实现 Terminology Registry 和 PubMed/MeSH claim ledger。
6. 人工审核 MeSH 2026 与 PMID 10952317 两个 raw 参考产物。
7. 人工选择或拒绝 `melanoma → MeSH:D008545` 映射。
8. 人工审核 PubMed 证据工作表；如需 claim，另行填写声明、立场和四类评价。
