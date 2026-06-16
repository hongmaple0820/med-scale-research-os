"""
文献深度解读 — 逐篇生成中文评述。

数据输入应经 literature_enricher 富化（PubMed MeSH + AMiner + 医学 Skills）。
优先调用 OpenAI 兼容 Chat Completions API；无密钥时回退到规则化中文摘要。
"""
from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

from .agent_llm_provider import (
    agent_cache_path,
    call_chat_completion,
    load_agent_review_cache,
    resolve_llm_provider,
    review_tasks_path,
    save_agent_review_tasks,
)
from .medical_skills_bridge import build_literature_skill_context, evidence_level_label
from .usage_envelope import build_usage_envelope, collect_usage_envelopes, summarize_usage_envelopes


class LiteratureReviewer:
    """对 PubMed 文献元数据生成中文深度评述。"""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: int = 60,
        max_papers: int = 12,
        output_dir: str | None = None,
        slug: str | None = None,
    ):
        self.timeout = timeout
        self.max_papers = max_papers
        self.output_dir = Path(output_dir) if output_dir else None
        self.slug = slug
        self._provider = None
        if api_key:
            from .agent_llm_provider import LlmProviderConfig
            self._provider = LlmProviderConfig(
                api_key=api_key,
                base_url=(base_url or "https://api.openai.com/v1").rstrip("/"),
                model=model or "gpt-4o-mini",
                source="openai",
            )
        else:
            self._provider = resolve_llm_provider()
        self._agent_cache: dict[str, Any] | None = None
        if self.output_dir and self.slug:
            self._agent_cache = load_agent_review_cache(agent_cache_path(self.output_dir, self.slug))

    @property
    def llm_available(self) -> bool:
        return self._provider is not None

    @property
    def llm_source(self) -> str | None:
        return self._provider.source if self._provider else None

    @property
    def model(self) -> str | None:
        return self._provider.model if self._provider else None

    def review_papers(
        self,
        papers: list[dict],
        *,
        target: str,
        disease_zh: str,
    ) -> list[dict[str, Any]]:
        selected = papers[: self.max_papers]
        reviews: list[dict[str, Any]] = []
        for idx, paper in enumerate(selected, start=1):
            review = self._review_single(paper, target=target, disease_zh=disease_zh, index=idx)
            reviews.append(review)
            if self.llm_available and idx < len(selected):
                time.sleep(0.3)
        return reviews

    def _review_single(self, paper: dict, *, target: str, disease_zh: str, index: int) -> dict[str, Any]:
        title = paper.get("title", "")
        design = paper.get("study_design") or self._infer_theme(title)
        pmid = str(paper.get("pmid") or "")
        base = {
            "index": index,
            "pmid": paper.get("pmid", ""),
            "title": title,
            "year": paper.get("year", ""),
            "journal": paper.get("journal", ""),
            "theme": self._infer_theme(title),
            "study_design": design,
            "evidence_level": evidence_level_label(design, paper),
            "mesh_terms": paper.get("mesh_terms") or [],
            "publication_types": paper.get("publication_types") or [],
            "aminer_citation_count": paper.get("aminer_citation_count"),
            "enrichment_sources": paper.get("enrichment_sources") or [],
            "source": "rule_based",
        }
        # 1) Agent 平台预写缓存（Cursor 会话写入，无需 API Key）
        cached = self._lookup_agent_cache(pmid=pmid, index=index)
        if cached:
            base["commentary_zh"] = cached
            base["source"] = "agent_cache"
            return base

        # 2) SCALE 本地 / OpenAI 兼容端点
        if self.llm_available:
            llm_text, meta = self._call_llm(paper, target=target, disease_zh=disease_zh)
            if llm_text:
                base["commentary_zh"] = llm_text
                base["source"] = meta.get("source", "llm")
                base["llm_model"] = meta.get("model")
                return base

        base["commentary_zh"] = self._rule_based_commentary(paper, target=target, disease_zh=disease_zh)
        return base

    def _lookup_agent_cache(self, *, pmid: str, index: int) -> str | None:
        if not self._agent_cache:
            return None
        for item in self._agent_cache.get("reviews") or []:
            if pmid and str(item.get("pmid")) == pmid:
                text = (item.get("commentary_zh") or "").strip()
                return text or None
            if int(item.get("index") or 0) == index:
                text = (item.get("commentary_zh") or "").strip()
                return text or None
        return None

    def _review_single(self, paper: dict, *, target: str, disease_zh: str, index: int) -> dict[str, Any]:
        title = paper.get("title", "")
        design = paper.get("study_design") or self._infer_theme(title)
        pmid = str(paper.get("pmid") or "")
        base = {
            "index": index,
            "pmid": paper.get("pmid", ""),
            "title": title,
            "year": paper.get("year", ""),
            "journal": paper.get("journal", ""),
            "theme": self._infer_theme(title),
            "study_design": design,
            "evidence_level": evidence_level_label(design, paper),
            "mesh_terms": paper.get("mesh_terms") or [],
            "publication_types": paper.get("publication_types") or [],
            "aminer_citation_count": paper.get("aminer_citation_count"),
            "enrichment_sources": paper.get("enrichment_sources") or [],
            "source": "rule_based",
        }

        cached = self._lookup_agent_cache_item(pmid=pmid, index=index)
        if cached:
            base["commentary_zh"] = str(cached.get("commentary_zh") or "").strip()
            base["source"] = "agent_cache"
            envelope = self._usage_envelope_from_cache_item(
                cached,
                target=target,
                disease_zh=disease_zh,
                pmid=pmid,
                index=index,
            )
            if envelope:
                base["usage_envelope"] = envelope
            return base

        if self.llm_available:
            llm_text, meta = self._call_llm(paper, target=target, disease_zh=disease_zh)
            if llm_text:
                base["commentary_zh"] = llm_text
                base["source"] = meta.get("source", "llm")
                base["llm_model"] = meta.get("model")
                envelope = build_usage_envelope(
                    provider=meta.get("provider") or meta.get("source"),
                    model=meta.get("model"),
                    medical_lane="literature",
                    source_role="literature_deep_review",
                    target=target,
                    disease=disease_zh,
                    usage=meta.get("usage"),
                    evidence_ref=f"pmid:{pmid}" if pmid else f"paper:{index}",
                    metadata={"review_index": index, "source": str(meta.get("source") or "llm")},
                )
                if envelope:
                    base["usage_envelope"] = envelope
                return base

        base["commentary_zh"] = self._rule_based_commentary(paper, target=target, disease_zh=disease_zh)
        return base

    def _lookup_agent_cache_item(self, *, pmid: str, index: int) -> dict[str, Any] | None:
        if not self._agent_cache:
            return None
        for item in self._agent_cache.get("reviews") or []:
            if not isinstance(item, dict):
                continue
            if pmid and str(item.get("pmid")) == pmid:
                text = (item.get("commentary_zh") or "").strip()
                return item if text else None
            if int(item.get("index") or 0) == index:
                text = (item.get("commentary_zh") or "").strip()
                return item if text else None
        return None

    def _usage_envelope_from_cache_item(
        self,
        item: dict[str, Any],
        *,
        target: str,
        disease_zh: str,
        pmid: str,
        index: int,
    ) -> dict[str, Any] | None:
        existing = item.get("usage_envelope")
        if isinstance(existing, dict) and existing.get("schema") == "medscale.usage_envelope.v1":
            return existing
        return build_usage_envelope(
            provider=item.get("provider") or item.get("model_provider") or item.get("source"),
            model=item.get("model") or item.get("llm_model"),
            medical_lane="literature",
            source_role="agent_cache_review",
            target=target,
            disease=disease_zh,
            usage=item.get("usage"),
            evidence_ref=f"pmid:{pmid}" if pmid else f"paper:{index}",
            metadata={"review_index": index, "source": "agent_cache"},
        )

    def export_review_tasks(
        self,
        papers: list[dict],
        *,
        target: str,
        disease_zh: str,
    ) -> str | None:
        """导出 Agent 待办评述任务（供 Cursor Agent 读取并完成）。"""
        if not self.output_dir or not self.slug:
            return None
        tasks = []
        for idx, paper in enumerate(papers[: self.max_papers], start=1):
            abstract = paper.get("abstract") or ""
            tasks.append({
                "index": idx,
                "pmid": paper.get("pmid"),
                "title": paper.get("title"),
                "study_design": paper.get("study_design"),
                "mesh_terms": paper.get("mesh_terms") or [],
                "citation_count": paper.get("citation_count") or paper.get("aminer_citation_count"),
                "prompt_hint": build_literature_skill_context(paper, target=target, disease_zh=disease_zh),
                "instruction": (
                    "请用中文撰写 180-280 字学术评述，写入 agent_reviews.json 对应 index。"
                    "禁止编造未给出的统计数据。"
                ),
            })
        payload = {
            "target": target,
            "disease_zh": disease_zh,
            "task_type": "literature_deep_review",
            "agent_platform": "cursor|scale",
            "usage_envelope_schema": "medscale.usage_envelope.v1",
            "usage_instruction": (
                "If an Agent or model provider is used, include provider, model, and a usage object "
                "with input_tokens/prompt_tokens and output_tokens/completion_tokens in agent_reviews.json."
            ),
            "output_file": str(agent_cache_path(self.output_dir, self.slug)),
            "papers": tasks,
        }
        return save_agent_review_tasks(review_tasks_path(self.output_dir, self.slug), payload)

    def _call_llm(self, paper: dict, *, target: str, disease_zh: str) -> tuple[str | None, dict]:
        authors = ", ".join((paper.get("authors") or [])[:4])
        abstract = paper.get("abstract") or paper.get("snippet") or ""
        skill_ctx = build_literature_skill_context(paper, target=target, disease_zh=disease_zh)
        prompt = f"""你是一位肿瘤药理学领域的资深审稿人（遵循 AIPOCH Evidence Insight 证据边界）。
请仅根据下列文献元数据，用中文撰写一段 180–280 字的学术评述。

要求：
1. 说明该研究与 {target}/{disease_zh} 的关联
2. 点明研究设计类型与证据强度（已给出推断结果时可引用）
3. 结合 MeSH/关键词概括核心科学问题或结论（摘要缺失时标注「据标题推断」）
4. 指出对靶点研发或临床实践的启示；若有引用数/期刊信号可简要提及学术影响力
5. 禁止编造未给出的 p 值、HR、样本量或实验结果
6. 语气客观、学术，适合写入论文「逐篇文献深度解读」小节

{skill_ctx}

文献信息：
- 标题：{paper.get('title', '')}
- 作者：{authors}
- 期刊：{paper.get('journal', '')} ({paper.get('year', '')})
- PMID：{paper.get('pmid', '')}
- 摘要：{abstract[:1500] if abstract else '（未提供摘要）'}
"""
        return call_chat_completion(
            prompt=prompt,
            temperature=0.3,
            max_tokens=500,
            timeout=self.timeout,
            provider=self._provider,
        )

    @staticmethod
    def _infer_theme(title: str) -> str:
        t = title.lower()
        if "resistance" in t or "耐药" in t:
            return "耐药机制"
        if "cdk4/6" in t:
            return "CDK4/6 抑制剂"
        if "selective" in t and "cdk4" in t:
            return "CDK4 选择性抑制"
        if "biomarker" in t or "predict" in t or "scrnaseq" in t or "single-cell" in t:
            return "生物标志物/单细胞"
        if "adjuvant" in t or "metastatic" in t or "clinical trial" in t:
            return "临床试验与疗效"
        if "review" in t or "systematic" in t or "meta-analysis" in t:
            return "循证综述"
        if "combination" in t or "联合" in t:
            return "联合治疗策略"
        return "机制与转化研究"

    def _rule_based_commentary(self, paper: dict, *, target: str, disease_zh: str) -> str:
        title = paper.get("title", "")
        theme = paper.get("study_design") or self._infer_theme(title)
        journal = paper.get("journal", "未知期刊")
        year = paper.get("year", "n.d.")
        abstract = (paper.get("abstract") or paper.get("snippet") or "").strip()
        mesh = paper.get("mesh_terms") or []
        mesh_note = f"MeSH 主题：{'；'.join(mesh[:4])}。" if mesh else ""
        cite_note = ""
        cites = paper.get("citation_count") or paper.get("aminer_citation_count")
        if cites is not None:
            cite_note = f"被引约 {cites} 次（OpenAlex/AMiner）。"
        level = evidence_level_label(theme, paper)

        if abstract:
            snippet = re.sub(r"\s+", " ", abstract)[:180]
            evidence = f"摘要提示：{snippet}…"
        else:
            evidence = f"据标题推断，该研究聚焦「{title[:80]}」。"

        theme_notes = {
            "耐药机制": (
                f"该文关注 {target} 通路抑制剂治疗后的耐药演化，对 {disease_zh} 后线治疗策略具有参考价值。"
                "建议结合本分析中的临床试验密度，评估耐药干预能否形成差异化适应症。"
            ),
            "CDK4/6 抑制剂": (
                f"作为 {disease_zh} 领域的主流疗法，CDK4/6 抑制剂相关证据直接影响 {target} 靶点的临床定位。"
                "需对照本文中的疗效/安全性结论，判断全新 CDK4 选择性方案的必要性。"
            ),
            "CDK4 选择性抑制": (
                "选择性抑制 CDK4 而非 CDK6 是近期重要研发方向，可能改善治疗窗口。"
                f"该研究为 {target} 在 {disease_zh} 中的差异化假设提供支持或反证。"
            ),
            "生物标志物/单细胞": (
                "生物标志物分层是精准用药关键。该文有助于识别响应或耐药人群，"
                f"可与我方 TCGA 表达异质性结果交叉验证。"
            ),
            "临床试验与疗效": (
                f"该文提供临床层级的疗效或试验设计信息，可映射到 ClinicalTrials.gov 检索到的活跃试验格局，"
                f"辅助判断 {target} 在 {disease_zh} 中的研发可行性。"
            ),
            "循证综述": (
                "综述类文献可快速勾勒领域共识与争议焦点，适合作为讨论部分的外部对照，"
                f"但不宜替代原创数据。"
            ),
            "联合治疗策略": (
                f"联合用药是克服 {target} 通路耐药的可行路径。该文为联合方案设计提供线索，"
                "应结合本研究的成药性评分与竞争强度综合决策。"
            ),
        }
        note = theme_notes.get(
            theme,
            f"该研究从「{theme}」角度补充了 {target} 在 {disease_zh} 中的证据链。",
        )
        enrich_hint = ""
        sources = paper.get("enrichment_sources") or []
        if sources:
            enrich_hint = f"（数据来源：{'+'.join(sources)}）"
        return (
            f"【{theme}｜证据{level}】发表于 {journal}（{year}）。{mesh_note}{cite_note}{evidence} "
            f"{note}{enrich_hint}（规则化评述；可用 Agent 缓存 / SCALE 本地模型 / OPENAI_API_KEY 升级。）"
        )


def review_literature_for_manuscript(
    papers: list[dict],
    *,
    target: str,
    disease_zh: str,
    enrichment_meta: dict[str, Any] | None = None,
    output_dir: str | None = None,
    slug: str | None = None,
    ) -> dict[str, Any]:
    reviewer = LiteratureReviewer(output_dir=output_dir, slug=slug)
    reviews = reviewer.review_papers(papers, target=target, disease_zh=disease_zh)
    usage_envelopes = collect_usage_envelopes(reviews)
    agent_sources = {"agent_cache", "openai", "scale_local"}
    llm_used = any(r.get("source") in agent_sources for r in reviews)
    review_tasks = None
    if not llm_used and not any(r.get("source") == "agent_cache" for r in reviews):
        review_tasks = reviewer.export_review_tasks(papers, target=target, disease_zh=disease_zh)
    return {
        "reviews": reviews,
        "llm_used": llm_used,
        "llm_model": reviewer.model if reviewer.llm_available else None,
        "llm_available": reviewer.llm_available,
        "llm_source": reviewer.llm_source,
        "agent_review_tasks": review_tasks,
        "agent_cache_expected": str(agent_cache_path(Path(output_dir), slug)) if output_dir and slug else None,
        "enrichment": enrichment_meta or {},
        "usage_envelopes": usage_envelopes,
        "usage_summary": summarize_usage_envelopes(usage_envelopes),
        "count": len(reviews),
    }
