// SCALE Engine - Anti-Pattern Registry (andrej-karpathy-skills style)
// Repository of common LLM coding mistakes with corrections

import type { IEventBus } from '../core/eventBus.js'
import { logger } from '../core/logger.js'

// ============================================================================
// Types
// ============================================================================

export interface AntiPattern {
  id: string
  principle: 'think-before-coding' | 'simplicity-first' | 'surgical-changes' | 'goal-driven-execution'
  category: string
  title: string
  userRequest: string
  wrongCode: string
  wrongDescription: string
  correctApproach: string | string[]
  correctCode?: string
  correctDescription: string
  testQuestion?: string
  tags: string[]
}

export interface AntiPatternMatch {
  patternId: string
  detectedIn: string
  severity: 'high' | 'medium' | 'low'
  suggestion: string
}

export interface IAntiPatternRegistry {
  getAntiPatterns(principle?: string): AntiPattern[]
  searchAntiPatterns(query: string): AntiPattern[]
  detectInCode(code: string): AntiPatternMatch[]
  getExample(principle: string, category: string): AntiPattern | undefined
}

// ============================================================================
// Anti-Pattern Database (from Karpathy EXAMPLES.md)
// ============================================================================

const KARPATHY_ANTIPATTERNS: AntiPattern[] = [
  // === Think Before Coding ===
  {
    id: 'AP-001',
    principle: 'think-before-coding',
    category: 'hidden-assumptions',
    title: 'Hidden Assumptions',
    userRequest: 'Add a feature to export user data',
    wrongCode: `def export_users(format='json'):
    users = User.query.all()
    if format == 'json':
        with open('users.json', 'w') as f:
            json.dump([u.to_dict() for u in users], f)
    return f"Exported {len(users)} users"`,
    wrongDescription: 'Assumed export ALL users, assumed file location, assumed no pagination or privacy concerns',
    correctApproach: ['Before implementing, clarify: 1. Scope: Export all or filtered? 2. Format: Download/API/background? 3. Fields: Which user fields? 4. Volume: How many users?'],
    correctDescription: 'Surface assumptions explicitly, ask for clarification on ambiguous requirements',
    testQuestion: 'Did you clarify scope, format, fields, and volume before implementing?',
    tags: ['assumptions', 'privacy', 'scope', 'requirements']
  },
  {
    id: 'AP-002',
    principle: 'think-before-coding',
    category: 'multiple-interpretations',
    title: 'Multiple Interpretations Picked Silently',
    userRequest: 'Make the search faster',
    wrongCode: `@lru_cache(maxsize=1000)
async def search(query: str) -> List[Result]:
    # 200 lines of optimization without asking which "faster" matters`,
    wrongDescription: 'Picked one interpretation of "faster" silently - could mean response time, throughput, or perceived UX',
    correctApproach: ['"Make search faster" could mean: 1. Response time (< 100ms) 2. Throughput (more concurrent) 3. Perceived UX (partial results). Present all, let user choose.'],
    correctDescription: 'Present multiple interpretations when ambiguity exists, do not pick silently',
    testQuestion: 'Did you list all possible interpretations of the request?',
    tags: ['ambiguity', 'interpretations', 'optimization']
  },
  // === Simplicity First ===
  {
    id: 'AP-003',
    principle: 'simplicity-first',
    category: 'over-abstraction',
    title: 'Over-Abstraction',
    userRequest: 'Add a function to calculate discount',
    wrongCode: `class DiscountStrategy(ABC):
    @abstractmethod
    def calculate(self, amount: float) -> float: pass
class PercentageDiscount(DiscountStrategy): ...
class FixedDiscount(DiscountStrategy): ...
class DiscountCalculator:
    def __init__(self, config: DiscountConfig): ...`,
    wrongDescription: 'Created Strategy pattern, abstract base class, config class for a simple percentage calculation',
    correctApproach: 'Write a single function first. Add classes/abstractions only when multiple discount types are actually required.',
    correctCode: `def calculate_discount(amount: float, percent: float) -> float:
    return amount * (percent / 100)`,
    correctDescription: 'One function until complexity is actually needed. Add classes when multiple discount types are required.',
    testQuestion: 'Would a senior engineer say this is overcomplicated?',
    tags: ['abstraction', 'design-patterns', 'overengineering']
  },
  {
    id: 'AP-004',
    principle: 'simplicity-first',
    category: 'speculative-features',
    title: 'Speculative Features',
    userRequest: 'Save user preferences to database',
    wrongCode: `class PreferenceManager:
    def save(self, user_id, prefs, merge=True, validate=True, notify=False):
        # Added caching, validation, merging, notifications - nobody asked`,
    wrongDescription: 'Added caching, validation, merging, notifications - features nobody asked for',
    correctApproach: 'Just save the preferences. Add caching when performance matters, validation when bad data appears, notifications when needed.',
    correctCode: `def save_preferences(db, user_id: int, preferences: dict):
    db.execute("UPDATE users SET preferences = ? WHERE id = ?", (json.dumps(preferences), user_id))`,
    correctDescription: 'Add later if needed: caching (when performance matters), validation (when bad data appears)',
    testQuestion: 'Did you add features beyond what was asked?',
    tags: ['speculative', 'features', 'yagni']
  },
  // === Surgical Changes ===
  {
    id: 'AP-005',
    principle: 'surgical-changes',
    category: 'drive-by-refactoring',
    title: 'Drive-by Refactoring',
    userRequest: 'Fix the bug where empty emails crash the validator',
    wrongCode: `# Changed comments, added docstring, improved email validation beyond bug,
# added username validation nobody asked for`,
    wrongDescription: 'Improved email validation beyond the bug, added username validation, changed comments, added docstring',
    correctApproach: 'Only fix the empty email handling. Do not change comments, add docstrings, or improve adjacent code.',
    correctDescription: 'Only changed the specific lines that fix empty email handling. No style changes, no extra validation.',
    testQuestion: 'Does every changed line trace directly to the user request?',
    tags: ['refactoring', 'surgical', 'minimal']
  },
  {
    id: 'AP-006',
    principle: 'surgical-changes',
    category: 'style-drift',
    title: 'Style Drift',
    userRequest: 'Add logging to the upload function',
    wrongCode: `# Changed quote style (' to "), added type hints, added docstring,
# reformatted whitespace, changed boolean return logic`,
    wrongDescription: 'Changed quote style, added type hints, added docstring, reformatted whitespace',
    correctApproach: 'Match existing code style. Only add the logging statements without changing quotes, types, or formatting.',
    correctDescription: 'Match existing style: single quotes, no type hints, existing boolean pattern, spacing style',
    testQuestion: 'Did you match existing code style?',
    tags: ['style', 'formatting', 'consistency']
  },
  // === Goal-Driven Execution ===
  {
    id: 'AP-007',
    principle: 'goal-driven-execution',
    category: 'vague-approach',
    title: 'Vague Approach Without Success Criteria',
    userRequest: 'Fix the authentication system',
    wrongCode: `I'll fix auth by: 1. Review code 2. Identify issues 3. Make improvements 4. Test
[Proceeds without clear success criteria]`,
    wrongDescription: 'No verifiable success criteria, no reproduction test, vague steps',
    correctApproach: ['Plan: 1. Write test: Change password -> verify session invalidated (Verify: test fails). 2. Implement (Verify: test passes). 3. Check edge cases (Verify: additional tests pass). 4. No regression (Verify: full suite green)'],
    correctDescription: 'Transform vague tasks into verifiable goals with success criteria',
    testQuestion: 'Can each step be independently verified?',
    tags: ['goals', 'verification', 'success-criteria']
  },
  {
    id: 'AP-008',
    principle: 'goal-driven-execution',
    category: 'fix-without-reproducing',
    title: 'Fix Without Reproducing',
    userRequest: 'The sorting breaks when there are duplicate scores',
    wrongCode: `# Immediately changes sort logic without writing a reproduction test first`,
    wrongDescription: 'Fixed without writing a test that reproduces the issue first',
    correctApproach: ['1. Write test: sort_scores with duplicates -> verify consistent ordering. 2. Verify: run 10 times -> fails inconsistently. 3. Now fix with stable sort'],
    correctDescription: 'Write test first that reproduces bug, verify test fails, then fix',
    testQuestion: 'Did you write a test that reproduces the bug before fixing?',
    tags: ['testing', 'tdd', 'reproduction']
  }
]

// ============================================================================
// AntiPatternRegistry Implementation
// ============================================================================

export class AntiPatternRegistry implements IAntiPatternRegistry {
  private patterns: Map<string, AntiPattern> = new Map()
  private eventBus: IEventBus | null

  constructor(eventBus?: IEventBus) {
    this.eventBus = eventBus ?? null
    for (const pattern of KARPATHY_ANTIPATTERNS) {
      this.patterns.set(pattern.id, pattern)
    }
    logger.info({ count: this.patterns.size }, 'AntiPatternRegistry initialized')
  }

  getAntiPatterns(principle?: string): AntiPattern[] {
    const all = Array.from(this.patterns.values())
    if (!principle) return all
    return all.filter(p => p.principle === principle)
  }

  searchAntiPatterns(query: string): AntiPattern[] {
    const lowerQuery = query.toLowerCase()
    return Array.from(this.patterns.values()).filter(p =>
      p.title.toLowerCase().includes(lowerQuery) ||
      p.category.toLowerCase().includes(lowerQuery) ||
      p.tags.some(t => t.includes(lowerQuery)) ||
      p.userRequest.toLowerCase().includes(lowerQuery)
    )
  }

  detectInCode(code: string): AntiPatternMatch[] {
    const matches: AntiPatternMatch[] = []
    const detectionRules: Array<{ pattern: string; check: RegExp }> = [
      { pattern: 'AP-003', check: /class\s+\w+Strategy\s*\(/ },
      { pattern: 'AP-003', check: /@abstractmethod/ },
      { pattern: 'AP-004', check: /merge:\s*bool\s*=/ },
      { pattern: 'AP-004', check: /validate:\s*bool\s*=/ },
      { pattern: 'AP-004', check: /notify:\s*bool\s*=/ },
    ]
    for (const rule of detectionRules) {
      if (rule.check.test(code)) {
        const pattern = this.patterns.get(rule.pattern)
        if (pattern) {
          matches.push({
            patternId: rule.pattern,
            detectedIn: 'code-structure',
            severity: 'high',
            suggestion: `Potential ${pattern.title}: ${pattern.correctDescription}`
          })
        }
      }
    }
    if (matches.length > 0) {
      this.eventBus?.emit('antipattern.detected', { matches })
    }
    return matches
  }

  getExample(principle: string, category: string): AntiPattern | undefined {
    return Array.from(this.patterns.values()).find(
      p => p.principle === principle && p.category === category
    )
  }

  register(pattern: AntiPattern): void {
    this.patterns.set(pattern.id, pattern)
    this.eventBus?.emit('antipattern.registered', { patternId: pattern.id })
    logger.info({ patternId: pattern.id }, 'Custom anti-pattern registered')
  }
}

export function createAntiPatternRegistry(eventBus?: IEventBus): IAntiPatternRegistry {
  return new AntiPatternRegistry(eventBus)
}
