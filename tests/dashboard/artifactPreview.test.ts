import { describe, expect, it } from 'vitest'
import {
  buildInlineArtifactUrl,
  resolveArtifactRelativePath,
  rewriteArtifactRelativeUrls,
} from '../../target-research-platform/src/dashboard/static/artifactPreview.js'

class FakeNode {
  readonly attributes = new Map<string, string>()
  readonly style: Record<string, string> = {}

  constructor(readonly tagName: string, seed: Record<string, string>) {
    for (const [key, value] of Object.entries(seed)) {
      this.attributes.set(key, value)
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
}

describe('artifactPreview', () => {
  it('resolves manuscript-relative figure paths into concrete artifact paths', () => {
    expect(resolveArtifactRelativePath(
      'E:/project/yixue-scale-engine/target-research-platform/output/manuscripts/EGFR_lung_cancer_manuscript.md',
      'figures/figure1.png',
    )).toBe(
      'E:/project/yixue-scale-engine/target-research-platform/output/manuscripts/figures/figure1.png',
    )

    expect(resolveArtifactRelativePath(
      'E:/project/yixue-scale-engine/target-research-platform/output/manuscripts/nested/report.md',
      '../figures/figure2.svg',
    )).toBe(
      'E:/project/yixue-scale-engine/target-research-platform/output/manuscripts/figures/figure2.svg',
    )
  })

  it('builds inline download URLs for resolved artifact paths', () => {
    expect(buildInlineArtifactUrl('E:/tmp/医学/figure 1.png')).toBe(
      '/api/download?inline=1&path=' + encodeURIComponent('E:/tmp/医学/figure 1.png'),
    )
  })

  it('rewrites relative image and link nodes for markdown preview rendering', () => {
    const image = new FakeNode('IMG', { src: 'figures/figure1.png' })
    const link = new FakeNode('A', { href: 'supplement/review.md' })
    const external = new FakeNode('A', { href: 'https://example.com/paper' })
    const root = {
      querySelectorAll: () => [image, link, external],
    }

    rewriteArtifactRelativeUrls(
      root,
      'E:/project/yixue-scale-engine/target-research-platform/output/manuscripts/EGFR_lung_cancer_manuscript.md',
    )

    expect(image.getAttribute('src')).toBe(
      '/api/download?inline=1&path=' + encodeURIComponent(
        'E:/project/yixue-scale-engine/target-research-platform/output/manuscripts/figures/figure1.png',
      ),
    )
    expect(image.getAttribute('loading')).toBe('eager')
    expect(image.style.maxWidth).toBe('100%')

    expect(link.getAttribute('href')).toBe(
      '/api/download?inline=1&path=' + encodeURIComponent(
        'E:/project/yixue-scale-engine/target-research-platform/output/manuscripts/supplement/review.md',
      ),
    )
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')

    expect(external.getAttribute('href')).toBe('https://example.com/paper')
    expect(external.getAttribute('target')).toBe('_blank')
    expect(external.getAttribute('rel')).toBe('noopener noreferrer')
  })
})
