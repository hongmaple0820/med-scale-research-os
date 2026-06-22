"""Reference source adapters that preserve downloaded bytes and retrieval evidence."""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any
from urllib.request import Request, urlopen

from .artifacts import (
    ArtifactIntegrityError,
    ArtifactManifest,
    ThreeLayerArtifactStore,
)


FetchFunction = Callable[
    [str, dict[str, str]],
    tuple[bytes, Mapping[str, str]],
]


def _default_fetch(url: str, headers: dict[str, str]) -> tuple[bytes, Mapping[str, str]]:
    request = Request(url, headers=headers)
    with urlopen(request, timeout=120) as response:
        return response.read(), dict(response.headers.items())


class HttpFileAdapter:
    """Download one exact approved URL without interpreting its content."""

    def __init__(
        self,
        *,
        source_id: str,
        store: ThreeLayerArtifactStore,
        fetch: FetchFunction | None = None,
        user_agent: str = "MedSCALE-Research-OS/1.0",
    ) -> None:
        self.source_id = source_id
        self.store = store
        self.fetch = fetch or _default_fetch
        self.user_agent = user_agent

    def download(
        self,
        *,
        project_id: str,
        url: str,
        filename: str,
        stable_record_ids: tuple[str, ...],
        query: dict[str, Any],
        expected_sha256: str | None = None,
    ) -> ArtifactManifest:
        self.store.registry.require_url(self.source_id, url)
        request_headers = {
            "User-Agent": self.user_agent,
            "Accept": "application/octet-stream,*/*",
        }
        content, response_headers = self.fetch(url, request_headers)
        actual_sha256 = self.store.sha256_bytes(content)
        if expected_sha256 and actual_sha256.lower() != expected_sha256.lower():
            raise ArtifactIntegrityError(
                "Downloaded bytes do not match the expected control checksum."
            )
        normalized_headers = {
            str(key).lower(): str(value)
            for key, value in response_headers.items()
        }
        media_type = normalized_headers.get(
            "content-type",
            "application/octet-stream",
        ).split(";", 1)[0].strip()
        return self.store.ingest_raw(
            project_id=project_id,
            source_id=self.source_id,
            filename=filename,
            content=content,
            stable_record_ids=stable_record_ids,
            retrieval={
                "url": url,
                "query": dict(query),
                "request_headers": request_headers,
                "response_headers": normalized_headers,
                "expected_sha256": expected_sha256,
                "control_passed": (
                    actual_sha256.lower() == expected_sha256.lower()
                    if expected_sha256
                    else None
                ),
            },
            media_type=media_type,
        )
