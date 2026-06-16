# Task Guard Enhancement Plan

## 目标
防止 Agent 虚假完成 Task，强制验证代码质量。

## 问题
Task FSM 的 'complete' action 无 Guards → Agent 可不验证就声称完成

## 优化
1. Task Payload 新增：buildStatus, lintStatus, testCoverage
2. Task FSM 新增 Guards：检查 build/lint/test 通过
3. 新增 `scale verify-task` 命令
4. Stop Hook 检查 Task 验证状态

