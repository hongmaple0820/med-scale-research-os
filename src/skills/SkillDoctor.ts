import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { WORKFLOW_AGENT_SKILL_CATALOG } from './SkillCatalog.js'
import type { WorkflowSkillCatalogEntry } from './SkillCatalog.js'

const TOOL_ORCHESTRATION_SKILL_CATALOG: WorkflowSkillCatalogEntry[] = [
  {
    id: 'web-access',
    name: 'Web Access',
    description: 'CDP browser automation for web research, logged-in pages, and dynamic browser tasks',
    source: 'https://github.com/eze-is/web-access',
    installCommand: 'npx skills add https://github.com/eze-is/web-access --skill web-access',
    trust: 'ecosystem',
    definition: {
      id: 'web-access',
      name: 'Web Access',
      description: 'CDP browser automation for web research, logged-in pages, and dynamic browser tasks',
      domain: 'execution',
      triggers: [],
      execution: { type: 'skill-file', config: { skillPath: '~/.agents/skills/web-access/SKILL.md' } },
      priority: 90,
      installed: true,
      source: 'https://github.com/eze-is/web-access',
    },
  },
  {
    id: 'awesome-design-md',
    name: 'Awesome Design.md',
    description: 'DESIGN.md brand and product design system references',
    source: 'https://github.com/VoltAgent/awesome-design-md',
    installCommand: 'scale setup --pack ui --include awesome-design-md --apply',
    trust: 'ecosystem',
    definition: {
      id: 'awesome-design-md',
      name: 'Awesome Design.md',
      description: 'DESIGN.md brand and product design system references',
      domain: 'planning',
      triggers: [],
      execution: { type: 'skill-file', config: { skillPath: '~/.agents/skills/awesome-design-md/SKILL.md' } },
      priority: 88,
      installed: true,
      source: 'https://github.com/VoltAgent/awesome-design-md',
    },
  },
  {
    id: 'ui-ux-pro-max',
    name: 'UI/UX Pro Max',
    description: 'UX guidelines and design intelligence database',
    source: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    installCommand: 'scale setup --pack ui --include ui-ux-pro-max --apply',
    trust: 'ecosystem',
    definition: {
      id: 'ui-ux-pro-max',
      name: 'UI/UX Pro Max',
      description: 'UX guidelines and design intelligence database',
      domain: 'planning',
      triggers: [],
      execution: { type: 'skill-file', config: { skillPath: '~/.agents/skills/ui-ux-pro-max/SKILL.md' } },
      priority: 89,
      installed: true,
      source: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    },
  },
  {
    id: 'agent-browser',
    name: 'Agent Browser',
    description: 'Browser automation CLI for AI agents',
    source: 'https://github.com/vercel-labs/agent-browser',
    installCommand: 'Install or configure Agent Browser from https://github.com/vercel-labs/agent-browser',
    trust: 'ecosystem',
    definition: {
      id: 'agent-browser',
      name: 'Agent Browser',
      description: 'Browser automation CLI for AI agents',
      domain: 'execution',
      triggers: [],
      execution: { type: 'cli-command', config: { command: 'agent-browser --version' } },
      priority: 86,
      installed: false,
      source: 'https://github.com/vercel-labs/agent-browser',
    },
  },
  {
    id: 'mcp-chrome-devtools',
    name: 'Chrome DevTools MCP',
    description: 'Chrome DevTools MCP for browser inspection, console, and network evidence',
    source: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    installCommand: 'Configure Chrome DevTools MCP for the active agent platform',
    trust: 'ecosystem',
    definition: {
      id: 'mcp-chrome-devtools',
      name: 'Chrome DevTools MCP',
      description: 'Chrome DevTools MCP for browser inspection, console, and network evidence',
      domain: 'verification',
      triggers: [],
      execution: { type: 'mcp-tool', config: { toolName: 'chrome-devtools' } },
      priority: 88,
      installed: false,
      source: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    },
  },
  {
    id: 'cua',
    name: 'CUA',
    description: 'Computer use agent for desktop automation and GUI testing',
    source: 'https://github.com/trycua/cua',
    installCommand: 'Install or configure CUA from https://github.com/trycua/cua',
    trust: 'ecosystem',
    definition: {
      id: 'cua',
      name: 'CUA',
      description: 'Computer use agent for desktop automation and GUI testing',
      domain: 'execution',
      triggers: [],
      execution: { type: 'cli-command', config: { command: 'cua --version' } },
      priority: 90,
      installed: false,
      source: 'https://github.com/trycua/cua',
    },
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    description: 'External Codex CLI reviewer or worker',
    source: 'https://github.com/openai/codex',
    installCommand: 'Install Codex CLI and verify with: codex --version',
    trust: 'ecosystem',
    definition: {
      id: 'codex-cli',
      name: 'Codex CLI',
      description: 'External Codex CLI reviewer or worker',
      domain: 'verification',
      triggers: [],
      execution: { type: 'cli-command', config: { command: 'codex --version' } },
      priority: 76,
      installed: false,
    },
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    description: 'External Gemini CLI reviewer or worker',
    source: 'https://github.com/google-gemini/gemini-cli',
    installCommand: 'Install Gemini CLI and verify with: gemini --version',
    trust: 'ecosystem',
    definition: {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      description: 'External Gemini CLI reviewer or worker',
      domain: 'verification',
      triggers: [],
      execution: { type: 'cli-command', config: { command: 'gemini --version' } },
      priority: 74,
      installed: false,
    },
  },
  {
    id: 'opencode-cli',
    name: 'OpenCode CLI',
    description: 'External OpenCode CLI reviewer or worker',
    source: 'https://github.com/sst/opencode',
    installCommand: 'Install OpenCode CLI and verify with: opencode --version',
    trust: 'ecosystem',
    definition: {
      id: 'opencode-cli',
      name: 'OpenCode CLI',
      description: 'External OpenCode CLI reviewer or worker',
      domain: 'verification',
      triggers: [],
      execution: { type: 'cli-command', config: { command: 'opencode --version' } },
      priority: 74,
      installed: false,
    },
  },
]

export interface SkillDoctorOptions {
  projectDir?: string
  homeDir?: string
}

export interface SkillDoctorEntry {
  id: string
  name: string
  description: string
  source: string
  installCommand: string
  trust: WorkflowSkillCatalogEntry['trust']
  executionType: string
  declaredPath?: string
  checkedPaths: string[]
  installed: boolean
  detectedPath?: string
  status: 'installed' | 'missing'
  missingReason?: string
}

export interface SkillDoctorReport {
  ok: boolean
  total: number
  installed: number
  missing: number
  skills: SkillDoctorEntry[]
}

export interface RequiredSkillInstallationReport {
  ok: boolean
  required: string[]
  installed: string[]
  missing: string[]
  unknown: string[]
  skills: SkillDoctorEntry[]
}

export function inspectWorkflowSkills(options: SkillDoctorOptions = {}): SkillDoctorReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const homeDir = options.homeDir ?? homedir()
  const skills = workflowSkillCatalog().map(entry => inspectWorkflowSkill(entry, projectDir, homeDir))
  const installed = skills.filter(skill => skill.installed).length
  const missing = skills.length - installed
  return {
    ok: missing === 0,
    total: skills.length,
    installed,
    missing,
    skills,
  }
}

export function inspectRequiredWorkflowSkills(requiredSkills: string[], options: SkillDoctorOptions = {}): RequiredSkillInstallationReport {
  const required = unique(requiredSkills.map(skill => skill.trim()).filter(Boolean))
  const report = inspectWorkflowSkills(options)
  const byId = new Map(report.skills.map(skill => [skill.id, skill]))
  const installed: string[] = []
  const missing: string[] = []
  const unknown: string[] = []
  const skills: SkillDoctorEntry[] = []

  for (const id of required) {
    const skill = byId.get(id)
    if (!skill) {
      unknown.push(id)
      missing.push(id)
      continue
    }
    skills.push(skill)
    if (skill.installed) installed.push(id)
    else missing.push(id)
  }

  return {
    ok: missing.length === 0,
    required,
    installed,
    missing,
    unknown,
    skills,
  }
}

function inspectWorkflowSkill(entry: WorkflowSkillCatalogEntry, projectDir: string, homeDir: string): SkillDoctorEntry {
  const declaredPath = entry.definition.execution.config.skillPath
  const checkedPaths = unique([
    declaredPath ? resolveSkillPath(declaredPath, projectDir, homeDir) : undefined,
    join(homeDir, '.agents', 'skills', entry.id, 'SKILL.md'),
    join(homeDir, '.codex', 'skills', entry.id, 'SKILL.md'),
    join(homeDir, '.claude', 'skills', entry.id, 'SKILL.md'),
    join(homeDir, '.gemini', 'skills', entry.id, 'SKILL.md'),
    join(homeDir, '.omx', 'skills', entry.id, 'SKILL.md'),
    join(projectDir, 'skills', entry.id, 'SKILL.md'),
    join(projectDir, '.scale', 'skills', entry.id, 'SKILL.md'),
  ].filter((path): path is string => Boolean(path)))

  const detectedPath = checkedPaths.find(path => existsSync(path))
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    source: entry.source,
    installCommand: entry.installCommand,
    trust: entry.trust,
    executionType: entry.definition.execution.type,
    declaredPath,
    checkedPaths,
    installed: Boolean(detectedPath),
    detectedPath,
    status: detectedPath ? 'installed' : 'missing',
    missingReason: detectedPath ? undefined : 'Skill file not found in declared or fallback paths.',
  }
}

function workflowSkillCatalog(): WorkflowSkillCatalogEntry[] {
  const entries = [...WORKFLOW_AGENT_SKILL_CATALOG, ...TOOL_ORCHESTRATION_SKILL_CATALOG]
  const byId = new Map<string, WorkflowSkillCatalogEntry>()
  for (const entry of entries) byId.set(entry.id, entry)
  return [...byId.values()]
}

function resolveSkillPath(path: string, projectDir: string, homeDir: string): string {
  if (path === '~') return homeDir
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homeDir, path.slice(2))
  if (isAbsolute(path)) return path
  return resolve(projectDir, path)
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}
