"""
Unified API client for biomedical databases.
Handles rate limiting, retries, and response caching.

Supported databases (verified 2026-06-01):
- GTEx Portal API v2          ✅ verified
- cBioPortal REST API          ✅ verified (replaces GDC for expression data)
- Open Targets GraphQL          ✅ verified
- ChEMBL REST API               ✅ verified (direct ID lookup, not search)
- ClinicalTrials.gov v2         ✅ verified
- PubMed E-utilities            ✅ verified
- UniProt REST API              ✅ verified
- STRING API                    ✅ verified
"""

import json
import os
import time
import hashlib
from pathlib import Path
from typing import Any, Dict, Optional, List

import requests

try:
    from shared.cache import ResultCache
except ImportError:
    from cache import ResultCache

CACHE_DIR = Path(__file__).parent.parent / ".cache"
CACHE_DIR.mkdir(exist_ok=True)

_cache_instance = None


def get_cache() -> ResultCache:
    """Lazy-initialized module-level ResultCache instance."""
    global _cache_instance
    if _cache_instance is None:
        _cache_instance = ResultCache()
    return _cache_instance

DEFAULT_TIMEOUT = 30
DEFAULT_RETRIES = 3
DEFAULT_RETRY_DELAY = 2


class _CachedResponse:
    """Lightweight response wrapper for ResultCache hits."""

    def __init__(self, data: dict):
        self._data = data

    def json(self) -> dict:
        return self._data

    @property
    def status_code(self) -> int:
        return 200

    @property
    def text(self) -> str:
        return json.dumps(self._data, ensure_ascii=False)


class APIClient:
    """Unified HTTP client with caching, retries, and rate limiting.

    Args:
        base_url: API base URL.
        timeout: Request timeout in seconds.
        retries: Number of retry attempts.
        retry_delay: Base delay between retries in seconds.
        headers: Optional default headers.
        cache_ttl: File-based cache TTL in seconds (legacy).
        use_result_cache: Enable SQLite-backed ResultCache (default False).
        cache_ttl_days: TTL in days for ResultCache (default 7).
    """

    def __init__(
        self,
        base_url: str,
        timeout: int = DEFAULT_TIMEOUT,
        retries: int = DEFAULT_RETRIES,
        retry_delay: float = DEFAULT_RETRY_DELAY,
        headers: Optional[Dict[str, str]] = None,
        cache_ttl: int = 3600,
        use_result_cache: bool = False,
        cache_ttl_days: int = 7,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.retries = retries
        self.retry_delay = retry_delay
        self.cache_ttl = cache_ttl
        self.use_result_cache = use_result_cache
        self.cache_ttl_days = cache_ttl_days
        self.session = requests.Session()
        if headers:
            self.session.headers.update(headers)
        # Proxy robustness: on Windows, requests resolves a proxy from the
        # registry even with no *_proxy env var set, often pointing at a dead
        # local proxy (e.g. 127.0.0.1:7890) that makes every POST fail.
        # Honor TARGET_INTEL_NO_PROXY=1 to force direct; otherwise auto-fall
        # back to a direct connection on the first ProxyError (see _send).
        self._proxies = None
        if os.environ.get("TARGET_INTEL_NO_PROXY", "").strip().lower() in ("1", "true", "yes"):
            self._disable_proxy()
        self._last_request_time = 0.0
        self._min_interval = 0.34  # ~3 req/sec max

    def _result_cache_key(self, url: str, params: Optional[Dict] = None) -> str:
        """Generate md5 cache key for ResultCache: md5(url|sorted_params)."""
        sorted_params = json.dumps(params or {}, sort_keys=True)
        raw = f"{url}|{sorted_params}"
        return hashlib.md5(raw.encode()).hexdigest()

    def _cache_key(self, url: str, params: Optional[Dict] = None) -> str:
        raw = json.dumps({"url": url, "params": params or {}}, sort_keys=True)
        return hashlib.md5(raw.encode()).hexdigest()

    def _get_cache(self, key: str) -> Optional[Dict]:
        cache_file = CACHE_DIR / f"{key}.json"
        if cache_file.exists():
            try:
                data = json.loads(cache_file.read_text(encoding="utf-8"))
                if time.time() - data.get("timestamp", 0) < self.cache_ttl:
                    return data.get("result")
            except (json.JSONDecodeError, KeyError):
                pass
        return None

    def _set_cache(self, key: str, result: Any) -> None:
        cache_file = CACHE_DIR / f"{key}.json"
        cache_file.write_text(
            json.dumps({"timestamp": time.time(), "result": result}, ensure_ascii=False),
            encoding="utf-8",
        )

    def _rate_limit(self) -> None:
        elapsed = time.time() - self._last_request_time
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last_request_time = time.time()

    def _disable_proxy(self) -> None:
        """Force direct connections (ignore env AND registry proxies)."""
        self.session.trust_env = False
        self._proxies = {"http": None, "https": None}

    def _send(self, method: str, url: str, **kwargs) -> "requests.Response":
        """Issue an HTTP request, auto-falling back to a direct connection once
        on ProxyError (handles broken Windows registry/env proxies). After the
        first fallback the client stays in direct mode for its lifetime."""
        try:
            return self.session.request(method, url, timeout=self.timeout, proxies=self._proxies, **kwargs)
        except requests.exceptions.ProxyError:
            if self._proxies is None:
                self._disable_proxy()
                return self.session.request(method, url, timeout=self.timeout, proxies=self._proxies, **kwargs)
            raise

    def get(
        self,
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        use_cache: bool = True,
    ) -> Dict[str, Any]:
        url = f"{self.base_url}/{endpoint.lstrip('/')}"

        # SQLite-backed ResultCache (opt-in via use_result_cache=True)
        if self.use_result_cache:
            rc = get_cache()
            rc_key = self._result_cache_key(url, params)
            cached = rc.get(gene="", disease="", phase="", source=rc_key)
            if cached is not None:
                return cached["data"]

        cache_key = self._cache_key(url, params)

        if use_cache:
            cached = self._get_cache(cache_key)
            if cached is not None:
                return cached

        last_error = None
        for attempt in range(self.retries):
            try:
                self._rate_limit()
                resp = self._send("GET", url, params=params)
                resp.raise_for_status()
                result = resp.json()
                if self.use_result_cache:
                    rc = get_cache()
                    rc_key = self._result_cache_key(url, params)
                    rc.set(
                        gene="", disease="", phase="", source=rc_key,
                        data=result, ttl_days=self.cache_ttl_days,
                    )
                if use_cache:
                    self._set_cache(cache_key, result)
                return result
            except requests.exceptions.RequestException as e:
                last_error = e
                if attempt < self.retries - 1:
                    time.sleep(self.retry_delay * (attempt + 1))

        raise RuntimeError(f"API request failed after {self.retries} attempts: {last_error}")

    def get_text(
        self,
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        use_cache: bool = True,
    ) -> str:
        """GET request returning raw text (for TSV/plain text responses)."""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        cache_key = self._cache_key(url, params) + "_text"

        if use_cache:
            cached = self._get_cache(cache_key)
            if cached is not None:
                return cached.get("text", "")

        last_error = None
        for attempt in range(self.retries):
            try:
                self._rate_limit()
                resp = self._send("GET", url, params=params)
                resp.raise_for_status()
                text = resp.text
                if use_cache:
                    self._set_cache(cache_key, {"text": text})
                return text
            except requests.exceptions.RequestException as e:
                last_error = e
                if attempt < self.retries - 1:
                    time.sleep(self.retry_delay * (attempt + 1))

        raise RuntimeError(f"API request failed after {self.retries} attempts: {last_error}")

    def post(
        self,
        endpoint: str,
        json_data: Optional[Dict] = None,
        data: Optional[Any] = None,
        use_cache: bool = False,
    ) -> Dict[str, Any]:
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        last_error = None
        for attempt in range(self.retries):
            try:
                self._rate_limit()
                resp = self._send("POST", url, json=json_data, data=data)
                resp.raise_for_status()
                result = resp.json()
                if use_cache:
                    cache_key = self._cache_key(url, json_data or data)
                    self._set_cache(cache_key, result)
                return result
            except requests.exceptions.RequestException as e:
                last_error = e
                if attempt < self.retries - 1:
                    time.sleep(self.retry_delay * (attempt + 1))

        raise RuntimeError(f"API request failed after {self.retries} attempts: {last_error}")

    def post_graphql(
        self,
        query: str,
        variables: Optional[Dict] = None,
        use_cache: bool = True,
    ) -> Dict[str, Any]:
        cache_key = self._cache_key(self.base_url, {"query": query, "variables": variables})
        if use_cache:
            cached = self._get_cache(cache_key)
            if cached is not None:
                return cached

        last_error = None
        for attempt in range(self.retries):
            try:
                self._rate_limit()
                resp = self._send(
                    "POST",
                    self.base_url,
                    json={"query": query, "variables": variables or {}},
                )
                resp.raise_for_status()
                result = resp.json()
                if use_cache:
                    self._set_cache(cache_key, result)
                return result
            except requests.exceptions.RequestException as e:
                last_error = e
                if attempt < self.retries - 1:
                    time.sleep(self.retry_delay * (attempt + 1))
        raise RuntimeError(f"GraphQL request failed after {self.retries} attempts: {last_error}")


# ============================================================
# Pre-configured clients — all verified 2026-06-01
# ============================================================

def get_gtex_client() -> APIClient:
    """GTEx Portal API v2. Docs: gtexportal.org/home/documentationPage"""
    return APIClient(
        base_url="https://gtexportal.org/api/v2",
        headers={"Accept": "application/json"},
        cache_ttl=86400,
    )


def get_cbioportal_client() -> APIClient:
    """cBioPortal REST API. Docs: docs.cbioportal.org/6.-web-api-and-clients/api-overview"""
    return APIClient(
        base_url="https://www.cbioportal.org/api",
        headers={"Accept": "application/json"},
        cache_ttl=86400,
    )


def get_opentargets_client() -> APIClient:
    """Open Targets GraphQL API. Docs: platform.opentargets.org/api"""
    return APIClient(
        base_url="https://api.platform.opentargets.org/api/v4/graphql",
        headers={"Content-Type": "application/json"},
        cache_ttl=86400,
    )


def get_chembl_client() -> APIClient:
    """ChEMBL REST API. Docs: chembl.gitbook.io/chembl-interface-documentation"""
    return APIClient(
        base_url="https://www.ebi.ac.uk/chembl/api/data",
        headers={"Accept": "application/json"},
        cache_ttl=86400,
    )


def get_clinicaltrials_client() -> APIClient:
    """ClinicalTrials.gov API v2. Docs: clinicaltrials.gov/data-api/about-api"""
    return APIClient(
        base_url="https://clinicaltrials.gov/api/v2",
        headers={"Accept": "application/json"},
        cache_ttl=3600,
    )


def get_pubmed_client() -> APIClient:
    """PubMed E-utilities. Docs: ncbi.nlm.nih.gov/books/NBK25500"""
    return APIClient(
        base_url="https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
        headers={"Accept": "application/json"},
        cache_ttl=3600,
    )


def get_uniprot_client() -> APIClient:
    """UniProt REST API. Docs: rest.uniprot.org/docs"""
    return APIClient(
        base_url="https://rest.uniprot.org",
        headers={"Accept": "application/json"},
        cache_ttl=86400,
    )


def get_string_client() -> APIClient:
    """STRING API. Docs: string-db.org/help/api/"""
    return APIClient(
        base_url="https://string-db.org/api",
        headers={"Accept": "application/json"},
        cache_ttl=86400,
    )


def get_lens_client() -> APIClient:
    """Lens.org free patent API. Docs: docs.lens.org"""
    return APIClient(
        base_url="https://api.lens.org/patent/search",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        cache_ttl=86400,
    )


def get_openalex_client() -> APIClient:
    """OpenAlex API for scholarly works. Docs: docs.openalex.org"""
    return APIClient(
        base_url="https://api.openalex.org",
        headers={"Accept": "application/json"},
        cache_ttl=86400,
    )


class APIGate:
    """Verify API endpoint availability at pipeline startup."""

    ENDPOINTS = {
        "GTEx": "https://gtexportal.org/api/v2/expression/medianGeneExpression?datasetId=gtex_v8&houldFilterByDatasetId=true&gencodeId=ENSG00000146648.17&tissueSiteDetailId=Lung",
        "cBioPortal": "https://www.cbioportal.org/api/studies?pageSize=1",
        "ChEMBL": "https://www.ebi.ac.uk/chembl/api/data/status.json",
        "ClinicalTrials": "https://clinicaltrials.gov/api/v2/studies?pageSize=1",
        "UniProt": "https://rest.uniprot.org/uniprotkb/P00533.json",
        "STRING": "https://string-db.org/api/json/version",
        "PubMed": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?retmode=json",
        "DisGeNET": "https://www.disgenet.org/api/gda/gene/EGFR?format=json&limit=1",
        "canSAR": "https://api.cansar.icr.ac.uk/target/EGFR",
        "OpenTargets": "https://api.platform.opentargets.org/api/v4/graphql",
    }

    # Transient errors worth retrying (network blips, not real outages)
    _TRANSIENT = (
        "ConnectionError", "ConnectionResetError", "Timeout", "ReadTimeout",
        "ConnectTimeout", "ChunkedEncodingError", "RemoteDisconnected",
    )

    @classmethod
    def check_all(cls, timeout: int = 10, force_direct: bool = None,
                  retries: int = 2, retry_delay: float = 1.5) -> dict:
        """Check all API endpoints. Returns {name: {status, latency_ms, error, via, attempts}}.

        Proxy robustness: some environments (notably Windows, where ``requests``
        resolves a proxy from the registry even with no ``*_proxy`` env var set)
        have a misconfigured/unreachable proxy. If a request fails with a
        ProxyError, it is retried with proxies disabled (direct connection).

        Transient robustness: connection resets / timeouts are retried up to
        ``retries`` times with linear backoff, so a momentary blip is not
        reported as "API unavailable".

        Args:
            timeout: per-request timeout in seconds.
            force_direct: True = always bypass proxy; False = always honor
                env/registry proxy; None (default) = honor proxy but auto-fall
                back to direct on ProxyError. Env var ``TARGET_INTEL_NO_PROXY=1``
                also forces direct.
            retries: extra attempts on transient errors (total tries = retries+1).
            retry_delay: base seconds between attempts (linear backoff).
        """
        import time as _time
        if force_direct is None:
            env_flag = os.environ.get("TARGET_INTEL_NO_PROXY", "").strip().lower()
            force_direct = env_flag in ("1", "true", "yes")

        def _request(url: str, is_graphql: bool, direct: bool):
            sess = requests.Session()
            proxies = None
            if direct:
                sess.trust_env = False  # ignore env AND registry proxies
                proxies = {"http": None, "https": None}
            headers = {"Accept": "application/json"}
            if is_graphql:
                headers["Content-Type"] = "application/json"
                return sess.post(url, json={"query": "{__typename}"}, timeout=timeout,
                                 headers=headers, proxies=proxies)
            return sess.get(url, timeout=timeout, headers=headers, proxies=proxies)

        def _is_transient(exc: Exception) -> bool:
            chain = exc
            seen = 0
            while chain is not None and seen < 6:
                if type(chain).__name__ in cls._TRANSIENT:
                    return True
                chain = getattr(chain, "__cause__", None) or getattr(chain, "__context__", None)
                seen += 1
            return "reset" in str(exc).lower() or "timed out" in str(exc).lower()

        results = {}
        for name, url in cls.ENDPOINTS.items():
            start = _time.time()
            is_graphql = "graphql" in url
            via = "direct" if force_direct else "proxy/env"
            direct = force_direct
            last_err = None
            attempts = 0
            status = None
            for attempt in range(retries + 1):
                attempts = attempt + 1
                try:
                    try:
                        resp = _request(url, is_graphql, direct=direct)
                    except requests.exceptions.ProxyError:
                        via = "direct (proxy fallback)"
                        direct = True
                        resp = _request(url, is_graphql, direct=True)
                    status = "ok" if resp.status_code < 400 else f"http_{resp.status_code}"
                    last_err = None
                    break
                except Exception as e:
                    last_err = e
                    # HTTP-level errors (4xx/5xx) won't reach here; only conn errors do.
                    if attempt < retries and _is_transient(e):
                        _time.sleep(retry_delay * (attempt + 1))
                        continue
                    break

            latency = round((_time.time() - start) * 1000)
            if last_err is None:
                results[name] = {"status": status, "latency_ms": latency,
                                 "via": via, "attempts": attempts}
            else:
                results[name] = {"status": "unavailable", "latency_ms": latency,
                                 "error": str(last_err)[:120], "via": via,
                                 "attempts": attempts}
        return results

    @classmethod
    def print_report(cls, timeout: int = 10, force_direct: bool = None, retries: int = 2):
        """Print API availability report."""
        results = cls.check_all(timeout=timeout, force_direct=force_direct, retries=retries)
        print("\n" + "=" * 72)
        print("API GATE: Endpoint Availability Check")
        print("=" * 72)
        ok_count = 0
        for name, info in results.items():
            status = info["status"]
            latency = info["latency_ms"]
            marker = "OK" if status == "ok" else "FAIL"
            via = info.get("via", "")
            tries = info.get("attempts", 1)
            tries_disp = f"x{tries}" if tries > 1 else "  "
            extra = "" if status == "ok" else f"  ({info.get('error', '')})"
            print(f"  [{marker:4s}] {name:16s} {status:12s} {latency:6d}ms {tries_disp} {via}{extra}")
            if status == "ok":
                ok_count += 1
        print(f"\n  {ok_count}/{len(results)} APIs reachable")
        print("=" * 72)
        return results


# Keep GDC client for backward compatibility but mark as deprecated
def get_gdc_client() -> APIClient:
    """[DEPRECATED] TCGA GDC API. Use cBioPortal instead for expression data."""
    return APIClient(
        base_url="https://api.gdc.cancer.gov",
        headers={"Accept": "application/json"},
        cache_ttl=86400,
    )


# Keep HPA client stub
def get_hpa_client() -> APIClient:
    """[STUB] HPA has no public REST API. Use UniProt + STRING instead."""
    return APIClient(
        base_url="https://www.proteinatlas.org",
        headers={"Accept": "application/json"},
        cache_ttl=86400,
    )


def get_disgenet_client() -> APIClient:
    """DisGeNET REST API. Docs: disgenet.com/api
    Provides gene-disease associations (GDA) scores.
    Free tier: 1000 requests/day.
    """
    return APIClient(
        base_url="https://www.disgenet.org/api",
        headers={
            "Accept": "application/json",
            "api-key": "",  # Set via DISGENET_API_KEY env var
        },
        cache_ttl=86400,
    )


def get_cansar_client() -> APIClient:
    """canSAR REST API. Docs: cansar.icr.ac.uk/api
    Provides target druggability, ligandability, and structural data.
    """
    return APIClient(
        base_url="https://api.cansar.icr.ac.uk",
        headers={"Accept": "application/json"},
        cache_ttl=86400,
    )


def get_depmap_client() -> APIClient:
    """DepMap/CRISPR dependency data. Docs: depmap.org/portal
    Provides gene effect scores across cancer cell lines.
    Note: Bulk data download preferred; API for quick lookups.
    """
    return APIClient(
        base_url="https://depmap.org/portal/api",
        headers={"Accept": "application/json"},
        cache_ttl=86400,
    )
