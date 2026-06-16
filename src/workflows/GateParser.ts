// SCALE Engine — Gate Parser (v0.7.0)
// 解析验证门控表达式

import type { Artifact } from "../artifact/types.js"
// import { logger } from "../core/logger.js"  // unused - kept for future use

export interface GateExpression {
  type: "comparison" | "status_check" | "command_check" | "approval_check" | "compound"
  field?: string
  operator?: string
  value?: string | number
  command?: string
  expressions?: GateExpression[]
  connector?: "and" | "or"
}

export interface GateResult {
  passed: boolean
  expression: string
  evaluated: GateExpression
  reason: string
  details?: Record<string, unknown>
}

export interface IGateParser {
  parse(expression: string): GateExpression
  evaluate(expr: GateExpression, context: { artifact?: Artifact; runCommand?: (cmd: string) => Promise<{ success: boolean; output: string }> }): Promise<GateResult>
  evaluateString(expression: string, context: { artifact?: Artifact; runCommand?: (cmd: string) => Promise<{ success: boolean; output: string }> }): Promise<GateResult>
}

export class GateParser implements IGateParser {
  parse(expression: string): GateExpression {
    const expr = expression.trim()
    if (expr.includes(" and ") || expr.includes(" or ")) {
      const connector = expr.includes(" and ") ? "and" : "or"
      const parts = expr.split(connector === "and" ? " and " : " or ")
      return { type: "compound", connector, expressions: parts.map(p => this.parse(p)) }
    }
    if (expr.includes(" == ") || expr.includes(" != ")) {
      const op = expr.includes(" == ") ? "==" : "!="
      const [field, value] = expr.split(" " + op + " ")
      return { type: "status_check", field: field.trim(), operator: op, value: value.trim() }
    }
    const compMatch = expr.match(/([a-zA-Z_]+)\s*(<=|>=|<|>|==)\s*([0-9.]+|[a-zA-Z_]+)/)
    if (compMatch) return { type: "comparison", field: compMatch[1], operator: compMatch[2], value: parseFloat(compMatch[3]) || compMatch[3] }
    if (expr.includes(" pass") || expr.includes(" fails")) {
      const cmd = expr.replace(" pass", "").replace(" fails", "").trim()
      return { type: "command_check", command: cmd }
    }
    if (expr.includes("approval") || expr.includes("human")) return { type: "approval_check" }
    return { type: "comparison", field: "unknown", operator: "==", value: "true" }
  }

  async evaluate(expr: GateExpression, ctx: { artifact?: Artifact; runCommand?: (cmd: string) => Promise<{ success: boolean; output: string }> }): Promise<GateResult> {
    if (expr.type === "comparison") return this.evalComparison(expr, ctx)
    if (expr.type === "status_check") return this.evalStatus(expr, ctx)
    if (expr.type === "command_check") return this.evalCommand(expr, ctx)
    if (expr.type === "approval_check") return { passed: false, expression: "human approval", evaluated: expr, reason: "Requires human approval" }
    if (expr.type === "compound") return this.evalCompound(expr, ctx)
    return { passed: false, expression: "", evaluated: expr, reason: "Unknown type" }
  }

  async evaluateString(expr: string, ctx: { artifact?: Artifact; runCommand?: (cmd: string) => Promise<{ success: boolean; output: string }> }): Promise<GateResult> {
    return this.evaluate(this.parse(expr), ctx)
  }

  private evalComparison(expr: GateExpression, ctx: { artifact?: Artifact }): GateResult {
    if (!ctx.artifact) return { passed: false, expression: "", evaluated: expr, reason: "No artifact" }
    const payload = ctx.artifact.payload as Record<string, unknown>
    const fieldValue = payload[expr.field ?? ""] ?? ctx.artifact[expr.field as keyof Artifact]
    const target = expr.value as number
    const passed = expr.operator === "<=" ? (fieldValue as number) <= target : expr.operator === "<" ? (fieldValue as number) < target : fieldValue === target
    return { passed, expression: expr.field + " " + expr.operator + " " + expr.value, evaluated: expr, reason: passed ? "OK" : "Failed" }
  }

  private evalStatus(expr: GateExpression, ctx: { artifact?: Artifact }): GateResult {
    if (!ctx.artifact) return { passed: false, expression: "", evaluated: expr, reason: "No artifact" }
    const status = ctx.artifact.status
    const passed = expr.operator === "==" ? status === expr.value : status !== expr.value
    return { passed, expression: expr.field + " " + expr.operator + " " + expr.value, evaluated: expr, reason: passed ? "OK" : "Mismatch" }
  }

  private async evalCommand(expr: GateExpression, ctx: { runCommand?: (cmd: string) => Promise<{ success: boolean; output: string }> }): Promise<GateResult> {
    if (!ctx.runCommand) return { passed: false, expression: expr.command ?? "", evaluated: expr, reason: "No runner" }
    const result = await ctx.runCommand(expr.command ?? "")
    return { passed: result.success, expression: expr.command + " pass", evaluated: expr, reason: result.success ? "OK" : result.output }
  }

  private async evalCompound(expr: GateExpression, ctx: { artifact?: Artifact; runCommand?: (cmd: string) => Promise<{ success: boolean; output: string }> }): Promise<GateResult> {
    if (!expr.expressions) return { passed: false, expression: "", evaluated: expr, reason: "No sub-expr" }
    const results = await Promise.all(expr.expressions.map(e => this.evaluate(e, ctx)))
    const passed = expr.connector === "and" ? results.every(r => r.passed) : results.some(r => r.passed)
    return { passed, expression: expr.connector ?? "and", evaluated: expr, reason: passed ? "All OK" : "Some failed" }
  }
}
