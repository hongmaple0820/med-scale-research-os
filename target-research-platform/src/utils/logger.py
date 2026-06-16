"""
日志配置模块
提供统一的 logging 配置，替代散落在各模块的 print() 语句
"""
import logging
import sys
from pathlib import Path


def setup_logger(
    name: str = "target_research",
    level: int = logging.INFO,
    log_file: str = None,
    fmt: str = None
) -> logging.Logger:
    """
    创建配置好的 logger

    Args:
        name: logger 名称
        level: 日志级别
        log_file: 可选的日志文件路径
        fmt: 自定义格式字符串

    Returns:
        配置好的 Logger 实例
    """
    logger = logging.getLogger(name)

    # 避免重复添加 handler
    if logger.handlers:
        return logger

    logger.setLevel(level)

    # 默认格式
    if fmt is None:
        fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"

    formatter = logging.Formatter(fmt, datefmt="%Y-%m-%d %H:%M:%S")

    # 控制台输出
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # 文件输出（可选）
    if log_file:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)

    return logger


def get_logger(module_name: str) -> logging.Logger:
    """
    获取子模块 logger

    用法:
        logger = get_logger("stage1")
        logger.info("分析开始")

    产生日志:
        2026-06-10 14:00:00 [INFO] target_research.stage1: 分析开始
    """
    return logging.getLogger(f"target_research.{module_name}")
