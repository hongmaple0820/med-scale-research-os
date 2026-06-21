"""Deterministic byte-range transport for authoritative source adapters."""
from __future__ import annotations

import hashlib
import re
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.request import Request, urlopen

from .artifacts import ArtifactIntegrityError


@dataclass(frozen=True)
class RangeDownloadResponse:
    status_code: int
    content: bytes
    headers: Mapping[str, str]


@dataclass(frozen=True)
class DownloadReceipt:
    url: str
    path: str
    sha256: str
    size_bytes: int
    resumed_from: int
    response_status: int
    request_headers: dict[str, str]
    response_headers: dict[str, str]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


RangeFetchFunction = Callable[
    [str, dict[str, str]],
    RangeDownloadResponse,
]
OpenUrlFunction = Callable[..., object]


class ResumableHttpDownloader:
    """Resume a local partial file and verify the final bytes before use."""

    _CONTENT_RANGE = re.compile(r"^bytes (\d+)-(\d+)/(\d+|\*)$")

    def __init__(
        self,
        *,
        fetch: RangeFetchFunction | None = None,
        open_url: OpenUrlFunction | None = None,
        user_agent: str = "MedSCALE-Research-OS/1.0",
        max_silent_eof_attempts: int = 3,
    ) -> None:
        if fetch is not None and open_url is not None:
            raise ValueError("Provide either fetch or open_url, not both.")
        self.fetch = fetch
        self.open_url = open_url or urlopen
        self.user_agent = user_agent
        self.max_silent_eof_attempts = max(1, max_silent_eof_attempts)

    def download(
        self,
        *,
        url: str,
        destination: str | Path,
        expected_size_bytes: int | None = None,
        expected_sha256: str | None = None,
    ) -> DownloadReceipt:
        output = Path(destination)
        output.parent.mkdir(parents=True, exist_ok=True)
        request_headers: dict[str, str] = {}
        response_headers: dict[str, str] = {}
        response_status = 0
        resumed_from = 0
        for attempt in range(self.max_silent_eof_attempts):
            partial_size = output.stat().st_size if output.is_file() else 0
            request_headers = {"User-Agent": self.user_agent}
            if partial_size:
                request_headers["Range"] = f"bytes={partial_size}-"

            if self.fetch is None:
                response_status, response_headers, resumed_from = (
                    self._stream_to_partial(
                        url=url,
                        output=output,
                        partial_size=partial_size,
                        request_headers=request_headers,
                    )
                )
            else:
                response_status, response_headers, resumed_from = (
                    self._write_buffered_response(
                        response=self.fetch(url, request_headers),
                        output=output,
                        partial_size=partial_size,
                    )
                )
            size_bytes = output.stat().st_size
            if (
                expected_size_bytes is not None
                and size_bytes < expected_size_bytes
                and self.fetch is None
                and attempt + 1 < self.max_silent_eof_attempts
            ):
                continue
            break

        if expected_size_bytes is not None and size_bytes != expected_size_bytes:
            raise ArtifactIntegrityError(
                "Downloaded byte count does not match the expected control byte count."
            )
        content_hash = hashlib.sha256(output.read_bytes()).hexdigest()
        if expected_sha256 and content_hash.lower() != expected_sha256.lower():
            raise ArtifactIntegrityError(
                "Downloaded checksum does not match the expected control checksum."
            )

        return DownloadReceipt(
            url=url,
            path=str(output.resolve()),
            sha256=content_hash,
            size_bytes=size_bytes,
            resumed_from=resumed_from,
            response_status=response_status,
            request_headers=request_headers,
            response_headers=response_headers,
        )

    def _stream_to_partial(
        self,
        *,
        url: str,
        output: Path,
        partial_size: int,
        request_headers: dict[str, str],
    ) -> tuple[int, dict[str, str], int]:
        request = Request(url, headers=request_headers)
        with self.open_url(request, timeout=120) as response:
            status_code = response.getcode()
            response_headers = self._normalize_headers(
                dict(response.headers.items())
            )
            mode, resumed_from = self._response_write_mode(
                status_code=status_code,
                response_headers=response_headers,
                partial_size=partial_size,
                response_size=None,
            )
            with output.open(mode) as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
                    handle.flush()
        return status_code, response_headers, resumed_from

    def _write_buffered_response(
        self,
        *,
        response: RangeDownloadResponse,
        output: Path,
        partial_size: int,
    ) -> tuple[int, dict[str, str], int]:
        response_headers = self._normalize_headers(response.headers)
        mode, resumed_from = self._response_write_mode(
            status_code=response.status_code,
            response_headers=response_headers,
            partial_size=partial_size,
            response_size=len(response.content),
        )
        with output.open(mode) as handle:
            handle.write(response.content)
        return response.status_code, response_headers, resumed_from

    @staticmethod
    def _normalize_headers(headers: Mapping[str, str]) -> dict[str, str]:
        return {
            str(key).lower(): str(value)
            for key, value in headers.items()
        }

    def _response_write_mode(
        self,
        *,
        status_code: int,
        response_headers: dict[str, str],
        partial_size: int,
        response_size: int | None,
    ) -> tuple[str, int]:
        if status_code == 206:
            if not partial_size:
                raise ArtifactIntegrityError(
                    "Server returned a partial response without a local partial file."
                )
            content_range = response_headers.get("content-range", "")
            match = self._CONTENT_RANGE.fullmatch(content_range)
            if not match or int(match.group(1)) != partial_size:
                raise ArtifactIntegrityError(
                    "Partial response Content-Range does not match the local byte count."
                )
            range_end = int(match.group(2))
            if (
                response_size is not None
                and range_end - partial_size + 1 != response_size
            ):
                raise ArtifactIntegrityError(
                    "Partial response byte count does not match Content-Range."
                )
            return "ab", partial_size
        if status_code == 200:
            return "wb", 0
        raise ArtifactIntegrityError(
            f"Authoritative download returned HTTP {status_code}."
        )
