# 医学研究者 × Agent 操作手册

## 角色分工

| 角色 | 职责 |
|------|------|
| **医学研究者** | 提出研究问题、确认靶点/疾病、解读结论 |
| **AI Agent** | 执行命令、汇总数据、生成报告草稿 |
| **SCALE 工作流** | 约束 Agent 必须验证、留证据、不幻觉 |

## 标准工作流

```
研究者提问 → Agent 澄清参数 → scale target analyze → scale target status → 解读报告
```

## Agent 必遵规则

1. **先诊断后执行**：任何分析前运行 `scale target doctor`
2. **证据优先**：只引用 `output/` 和 `--json` 返回的字段，禁止编造 p 值、临床试验数
3. **失败即停**：任一 stage 失败时报告 `stages_failed`，不继续编造后续结论
4. **验证声明**：没有实际命令输出，不说「已通过」或「分析完成」

## 常用命令

```bash
# 环境检查
scale target doctor

# 完整分析（Agent 用 JSON 模式）
scale target analyze TP53 --disease "lung cancer" --cancers LUAD --json

# 查看状态
scale target status --json

# 打包研究者交付包
scale target package --target TP53 --disease "lung cancer" --json

# 启动医学研究工作台：http://127.0.0.1:18766/
scale target dashboard
```

## 参数说明

| 参数 | 示例 | 说明 |
|------|------|------|
| `target` | CDK4 | 基因符号 |
| `--disease` | "breast cancer" | 疾病名称（引号包裹） |
| `--cancers` | BRCA,LUAD | TCGA 癌种代码 |
| `--modality` | small_molecule | 药物形式 |
| `--risk-level` | medium | 风险等级 |

## 结果解读要点

Agent 向研究者汇报时应包含：

- 表达显著性（Stage 1）
- 成药性评分与排名（Stage 2）
- 竞品临床试验数量与阶段分布（Stage 3）
- 里程碑周期与成本估算（Stage 4）
- 每个结论对应的 JSON/MD 文件路径
