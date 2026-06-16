"""
任务监控 CLI — 查询 Celery 任务状态。

使用:
    python -m shared.task_monitor status <task_id>
    python -m shared.task_monitor list
    python -m shared.task_monitor submit --gene KRAS --disease "Pancreatic Cancer"
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

CELERY_BROKER = "redis://localhost:6379/0"


def get_celery_app():
    try:
        from celery import Celery
        app = Celery("target_intelligence", broker=CELERY_BROKER)
        return app
    except ImportError:
        print("[ERROR] Celery not installed. Run: pip install celery redis")
        sys.exit(1)


def cmd_status(args):
    app = get_celery_app()
    from celery.result import AsyncResult
    result = AsyncResult(args.task_id, app=app)
    print(f"Task ID: {args.task_id}")
    print(f"Status:  {result.status}")
    if result.ready():
        print(f"Result:  {json.dumps(result.result, indent=2, ensure_ascii=False)}")
    elif result.info:
        print(f"Progress: {json.dumps(result.info, indent=2, ensure_ascii=False)}")


def cmd_submit(args):
    from tasks import run_full_analysis
    result = run_full_analysis.delay(args.gene, args.disease)
    print(f"Task submitted: {result.id}")
    print(f"Monitor with: python -m shared.task_monitor status {result.id}")


def cmd_workers(args):
    app = get_celery_app()
    inspect = app.control.inspect()
    active = inspect.active()
    if active:
        for worker, tasks in active.items():
            print(f"Worker: {worker}")
            for task in tasks:
                print(f"  - {task['name']} ({task['id']})")
    else:
        print("No active workers. Start with: celery -A shared.tasks worker --loglevel=info")


def main():
    parser = argparse.ArgumentParser(description="Target Intelligence Task Monitor")
    sub = parser.add_subparsers(dest="command")

    p_status = sub.add_parser("status", help="Check task status")
    p_status.add_argument("task_id", help="Celery task ID")

    p_submit = sub.add_parser("submit", help="Submit new analysis")
    p_submit.add_argument("--gene", required=True)
    p_submit.add_argument("--disease", required=True)

    sub.add_parser("workers", help="List active workers")

    args = parser.parse_args()
    if args.command == "status":
        cmd_status(args)
    elif args.command == "submit":
        cmd_submit(args)
    elif args.command == "workers":
        cmd_workers(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
