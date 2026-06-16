"""Shared usage/evidence envelope for MedSCALE medical workflow artifacts."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any


SCHEMA = "medscale.usage_envelope.v1"

_INPUT_KEYS = ("input_tokens", "prompt_tokens", "inputTokens", "promptTokens")
_OUTPUT_KEYS = ("output_tokens", "completion_tokens", "outputTokens", "completionTokens")
_CACHE_KEYS = (
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "cached_tokens",
    "cacheCreationInputTokens",
    "cacheReadInputTokens",
    "cachedTokens",
)


def _number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value >= 0:
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = float(value)
        except ValueError:
            return None
        if parsed < 0:
            return None
        return int(parsed) if parsed.is_integer() else parsed
    return None


def _first_number(payload: dict[str, Any], keys: tuple[str, ...]) -> int | float | None:
    for key in keys:
        value = _number(payload.get(key))
        if value is not None:
            return value
    return None


def normalize_usage_payload(raw_usage: Any) -> dict[str, Any]:
    """Normalize common provider usage payloads without inventing token counts."""
    if not isinstance(raw_usage, dict):
        return {}

    usage: dict[str, Any] = {}
    for key, value in raw_usage.items():
        if isinstance(value, (str, int, float)) and _number(value) is not None:
            usage[key] = _number(value)
        elif isinstance(value, dict):
            nested: dict[str, Any] = {}
            for nested_key, nested_value in value.items():
                number = _number(nested_value)
                if number is not None:
                    nested[nested_key] = number
            if nested:
                usage[key] = nested

    input_tokens = _first_number(usage, _INPUT_KEYS)
    output_tokens = _first_number(usage, _OUTPUT_KEYS)
    if input_tokens is not None and "input_tokens" not in usage:
        usage["input_tokens"] = input_tokens
    if output_tokens is not None and "output_tokens" not in usage:
        usage["output_tokens"] = output_tokens
    total_tokens = _number(usage.get("total_tokens") or usage.get("totalTokens"))
    if total_tokens is None and input_tokens is not None and output_tokens is not None:
        total_tokens = input_tokens + output_tokens
    if total_tokens is not None:
        usage["total_tokens"] = total_tokens
    return usage


def has_model_token_fields(raw_usage: Any) -> bool:
    usage = normalize_usage_payload(raw_usage)
    return any(_first_number(usage, keys) is not None for keys in (_INPUT_KEYS, _OUTPUT_KEYS, _CACHE_KEYS))


def build_usage_envelope(
    *,
    provider: str | None,
    model: str | None = None,
    medical_lane: str,
    source_role: str,
    target: str | None = None,
    disease: str | None = None,
    usage: Any = None,
    evidence_ref: str | None = None,
    metadata: dict[str, Any] | None = None,
    timestamp: str | None = None,
) -> dict[str, Any] | None:
    """Build a deterministic envelope only when explicit model token fields exist."""
    normalized_usage = normalize_usage_payload(usage)
    if not provider or not has_model_token_fields(normalized_usage):
        return None

    envelope = {
        "schema": SCHEMA,
        "provider": str(provider),
        "model": model,
        "medical_lane": medical_lane,
        "source_role": source_role,
        "target": target,
        "disease": disease,
        "evidence_ref": evidence_ref,
        "usage": normalized_usage,
        "metadata": metadata or {},
        "timestamp": timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    envelope["usage_id"] = _stable_usage_id(envelope)
    return envelope


def collect_usage_envelopes(value: Any) -> list[dict[str, Any]]:
    envelopes: list[dict[str, Any]] = []

    def visit(item: Any) -> None:
        if isinstance(item, dict):
            if item.get("schema") == SCHEMA:
                envelopes.append(item)
                return
            nested = item.get("usage_envelope")
            if isinstance(nested, dict) and nested.get("schema") == SCHEMA:
                envelopes.append(nested)
            for child in item.values():
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)

    visit(value)
    unique: dict[str, dict[str, Any]] = {}
    for envelope in envelopes:
        usage_id = str(envelope.get("usage_id") or _stable_usage_id(envelope))
        unique[usage_id] = envelope
    return list(unique.values())


def summarize_usage_envelopes(envelopes: list[dict[str, Any]]) -> dict[str, Any]:
    summary = {
        "schema": "medscale.usage_summary.v1",
        "total_records": 0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
        "total_tokens": 0,
        "cache_savings_tokens": 0,
        "by_medical_lane": {},
        "providers": {},
    }
    for envelope in envelopes:
        usage = normalize_usage_payload(envelope.get("usage"))
        input_tokens = _first_number(usage, _INPUT_KEYS) or 0
        output_tokens = _first_number(usage, _OUTPUT_KEYS) or 0
        total_tokens = _number(usage.get("total_tokens")) or input_tokens + output_tokens
        cache_savings = _first_number(usage, ("cache_read_input_tokens", "cached_tokens", "cacheReadInputTokens", "cachedTokens")) or 0
        lane = str(envelope.get("medical_lane") or "workflow")
        provider = str(envelope.get("provider") or "unknown")

        summary["total_records"] += 1
        summary["total_input_tokens"] += input_tokens
        summary["total_output_tokens"] += output_tokens
        summary["total_tokens"] += total_tokens
        summary["cache_savings_tokens"] += cache_savings

        lane_row = summary["by_medical_lane"].setdefault(lane, {"records": 0, "total_tokens": 0})
        lane_row["records"] += 1
        lane_row["total_tokens"] += total_tokens

        provider_row = summary["providers"].setdefault(provider, {"records": 0, "total_tokens": 0})
        provider_row["records"] += 1
        provider_row["total_tokens"] += total_tokens
    return summary


def _stable_usage_id(envelope: dict[str, Any]) -> str:
    stable = {
        "provider": envelope.get("provider"),
        "model": envelope.get("model"),
        "medical_lane": envelope.get("medical_lane"),
        "source_role": envelope.get("source_role"),
        "target": envelope.get("target"),
        "disease": envelope.get("disease"),
        "evidence_ref": envelope.get("evidence_ref"),
        "usage": normalize_usage_payload(envelope.get("usage")),
    }
    digest = hashlib.sha256(json.dumps(stable, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    return f"MSU-{digest[:16]}"
