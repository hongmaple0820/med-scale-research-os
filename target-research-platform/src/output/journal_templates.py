"""
期刊投稿模板 — 《中华肿瘤杂志》等中文核心期刊格式。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any


def render_zhonghua_oncology(
    context: dict[str, Any],
    body_md: str,
    *,
    figures: list[dict[str, str]] | None = None,
) -> str:
    """
    将 IMRaD 正文包装为《中华肿瘤杂志》风格稿件。

    格式要点：
    - 中英文题目、结构化摘要、关键词
    - 正文层级：前言 / 材料与方法 / 结果 / 讨论 / 参考文献
    - 图表中英文双语题注
    - 文末利益冲突、伦理声明、基金占位
    """
    target = context.get("target", "")
    disease_zh = context.get("disease_zh", context.get("disease", ""))
    title_zh = context.get("title_zh", "")
    title_en = context.get("title_en", "")
    abstract = _extract_section(body_md, "摘要") or _build_structured_abstract(context)
    keywords = f"{target}；{disease_zh}；治疗靶点；成药性；临床试验；生物信息学"
    keywords_en = f"{target}; {context.get('disease', '')}; therapeutic target; druggability; clinical trials"

    figure_block = _render_figures(figures or context.get("figures") or [])

    # 去掉 body 中已有的重复摘要/标题，保留正文核心
    core_body = body_md
    for marker in ("# ", "## 摘要", "## 1 引言", "## 1 前言"):
        if marker in core_body:
            break
    if "## 1 引言" in body_md:
        core_body = body_md.split("## 1 引言", 1)[-1]
        core_body = "## 1 前言\n\n" + core_body.lstrip()
    elif "## 1 前言" in body_md:
        idx = body_md.index("## 1 前言")
        core_body = body_md[idx:]

    today = datetime.now().strftime("%Y-%m-%d")

    manuscript = f"""---
journal: 中华肿瘤杂志
template_version: "1.0"
generated_at: {context.get("generated_at", today)}
---

<div align="center">

# {title_zh}

**{title_en}**

[作者姓名]<sup>1</sup>　[共同作者]<sup>1,2</sup>

<sup>1</sup> [单位名称，城市 邮编]　<sup>2</sup> [合作单位]

**通信作者：** [姓名]，E-mail: [email@institution.edu.cn]

</div>

---

**【摘要】**　{_strip_md_headers(abstract)}

**【关键词】**　{keywords}

**【Abstract】**　{_english_abstract_placeholder(context)}

**【Key words】**　{keywords_en}

---

**基金项目：** 国家自然科学基金（编号：待填）；省部级课题（待填）

**收稿日期：** {today}　　**修回日期：** 待填

---

{core_body}

---

{figure_block}

---

## 利益冲突声明

所有作者声明不存在利益冲突。

## 伦理审查

本研究使用公开去标识化数据库，未涉及人体或动物实验，免予伦理审查。

## 作者贡献声明

[待填：研究设计 / 数据分析 / 论文撰写 / 经费支持 — CRediT 格式]

---

> **排版说明（投稿前删除本段）：**
> 1. 图表需按在正文中首次出现顺序编号（图1、图2…；表1、表2…）
> 2. 《中华肿瘤杂志》要求参考文献著录格式为温哥华样式序号制
> 3. 英文摘要需由作者或专业翻译润色
> 4. 配置 `OPENAI_API_KEY` 可启用 LLM 深度文献评述

*模板：中华肿瘤杂志 v1.0 · 靶点研究平台*
"""
    return _sanitize_submission_placeholders(manuscript)


def _sanitize_submission_placeholders(text: str) -> str:
    """Keep journal fields present without making unverifiable submission claims."""
    replacements = {
        "国家自然科学基金（编号：待填）；省部级课题（待填）": "待填写（投稿前由作者确认）",
        "所有作者声明不存在利益冲突。": "利益冲突声明：待全体作者确认后填写。",
        "本研究使用公开去标识化数据库，未涉及人体或动物实验，免予伦理审查。": (
            "本稿基于公开数据库与去标识化数据；是否需要伦理审查或豁免应由作者所在机构确认。"
        ),
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


def _extract_section(md: str, heading: str) -> str | None:
    token = f"## {heading}"
    if token not in md:
        return None
    part = md.split(token, 1)[1]
    for stop in ("\n## ", "\n---"):
        if stop in part:
            part = part.split(stop, 1)[0]
    return part.strip()


def _strip_md_headers(text: str) -> str:
    lines = []
    for line in text.splitlines():
        if line.startswith("#"):
            continue
        if line.strip() == "---":
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def _build_structured_abstract(context: dict[str, Any]) -> str:
    clin = context.get("clinical_summary") or {}
    dev = context.get("developability") or {}
    ms = context.get("milestones") or {}
    return (
        f"**目的** 评估 {context.get('target')} 在{context.get('disease_zh')}中的治疗靶点价值。"
        f"**方法** 整合 GTEx、TCGA、PubMed 与 ClinicalTrials.gov 四阶段计算分析。"
        f"**结果** 临床试验 {clin.get('total_trials', '—')} 项，可开发性 {dev.get('score', '—')}/100，"
        f"研发周期约 {ms.get('total_duration', '—')}。"
        f"**结论** 具备研发基础，需明确差异化策略。"
    )


def _english_abstract_placeholder(context: dict[str, Any]) -> str:
    return (
        f"Objective: To assess {context.get('target')} as a therapeutic target in "
        f"{context.get('disease', '')} using integrative public data. "
        f"Methods: Multi-omics and clinical registry analysis. "
        f"Results: See Chinese abstract for quantitative findings. "
        f"Conclusions: Supports further development with differentiation required. "
        f"[English abstract to be polished by authors before submission.]"
    )


def _render_figures(figures: list[dict[str, str]]) -> str:
    if not figures:
        return ""
    lines = ["## 图表（嵌入稿）\n"]
    for i, fig in enumerate(figures, 1):
        path = fig.get("relative") or fig.get("path", "")
        title_zh = fig.get("title_zh", f"图{i}")
        title_en = fig.get("title_en", f"Figure {i}")
        lines.append(f"### 图{i}　{title_zh}\n")
        lines.append(f"**Figure {i}.** {title_en}\n")
        if path:
            lines.append(f"![图{i}]({path})\n")
        lines.append("")
    return "\n".join(lines)
