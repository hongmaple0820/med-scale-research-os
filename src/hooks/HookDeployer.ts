// SCALE Engine — Hook Deployer (v0.7.0)
// Hook 部署管理：验证、安装、跟踪、回滚

import type { IEventBus } from '../core/eventBus.js'
import type { EnhancedHook } from './HookGeneratorEnhanced.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'

export interface DeploymentResult {
  success: boolean
  hookId: string
  settingsPath: string
  errors: string[]
}

export interface DeploymentStatus {
  hookId: string
  deployedAt: number
  settingsPath: string
  active: boolean
  rollbackAvailable: boolean
}

export interface IHookDeployer {
  deploy(hook: EnhancedHook, settingsPath: string): DeploymentResult
  deployMultiple(hooks: EnhancedHook[], settingsPath: string): DeploymentResult[]
  rollback(hookId: string, settingsPath: string): boolean
  getStatus(hookId: string): DeploymentStatus | null
  listDeployed(): DeploymentStatus[]
  validateForDeployment(hook: EnhancedHook): { valid: boolean; errors: string[] }
}

export class HookDeployer implements IHookDeployer {
  private deployments: Map<string, DeploymentStatus> = new Map()
  private hooksBackup: Map<string, string> = new Map()

  constructor(private eventBus: IEventBus) {}

  deploy(hook: EnhancedHook, settingsPath: string): DeploymentResult {
    const validation = this.validateForDeployment(hook)
    if (!validation.valid) {
      return { success: false, hookId: hook.id, settingsPath, errors: validation.errors }
    }

    // 读取现有 settings
    const settings = this.readSettings(settingsPath)
    if (!settings) {
      return { success: false, hookId: hook.id, settingsPath, errors: ['Cannot read settings.json'] }
    }

    // 备份原配置
    this.hooksBackup.set(hook.id, JSON.stringify(settings))

    // 添加 hook 配置
    const hookConfig = this.buildHookConfig(hook)
    const hooks = (settings.hooks as Record<string, unknown[]>) ?? {}
    if (!hooks[hook.hookType]) hooks[hook.hookType] = []
    hooks[hook.hookType].push(hookConfig)
    settings.hooks = hooks

    // 写入文件
    try {
      this.writeSettings(settingsPath, settings)
    } catch (e) {
      return { success: false, hookId: hook.id, settingsPath, errors: ['Failed to write settings: ' + (e as Error).message] }
    }

    // 记录部署状态
    const status: DeploymentStatus = {
      hookId: hook.id,
      deployedAt: Date.now(),
      settingsPath,
      active: true,
      rollbackAvailable: true,
    }
    this.deployments.set(hook.id, status)

    this.eventBus.emit('hook.deployed', { hookId: hook.id, hookType: hook.hookType, scriptPath: hook.scriptPath, settingsPath })
    logger.info({ hookId: hook.id, settingsPath }, 'Hook deployed')

    return { success: true, hookId: hook.id, settingsPath, errors: [] }
  }

  deployMultiple(hooks: EnhancedHook[], settingsPath: string): DeploymentResult[] {
    return hooks.map(h => this.deploy(h, settingsPath))
  }

  rollback(hookId: string, settingsPath: string): boolean {
    const status = this.deployments.get(hookId)
    if (!status || !status.rollbackAvailable) {
      logger.warn({ hookId }, 'No rollback available for hook')
      return false
    }

    const backup = this.hooksBackup.get(hookId)
    if (!backup) {
      logger.warn({ hookId }, 'No backup found for hook')
      return false
    }

    try {
      writeFileSync(settingsPath, backup, 'utf-8')
      status.active = false
      status.rollbackAvailable = false

      this.eventBus.emit('hook.rollback', { hookId, settingsPath })
      logger.info({ hookId }, 'Hook rolled back')
      return true
    } catch (e) {
      logger.error({ hookId, error: (e as Error).message }, 'Rollback failed')
      return false
    }
  }

  getStatus(hookId: string): DeploymentStatus | null {
    return this.deployments.get(hookId) ?? null
  }

  listDeployed(): DeploymentStatus[] {
    return Array.from(this.deployments.values())
  }

  validateForDeployment(hook: EnhancedHook): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // 检查脚本文件存在
    if (!existsSync(hook.scriptPath)) {
      errors.push('Hook script does not exist: ' + hook.scriptPath)
    }

    // 检查 hook 类型
    const validTypes = ['PreToolUse', 'PostToolUse', 'Stop', 'SessionStart']
    if (!validTypes.includes(hook.hookType)) {
      errors.push('Invalid hook type: ' + hook.hookType)
    }

    // 检查 matcher
    if (hook.hookType !== 'Stop' && hook.hookType !== 'SessionStart' && !hook.matcher) {
      errors.push('Matcher is required for PreToolUse/PostToolUse hooks')
    }

    // 检查超时合理
    if (hook.timeout < 1000 || hook.timeout > 60000) {
      errors.push('Timeout should be between 1000ms and 60000ms')
    }

    return { valid: errors.length === 0, errors }
  }

  private readSettings(path: string): Record<string, unknown> | null {
    if (!existsSync(path)) {
      // 创建默认配置
      return { hooks: {} }
    }
    try {
      const content = readFileSync(path, 'utf-8')
      return JSON.parse(content) as Record<string, unknown>
    } catch (e) {
      logger.error({ path, error: (e as Error).message }, 'Failed to read settings')
      return null
    }
  }

  private writeSettings(path: string, settings: Record<string, unknown>): void {
    const dir = join(path, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8')
  }

  private buildHookConfig(hook: EnhancedHook): Record<string, unknown> {
    const config: Record<string, unknown> = {
      matcher: hook.matcher || '',
      command: 'node ' + hook.scriptPath,
      timeout: hook.timeout,
    }

    // 添加描述
    if (hook.templateId) {
      config.description = 'Generated from template: ' + hook.templateId
    } else if (hook.detectorType) {
      config.description = 'Generated from detector: ' + hook.detectorType
    } else if (hook.ruleId) {
      config.description = 'Generated from rule: ' + hook.ruleId
    }

    return config
  }
}
