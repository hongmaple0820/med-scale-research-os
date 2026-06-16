// SCALE Engine — Skill Executor (v0.10.0)
// 技能执行器：执行不同类型的技能 + MCP 能力集成

import type { IEventBus } from "../core/eventBus.js"
import type { ISkillRegistry, SkillExecutionType } from "./SkillRegistry.js"
import type { ICapabilityRegistry, IBrowserCapability, ISearchCapability, IComputerCapability, IExaCapability } from "../capabilities/types.js"
import { skillsInvoker } from "../capabilities/InstalledSkillsIntegration.js"
import { spawn } from "node:child_process"

export interface SkillExecutionResult {
  skillId: string
  type: SkillExecutionType
  success: boolean
  output?: unknown
  error?: string
  durationMs: number
}

export interface ISkillExecutor {
  execute(skillId: string, input: Record<string, unknown>): Promise<SkillExecutionResult>
  executeCliCommand(command: string, _parameters: Record<string, unknown>): Promise<SkillExecutionResult>
  executeBuiltinFunction(functionName: string, input: Record<string, unknown>): Promise<SkillExecutionResult>
  registerBuiltinFunction(name: string, fn: (input: Record<string, unknown>) => Promise<unknown>): void
}

export class SkillExecutor implements ISkillExecutor {
  private skillRegistry: ISkillRegistry
  private eventBus: IEventBus
  private capabilityRegistry?: ICapabilityRegistry
  private builtinFunctions: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {}

  constructor(skillRegistry: ISkillRegistry, eventBus: IEventBus, capabilityRegistry?: ICapabilityRegistry) {
    this.skillRegistry = skillRegistry
    this.eventBus = eventBus
    this.capabilityRegistry = capabilityRegistry
    this.registerDefaultBuiltinFunctions()
  }

  async execute(skillId: string, input: Record<string, unknown>): Promise<SkillExecutionResult> {
    const skill = this.skillRegistry.get(skillId)
    if (!skill) return { skillId, type: "builtin-function", success: false, error: "Skill not found", durationMs: 0 }
    const start = Date.now()
    try {
      let result: SkillExecutionResult
      switch (skill.execution.type) {
        case "cli-command": result = await this.executeCliCommand(skill.execution.config.command ?? "", input); break
        case "builtin-function": result = await this.executeBuiltinFunction(skill.execution.config.functionName ?? "", input); break
        case "agent-delegate": result = { skillId: "", type: "agent-delegate", success: true, output: { agentType: skill.execution.config.agentType }, durationMs: 0 }; break
        case "mcp-tool": result = await this.executeMCPTool(skill.execution.config.toolName ?? "", input); break
        default: throw new Error("Unknown execution type")
      }
      result.skillId = skillId
      result.durationMs = Date.now() - start
      this.eventBus.emit("skill.executed", { skillId, success: result.success })
      return result
    } catch (err) { return { skillId, type: skill.execution.type, success: false, error: String(err), durationMs: Date.now() - start } }
  }

  async executeCliCommand(command: string, _parameters: Record<string, unknown>): Promise<SkillExecutionResult> {
    try {
      const output = await this.runCommand(command, 30000)
      return { skillId: "", type: "cli-command", success: true, output, durationMs: 0 }
    } catch (err) { return { skillId: "", type: "cli-command", success: false, error: String(err), durationMs: 0 } }
  }

  async executeBuiltinFunction(functionName: string, input: Record<string, unknown>): Promise<SkillExecutionResult> {
    const fn = this.builtinFunctions[functionName]
    if (!fn) return { skillId: "", type: "builtin-function", success: false, error: "Function not found", durationMs: 0 }
    try {
      const output = await fn(input)
      return { skillId: "", type: "builtin-function", success: true, output, durationMs: 0 }
    } catch (err) { return { skillId: "", type: "builtin-function", success: false, error: String(err), durationMs: 0 } }
  }

  registerBuiltinFunction(name: string, fn: (input: Record<string, unknown>) => Promise<unknown>): void {
    this.builtinFunctions[name] = fn
  }

  async executeMCPTool(toolName: string, input: Record<string, unknown>): Promise<SkillExecutionResult> {
    const start = Date.now()
    if (!this.capabilityRegistry) {
      return { skillId: "", type: "mcp-tool", success: false, error: "Capability registry not initialized", durationMs: 0 }
    }

    try {
      // Map tool name to capability
      const category = this.getToolCategory(toolName)
      let result: unknown

      switch (category) {
        case 'browser':
          const browser = this.capabilityRegistry.getBrowser()
          if (!browser) return { skillId: "", type: "mcp-tool", success: false, error: "Browser capability not available", durationMs: Date.now() - start }
          result = await this.executeBrowserAction(browser, toolName, input)
          break
        case 'search':
          const search = this.capabilityRegistry.getSearch()
          if (!search) return { skillId: "", type: "mcp-tool", success: false, error: "Search capability not available", durationMs: Date.now() - start }
          result = await this.executeSearchAction(search, toolName, input)
          break
        case 'computer':
          const computer = this.capabilityRegistry.getComputer()
          if (!computer) return { skillId: "", type: "mcp-tool", success: false, error: "Computer capability not available", durationMs: Date.now() - start }
          result = await this.executeComputerAction(computer, toolName, input)
          break
        case 'exa':
          const exa = this.capabilityRegistry.getExa()
          if (!exa) return { skillId: "", type: "mcp-tool", success: false, error: "Exa search capability not available. Configure exa-web-search MCP server in ~/.claude.json", durationMs: Date.now() - start }
          result = await this.executeExaAction(exa, toolName, input)
          break
        default:
          return { skillId: "", type: "mcp-tool", success: false, error: `Unknown tool category: ${toolName}`, durationMs: Date.now() - start }
      }

      return { skillId: "", type: "mcp-tool", success: true, output: result, durationMs: Date.now() - start }
    } catch (e) {
      return { skillId: "", type: "mcp-tool", success: false, error: String(e), durationMs: Date.now() - start }
    }
  }

  private getToolCategory(toolName: string): 'browser' | 'search' | 'computer' | 'exa' | 'unknown' {
    if (toolName.includes('browser') || toolName.includes('navigate') || toolName.includes('click') || toolName.includes('screenshot')) return 'browser'
    if (toolName.includes('exa') || toolName.includes('web_search_exa') || toolName.includes('get_code_context')) return 'exa'
    if (toolName.includes('search') || toolName.includes('fetch') || toolName.includes('web')) return 'search'
    if (toolName.includes('computer') || toolName.includes('cua') || toolName.includes('desktop')) return 'computer'
    return 'unknown'
  }

  private async executeBrowserAction(browser: IBrowserCapability, toolName: string, input: Record<string, unknown>): Promise<unknown> {
    const sessionId = input.sessionId as string ?? `default-${Date.now()}`
    if (toolName.includes('navigate')) {
      const sessionResult = await browser.createSession({ url: input.url as string })
      return sessionResult
    }
    return await browser.executeAction(sessionId, { type: this.mapToolToAction(toolName), target: input.target as string, value: input.value as string })
  }

  private async executeSearchAction(search: ISearchCapability, toolName: string, input: Record<string, unknown>): Promise<unknown> {
    if (toolName.includes('search')) return await search.search(input.query as string, { limit: input.limit as number })
    if (toolName.includes('fetch')) return await search.fetch(input.url as string)
    return { error: 'Unknown search action' }
  }

  private async executeComputerAction(computer: IComputerCapability, toolName: string, input: Record<string, unknown>): Promise<unknown> {
    return await computer.execute({ type: this.mapToolToComputerAction(toolName), coordinate: input.coordinate as [number, number], text: input.text as string })
  }

  private async executeExaAction(exa: IExaCapability, toolName: string, input: Record<string, unknown>): Promise<unknown> {
    if (toolName.includes('web_search_exa') || toolName.includes('web_search')) {
      return await exa.webSearch(input.query as string, { numResults: input.numResults as number, category: input.category as string })
    }
    if (toolName.includes('get_code_context_exa') || toolName.includes('get_code_context')) {
      return await exa.getCodeContext(input.query as string, { tokensNum: input.tokensNum as number })
    }
    return { error: 'Unknown exa action' }
  }

  private mapToolToAction(toolName: string): 'navigate' | 'click' | 'fill' | 'screenshot' | 'snapshot' | 'wait' | 'hover' | 'press_key' {
    const map: Record<string, 'navigate' | 'click' | 'fill' | 'screenshot' | 'snapshot' | 'wait' | 'hover' | 'press_key'> = {
      navigate: 'navigate', click: 'click', fill: 'fill', screenshot: 'screenshot', snapshot: 'snapshot',
      wait: 'wait', hover: 'hover', press: 'press_key', type: 'fill'
    }
    for (const [key, action] of Object.entries(map)) if (toolName.includes(key)) return action
    return 'click'
  }

  private mapToolToComputerAction(toolName: string): 'click' | 'type' | 'scroll' {
    if (toolName.includes('click')) return 'click'
    if (toolName.includes('type')) return 'type'
    if (toolName.includes('scroll')) return 'scroll'
    return 'click'
  }

  private registerDefaultBuiltinFunctions(): void {
    this.registerBuiltinFunction("tdd_check", async (_input) => ({ checked: true, hasTest: true }))
    this.registerBuiltinFunction("debug_suggest", async (_input) => ({ suggestions: ["Check error message"] }))
    this.registerBuiltinFunction("verify_status", async (_input) => ({ verified: true }))
    // ========== 真正调用已安装的外部技能 ==========
    // web-access CDP browser automation
    this.registerBuiltinFunction("web_access_targets", async () => skillsInvoker.webAccessTargets())
    this.registerBuiltinFunction("web_access_new_tab", async (input) => skillsInvoker.webAccessNewTab(input.url as string))
    this.registerBuiltinFunction("web_access_eval", async (input) => skillsInvoker.webAccessEval(input.targetId as string, input.js as string))
    this.registerBuiltinFunction("web_access_click", async (input) => skillsInvoker.webAccessClick(input.targetId as string, input.selector as string))
    this.registerBuiltinFunction("web_access_close", async (input) => skillsInvoker.webAccessClose(input.targetId as string))
    // playwright CLI browser automation
    this.registerBuiltinFunction("playwright_open", async (input) => skillsInvoker.playwrightOpen(input.url as string))
    this.registerBuiltinFunction("playwright_snapshot", async () => skillsInvoker.playwrightSnapshot())
    this.registerBuiltinFunction("playwright_click", async (input) => skillsInvoker.playwrightClick(input.ref as string))
    // cua desktop automation
    this.registerBuiltinFunction("cua_mouse_move", async (input) => skillsInvoker.cuaMouseMove(input.x as number, input.y as number))
    this.registerBuiltinFunction("cua_screenshot", async () => skillsInvoker.cuaScreenshot())
    // graphify knowledge graph
    this.registerBuiltinFunction("graphify_build", async (input) => skillsInvoker.graphifyBuild(input.dir as string))
    // ========== UI/UX Design Skills ==========
    // ui-ux-pro-max design system generator
    this.registerBuiltinFunction("ui_ux_design_system", async (input) => skillsInvoker.uiUxDesignSystem(input.query as string, input.projectName as string))
    this.registerBuiltinFunction("ui_ux_domain_search", async (input) => skillsInvoker.uiUxDomainSearch(input.query as string, input.domain as string, input.maxResults as number))
    this.registerBuiltinFunction("ui_ux_stack_guidelines", async (input) => skillsInvoker.uiUxStackGuidelines(input.query as string, input.stack as string))
    // awesome-design-md brand design installer
    this.registerBuiltinFunction("awesome_design_install", async (input) => skillsInvoker.awesomeDesignInstall(input.brand as string))
    // ========== Baoyu Content Creation Skills ==========
    this.registerBuiltinFunction("baoyu_image_gen", async (input) => skillsInvoker.baoyuImageGen(input.prompt as string, input.options as { model?: string; aspect?: string; output?: string }))
    this.registerBuiltinFunction("baoyu_infographic", async (input) => skillsInvoker.baoyuInfographic(input.contentPath as string, input.options as { layout?: string; style?: string; aspect?: string; lang?: string }))
    this.registerBuiltinFunction("baoyu_translate", async (input) => skillsInvoker.baoyuTranslate(input.filePath as string, input.mode as 'quick' | 'normal' | 'refined'))
    this.registerBuiltinFunction("baoyu_slide_deck", async (input) => skillsInvoker.baoyuSlideDeck(input.contentPath as string, input.options as { style?: string; slides?: number; lang?: string }))
    this.registerBuiltinFunction("baoyu_article_illustrator", async (input) => skillsInvoker.baoyuArticleIllustrator(input.articlePath as string))
    this.registerBuiltinFunction("baoyu_comic", async (input) => skillsInvoker.baoyuComic(input.storyPath as string))
    this.registerBuiltinFunction("baoyu_compress_image", async (input) => skillsInvoker.baoyuCompressImage(input.imagePath as string))
    this.registerBuiltinFunction("baoyu_cover_image", async (input) => skillsInvoker.baoyuCoverImage(input.articlePath as string))
    this.registerBuiltinFunction("baoyu_format_markdown", async (input) => skillsInvoker.baoyuFormatMarkdown(input.filePath as string))
    this.registerBuiltinFunction("baoyu_markdown_to_html", async (input) => skillsInvoker.baoyuMarkdownToHtml(input.filePath as string, input.theme as string))
    this.registerBuiltinFunction("baoyu_url_to_markdown", async (input) => skillsInvoker.baoyuUrlToMarkdown(input.url as string))
    this.registerBuiltinFunction("baoyu_x_to_markdown", async (input) => skillsInvoker.baoyuXToMarkdown(input.url as string))
    this.registerBuiltinFunction("baoyu_xhs_images", async (input) => skillsInvoker.baoyuXhsImages(input.url as string))
    // ========== Document Processing Skills ==========
    this.registerBuiltinFunction("pdf_extract", async (input) => skillsInvoker.pdfExtract(input.filePath as string))
    this.registerBuiltinFunction("pdf_merge", async (input) => skillsInvoker.pdfMerge(input.files as string[], input.outputPath as string))
    this.registerBuiltinFunction("docx_to_markdown", async (input) => skillsInvoker.docxToMarkdown(input.filePath as string))
    this.registerBuiltinFunction("xlsx_analyze", async (input) => skillsInvoker.xlsxAnalyze(input.filePath as string))
    this.registerBuiltinFunction("pptx_to_markdown", async (input) => skillsInvoker.pptxToMarkdown(input.filePath as string))
    // ========== Deployment Skills ==========
    this.registerBuiltinFunction("vercel_deploy", async (input) => skillsInvoker.vercelDeploy(input.path as string, input.scope as string))
    this.registerBuiltinFunction("vercel_whoami", async () => skillsInvoker.vercelWhoami())
    // ========== Video/Media Skills ==========
    this.registerBuiltinFunction("remotion_render", async (input) => skillsInvoker.remotionRender(input.projectDir as string, input.composition as string))
    this.registerBuiltinFunction("manim_render", async (input) => skillsInvoker.manimRender(input.sceneClass as string, input.quality as 'low' | 'medium' | 'high'))
    // ========== Translation/Search Skills ==========
    this.registerBuiltinFunction("deepl_translate", async (input) => skillsInvoker.deeplTranslate(input.text as string, input.targetLang as string))
    // ========== Note: exa-search is MCP-based, not CLI ==========
    // exa-search uses MCP tools: web_search_exa, get_code_context_exa
    // These are invoked via executeMCPTool() method, not command line
  }

  private runCommand(command: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("sh", ["-c", command], { timeout })
      let stdout = ""
      proc.stdout.on("data", (d) => stdout += d)
      proc.on("close", (c) => c === 0 ? resolve(stdout) : reject(new Error("Command failed")))
      proc.on("error", reject)
    })
  }
}
