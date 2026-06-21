# 医学 AI 全链路指南证据审计

> 日期：2026-06-19
> 审计对象：用户提供的两份连续文本
> 审计深度：Deep
> 目的：区分可直接纳入 MedSCALE 的原则、需要修订的方案、未经证实的量化断言和与既定
> 产品边界冲突的设计。

## 1. 总体结论

附件约 1.3 万中文字符，包含超过 40 个技术、循证、商业和合规实施单元。它适合作为
需求启发材料，但不能作为事实基线或直接执行规范。

处理结果：

- **采纳**：逐声明溯源、术语标准化、原生英文检索、语言索引隔离、医学/商业数据隔离、
  否定与语境标记、人工审核、冲突与不确定性显式表达。
- **修订后采纳**：多路检索、知识图谱、证据分级、医学实体链接、外部 API、评估指标。
- **拒绝进入执行链**：固定“行业通用”权重、未经基准验证的 Top-K/HNSW 参数、自动创新
  推荐、外部商业模型评分、把知识图谱当真值约束、自动医学推理。
- **待授权/待验证**：UMLS/SNOMED CT、Cochrane、Trip、授权全文库、商业数据库和中国
  本地市场数据库。

## 2. 高影响审计发现

| ID | 原断言/方案 | 结论 | MedSCALE 处理 |
| --- | --- | --- | --- |
| A01 | 通用模型“无法”理解医学因果 | 绝对化且不可证伪 | 保留“模型不得作为事实来源”；不对模型能力作绝对判断 |
| A02 | 医学文本 30% 以上是术语、特定分词必然破坏实体 | 未提供可复现实验 | 要求在项目语料上测量 NER/链接，不硬编码百分比 |
| A03 | 六大术语体系“必须全部复用” | 范围不完整且许可不同 | 建立按实体域准入的 Terminology Registry；UMLS/SNOMED 需许可 |
| A04 | 所有实体统一到 UMLS CUI | 不适合所有组学实体 | 基因优先 HGNC/Ensembl，疾病 MONDO/MeSH，组织 UBERON；UMLS 作为可选 crosswalk |
| A05 | QuickUMLS/MedCAT/cTAKES 的固定原型/生产分工 | 缺少当前项目基准 | 作为候选适配器，必须通过项目实体链接基准和许可审核 |
| A06 | 英文栈比中文领先固定 2–3 年 | 不可操作的泛化判断 | 原生语言优先；英文/中文物理分索引，是否降权由项目基准决定 |
| A07 | PubMed 有“3000 万+全文” | 混淆书目与全文 | 分开登记 PubMed citation/abstract 与 PMC full text；动态记录库计数 |
| A08 | PubMedBERT 匹配准确率 95.62% | 原论文不支持通用匹配指标 | 模型进入候选池；必须在项目检索集上比较 BM25/hybrid/embedding |
| A09 | 纯向量必然漏检 40% | 无通用证据 | 通过可复现检索基准决定是否采用 hybrid retrieval |
| A10 | Top 50/30/20、HNSW M=16 等可直接使用 | 数据集相关参数 | 仅作为实验初值，不作为产品规范 |
| A11 | Trip API 100 次/天 | 未在公开官方资料核实 | 来源状态设为 `pending_verification`，不得进入生产 |
| A12 | Semantic Scholar 100 次/分钟 | 与当前官方公开说明不一致 | 速率限制由适配器运行时读取/配置，不硬编码宣传数字 |
| A13 | Cochrane API 申请学术授权即可 | 访问模式与许可更复杂 | 作为授权来源；完成合同、TDM/API 权限和导出限制审核后接入 |
| A14 | MeSH 示例含“EGFR 突变型 NSCLC”树节点 | 示例不是已验证 MeSH 节点 | 只使用 MeSH 官方 ID/树号；分子亚型由多个实体组合表达 |
| A15 | 自定义 10/8/6 分表是 GRADE | 错误 | 分离 study design、risk of bias、certainty、applicability；禁止伪称 GRADE |
| A16 | 指南、IF、引用量可直接给 GRADE 加分 | 非 GRADE 方法 | 期刊与引用信息可作为元数据，不自动改变证据确定性 |
| A17 | 固定 0.3/0.35/0.2/0.15 是行业通用精排公式 | 未证实 | 不进入产品；排序规则必须基于标注集验证并版本化 |
| A18 | 知识图谱是系统“大脑”和真值约束 | 会放大图谱缺失与陈旧 | 图谱是派生索引；所有关系必须回链来源，不能作为唯一真值 |
| A19 | 图谱中不存在的关系应被过滤 | 会压制新发现并制造假阴性 | 未知关系标记为 `unverified`，不得静默删除 |
| A20 | 创新 Agent 自动发现方向 | 与“机器只执行、不做医学推理”冲突 | V1 拒绝；机器只输出证据缺口和未覆盖组合供人工评价 |
| A21 | Grok 四 Agent 辩论天然更客观 | 无可验证官方保证 | 不采纳 |
| A22 | Grok 固定价格与能力 | 时间敏感且型号相关 | 若未来接入，运行时记录模型/价格版本；当前不进入医学或商业判断链 |
| A23 | 医学原始文献绝不输入商业模型 | 原则正确但“脱敏技术结论”仍可能敏感 | 物理隔离；任何外发数据需单独导出审批和内容清单 |
| A24 | 所有医疗数据必须在中国境内存储 | 过度概括 | 依据数据类别、处理者身份、数量阈值、重要数据认定和出境场景判断 |
| A25 | 去标识化必须移除 18 类 PHI | 这是美国 HIPAA Safe Harbor 语境 | 建立 jurisdiction profile；中国项目依据 PIPL 等法规和机构政策 |
| A26 | 医疗 AI 一律按三类器械注册 | 错误概括 | 由预期用途、风险和分类规则判断；研究平台默认不宣称诊疗用途 |
| A27 | 工具版本和 4–6 周工期可直接复用 | 易过时且无本仓库估算 | 版本由依赖治理检查；工期不进入验收标准 |
| A28 | P@10≥85%、幻觉率≤5% 等是合格标准 | 可作为目标，非通用监管阈值 | 作为项目可配置 SLO；必须定义数据集、标注者和计算方法 |

## 3. 采纳后的架构要求

### 3.1 Terminology Registry

每个术语来源必须记录词表/本体 ID、版本、发布日期、许可、下载哈希、实体域、首选 ID、
同义词、层级、废弃/替代关系、映射算法、候选列表和人工审核。

推荐的首选实体域，不把单一体系当作全局真值：

| 实体域 | 首选候选 | 备注 |
| --- | --- | --- |
| 基因/转录本 | HGNC、Ensembl、NCBI Gene | 保留版本和物种 |
| 疾病/表型 | MONDO、MeSH、HPO | UMLS 可作为授权 crosswalk |
| 组织/解剖 | UBERON、MeSH | 临床术语另行准入 |
| 药物 | RxNorm、ChEMBL、DrugBank（授权） | 商品名与研发代码分层 |
| 临床概念 | SNOMED CT、ICD-11、LOINC | 按司法辖区和许可启用 |
| 文献主题 | MeSH | 只接受官方 ID 与树号 |

### 3.2 Language-separated retrieval

- 保存原文语言，不把翻译文本作为原始证据。
- 英文和中文建立独立索引、分析召回和失败率。
- 结果层以 PMID、DOI、注册号和规范实体去重。
- 不预设中文结果降权；权重必须来源于人工标注的检索基准。

### 3.3 Retrieval benchmark before architecture lock-in

候选通道可包括 BM25、受控词表查询、向量召回和实体扩展，但权重和 Top-K 必须通过冻结
查询集与人工相关性判断验证，并分通道报告 precision、recall、nDCG、重复率和新增相关
文献。

### 3.4 Evidence methodology

正式证据包分开记录文献类型/研究设计、PICO/PECO、风险偏倚、直接性、一致性、精确性、
发表偏倚、证据确定性和问题适用性。系统不得把论文类型映射成伪 GRADE 数字分，也不得
用影响因子或引用量自动提升确定性。

### 3.5 Claim ledger

每条正式陈述必须关联 `claim_id`、陈述文本、支持/反对/不确定、PMID/DOI/注册号/专利号、
原文 locator、内容哈希、访问时间、研究设计、样本量、结局、效应量和人工审核状态。
无原文定位的模型文本不能进入正式报告。

### 3.6 Knowledge graph boundary

- 图谱节点和边均是可重建的派生产物。
- 每条边必须有一个或多个证据 locator。
- 图谱缺失表示“未收录”，不表示关系为假。
- 链路预测只能生成待检索队列，不能生成医学结论或候选推荐。

### 3.7 Medical/commercial isolation

- 医学原始文件、患者级数据和未公开研究数据不得进入外部商业模型。
- 商业事实包和医学证据包使用独立存储、来源、审核人和导出策略。
- 不自动生成投资评分或建议。
- 任何外部 API 出站内容都要形成可审核 manifest。

### 3.8 Jurisdiction-aware compliance

合规模块必须把司法辖区、主体、用途、数据类别、是否个人信息/敏感个人信息/重要数据、
跨境接收方和处理规模作为输入。模板不能输出“免伦理”“必须本地化”“三类器械”等
自动法律结论。

## 4. 官方核验来源

- NLM PubMed/PMC 实时 E-Utilities（2026-06-19 查询结果分别为 40,736,322 和
  12,330,381）：<https://eutils.ncbi.nlm.nih.gov/entrez/eutils/>
- NCBI E-Utilities 使用说明：<https://www.ncbi.nlm.nih.gov/books/NBK25497/>
- NLM MeSH Browser：<https://meshb.nlm.nih.gov/>
- NLM UMLS 许可：<https://www.nlm.nih.gov/research/umls/licensedcontent/umlsknowledgesources.html>
- PubMedBERT 原论文：<https://aclanthology.org/2021.acl-long.266/>
- Semantic Scholar API：<https://www.semanticscholar.org/product/api>
- Cochrane 数据访问：<https://www.cochrane.org/about-us/our-data>
- Cochrane Handbook/GRADE：<https://training.cochrane.org/handbook/current/chapter-14>
- 《个人信息保护法》：<https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm>
- 《促进和规范数据跨境流动规定》：<https://www.cac.gov.cn/2024-03/22/c_1712776611775634.htm>
- NMPA 人工智能医用软件分类指导：
  <https://www.nmpa.gov.cn/directory/web/nmpa/images/1625713895408075422.docx>
- xAI 当前模型与价格入口：<https://docs.x.ai/developers/models>

## 5. 后续实施顺序

1. Terminology Registry 与规范实体映射队列。
2. PubMed/MeSH 原始检索 manifest 与 claim ledger。
3. 冻结人工检索基准，再比较 BM25、词表、向量和实体扩展。
4. 研究设计/偏倚/确定性分离的证据表。
5. 医学与商业事实包物理隔离及出站审批。
6. 可选知识图谱派生索引。

在 1–4 完成前，不实施自动分析 Agent、创新 Agent、固定综合评分或外部商业模型。
