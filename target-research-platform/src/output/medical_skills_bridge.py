"""
医学研究 Agent Skills 桥接层

将 AIPOCH / 循证医学工作流中的核心逻辑编码为可复用 Python 规则，
供稿件生成管线在 PubMed 富化与 LLM 评述前调用。

参考能力域（Evidence Insight）：
- study-design-identifier：研究设计识别
- paper-to-claim-verifier：主张可证性约束
- drug-target-evidence-landscape：靶点证据景观 framing
"""
from __future__ import annotations

import re
from typing import Any


# AIPOCH paper-to-claim-verifier 约束：禁止超出元数据的断言
CLAIM_GUARDRAILS_ZH = """
【证据边界】
1. 仅根据已提供的标题、摘要、MeSH、发表类型、引用数评述，不得编造 p 值、HR、样本量。
2. 摘要缺失时须标注「据标题推断」。
3. 综述/Meta 分析不得表述为原创实验结论。
4. 临床试验类文献须区分试验阶段与主要终点是否在给定摘要中出现。
"""


def _matches_marker(values: list[str], marker: str, *, ignore_topic_suffix: bool = False) -> bool:
    for value in values:
        current = value.lower()
        if ignore_topic_suffix and current.endswith(" as topic"):
            continue
        if marker in current:
            return True
    return False


def infer_study_design(paper: dict[str, Any]) -> str:
    """
    研究设计识别（对标 AIPOCH study-design-identifier）。

    优先级：发表类型 > MeSH > 标题关键词。
    """
    pub_types = [str(x).lower() for x in (paper.get("publication_types") or [])]
    mesh = [str(x).lower() for x in (paper.get("mesh_terms") or [])]
    title = (paper.get("title") or "").lower()

    pub_type_checks: list[tuple[str, list[str]]] = [
        ("系统综述/Meta分析", ["meta-analysis", "systematic review", "network meta"]),
        ("综述", ["review", "narrative review"]),
        ("随机对照试验", ["randomized controlled trial", "randomised controlled trial"]),
        ("临床试验", ["clinical trial", "clinical study"]),
        ("队列研究", ["cohort studies", "prospective studies", "retrospective studies"]),
        ("病例对照研究", ["case-control studies"]),
        ("临床前/体外研究", ["preclinical", "in vitro", "xenograft", "cell line"]),
        ("生物信息学/计算研究", ["bioinformatics", "transcriptom", "single-cell", "scrnaseq", "tcga"]),
    ]
    for label, keys in pub_type_checks:
        if any(_matches_marker(pub_types, key) for key in keys):
            return label

    secondary_checks: list[tuple[str, list[str]]] = [
        ("系统综述/Meta分析", ["meta-analysis", "systematic review", "network meta"]),
        ("随机对照试验", ["randomized controlled trial", "randomised controlled trial"]),
        ("临床试验", ["clinical trial", "clinical study"]),
        ("队列研究", ["cohort studies", "prospective studies", "retrospective studies"]),
        ("病例对照研究", ["case-control studies"]),
        ("临床前/体外研究", ["preclinical", "in vitro", "xenograft", "cell line"]),
        ("综述", ["review", "narrative review"]),
        ("生物信息学/计算研究", ["bioinformatics", "transcriptom", "single-cell", "scrnaseq", "tcga"]),
    ]
    for label, keys in secondary_checks:
        for key in keys:
            if _matches_marker(mesh, key, ignore_topic_suffix=True):
                return label
            if key in title:
                return label

    if "review" in title:
        return "综述"
    if re.search(r"phase\s+[i123]", title):
        return "临床试验"
    return "机制与转化研究"


def evidence_level_label(study_design: str, paper: dict[str, Any]) -> str:
    """粗略证据等级（用于评述语气，非正式 GRADE）。"""
    design = study_design.lower()
    if "meta" in design or "系统综述" in design:
        return "I（系统综述/Meta）"
    if "随机" in design or "rct" in design:
        return "II（RCT）"
    if "临床试验" in design or "队列" in design:
        return "III（临床/队列）"
    if "综述" in design:
        return "IV（叙述性综述）"
    cites = paper.get("aminer_citation_count")
    if isinstance(cites, (int, float)) and cites >= 50:
        return "III（高被引机制研究）"
    return "IV（临床前/探索性）"


def build_literature_skill_context(paper: dict[str, Any], *, target: str, disease_zh: str) -> str:
    """为 LLM 评述组装医学 skill 增强上下文块。"""
    design = paper.get("study_design") or infer_study_design(paper)
    level = evidence_level_label(design, paper)
    mesh = "；".join((paper.get("mesh_terms") or [])[:8]) or "（无 MeSH）"
    pub_types = "；".join((paper.get("publication_types") or [])[:5]) or "（未标注）"
    keywords = "；".join((paper.get("keywords") or paper.get("aminer_keywords") or [])[:6]) or "（无）"

    aminer_bits = []
    if paper.get("aminer_citation_count") is not None:
        aminer_bits.append(f"被引次数≈{paper['aminer_citation_count']}")
    if paper.get("aminer_venue"):
        aminer_bits.append(f"AMiner 期刊信号：{paper['aminer_venue']}")
    if paper.get("aminer_cited_by_sample"):
        sample = "；".join(paper["aminer_cited_by_sample"][:2])
        aminer_bits.append(f"引用链样例：{sample}")

    aminer_line = " | ".join(aminer_bits) if aminer_bits else "（未匹配 AMiner）"

    return (
        f"靶点/疾病：{target} / {disease_zh}\n"
        f"研究设计（skill 推断）：{design}\n"
        f"证据等级（粗估）：{level}\n"
        f"MeSH：{mesh}\n"
        f"发表类型：{pub_types}\n"
        f"关键词：{keywords}\n"
        f"AMiner 补充：{aminer_line}\n"
        f"{CLAIM_GUARDRAILS_ZH}"
    )


def drug_target_evidence_framing(target: str, disease_zh: str, paper_count: int) -> str:
    """靶点证据景观 framing（对标 drug-target-evidence-landscape）。"""
    return (
        f"在 {disease_zh} 语境下，{target} 相关公开文献约 {paper_count} 篇。"
        f"评述应回答：该文献如何补充机制证据、临床转化线索或竞争格局认知，"
        f"并指出是否支持 {target} 作为差异化靶点的假设。"
    )
