// SCALE Engine — Core Skills (v0.7.0)
// 10 个内置技能定义

import type { SkillDefinition } from "./SkillRegistry.js"

export const CORE_SKILLS: SkillDefinition[] = [
  { id: "brainstorming", name: "Brainstorming", description: "需求精炼与方案探索", domain: "planning",
    triggers: [{ type: "taskType", value: "feature", weight: 0.8 }, { type: "phase", value: "plan", weight: 0.9 }],
    execution: { type: "agent-delegate", config: { agentType: "planner" } }, priority: 80, installed: true },

  { id: "tdd-guide", name: "TDD Guide", description: "测试驱动开发指导", domain: "execution",
    triggers: [{ type: "taskType", value: ["feature", "bug-fix"], weight: 0.7 }, { type: "phase", value: "implement", weight: 0.8 }],
    execution: { type: "builtin-function", config: { functionName: "tdd_check" } }, priority: 75, installed: true },

  { id: "systematic-debugging", name: "Systematic Debugging", description: "系统性调试", domain: "verification",
    triggers: [{ type: "detectorTriggered", value: "brute-retry", weight: 0.9 }, { type: "keyword", value: ["bug", "error", "fix"], weight: 0.6 }],
    execution: { type: "agent-delegate", config: { agentType: "debugger" } }, priority: 85, installed: true },

  { id: "code-review", name: "Code Review", description: "代码审查", domain: "verification",
    triggers: [{ type: "phase", value: "verify", weight: 0.8 }, { type: "artifactStatus", value: "DONE", weight: 0.7 }],
    execution: { type: "agent-delegate", config: { agentType: "reviewer" } }, priority: 70, installed: true },

  { id: "security-review", name: "Security Review", description: "安全审查", domain: "verification",
    triggers: [{ type: "keyword", value: ["auth", "payment", "credential"], weight: 0.9 }],
    execution: { type: "agent-delegate", config: { agentType: "security-reviewer" } }, priority: 90, installed: true },

  { id: "verification", name: "Verification Gate", description: "验证门控", domain: "verification",
    triggers: [{ type: "phase", value: "verify", weight: 0.9 }],
    execution: { type: "builtin-function", config: { functionName: "verify_status" } }, priority: 65, installed: true },

  { id: "lesson-extractor", name: "Lesson Extractor", description: "经验提取", domain: "evolution",
    triggers: [{ type: "phase", value: "evolve", weight: 0.9 }, { type: "artifactType", value: "Defect", weight: 0.8 }],
    execution: { type: "cli-command", config: { command: "scale evolve" } }, priority: 60, installed: true },

  { id: "context-builder", name: "Context Builder", description: "上下文构建", domain: "context",
    triggers: [{ type: "complexity", value: "complex", weight: 0.7 }],
    execution: { type: "cli-command", config: { command: "scale context build" } }, priority: 55, installed: true },

  { id: "workflow-guide", name: "Workflow Guide", description: "工作流指导", domain: "planning",
    triggers: [{ type: "taskType", value: "planning", weight: 0.8 }],
    execution: { type: "cli-command", config: { command: "scale workflow start" } }, priority: 50, installed: true },

  { id: "fsm-check", name: "FSM Status Check", description: "FSM状态检查", domain: "execution",
    triggers: [{ type: "keyword", value: ["approve", "complete", "transition"], weight: 0.6 }],
    execution: { type: "cli-command", config: { command: "scale fsm status" } }, priority: 45, installed: true },
]

export function getCoreSkill(id: string): SkillDefinition | undefined {
  return CORE_SKILLS.find(s => s.id === id)
}

export function registerCoreSkills(registry: { registerBatch: (skills: SkillDefinition[]) => void }): void {
  registry.registerBatch(CORE_SKILLS)
}
