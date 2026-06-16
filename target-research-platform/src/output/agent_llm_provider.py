"""
Agent / SCALE 平台 LLM 提供方

优先级（与 SCALE LocalModelProvider 对齐）：
1. Agent 预写评述缓存（Cursor/Agent 会话写入的 JSON）
2. MANUSCRIPT_LLM_* / OPENAI_API_KEY 直连
3. SCALE_LOCAL_* 本地模型（Ollama 等，默认 http://localhost:11434/v1）
4. 无可用提供方 → 返回 None，由调用方走规则回退
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests


@dataclass
class LlmProviderConfig:
    api_key: str
    base_url: str
    model: str
    source: str  # agent_cache | openai | scale_local


def resolve_llm_provider() -> LlmProviderConfig | None:
    """解析当前环境可用的 LLM 端点。"""
    # 显式稿件 LLM 配置
    api_key = (
        os.environ.get("MANUSCRIPT_LLM_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    ).strip()
    base_url = (
        os.environ.get("MANUSCRIPT_LLM_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or ""
    ).strip()
    model = os.environ.get("MANUSCRIPT_LLM_MODEL") or os.environ.get("OPENAI_MODEL") or "gpt-4o-mini"

    if api_key:
        return LlmProviderConfig(
            api_key=api_key,
            base_url=(base_url or "https://api.openai.com/v1").rstrip("/"),
            model=model,
            source="openai",
        )

    # SCALE 本地模型（Ollama / 内网网关）
    local_base = (
        os.environ.get("SCALE_LOCAL_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or "http://localhost:11434/v1"
    ).rstrip("/")
    local_key = os.environ.get("SCALE_LOCAL_API_KEY") or "ollama"
    local_model = os.environ.get("SCALE_LOCAL_MODEL") or os.environ.get("MANUSCRIPT_LLM_MODEL") or "qwen2.5:7b"

    if _probe_chat_endpoint(local_base, local_key, local_model):
        return LlmProviderConfig(
            api_key=local_key,
            base_url=local_base,
            model=local_model,
            source="scale_local",
        )

    return None


def _probe_chat_endpoint(base_url: str, api_key: str, model: str, timeout: int = 3) -> bool:
    """快速探测 OpenAI 兼容端点是否可达。"""
    if os.environ.get("MANUSCRIPT_LLM_PROBE", "1") == "0":
        return True
    try:
        resp = requests.get(f"{base_url.rstrip('/')}/models", timeout=timeout, headers=_auth_headers(api_key))
        if resp.status_code == 200:
            return True
        # 部分端点无 /models，用最小 chat 探测
        resp = requests.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={**_auth_headers(api_key), "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 1,
            },
            timeout=timeout,
        )
        return resp.status_code in (200, 400, 422)
    except Exception:
        return False


def _auth_headers(api_key: str) -> dict[str, str]:
    if not api_key or api_key == "ollama":
        return {}
    return {"Authorization": f"Bearer {api_key}"}


def call_chat_completion(
    *,
    prompt: str,
    system: str = "你是医学论文写作助手，输出简洁中文评述。",
    temperature: float = 0.3,
    max_tokens: int = 500,
    timeout: int = 90,
    provider: LlmProviderConfig | None = None,
) -> tuple[str | None, dict[str, Any]]:
    cfg = provider or resolve_llm_provider()
    if not cfg:
        return None, {"source": "none"}

    try:
        resp = requests.post(
            f"{cfg.base_url}/chat/completions",
            headers={**_auth_headers(cfg.api_key), "Content-Type": "application/json"},
            json={
                "model": cfg.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
        usage = data.get("usage") or {}
        meta = {
            "source": cfg.source,
            "provider": cfg.source,
            "model": cfg.model,
            "base_url": cfg.base_url,
            "usage": usage,
            "tokens": usage.get("total_tokens") if isinstance(usage, dict) else None,
        }
        return (content if len(content) > 40 else None), meta
    except Exception as exc:
        return None, {"source": cfg.source, "error": str(exc)}


def load_agent_review_cache(path: Path) -> dict[str, Any] | None:
    """读取 Agent 平台预生成的评述缓存。"""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("reviews"):
            return data
    except Exception:
        return None
    return None


def save_agent_review_tasks(path: Path, payload: dict[str, Any]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(path.resolve())


def agent_cache_path(output_dir: Path, slug: str) -> Path:
    return output_dir / f"{slug}_agent_reviews.json"


def review_tasks_path(output_dir: Path, slug: str) -> Path:
    return output_dir / f"{slug}_review_tasks.json"
