// SCALE Engine — Task Level Detector
// 自动推断任务等级 (S/M/L/CRITICAL)，基于代码变更规模 + 项目结构复杂度

import { execSync } from 'node:child_process'

export type TaskLevel = 'S' | 'M' | 'L' | 'CRITICAL'

export interface TaskLevelSignals {
  fileCount: number
  lineDelta: number
  crossModule: boolean
  criticalFileHits: string[]
  descriptionKeywords: string[]
  topDirs: string[]
}

export interface TaskLevelResult {
  level: TaskLevel
  confidence: number
  reasons: string[]
  signals: TaskLevelSignals
}

const CRITICAL_KEYWORDS = ['migration', 'migrate', 'auth', 'payment', 'pay', 'security', 'secret', 'credential', 'drop', 'alter', 'truncate', 'production', 'prod']
const L_KEYWORDS = ['refactor', 'redesign', 'restructure', 'rewrite', 'architecture', 'schema', 'database', 'infrastructure']
const S_KEYWORDS = ['typo', 'comment', 'readme', 'doc', 'format', 'whitespace', 'rename', 'lint']

const CRITICAL_FILES = [
  /migration/i, /schema/i, /\.env/, /docker-compose/i, /Dockerfile/i,
  /auth/i, /payment/i, /security/i, /credential/i,
  /package\.json$/, /pom\.xml$/, /build\.gradle$/,
]

export class TaskLevelDetector {
  /**
   * 从 git diff 采集信号并判定等级
   */
  async detectFromGitDiff(cwd?: string): Promise<TaskLevelResult> {
    const signals = await this.collectGitSignals(cwd)
    return this.classify(signals)
  }

  /**
   * 从任务描述 + 文件列表判定等级
   */
  detectFromDescription(description: string, files: string[] = []): TaskLevelResult {
    const signals = this.collectDescriptionSignals(description, files)
    return this.classify(signals)
  }

  /**
   * 综合判定任务等级
   */
  classify(signals: TaskLevelSignals): TaskLevelResult {
    const reasons: string[] = []
    let score = 0

    // CRITICAL: 关键词命中
    if (signals.descriptionKeywords.some(kw => CRITICAL_KEYWORDS.includes(kw))) {
      score += 100
      reasons.push('CRITICAL keyword detected in description')
    }

    // CRITICAL: 关键文件命中
    if (signals.criticalFileHits.length > 0) {
      score += 80
      reasons.push(`Critical files touched: ${signals.criticalFileHits.join(', ')}`)
    }

    // 文件数量评分
    if (signals.fileCount > 20) {
      score += 40
      reasons.push(`High file count: ${signals.fileCount}`)
    } else if (signals.fileCount > 10) {
      score += 20
      reasons.push(`Medium file count: ${signals.fileCount}`)
    } else if (signals.fileCount <= 5) {
      score -= 10
      reasons.push(`Low file count: ${signals.fileCount}`)
    }

    // 行数评分
    if (signals.lineDelta > 500) {
      score += 40
      reasons.push(`Large change: ${signals.lineDelta} lines`)
    } else if (signals.lineDelta > 100) {
      score += 20
      reasons.push(`Medium change: ${signals.lineDelta} lines`)
    } else if (signals.lineDelta <= 50) {
      score -= 10
      reasons.push(`Small change: ${signals.lineDelta} lines`)
    }

    // 跨模块评分
    if (signals.crossModule) {
      score += 30
      reasons.push(`Cross-module change: ${signals.topDirs.join(', ')}`)
    }

    // L 关键词
    if (signals.descriptionKeywords.some(kw => L_KEYWORDS.includes(kw))) {
      score += 25
      reasons.push('L-level keyword detected')
    }

    // S 关键词（降级）
    if (signals.descriptionKeywords.some(kw => S_KEYWORDS.includes(kw))) {
      score -= 20
      reasons.push('S-level keyword detected')
    }

    // 判定等级
    let level: TaskLevel
    let confidence: number

    if (score >= 80) {
      level = 'CRITICAL'
      confidence = Math.min(1, 0.7 + (score - 80) / 100)
    } else if (score >= 40) {
      level = 'L'
      confidence = Math.min(1, 0.6 + (score - 40) / 100)
    } else if (score >= 0) {
      level = 'M'
      confidence = Math.min(1, 0.5 + score / 80)
    } else {
      level = 'S'
      confidence = Math.min(1, 0.6 + Math.abs(score) / 40)
    }

    return { level, confidence: Math.round(confidence * 100) / 100, reasons, signals }
  }

  /**
   * 从 git diff 采集信号
   */
  private async collectGitSignals(cwd?: string): Promise<TaskLevelSignals> {
    const workingDir = cwd ?? process.cwd()

    let fileCount = 0
    let lineDelta = 0
    const changedFiles: string[] = []

    try {
      // 获取 staged + unstaged 变更
      const diffStat = execSync('git diff --stat HEAD --no-color 2>/dev/null || git diff --stat --no-color 2>/dev/null', {
        cwd: workingDir,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()

      if (diffStat) {
        const lines = diffStat.split('\n').filter(l => l.trim() && !l.includes('files changed'))
        fileCount = lines.length

        for (const line of lines) {
          // 解析: " src/foo.ts | 10 +++---"
          const fileMatch = line.match(/^\s*(.+?)\s*\|/)
          if (fileMatch) changedFiles.push(fileMatch[1].trim())

          // 解析行数变化
          const insertMatch = line.match(/(\d+)\s+insertion/)
          const deleteMatch = line.match(/(\d+)\s+deletion/)
          if (insertMatch) lineDelta += parseInt(insertMatch[1], 10)
          if (deleteMatch) lineDelta += parseInt(deleteMatch[1], 10)
        }
      }
    } catch (error) {
      void error
      // git diff 失败（可能不在 git 仓库中）
    }

    // 如果没有 git diff 信息，尝试获取最近 commit 的变更
    if (fileCount === 0) {
      try {
        const lastCommit = execSync('git diff --stat HEAD~1..HEAD --no-color 2>/dev/null', {
          cwd: workingDir,
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()

        if (lastCommit) {
          const lines = lastCommit.split('\n').filter(l => l.trim() && !l.includes('files changed'))
          fileCount = lines.length

          for (const line of lines) {
            const fileMatch = line.match(/^\s*(.+?)\s*\|/)
            if (fileMatch) changedFiles.push(fileMatch[1].trim())

            const insertMatch = line.match(/(\d+)\s+insertion/)
            const deleteMatch = line.match(/(\d+)\s+deletion/)
            if (insertMatch) lineDelta += parseInt(insertMatch[1], 10)
            if (deleteMatch) lineDelta += parseInt(deleteMatch[1], 10)
          }
        }
      } catch (error) {
        void error
        // 忽略
      }
    }

    return this.buildSignals(fileCount, lineDelta, changedFiles, '')
  }

  /**
   * 从描述 + 文件列表采集信号
   */
  private collectDescriptionSignals(description: string, files: string[]): TaskLevelSignals {
    const lineDelta = 0
    return this.buildSignals(files.length, lineDelta, files, description)
  }

  /**
   * 构建信号对象
   */
  private buildSignals(fileCount: number, lineDelta: number, changedFiles: string[], description: string): TaskLevelSignals {
    // 跨模块检测：变更文件是否跨越 ≥2 个顶层目录
    const topDirs = new Set<string>()
    for (const file of changedFiles) {
      const parts = file.replace(/\\/g, '/').split('/')
      if (parts.length > 1) {
        topDirs.add(parts[0])
      }
    }
    const crossModule = topDirs.size >= 2

    // 关键文件命中
    const criticalFileHits: string[] = []
    for (const file of changedFiles) {
      for (const pattern of CRITICAL_FILES) {
        if (pattern.test(file)) {
          criticalFileHits.push(file)
          break
        }
      }
    }

    // 描述关键词提取
    const descriptionKeywords = description.toLowerCase()
      .split(/[\s,;.!?]+/)
      .filter(w => w.length > 2)

    return {
      fileCount,
      lineDelta,
      crossModule,
      criticalFileHits,
      descriptionKeywords,
      topDirs: Array.from(topDirs),
    }
  }
}
