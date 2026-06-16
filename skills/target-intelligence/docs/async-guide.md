# 异步任务队列使用指南

## 前置条件
1. 安装 Redis: `docker run -d -p 6379:6379 redis:alpine` 或本地安装
2. 安装依赖: `pip install celery redis`

## 启动 Worker
```bash
cd E:\yixue-scale-engine\skills\target-intelligence
celery -A shared.tasks worker --loglevel=info -Q target_intelligence
```

## 提交任务
```python
from shared.tasks import run_full_analysis
result = run_full_analysis.delay("KRAS", "Pancreatic Cancer")
print(result.id)  # 保存此 ID 用于查询
```

## 查询状态
```bash
python -m shared.task_monitor status <task_id>
python -m shared.task_monitor workers
```

## 同步降级
如果 Redis 不可用，系统自动降级为同步执行：
```python
from shared.tasks import run_full_analysis_sync
result = run_full_analysis_sync("KRAS", "Pancreatic Cancer")
```

## 任务超时
- 软超时: 30 分钟（可被 worker 捕获做清理）
- 硬超时: 60 分钟（强制终止）
