# 医学研究工作流 — 今日交付指南

> **适用对象**：医学研究工作者（操作 Agent）+ 技术支持同事  
> **交付版本**：v0.43.0 + 靶点研究管线 Beta  
> **最后更新**：2026-06-10

---

## 5 分钟上手（研究者视角）

### 第一步：环境检查

```bash
scale target doctor
```

看到 `总体: 可运行` 即可继续。若失败：

```bash
cd target-research-platform
pip install -r requirements.txt
```

### 第二步：运行完整分析

```bash
scale target analyze CDK4 --disease "breast cancer" --cancers BRCA
```

预计 5–15 分钟，会依次完成四个阶段：

| 阶段 | 内容 |
|------|------|
| Stage 1 | 表达全景（GTEx / TCGA / HPA） |
| Stage 2 | 靶点筛选与成药性评分 |
| Stage 3 | 文献与竞品格局 |
| Stage 4 | 商业计划书与里程碑 |

### 第三步：生成期刊论文草稿

```bash
scale target manuscript --target CDK4 --disease "breast cancer"
```

该命令基于已有四阶段结果生成中文 IMRaD 草稿、中华肿瘤杂志格式稿、Word 草稿、图表和元数据，并写入 `dashboard_runtime/live_status.json`，供 Dashboard 展示。

严格交付或 CI 场景可加质量门禁：

```bash
scale target manuscript --target CDK4 --disease "breast cancer" --fail-on-quality --json
```

`--fail-on-quality` 会在稿件质量门禁存在硬错误时返回非零退出码；普通运行仍会生成稿件并在 JSON 中输出 `quality_gate` 详情。

### 第四步：查看结果

```bash
# 命令行状态
scale target status

# 医学研究工作台（浏览器打开 http://127.0.0.1:18766）
scale target dashboard

# 研究者交付包
scale target package --target CDK4 --disease "breast cancer"
```

濡傛灉瑕佹妸鏈鍖诲浜や粯娌夋穩鍒伴粯璁よ蹇嗕緵搴斿晢锛堟帹鑽?`gbrain`锛夛紝鍙洿鎺ヨ繍琛岋細

```bash
scale target remember --target CDK4 --disease "breast cancer"
scale target package --target CDK4 --disease "breast cancer" --seed-memory
scale target package --target CDK4 --disease "breast cancer" --seed-memory --settle-learning --ingest-memory-brain
```

`remember` / `--seed-memory` 浼氬皢稿浠躲€佷腑鍗庤偪鐦ゆ潅蹇楁牸寮忕銆乵eta銆乹uality銆乫act_check銆乴iterature evidence銆丄gent review cache 鍜?delivery manifest staging 鎴愬彲妫€绱㈡枃妗ｏ紝鍐嶅鍏?`gbrain`銆傞粯璁や粛浣跨敤 `--no-embed` 鏈湴瀵煎叆妯″紡锛屼笉浼氶粯榛樻墦寮€澶栭儴鍐欏叆銆?
```

---

## 给 Agent 的操作指令（复制即用）

在 Cursor / Codex 中，研究者可以直接发送：

```
请分析靶点 CDK4 在乳腺癌中的成药性，执行：
scale target doctor
scale target analyze CDK4 --disease "breast cancer" --cancers BRCA --json
分析完成后运行 scale target status 并总结关键结论。
```

Agent 必须：
1. 先跑 `doctor`，失败则停止并报告修复步骤
2. 用 `--json` 获取结构化结果，禁止编造数据
3. 引用产物路径（`artifacts` 字段）作为证据
4. 未跑验证前不得声称「分析通过」

---

## 交付范围说明

### 今日可交付（Beta）

| 能力 | 状态 |
|------|------|
| 四阶段靶点分析管线 | 可用 |
| 权威 API 数据溯源 | 可用 |
| `scale target analyze` 统一入口 | 可用 |
| 本地 Dashboard 可视化 | 可用 |
| Agent 操作指令模板 | 可用 |
| SCALE 工作流门禁（define/verify/ship） | 可用 |

### 今日不承诺（Beta 后续）

| 能力 | 状态 |
|------|------|
| 多用户 / 权限 / 审计合规 | 未实现 |
| 云端部署 | 未实现 |
| FDA 21 CFR Part 11 | 未实现 |
| 非医学类 Agent 步骤的真实 LLM 调用 | 仍为模拟 |

---

## 产物位置

分析完成后，产物在：

```
target-research-platform/output/
├── stage1/   # 表达分析 JSON
├── stage2/   # 筛选排序 JSON
├── stage3/   # 深度调研 JSON
├── stage4/   # 商业计划书 MD + JSON
├── manuscripts/  # 期刊论文草稿（中文 IMRaD + 图表 + 逐篇评述）
│   ├── {TARGET}_{disease}_manuscript.md
│   ├── {TARGET}_{disease}_manuscript_zhongliu.md   # 中华肿瘤杂志格式
│   ├── {TARGET}_{disease}_manuscript.docx
│   ├── {TARGET}_{disease}_manuscript_meta.json
│   ├── {TARGET}_{disease}_manuscript_quality.json      # 质量门禁报告
│   ├── {TARGET}_{disease}_manuscript_fact_check.json  # 医学事实核查报告
│   ├── {TARGET}_{disease}_delivery_manifest.json      # 交付清单与 hash
│   ├── {TARGET}_{disease}_memory_summary.md           # 记忆摘要
│   ├── {TARGET}_{disease}_memory_seed.json            # 记忆播种记录
│   ├── {TARGET}_{disease}_memory_learning_candidate.md   # 学习候选摘要
│   ├── {TARGET}_{disease}_memory_learning_candidate.json # 学习候选记录
│   └── figures/   # 热图、桑基图等 PNG
├── deliveries/
│   └── {TARGET}_{disease}_delivery.zip                # 研究者交付包（含 memory artifacts）
└── dashboard_runtime/live_status.json  # Dashboard 实时状态
```

---

## 医学 Skills 富化（论文生成）

论文管线已接入三层证据增强（对标 AIPOCH Evidence Insight 逻辑）：

| 能力 | 实现 | 环境变量 |
|------|------|----------|
| PubMed 完整摘要 + MeSH | `PubMedClient.fetch_details`（efetch） | 默认开启；`MANUSCRIPT_ENRICH_PUBMED=0` 关闭 |
| 被引次数（免费） | `OpenAlexClient` | 默认开启，**无需 Key** |
| AMiner 引用链/期刊信号 | `AMinerClient.enrich_by_title` | 可选 `AMINER_TOKEN` |
| **Agent 平台评述（推荐）** | `{slug}_agent_reviews.json` | Cursor Agent 写入，**无需 Key** |
| SCALE 本地模型评述 | `SCALE_LOCAL_BASE_URL` | 默认探测 Ollama `localhost:11434` |
| 外部 LLM 评述 | `LiteratureReviewer` | 可选 `OPENAI_API_KEY` |

为避免外部学术 API 长尾阻塞交付，论文富化有默认时间边界：`MANUSCRIPT_ENRICH_BUDGET_SECONDS=45`、`MANUSCRIPT_ENRICH_OPENALEX_TIMEOUT=5`、`MANUSCRIPT_ENRICH_PUBMED_TIMEOUT=10`、`MANUSCRIPT_ENRICH_AMINER_TIMEOUT=8`。超时不会中断论文生成，只会降级使用已有 Stage3/缓存元数据，并在 manuscript metadata 的 `literature_reviews.enrichment` 中记录 `deadline_exceeded` 与 `budget_seconds`。

论文 PNG 图表会自动选择可用中文字体（如 Microsoft YaHei / SimHei / Noto Sans SC）。如部署环境字体选择不理想，可用 `MANUSCRIPT_CHART_FONT` 指定 matplotlib 可识别的字体名。

**方式 A — Agent 平台（推荐，无需 API Key）**

```text
1. python main.py manuscript --target CDK4 --disease "breast cancer"
   → 生成 CDK4_breast_cancer_review_tasks.json（待办）
2. 在 Cursor 中对 Agent 说：「请根据 review_tasks 生成 agent_reviews.json」
   → 写入 CDK4_breast_cancer_agent_reviews.json
3. 再次运行 manuscript 命令 → 自动合并 Agent 评述
```

**方式 B — SCALE 本地模型（Ollama）**

```powershell
$env:SCALE_LOCAL_BASE_URL = "http://localhost:11434/v1"
$env:SCALE_LOCAL_MODEL = "qwen2.5:7b"
python main.py manuscript --target CDK4 --disease "breast cancer" --json
```

**方式 C — 外部 API（可选）**

```powershell
$env:OPENAI_API_KEY = "sk-..."
python main.py manuscript --target CDK4 --disease "breast cancer" --json
```

> 当前未安装 AIPOCH 550+ skills 包；已将 `study-design-identifier`、`paper-to-claim-verifier`、`drug-target-evidence-landscape` 的核心规则编码在 `medical_skills_bridge.py`。完整技能库见 [medical-research-skills](https://github.com/aipoch/medical-research-skills)。

---

## 故障排查

| 现象 | 处理 |
|------|------|
| `未找到 target-research-platform` | 在仓库根目录 `e:\project\yixue-scale-engine` 运行 |
| Python 不可用 | 安装 Python 3.10+，确保 `python --version` 可用 |
| API 超时 | 检查网络，重试；缓存目录 `target-research-platform/cache/` 会加速二次查询 |
| Dashboard 空白 | 先完成一次 `scale target analyze`，再启动 dashboard |

---

## 技术支持联系清单

交付时向研究者说明：

1. 本版本为 **Alpha**，结果仅供研究参考，不构成申报依据
2. 所有数据来自公开 API，带完整溯源记录
3. 遇到问题先跑 `scale target doctor`，将输出截图给技术支持
