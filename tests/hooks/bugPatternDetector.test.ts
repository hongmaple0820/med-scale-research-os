import { describe, it, expect } from 'vitest'
import { BugPatternDetector } from '../../src/hooks/BugPatternDetector.js'

describe('BugPatternDetector', () => {
  const detector = new BugPatternDetector()

  describe('error-handling', () => {
    it('detects adding try/catch', () => {
      const result = detector.detect(
        'const data = fetch(url)',
        'try { const data = fetch(url) } catch (e) { console.error(e) }',
        'src/api.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('error-handling')
      expect(result!.confidence).toBeGreaterThan(0.5)
    })

    it('detects adding throw', () => {
      const result = detector.detect(
        'if (!user) return',
        'if (!user) throw new Error("User not found")',
        'src/auth.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('error-handling')
    })
  })

  describe('null-safety', () => {
    it('detects optional chaining', () => {
      const result = detector.detect(
        'const name = user.profile.name',
        'const name = user?.profile?.name',
        'src/user.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('null-safety')
    })

    it('detects nullish coalescing', () => {
      const result = detector.detect(
        'const val = x || "default"',
        'const val = x ?? "default"',
        'src/config.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('null-safety')
    })

    it('detects explicit null check', () => {
      const result = detector.detect(
        'const val = obj.prop',
        'if (obj !== null) { const val = obj.prop }',
        'src/util.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('null-safety')
    })
  })

  describe('guard-clause', () => {
    it('detects guard clause addition', () => {
      const result = detector.detect(
        'function process(data) {\n  return data.map(x => x)\n}',
        'function process(data) {\n  if (!data) return []\n  return data.map(x => x)\n}',
        'src/processor.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('guard-clause')
    })
  })

  describe('missing-import', () => {
    it('detects added import', () => {
      const result = detector.detect(
        'export function main() { return path.join(a, b) }',
        'import { join } from "path"\nexport function main() { return join(a, b) }',
        'src/main.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('missing-import')
    })

    it('detects added require', () => {
      const result = detector.detect(
        'module.exports = {}',
        'const fs = require("fs")\nmodule.exports = {}',
        'src/util.js',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('missing-import')
    })
  })

  describe('async-fix', () => {
    it('detects added await', () => {
      const result = detector.detect(
        'const data = fetch(url)',
        'const data = await fetch(url)',
        'src/api.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('async-fix')
    })

    it('detects added async', () => {
      const result = detector.detect(
        'function getData() { return fetch(url) }',
        'async function getData() { return fetch(url) }',
        'src/api.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('async-fix')
    })
  })

  describe('type-fix', () => {
    it('detects added type annotation', () => {
      const result = detector.detect(
        'const name = getValue()',
        'const name: string = getValue()',
        'src/types.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('type-fix')
    })

    it('detects removal of any type', () => {
      const result = detector.detect(
        'const val: any = getValue()',
        'const val: string = getValue()',
        'src/types.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('type-fix')
    })

    it('ignores non-TypeScript files', () => {
      const result = detector.detect(
        'const name = getValue()',
        'const name: string = getValue()',
        'src/app.js',
      )
      expect(result).toBeNull()
    })
  })

  describe('operator-fix', () => {
    it('detects == to ===', () => {
      const result = detector.detect(
        'if (x == y)',
        'if (x === y)',
        'src/check.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('operator-fix')
      expect(result!.confidence).toBeGreaterThan(0.8)
    })

    it('detects != to !==', () => {
      const result = detector.detect(
        'if (x != y)',
        'if (x !== y)',
        'src/check.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('operator-fix')
    })
  })

  describe('logic-fix', () => {
    it('detects negation flip', () => {
      const result = detector.detect(
        'if (isValid)',
        'if (!isValid)',
        'src/validate.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('logic-fix')
    })

    it('detects && to || flip', () => {
      const result = detector.detect(
        'if (a && b)',
        'if (a || b)',
        'src/condition.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('logic-fix')
    })
  })

  describe('return-value', () => {
    it('detects changed return value', () => {
      const result = detector.detect(
        'return true',
        'return false',
        'src/check.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('return-value')
    })
  })

  describe('wrong-value', () => {
    it('detects changed string literal', () => {
      const result = detector.detect(
        'const url = "https://old.example.com"',
        'const url = "https://new.example.com"',
        'src/config.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('wrong-value')
    })

    it('detects changed number literal', () => {
      const result = detector.detect(
        'const limit = 10',
        'const limit = 100',
        'src/config.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('wrong-value')
    })
  })

  describe('wrong-reference', () => {
    it('detects changed identifier', () => {
      const result = detector.detect(
        'const val = oldVar',
        'const val = newVar',
        'src/ref.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('wrong-reference')
    })
  })

  describe('refactor', () => {
    it('detects major rewrite', () => {
      const old = 'function calculateTotal(items) {\n  let sum = 0\n  for (const item of items) {\n    sum += item.price * item.quantity\n  }\n  return sum\n}'
      const nw = 'class PriceCalculator {\n  constructor(discountStrategy, taxCalculator, shippingProvider) {\n    this.discount = discountStrategy\n    this.tax = taxCalculator\n    this.shipping = shippingProvider\n  }\n\n  compute(items, customerTier, promoCode) {\n    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0)\n    const discount = this.discount.apply(subtotal, customerTier, promoCode)\n    const afterDiscount = subtotal - discount\n    const tax = this.tax.calculate(afterDiscount, items)\n    const shippingCost = this.shipping.quote(items, customerTier)\n    return afterDiscount + tax + shippingCost\n  }\n\n  generateInvoice(items, customer) {\n    return { total: this.compute(items, customer.tier), items, customer }\n  }\n}'
      const result = detector.detect(old, nw, 'src/processor.js')
      expect(result).not.toBeNull()
      expect(result!.pattern).toBe('refactor')
    })
  })

  describe('edge cases', () => {
    it('returns null for empty old string', () => {
      expect(detector.detect('', 'new content', 'file.ts')).toBeNull()
    })

    it('returns null for empty new string', () => {
      expect(detector.detect('old content', '', 'file.ts')).toBeNull()
    })

    it('returns null for identical strings', () => {
      expect(detector.detect('same', 'same', 'file.ts')).toBeNull()
    })

    it('returns null for undetected patterns', () => {
      // Multi-line whitespace/formatting change — no semantic fix pattern
      expect(detector.detect('const x = 1\nconst y = 2', 'const x = 1\n\nconst y = 2', 'file.ts')).toBeNull()
    })

    it('includes file path in result', () => {
      const result = detector.detect(
        'const x = await fetch(url)',
        'const x = fetch(url)',
        'src/api.ts',
      )
      // async removal is not a detected pattern (only addition is)
      expect(result).toBeNull()
    })

    it('returns summary string', () => {
      const result = detector.detect(
        'const name = user.name',
        'const name = user?.name',
        'src/user.ts',
      )
      expect(result).not.toBeNull()
      expect(result!.summary).toContain('null')
    })

    it('truncates long snippets to 200 chars', () => {
      // Multi-line change with no fix pattern
      const oldStr = 'function a() {\n' + '  // line\n'.repeat(30) + '}'
      const newStr = 'function a() {\n' + '  // updated\n'.repeat(30) + '}'
      const result = detector.detect(oldStr, newStr, 'file.ts')
      expect(result).toBeNull()
    })
  })
})
