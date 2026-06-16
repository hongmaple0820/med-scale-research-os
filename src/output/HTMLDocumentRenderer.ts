// SCALE Engine — HTML Document Renderer
// Self-contained HTML output for Spec, Plan, Review, and Report documents
// Dark theme, inline CSS/JS, interactive TOC, print-friendly

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { SCALE_ENGINE_VERSION } from '../version.js'

// ============================================================================
// 1. Types
// ============================================================================

export type OutputFormat = 'html' | 'md'
export type ThemeMode = 'dark' | 'light' | 'auto'
export type DocLang = 'zh' | 'en'

export interface HTMLRenderOptions {
  theme: ThemeMode
  brand?: string          // Brand design spec (vercel/stripe/notion...)
  printFriendly: boolean  // Enable @media print
  interactive: boolean    // Collapsible TOC, tab switching, search
  title: string
  lang: DocLang
  author?: string
  version?: string
  status?: string
}

export interface SpecData {
  id: string
  title: string
  what: string
  successCriteria: string[]
  outOfScope: string[]
  edgeCases: string[]
  northStar: string
  ambiguityScore?: number
}

export interface PlanData {
  id: string
  title?: string
  specId: string
  approach: string
  techChoices: Array<{ decision: string; rationale: string; alternatives?: string[] }>
  modules: Array<{ path: string; action: 'create' | 'modify' | 'delete'; reason: string }>
  rollbackStrategy: string
  estimatedComplexity?: number
}

export interface ReviewData {
  id: string
  title: string
  timestamp: string
  findings: Array<{ severity: string; file: string; line?: number; message: string }>
  passed: boolean
  specCoverage?: number
  specFindings?: string[]
}

export interface ReportData {
  type: string
  title: string
  timestamp: string
  sections: Array<{ heading: string; content: string }>
  metrics?: Record<string, number | string>
}

// ============================================================================
// 2. Default options
// ============================================================================

const DEFAULT_OPTIONS: HTMLRenderOptions = {
  theme: 'dark',
  printFriendly: true,
  interactive: true,
  title: 'SCALE Engine Document',
  lang: 'zh',
}

// ============================================================================
// 3. CSS Theme Variables
// ============================================================================

function getCSSVariables(theme: ThemeMode, brand?: string): string {
  // Default dark theme — matches dashboard pattern
  if (theme === 'dark' || theme === 'auto') {
    return `
    :root {
      --bg: #0f0f0f;
      --bg-surface: #1a1a1a;
      --bg-elevated: #242424;
      --fg: #e0e0e0;
      --fg-muted: #808080;
      --fg-dim: #606060;
      --accent: #00ff88;
      --accent-dim: #00cc6a;
      --border: #333;
      --danger: #ff4444;
      --warning: #ffaa00;
      --info: #4488ff;
      --success: #00ff88;
      --font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      --radius: 8px;
      --shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    ${theme === 'auto' ? `
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #ffffff;
        --bg-surface: #f5f5f5;
        --bg-elevated: #eeeeee;
        --fg: #1a1a1a;
        --fg-muted: #666;
        --fg-dim: #999;
        --accent: #00aa55;
        --accent-dim: #008844;
        --border: #ddd;
        --shadow: 0 2px 8px rgba(0,0,0,0.1);
      }
    }` : ''}
    `
  }

  // Light theme
  return `
    :root {
      --bg: #ffffff;
      --bg-surface: #f5f5f5;
      --bg-elevated: #eeeeee;
      --fg: #1a1a1a;
      --fg-muted: #666;
      --fg-dim: #999;
      --accent: #00aa55;
      --accent-dim: #008844;
      --border: #ddd;
      --danger: #cc0000;
      --warning: #cc8800;
      --info: #2266cc;
      --success: #00aa55;
      --font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      --radius: 8px;
      --shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
  `
}

// ============================================================================
// 4. Base Layout CSS
// ============================================================================

function getBaseCSS(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.6;
      min-height: 100vh;
    }
    /* Navigation */
    .doc-nav {
      background: var(--bg-surface);
      padding: 0.75rem 1.5rem;
      display: flex;
      gap: 1rem;
      align-items: center;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .doc-nav .brand { color: var(--accent); font-weight: 700; font-size: 0.85rem; letter-spacing: 0.05em; }
    .doc-nav .sep { color: var(--fg-dim); }
    .doc-nav .title { color: var(--fg-muted); font-size: 0.85rem; }

    /* Layout */
    .doc-layout { display: flex; min-height: calc(100vh - 49px); }
    .doc-toc {
      width: 260px;
      min-width: 260px;
      background: var(--bg-surface);
      padding: 1.5rem 1rem;
      border-right: 1px solid var(--border);
      overflow-y: auto;
      position: sticky;
      top: 49px;
      height: calc(100vh - 49px);
    }
    .doc-toc h3 {
      color: var(--fg-muted);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 0.75rem;
    }
    .doc-toc a {
      display: block;
      color: var(--fg-muted);
      text-decoration: none;
      font-size: 0.85rem;
      padding: 0.3rem 0.5rem;
      border-radius: 4px;
      transition: all 0.15s;
    }
    .doc-toc a:hover { color: var(--fg); background: var(--bg-elevated); }
    .doc-toc a.active { color: var(--accent); background: var(--bg-elevated); }
    .doc-toc a.indent-1 { padding-left: 1.25rem; font-size: 0.8rem; }

    .doc-main {
      flex: 1;
      padding: 2rem 3rem;
      max-width: 900px;
    }

    /* Header */
    .doc-header {
      margin-bottom: 2.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }
    .doc-header h1 {
      color: var(--accent);
      font-size: 1.75rem;
      margin-bottom: 0.5rem;
    }
    .doc-meta {
      display: flex;
      gap: 1.5rem;
      flex-wrap: wrap;
      margin-top: 0.75rem;
    }
    .doc-meta .tag {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.75rem;
      color: var(--fg-muted);
      background: var(--bg-elevated);
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
    }
    .doc-meta .tag .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      display: inline-block;
    }
    .doc-meta .tag .dot.green { background: var(--success); }
    .doc-meta .tag .dot.yellow { background: var(--warning); }
    .doc-meta .tag .dot.red { background: var(--danger); }

    /* Sections */
    .doc-section {
      margin-bottom: 2rem;
      scroll-margin-top: 60px;
    }
    .doc-section h2 {
      color: var(--fg);
      font-size: 1.25rem;
      margin-bottom: 0.75rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .doc-section h2 .icon { color: var(--accent); font-size: 1rem; }
    .doc-section h3 {
      color: var(--fg);
      font-size: 1rem;
      margin-top: 1rem;
      margin-bottom: 0.5rem;
    }
    .doc-section p { margin-bottom: 0.75rem; }
    .doc-section ul, .doc-section ol {
      padding-left: 1.5rem;
      margin-bottom: 0.75rem;
    }
    .doc-section li { margin-bottom: 0.35rem; }

    /* Cards */
    .card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.25rem;
      margin-bottom: 0.75rem;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .card-title { font-weight: 600; font-size: 0.9rem; }
    .card-badge {
      font-size: 0.7rem;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-weight: 600;
    }
    .badge-green { background: rgba(0,255,136,0.15); color: var(--success); }
    .badge-yellow { background: rgba(255,170,0,0.15); color: var(--warning); }
    .badge-red { background: rgba(255,68,68,0.15); color: var(--danger); }
    .badge-blue { background: rgba(68,136,255,0.15); color: var(--info); }

    /* Tables */
    .doc-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1rem;
      font-size: 0.85rem;
    }
    .doc-table th, .doc-table td {
      padding: 0.6rem 0.75rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    .doc-table th {
      color: var(--fg-muted);
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .doc-table tr:hover td { background: var(--bg-surface); }

    /* Code */
    code {
      font-family: var(--font-mono);
      font-size: 0.85em;
      background: var(--bg-elevated);
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
    }
    pre {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem;
      overflow-x: auto;
      margin-bottom: 1rem;
    }
    pre code {
      background: none;
      padding: 0;
      font-size: 0.8rem;
      line-height: 1.5;
    }

    /* Checklist */
    .checklist { list-style: none; padding-left: 0; }
    .checklist li {
      padding: 0.4rem 0;
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
    }
    .checklist li::before {
      content: '\\2610';
      color: var(--fg-muted);
      flex-shrink: 0;
    }
    .checklist li.done::before {
      content: '\\2611';
      color: var(--success);
    }

    /* Finding rows */
    .finding-row {
      display: flex;
      gap: 0.5rem;
      align-items: flex-start;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
      font-size: 0.85rem;
    }
    .finding-severity {
      flex-shrink: 0;
      font-weight: 600;
      font-size: 0.7rem;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      text-transform: uppercase;
    }
    .severity-critical { background: rgba(255,68,68,0.2); color: var(--danger); }
    .severity-high { background: rgba(255,170,0,0.2); color: var(--warning); }
    .severity-medium { background: rgba(68,136,255,0.2); color: var(--info); }
    .severity-low { background: rgba(128,128,128,0.2); color: var(--fg-muted); }
    .finding-file { color: var(--accent); font-family: var(--font-mono); font-size: 0.8rem; }
    .finding-message { color: var(--fg); }

    /* Metric grid */
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .metric-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem;
      text-align: center;
    }
    .metric-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--accent);
    }
    .metric-label {
      font-size: 0.75rem;
      color: var(--fg-muted);
      margin-top: 0.25rem;
    }

    /* Collapsible */
    details { margin-bottom: 0.75rem; }
    details summary {
      cursor: pointer;
      font-weight: 600;
      padding: 0.5rem 0;
      color: var(--fg);
    }
    details summary:hover { color: var(--accent); }
    details[open] summary { margin-bottom: 0.5rem; }

    /* Footer */
    .doc-footer {
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
      font-size: 0.75rem;
      color: var(--fg-dim);
      text-align: center;
    }

    /* Print */
    @media print {
      body { background: #fff; color: #000; }
      .doc-nav { display: none; }
      .doc-toc { display: none; }
      .doc-main { max-width: 100%; padding: 0; }
      .doc-header h1 { color: #000; }
      .card { border: 1px solid #ccc; }
      .metric-card { border: 1px solid #ccc; }
      .metric-value { color: #000; }
      a { color: #000; text-decoration: underline; }
      .doc-footer { color: #666; }
    }

    /* Responsive */
    @media (max-width: 768px) {
      .doc-toc { display: none; }
      .doc-main { padding: 1.5rem 1rem; }
      .doc-meta { gap: 0.75rem; }
    }
  `
}

// ============================================================================
// 5. Interactive JS
// ============================================================================

function getInteractiveScript(): string {
  return `
    // Active TOC tracking
    (function() {
      const sections = document.querySelectorAll('.doc-section[id]');
      const tocLinks = document.querySelectorAll('.doc-toc a[href^="#"]');
      if (!sections.length || !tocLinks.length) return;

      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            tocLinks.forEach(link => link.classList.remove('active'));
            const id = entry.target.getAttribute('id');
            const active = document.querySelector('.doc-toc a[href="#' + id + '"]');
            if (active) active.classList.add('active');
          }
        });
      }, { rootMargin: '-60px 0px -60% 0px' });

      sections.forEach(s => observer.observe(s));
    })();

    // Smooth scroll for TOC links
    document.querySelectorAll('.doc-toc a').forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (href && href.startsWith('#')) {
          e.preventDefault();
          const target = document.getElementById(href.slice(1));
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });

    // Keyboard shortcut: Ctrl+P print hint
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        // Let browser handle print
      }
    });
  `
}

// ============================================================================
// 6. HTMLDocumentRenderer
// ============================================================================

export class HTMLDocumentRenderer {
  private options: HTMLRenderOptions

  constructor(options?: Partial<HTMLRenderOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  // === Spec rendering ===
  renderSpec(data: SpecData): string {
    const sections = [
      this.renderSection('overview', 'What', `
        <p>${this.escapeHtml(data.what)}</p>
      `),
      this.renderSection('success-criteria', 'Success Criteria', `
        <ul class="checklist">
          ${data.successCriteria.map(c => `<li>${this.escapeHtml(c)}</li>`).join('\n')}
        </ul>
      `),
      data.outOfScope.length > 0 ? this.renderSection('out-of-scope', 'Out of Scope', `
        <ul>${data.outOfScope.map(o => `<li>${this.escapeHtml(o)}</li>`).join('\n')}</ul>
      `) : '',
      data.edgeCases.length > 0 ? this.renderSection('edge-cases', 'Edge Cases', `
        <ul>${data.edgeCases.map(e => `<li>${this.escapeHtml(e)}</li>`).join('\n')}</ul>
      `) : '',
      this.renderSection('north-star', 'North Star', `
        <p>${this.escapeHtml(data.northStar)}</p>
      `),
    ].filter(Boolean).join('\n')

    const meta = this.buildMetaTags([
      { label: 'ID', value: data.id },
      { label: 'Status', value: this.options.status ?? 'FROZEN', dotColor: 'green' },
      data.ambiguityScore !== undefined
        ? { label: 'Ambiguity', value: data.ambiguityScore.toFixed(2), dotColor: data.ambiguityScore > 0.2 ? 'yellow' : 'green' }
        : null,
      { label: 'Criteria', value: `${data.successCriteria.length}` },
    ].filter(Boolean) as MetaTag[])

    return this.wrapInLayout(data.title, meta, sections, 'DEFINE')
  }

  // === Plan rendering ===
  renderPlan(data: PlanData): string {
    const sections = [
      this.renderSection('approach', 'Approach', `
        <p>${this.escapeHtml(data.approach)}</p>
      `),
      data.techChoices.length > 0 ? this.renderSection('tech-choices', 'Tech Choices', `
        <div class="doc-table-wrap">
          <table class="doc-table">
            <thead><tr><th>Decision</th><th>Rationale</th>${data.techChoices[0]?.alternatives ? '<th>Alternatives</th>' : ''}</tr></thead>
            <tbody>
              ${data.techChoices.map(t => `<tr>
                <td><strong>${this.escapeHtml(t.decision)}</strong></td>
                <td>${this.escapeHtml(t.rationale)}</td>
                ${t.alternatives ? `<td>${t.alternatives.map(a => this.escapeHtml(a)).join(', ')}</td>` : ''}
              </tr>`).join('\n')}
            </tbody>
          </table>
        </div>
      `) : '',
      data.modules.length > 0 ? this.renderSection('modules', 'Modules', `
        <div class="doc-table-wrap">
          <table class="doc-table">
            <thead><tr><th>Action</th><th>Path</th><th>Reason</th></tr></thead>
            <tbody>
              ${data.modules.map(m => `<tr>
                <td><span class="card-badge ${m.action === 'create' ? 'badge-green' : m.action === 'modify' ? 'badge-yellow' : 'badge-red'}">${m.action}</span></td>
                <td><code>${this.escapeHtml(m.path)}</code></td>
                <td>${this.escapeHtml(m.reason)}</td>
              </tr>`).join('\n')}
            </tbody>
          </table>
        </div>
      `) : '',
      this.renderSection('rollback', 'Rollback Strategy', `
        <div class="card">
          <p>${this.escapeHtml(data.rollbackStrategy)}</p>
        </div>
      `),
      data.estimatedComplexity !== undefined ? this.renderSection('complexity', 'Estimated Complexity', `
        <div class="metric-grid">
          <div class="metric-card">
            <div class="metric-value">${data.estimatedComplexity}/10</div>
            <div class="metric-label">Complexity</div>
          </div>
        </div>
      `) : '',
    ].filter(Boolean).join('\n')

    const meta = this.buildMetaTags([
      { label: 'ID', value: data.id },
      { label: 'Spec', value: data.specId },
      { label: 'Status', value: this.options.status ?? 'APPROVED', dotColor: 'green' },
      data.estimatedComplexity !== undefined
        ? { label: 'Complexity', value: `${data.estimatedComplexity}/10` }
        : null,
    ].filter(Boolean) as MetaTag[])

    return this.wrapInLayout(data.title ?? `Plan ${data.id}`, meta, sections, 'PLAN')
  }

  // === Review rendering ===
  renderReview(data: ReviewData): string {
    const severityGroups = this.groupBySeverity(data.findings)

    const sections = [
      // Summary metrics
      `<div class="metric-grid">
        <div class="metric-card">
          <div class="metric-value">${data.findings.length}</div>
          <div class="metric-label">Findings</div>
        </div>
        <div class="metric-card">
          <div class="metric-value" style="color: ${data.passed ? 'var(--success)' : 'var(--danger)'}">${data.passed ? 'PASS' : 'FAIL'}</div>
          <div class="metric-label">Result</div>
        </div>
        ${data.specCoverage !== undefined ? `
        <div class="metric-card">
          <div class="metric-value">${(data.specCoverage * 100).toFixed(0)}%</div>
          <div class="metric-label">Spec Coverage</div>
        </div>` : ''}
        ${Object.entries(severityGroups).map(([sev, items]) => `
        <div class="metric-card">
          <div class="metric-value" style="color: ${sev === 'critical' || sev === 'high' ? 'var(--danger)' : sev === 'medium' ? 'var(--warning)' : 'var(--fg-muted)'}">${items.length}</div>
          <div class="metric-label">${sev}</div>
        </div>`).join('')}
      </div>`,

      // Findings table
      this.renderSection('findings', 'Findings', data.findings.length > 0
        ? data.findings.map(f => `
          <div class="finding-row">
            <span class="finding-severity severity-${f.severity.toLowerCase()}">${f.severity}</span>
            <span class="finding-file">${this.escapeHtml(f.file)}${f.line ? `:${f.line}` : ''}</span>
            <span class="finding-message">${this.escapeHtml(f.message)}</span>
          </div>
        `).join('')
        : '<p style="color: var(--fg-muted)">No findings</p>'
      ),

      // Spec conformance
      data.specFindings && data.specFindings.length > 0
        ? this.renderSection('spec-conformance', 'Spec Conformance', `
          <ul>${data.specFindings.map(f => `<li>${this.escapeHtml(f)}</li>`).join('\n')}</ul>
        `)
        : '',
    ].filter(Boolean).join('\n')

    const meta = this.buildMetaTags([
      { label: 'ID', value: data.id },
      { label: 'Status', value: data.passed ? 'PASS' : 'FAIL', dotColor: data.passed ? 'green' : 'red' },
      { label: 'Time', value: data.timestamp },
    ])

    return this.wrapInLayout(data.title, meta, sections, 'REVIEW')
  }

  // === Report rendering ===
  renderReport(data: ReportData): string {
    // Metrics grid
    const metricsHtml = data.metrics
      ? `<div class="metric-grid">
          ${Object.entries(data.metrics).map(([key, val]) => `
            <div class="metric-card">
              <div class="metric-value">${this.escapeHtml(String(val))}</div>
              <div class="metric-label">${this.escapeHtml(key)}</div>
            </div>
          `).join('')}
        </div>`
      : ''

    const sections = [
      metricsHtml,
      ...data.sections.map(s => this.renderSection(
        this.slugify(s.heading),
        s.heading,
        s.content
      )),
    ].filter(Boolean).join('\n')

    const meta = this.buildMetaTags([
      { label: 'Type', value: data.type },
      { label: 'Time', value: data.timestamp },
    ])

    return this.wrapInLayout(data.title, meta, sections, data.type.toUpperCase())
  }

  // === Generic content rendering ===
  renderContent(title: string, bodyHtml: string, phase?: string): string {
    const meta = this.buildMetaTags([
      { label: 'Phase', value: phase ?? 'CUSTOM' },
      { label: 'Time', value: new Date().toISOString() },
    ])
    return this.wrapInLayout(title, meta, bodyHtml, phase)
  }

  // === Write to file ===
  writeToFile(html: string, filePath: string): string {
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, html, 'utf-8')
    return filePath
  }

  // === Internal: Wrap in full HTML layout ===
  private wrapInLayout(title: string, metaHtml: string, bodyHtml: string, phase?: string): string {
    const opts = this.options
    const toc = this.extractTOC(bodyHtml)

    return `<!DOCTYPE html>
<html lang="${opts.lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="SCALE Engine v${opts.version ?? SCALE_ENGINE_VERSION}">
  <title>${this.escapeHtml(title)} — SCALE Engine</title>
  <style>
${getCSSVariables(opts.theme, opts.brand)}
${getBaseCSS()}
  </style>
</head>
<body>
  <nav class="doc-nav">
    <span class="brand">SCALE</span>
    <span class="sep">/</span>
    <span class="title">${this.escapeHtml(phase ?? 'DOC')} — ${this.escapeHtml(title)}</span>
  </nav>
  <div class="doc-layout">
${opts.interactive && toc.length > 0 ? `
    <aside class="doc-toc">
      <h3>Contents</h3>
${toc.map(item => `      <a href="#${item.id}"${item.indent ? ' class="indent-1"' : ''}>${this.escapeHtml(item.label)}</a>`).join('\n')}
    </aside>
` : ''}
    <main class="doc-main">
      <header class="doc-header">
        <h1>${this.escapeHtml(title)}</h1>
${metaHtml}
      </header>
${bodyHtml}
      <footer class="doc-footer">
        Generated by SCALE Engine v${opts.version ?? SCALE_ENGINE_VERSION} &middot; ${new Date().toISOString().slice(0, 10)}
${opts.printFriendly ? ' &middot; <em>Ctrl+P to print as PDF</em>' : ''}
      </footer>
    </main>
  </div>
${opts.interactive ? `<script>${getInteractiveScript()}</script>` : ''}
</body>
</html>`
  }

  // === Internal: Render a section with anchor ===
  private renderSection(id: string, heading: string, content: string): string {
    return `
    <section class="doc-section" id="${id}">
      <h2><span class="icon">#</span> ${this.escapeHtml(heading)}</h2>
      ${content}
    </section>`
  }

  // === Internal: Build meta tags HTML ===
  private buildMetaTags(tags: MetaTag[]): string {
    if (tags.length === 0) return ''
    return `<div class="doc-meta">
${tags.map(t => `      <span class="tag">${t.dotColor ? `<span class="dot ${t.dotColor}"></span>` : ''}<strong>${this.escapeHtml(t.label)}:</strong> ${this.escapeHtml(t.value)}</span>`).join('\n')}
    </div>`
  }

  // === Internal: Extract TOC from rendered sections ===
  private extractTOC(html: string): TOCItem[] {
    const items: TOCItem[] = []
    const regex = /<section[^>]*id="([^"]*)"[^>]*>\s*<h2[^>]*>(?:<[^>]*>)?\s*#\s*(?:<[^>]*>)?\s*([^<]+)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(html)) !== null) {
      items.push({ id: match[1], label: match[2].trim(), indent: false })
    }
    return items
  }

  // === Utility ===
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>')
  }

  private slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }

  private groupBySeverity(findings: ReviewData['findings']): Record<string, typeof findings> {
    const groups: Record<string, typeof findings> = {}
    for (const f of findings) {
      const key = f.severity.toLowerCase()
      if (!groups[key]) groups[key] = []
      groups[key].push(f)
    }
    return groups
  }
}

// ============================================================================
// 7. Helper types
// ============================================================================

interface MetaTag {
  label: string
  value: string
  dotColor?: 'green' | 'yellow' | 'red'
}

interface TOCItem {
  id: string
  label: string
  indent: boolean
}
