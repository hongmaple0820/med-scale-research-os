"""
API客户端基类
所有数据源客户端必须继承此类，确保统一的接口和数据溯源
"""
import json
import time
import hashlib
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
import requests


class APIResponse:
    """标准化API响应"""

    def __init__(
        self,
        success: bool,
        data: Any,
        source: str,
        endpoint: str,
        params: dict,
        timestamp: str,
        raw_response: Optional[str] = None,
        error: Optional[str] = None
    ):
        self.success = success
        self.data = data
        self.source = source
        self.endpoint = endpoint
        self.params = params
        self.timestamp = timestamp
        self.raw_response = raw_response
        self.error = error

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "source": self.source,
            "endpoint": self.endpoint,
            "params": self.params,
            "timestamp": self.timestamp,
            "error": self.error,
            "data": self.data
        }

    def get_provenance(self) -> dict:
        """获取数据溯源信息"""
        return {
            "source": self.source,
            "endpoint": self.endpoint,
            "params": self.params,
            "timestamp": self.timestamp,
            "request_hash": hashlib.md5(
                f"{self.endpoint}{json.dumps(self.params, sort_keys=True)}".encode()
            ).hexdigest()
        }


class BaseAPIClient(ABC):
    """API客户端基类"""

    def __init__(self, cache_dir: Optional[str] = None, rate_limit: float = 0.34):
        """
        Args:
            cache_dir: 缓存目录路径
            rate_limit: 请求间隔（秒），默认0.34秒（约3次/秒）
        """
        self.cache_dir = Path(cache_dir) if cache_dir else Path("./cache")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.rate_limit = rate_limit
        self._last_request_time = 0
        self._session = requests.Session()
        self._session.headers.update({
            "User-Agent": "TargetResearchPlatform/1.0"
        })

    @property
    @abstractmethod
    def source_name(self) -> str:
        """数据源名称"""
        pass

    @property
    @abstractmethod
    def base_url(self) -> str:
        """API基础URL"""
        pass

    def _wait_for_rate_limit(self):
        """遵守速率限制"""
        elapsed = time.time() - self._last_request_time
        if elapsed < self.rate_limit:
            time.sleep(self.rate_limit - elapsed)
        self._last_request_time = time.time()

    def _get_cache_key(self, endpoint: str, params: dict) -> str:
        """生成缓存键"""
        key_str = f"{self.source_name}:{endpoint}:{json.dumps(params, sort_keys=True)}"
        return hashlib.md5(key_str.encode()).hexdigest()

    def _get_from_cache(self, cache_key: str) -> Optional[dict]:
        """从缓存读取"""
        cache_file = self.cache_dir / f"{cache_key}.json"
        if cache_file.exists():
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    cached = json.load(f)
                    # 缓存有效期24小时
                    cached_time = datetime.fromisoformat(cached.get('timestamp', '2000-01-01'))
                    if (datetime.now() - cached_time).total_seconds() < 86400:
                        return cached
            except (json.JSONDecodeError, ValueError):
                pass
        return None

    def _save_to_cache(self, cache_key: str, response: APIResponse):
        """保存到缓存"""
        cache_file = self.cache_dir / f"{cache_key}.json"
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(response.to_dict(), f, ensure_ascii=False, indent=2)

    def _make_request(
        self,
        method: str,
        endpoint: str,
        params: Optional[dict] = None,
        json_data: Optional[dict] = None,
        use_cache: bool = True
    ) -> APIResponse:
        """发起HTTP请求"""
        # 检查缓存
        cache_key = self._get_cache_key(endpoint, params or {})
        if use_cache:
            cached = self._get_from_cache(cache_key)
            if cached:
                return APIResponse(**cached)

        # 速率限制
        self._wait_for_rate_limit()

        url = f"{self.base_url}/{endpoint.lstrip('/')}"

        try:
            if method.upper() == "GET":
                response = self._session.get(url, params=params, timeout=30)
            elif method.upper() == "POST":
                response = self._session.post(url, params=params, json=json_data, timeout=30)
            else:
                raise ValueError(f"不支持的HTTP方法: {method}")

            response.raise_for_status()

            api_response = APIResponse(
                success=True,
                data=response.json() if response.content else None,
                source=self.source_name,
                endpoint=endpoint,
                params=params or {},
                timestamp=datetime.now().isoformat(),
                raw_response=response.text[:1000]  # 只保存前1000字符
            )

            # 保存缓存
            if use_cache:
                self._save_to_cache(cache_key, api_response)

            return api_response

        except requests.exceptions.RequestException as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint=endpoint,
                params=params or {},
                timestamp=datetime.now().isoformat(),
                error=str(e)
            )

    @abstractmethod
    def health_check(self) -> bool:
        """检查API可用性"""
        pass
