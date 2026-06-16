// SCALE Engine — Bug Pattern Detector
// Analyzes Edit operations to auto-detect bug fix patterns.
// Inspired by OpenWolf's detectFixPattern().

export type FixPattern =
  | 'error-handling'
  | 'null-safety'
  | 'guard-clause'
  | 'wrong-value'
  | 'wrong-reference'
  | 'logic-fix'
  | 'operator-fix'
  | 'missing-import'
  | 'async-fix'
  | 'type-fix'
  | 'return-value'
  | 'refactor'

export interface BugDetection {
  pattern: FixPattern
  confidence: number
  summary: string
  file: string
  oldSnippet: string
  newSnippet: string
  detectedAt: string
}

export interface BugRecord {
  id: string
  timestamp: string
  file: string
  pattern: FixPattern
  summary: string
  oldSnippet: string
  newSnippet: string
  occurrences: number
}

export class BugPatternDetector {
  detect(oldString: string, newString: string, filePath: string): BugDetection | null {
    if (!oldString || !newString) return null
    if (oldString === newString) return null

    // Order matters: more specific patterns first. On tie, first match wins.
    const patterns: Array<{ pattern: FixPattern; check: () => number }> = [
      { pattern: 'missing-import', check: () => this.checkMissingImport(oldString, newString) },
      { pattern: 'error-handling', check: () => this.checkErrorHandling(oldString, newString) },
      { pattern: 'async-fix', check: () => this.checkAsyncFix(oldString, newString) },
      { pattern: 'operator-fix', check: () => this.checkOperatorFix(oldString, newString) },
      { pattern: 'null-safety', check: () => this.checkNullSafety(oldString, newString) },
      { pattern: 'guard-clause', check: () => this.checkGuardClause(oldString, newString) },
      { pattern: 'type-fix', check: () => this.checkTypeFix(oldString, newString, filePath) },
      { pattern: 'logic-fix', check: () => this.checkLogicFix(oldString, newString) },
      { pattern: 'return-value', check: () => this.checkReturnValue(oldString, newString) },
      { pattern: 'wrong-value', check: () => this.checkWrongValue(oldString, newString) },
      { pattern: 'refactor', check: () => this.checkRefactor(oldString, newString) },
      // wrong-reference is the most generic — checked last
      { pattern: 'wrong-reference', check: () => this.checkWrongReference(oldString, newString) },
    ]

    let best: { pattern: FixPattern; confidence: number } | null = null
    for (const p of patterns) {
      const confidence = p.check()
      if (confidence > 0 && (!best || confidence > best.confidence)) {
        best = { pattern: p.pattern, confidence }
      }
    }

    if (!best || best.confidence < 0.3) return null

    return {
      pattern: best.pattern,
      confidence: best.confidence,
      summary: this.summarize(best.pattern, oldString, newString),
      file: filePath,
      oldSnippet: oldString.slice(0, 200),
      newSnippet: newString.slice(0, 200),
      detectedAt: new Date().toISOString(),
    }
  }

  private checkErrorHandling(oldStr: string, newStr: string): number {
    const oldHasCatch = /catch\s*\(/.test(oldStr) || /try\s*\{/.test(oldStr)
    const newHasCatch = /catch\s*\(/.test(newStr) || /try\s*\{/.test(newStr)
    if (!oldHasCatch && newHasCatch) return 0.9
    const oldHasThrow = /throw\s+/.test(oldStr)
    const newHasThrow = /throw\s+/.test(newStr)
    if (!oldHasThrow && newHasThrow) return 0.8
    return 0
  }

  private checkNullSafety(oldStr: string, newStr: string): number {
    const newHasOptional = /\?\./.test(newStr) && !/\?\./.test(oldStr)
    if (newHasOptional) return 0.9
    const newHasNullish = /\?\?/.test(newStr) && !/\?\?/.test(oldStr)
    if (newHasNullish) return 0.8
    const newHasNullCheck = (/!=\s*null/.test(newStr) || /!==\s*null/.test(newStr) || /!==\s*undefined/.test(newStr)) &&
      !(/!=\s*null/.test(oldStr) || /!==\s*null/.test(oldStr))
    if (newHasNullCheck) return 0.7
    return 0
  }

  private checkGuardClause(oldStr: string, newStr: string): number {
    // Guard clauses check for null/undefined/empty/invalid at function start
    const guardPattern = /if\s*\(\s*(!?\w+|!?\w+[\?\.\[][^)]*)\s*\)\s*(return|throw)\s+/
    const newHasGuard = guardPattern.test(newStr) && !guardPattern.test(oldStr)
    if (newHasGuard) {
      // Higher confidence if checking null/undefined/empty
      const isNullCheck = /null|undefined|empty|!/.test(newStr.match(guardPattern)?.[1] || '')
      return isNullCheck ? 0.8 : 0.65
    }
    return 0
  }

  private checkMissingImport(oldStr: string, newStr: string): number {
    const oldImports = (oldStr.match(/^import\s+/gm) || []).length
    const newImports = (newStr.match(/^import\s+/gm) || []).length
    if (newImports > oldImports) return 0.85
    const newHasRequire = /require\s*\(/.test(newStr) && !/require\s*\(/.test(oldStr)
    if (newHasRequire) return 0.7
    return 0
  }

  private checkAsyncFix(oldStr: string, newStr: string): number {
    const addedAwait = /\bawait\b/.test(newStr) && !/\bawait\b/.test(oldStr)
    if (addedAwait) return 0.85
    const addedAsync = /\basync\b/.test(newStr) && !/\basync\b/.test(oldStr)
    if (addedAsync) return 0.7
    return 0
  }

  private checkTypeFix(oldStr: string, newStr: string, filePath: string): number {
    if (!/\.(ts|tsx)$/.test(filePath)) return 0
    const newHasType = /:\s*(string|number|boolean|any|unknown|never|void|Record|Partial|Required|Pick|Omit|Promise|Array)\b/.test(newStr) &&
      !(/:\s*(string|number|boolean|any|unknown|never|void|Record|Partial|Required|Pick|Omit|Promise|Array)\b/.test(oldStr))
    if (newHasType) return 0.8
    const removedAny = /:\s*any\b/.test(oldStr) && !/:\s*any\b/.test(newStr)
    if (removedAny) return 0.85
    return 0
  }

  private checkOperatorFix(oldStr: string, newStr: string): number {
    const ops = [
      ['===', '=='], ['!==', '!='], ['>=', '>'], ['<=', '<'],
    ]
    for (const [strict, loose] of ops) {
      if (oldStr.includes(loose) && newStr.includes(strict) && !oldStr.includes(strict)) return 0.9
      if (oldStr.includes(strict) && newStr.includes(loose) && !oldStr.includes(loose)) return 0.6
    }
    return 0
  }

  private checkLogicFix(oldStr: string, newStr: string): number {
    const oldHasCondition = /if\s*\(|&&|\|\||switch\s*\(/.test(oldStr)
    const newHasCondition = /if\s*\(|&&|\|\||switch\s*\(/.test(newStr)
    if (oldHasCondition && newHasCondition) {
      const oldLines = oldStr.split('\n').filter(l => l.trim())
      const newLines = newStr.split('\n').filter(l => l.trim())
      if (oldLines.length <= 3 && newLines.length <= 3 && oldStr !== newStr) return 0.6
    }
    const flippedAndOr = (oldStr.includes('&&') && newStr.includes('||')) ||
      (oldStr.includes('||') && newStr.includes('&&'))
    if (flippedAndOr) return 0.7
    const negated = (oldStr.includes('!') && !newStr.includes('!')) ||
      (!oldStr.includes('!') && newStr.includes('!'))
    if (negated && oldStr.replace(/!/g, '') === newStr.replace(/!/g, '')) return 0.85
    return 0
  }

  private checkReturnValue(oldStr: string, newStr: string): number {
    const oldReturn = oldStr.match(/return\s+(.+)/)?.[1]?.trim()
    const newReturn = newStr.match(/return\s+(.+)/)?.[1]?.trim()
    if (oldReturn && newReturn && oldReturn !== newReturn) {
      if (oldStr.split('\n').length <= 3 && newStr.split('\n').length <= 3) return 0.7
    }
    return 0
  }

  private checkWrongValue(oldStr: string, newStr: string): number {
    const oldLines = oldStr.split('\n').filter(l => l.trim())
    const newLines = newStr.split('\n').filter(l => l.trim())
    if (oldLines.length === 1 && newLines.length === 1 && oldStr !== newStr) {
      const oldStrings = oldStr.match(/["'`][^"'`]+["'`]/g) || []
      const newStrings = newStr.match(/["'`][^"'`]+["'`]/g) || []
      if (oldStrings.length > 0 && newStrings.length > 0 && oldStrings[0] !== newStrings[0]) return 0.75
      const oldNums = oldStr.match(/\b\d+\b/g) || []
      const newNums = newStr.match(/\b\d+\b/g) || []
      if (oldNums.length > 0 && newNums.length > 0 && oldNums[0] !== newNums[0]) return 0.75
    }
    return 0
  }

  private checkWrongReference(oldStr: string, newStr: string): number {
    const oldLines = oldStr.split('\n').filter(l => l.trim())
    const newLines = newStr.split('\n').filter(l => l.trim())
    if (oldLines.length === 1 && newLines.length === 1 && oldStr !== newStr) {
      const oldIdents: string[] = oldStr.match(/\b[a-zA-Z_]\w*\b/g) ?? []
      const newIdents: string[] = newStr.match(/\b[a-zA-Z_]\w*\b/g) ?? []
      const diff = oldIdents.filter(i => !newIdents.includes(i))
      const added = newIdents.filter(i => !oldIdents.includes(i))
      if (diff.length === 1 && added.length === 1) return 0.65
    }
    return 0
  }

  private checkRefactor(oldStr: string, newStr: string): number {
    const oldLen = oldStr.length
    const newLen = newStr.length
    if (oldLen < 30 || newLen < 30) return 0
    const ratio = Math.min(oldLen, newLen) / Math.max(oldLen, newLen)
    if (ratio < 0.6) return 0.7
    return 0
  }

  private summarize(pattern: FixPattern, oldStr: string, newStr: string): string {
    switch (pattern) {
      case 'error-handling': return 'Added error handling (try/catch or throw)'
      case 'null-safety': return 'Added null/undefined safety checks'
      case 'guard-clause': return 'Added guard clause for early return/throw'
      case 'missing-import': return 'Added missing import/require'
      case 'async-fix': return 'Added async/await'
      case 'type-fix': return 'Improved TypeScript type annotations'
      case 'operator-fix': return 'Fixed comparison operator'
      case 'logic-fix': return 'Fixed logic condition'
      case 'return-value': return 'Changed return value'
      case 'wrong-value': return 'Fixed incorrect value'
      case 'wrong-reference': return 'Fixed incorrect identifier reference'
      case 'refactor': return 'Major refactor (>30% diff)'
      default: return 'Code fix detected'
    }
  }
}
