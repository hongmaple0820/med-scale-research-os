// SCALE Engine — Brand Theme Loader
// Loads brand design specs from awesome-design-md and generates CSS variables
// Integrates with npx getdesign for brand asset fetching

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// ============================================================================
// 1. Types
// ============================================================================

export interface BrandTheme {
  name: string
  displayName: string
  colors: BrandColors
  typography: BrandTypography
  spacing: BrandSpacing
  radius: string
  shadows: BrandShadows
}

export interface BrandColors {
  primary: string
  primaryHover?: string
  secondary?: string
  accent?: string
  bg: string
  bgSurface: string
  bgElevated: string
  fg: string
  fgMuted: string
  border: string
  success?: string
  warning?: string
  danger?: string
}

export interface BrandTypography {
  fontFamily: string
  fontFamilyMono: string
  baseFontSize: string
  headingWeight: string
}

export interface BrandSpacing {
  unit: string
  sectionGap: string
  cardPadding: string
}

export interface BrandShadows {
  card: string
  elevated: string
}

// ============================================================================
// 2. Built-in brand presets
// ============================================================================

const BUILTIN_BRANDS: Record<string, BrandTheme> = {
  vercel: {
    name: 'vercel',
    displayName: 'Vercel',
    colors: {
      primary: '#000000',
      primaryHover: '#333333',
      secondary: '#666666',
      accent: '#0070f3',
      bg: '#000000',
      bgSurface: '#111111',
      bgElevated: '#222222',
      fg: '#ededed',
      fgMuted: '#888888',
      border: '#333333',
      success: '#0070f3',
      warning: '#f5a623',
      danger: '#ee0000',
    },
    typography: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontFamilyMono: "'SF Mono', 'Fira Code', monospace",
      baseFontSize: '16px',
      headingWeight: '700',
    },
    spacing: { unit: '8px', sectionGap: '2rem', cardPadding: '1.25rem' },
    radius: '8px',
    shadows: {
      card: '0 2px 8px rgba(255,255,255,0.05)',
      elevated: '0 8px 30px rgba(255,255,255,0.08)',
    },
  },
  stripe: {
    name: 'stripe',
    displayName: 'Stripe',
    colors: {
      primary: '#635bff',
      primaryHover: '#7a73ff',
      secondary: '#0a2540',
      accent: '#00d4aa',
      bg: '#0a2540',
      bgSurface: '#1a3a5c',
      bgElevated: '#244b73',
      fg: '#ffffff',
      fgMuted: '#8898aa',
      border: '#2e4a62',
      success: '#00d4aa',
      warning: '#ffbb00',
      danger: '#ff5c5c',
    },
    typography: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      fontFamilyMono: "'SF Mono', 'Fira Code', monospace",
      baseFontSize: '16px',
      headingWeight: '600',
    },
    spacing: { unit: '8px', sectionGap: '2rem', cardPadding: '1.5rem' },
    radius: '6px',
    shadows: {
      card: '0 2px 4px rgba(0,0,0,0.2)',
      elevated: '0 8px 24px rgba(0,0,0,0.3)',
    },
  },
  notion: {
    name: 'notion',
    displayName: 'Notion',
    colors: {
      primary: '#2382e2',
      primaryHover: '#1a6bc4',
      secondary: '#37352f',
      accent: '#eb5757',
      bg: '#ffffff',
      bgSurface: '#f7f6f3',
      bgElevated: '#eeeeee',
      fg: '#37352f',
      fgMuted: '#787774',
      border: '#e3e2de',
      success: '#0f7b6c',
      warning: '#d9730d',
      danger: '#e03e3e',
    },
    typography: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      fontFamilyMono: "'SF Mono', 'Consolas', monospace",
      baseFontSize: '16px',
      headingWeight: '600',
    },
    spacing: { unit: '8px', sectionGap: '1.5rem', cardPadding: '1rem' },
    radius: '3px',
    shadows: {
      card: '0 1px 3px rgba(0,0,0,0.08)',
      elevated: '0 4px 12px rgba(0,0,0,0.1)',
    },
  },
  linear: {
    name: 'linear',
    displayName: 'Linear',
    colors: {
      primary: '#5e6ad2',
      primaryHover: '#7b84e0',
      secondary: '#171923',
      accent: '#26b5ce',
      bg: '#0d0f14',
      bgSurface: '#161a24',
      bgElevated: '#1e2330',
      fg: '#e8eaed',
      fgMuted: '#6b7280',
      border: '#2a2f3e',
      success: '#4ade80',
      warning: '#fbbf24',
      danger: '#f87171',
    },
    typography: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      fontFamilyMono: "'JetBrains Mono', 'Fira Code', monospace",
      baseFontSize: '14px',
      headingWeight: '600',
    },
    spacing: { unit: '8px', sectionGap: '2rem', cardPadding: '1.25rem' },
    radius: '6px',
    shadows: {
      card: '0 1px 2px rgba(0,0,0,0.2)',
      elevated: '0 4px 16px rgba(0,0,0,0.3)',
    },
  },
  github: {
    name: 'github',
    displayName: 'GitHub',
    colors: {
      primary: '#0969da',
      primaryHover: '#0550ae',
      secondary: '#24292f',
      accent: '#8250df',
      bg: '#0d1117',
      bgSurface: '#161b22',
      bgElevated: '#21262d',
      fg: '#c9d1d9',
      fgMuted: '#8b949e',
      border: '#30363d',
      success: '#3fb950',
      warning: '#d29922',
      danger: '#f85149',
    },
    typography: {
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontFamilyMono: "'SFMono-Regular', 'Consolas', 'Liberation Mono', monospace",
      baseFontSize: '14px',
      headingWeight: '600',
    },
    spacing: { unit: '8px', sectionGap: '1.5rem', cardPadding: '1rem' },
    radius: '6px',
    shadows: {
      card: '0 1px 3px rgba(0,0,0,0.12)',
      elevated: '0 8px 24px rgba(0,0,0,0.2)',
    },
  },
}

// ============================================================================
// 3. BrandThemeLoader
// ============================================================================

export class BrandThemeLoader {
  private customBrandsDir?: string

  constructor(options?: { brandsDir?: string }) {
    this.customBrandsDir = options?.brandsDir
  }

  // Load a brand theme by name
  loadBrand(brand: string): BrandTheme | null {
    const normalized = brand.toLowerCase().trim()

    // Check built-in brands first
    if (BUILTIN_BRANDS[normalized]) {
      return BUILTIN_BRANDS[normalized]
    }

    // Check custom brands directory
    if (this.customBrandsDir) {
      const brandPath = join(this.customBrandsDir, normalized, 'DESIGN.md')
      if (existsSync(brandPath)) {
        return this.parseBrandDesignMD(brandPath, normalized)
      }
    }

    // Check awesome-design-md skill directory
    const awesomeDir = this.getAwesomeDesignDir()
    if (awesomeDir) {
      const brandPath = join(awesomeDir, normalized, 'DESIGN.md')
      if (existsSync(brandPath)) {
        return this.parseBrandDesignMD(brandPath, normalized)
      }
    }

    return null
  }

  // Generate CSS variables from a brand theme
  getCSSVariables(theme: BrandTheme): string {
    return `
    :root {
      --brand-primary: ${theme.colors.primary};
      --brand-primary-hover: ${theme.colors.primaryHover ?? theme.colors.primary};
      --brand-secondary: ${theme.colors.secondary ?? theme.colors.fg};
      --brand-accent: ${theme.colors.accent ?? theme.colors.primary};
      --brand-bg: ${theme.colors.bg};
      --brand-bg-surface: ${theme.colors.bgSurface};
      --brand-bg-elevated: ${theme.colors.bgElevated};
      --brand-fg: ${theme.colors.fg};
      --brand-fg-muted: ${theme.colors.fgMuted};
      --brand-border: ${theme.colors.border};
      --brand-success: ${theme.colors.success ?? '#00ff88'};
      --brand-warning: ${theme.colors.warning ?? '#ffaa00'};
      --brand-danger: ${theme.colors.danger ?? '#ff4444'};
      --brand-font: ${theme.typography.fontFamily};
      --brand-font-mono: ${theme.typography.fontFamilyMono};
      --brand-font-size: ${theme.typography.baseFontSize};
      --brand-heading-weight: ${theme.typography.headingWeight};
      --brand-radius: ${theme.radius};
      --brand-shadow-card: ${theme.shadows.card};
      --brand-shadow-elevated: ${theme.shadows.elevated};
    }
    `
  }

  // Generate override CSS that replaces default variables with brand values
  getOverrideCSS(theme: BrandTheme): string {
    return `
    :root {
      --bg: ${theme.colors.bg};
      --bg-surface: ${theme.colors.bgSurface};
      --bg-elevated: ${theme.colors.bgElevated};
      --fg: ${theme.colors.fg};
      --fg-muted: ${theme.colors.fgMuted};
      --border: ${theme.colors.border};
      --accent: ${theme.colors.primary};
      --accent-dim: ${theme.colors.primaryHover ?? theme.colors.primary};
      --radius: ${theme.radius};
    }
    body { font-family: ${theme.typography.fontFamily}; font-size: ${theme.typography.baseFontSize}; }
    h1, h2, h3 { font-weight: ${theme.typography.headingWeight}; }
    `
  }

  // List all available brand names
  listAvailableBrands(): string[] {
    const builtin = Object.keys(BUILTIN_BRANDS)

    // Add custom brands from awesome-design-md
    const awesomeDir = this.getAwesomeDesignDir()
    if (awesomeDir && existsSync(awesomeDir)) {
      try {
        const dirs = readdirSync(awesomeDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name)
        for (const d of dirs) {
          if (!builtin.includes(d)) builtin.push(d)
        }
      } catch {
        // ignore read errors
      }
    }

    return builtin.sort()
  }

  // Check if a brand exists
  hasBrand(brand: string): boolean {
    return this.loadBrand(brand) !== null
  }

  // === Internal: Parse DESIGN.md from awesome-design-md ===
  private parseBrandDesignMD(filePath: string, name: string): BrandTheme | null {
    try {
      const content = readFileSync(filePath, 'utf-8')
      // Basic parsing — extract colors from markdown table or code blocks
      const colors = this.extractColors(content)
      if (!colors) return null

      return {
        name,
        displayName: this.extractTitle(content) ?? name,
        colors: {
          primary: colors.primary ?? '#0070f3',
          primaryHover: colors.primaryHover,
          secondary: colors.secondary,
          accent: colors.accent,
          bg: colors.bg ?? '#0f0f0f',
          bgSurface: colors.bgSurface ?? '#1a1a1a',
          bgElevated: colors.bgElevated ?? '#242424',
          fg: colors.fg ?? '#e0e0e0',
          fgMuted: colors.fgMuted ?? '#808080',
          border: colors.border ?? '#333',
          success: colors.success,
          warning: colors.warning,
          danger: colors.danger,
        },
        typography: {
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
          fontFamilyMono: "'SF Mono', 'Fira Code', monospace",
          baseFontSize: '16px',
          headingWeight: '600',
        },
        spacing: { unit: '8px', sectionGap: '2rem', cardPadding: '1.25rem' },
        radius: '6px',
        shadows: {
          card: '0 2px 8px rgba(0,0,0,0.2)',
          elevated: '0 8px 24px rgba(0,0,0,0.3)',
        },
      }
    } catch {
      return null
    }
  }

  private extractColors(content: string): Record<string, string> | null {
    const colors: Record<string, string> = {}
    // Match hex colors in various formats
    const hexPattern = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/g
    const matches = content.match(hexPattern)
    if (!matches || matches.length === 0) return null

    // First hex is often primary
    colors.primary = matches[0]
    if (matches.length > 1) colors.bg = matches[1]
    if (matches.length > 2) colors.fg = matches[2]

    return colors
  }

  private extractTitle(content: string): string | null {
    const titleMatch = content.match(/^#\s+(.+)$/m)
    return titleMatch ? titleMatch[1].trim() : null
  }

  private getAwesomeDesignDir(): string | undefined {
    // Check standard paths for awesome-design-md
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
    const candidates = [
      join(home, '.claude', 'skills', 'awesome-design-md'),
      join(home, '.agents', 'skills', 'awesome-design-md'),
    ]
    return candidates.find(p => existsSync(p))
  }
}
