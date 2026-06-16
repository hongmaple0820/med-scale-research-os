// SCALE Engine — UI Prototype Renderer
// Generates high-fidelity UI prototype HTML from page/component specs
// Integrates with frontend-design, awesome-design-md, web-artifacts-builder skills

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

// ============================================================================
// 1. Types
// ============================================================================

export interface PageSpec {
  name: string
  title: string
  description?: string
  layout: 'single-column' | 'two-column' | 'sidebar' | 'dashboard' | 'grid'
  components: ComponentSpec[]
  navigation?: NavItem[]
}

export interface ComponentSpec {
  type: 'header' | 'card' | 'table' | 'form' | 'chart' | 'list' | 'hero' | 'footer' | 'sidebar' | 'modal' | 'tabs' | 'custom'
  title?: string
  data?: Record<string, unknown>
  position?: { col: number; row: number; colSpan?: number; rowSpan?: number }
}

export interface NavItem {
  label: string
  href: string
  active?: boolean
  icon?: string
}

export interface DashboardLayout {
  title: string
  description?: string
  nav: NavItem[]
  widgets: DashboardWidget[]
}

export interface DashboardWidget {
  title: string
  type: 'metric' | 'chart' | 'table' | 'list' | 'status'
  data: Record<string, unknown>
  size?: 'small' | 'medium' | 'large'
}

export interface UIPrototypeOptions {
  theme: 'dark' | 'light'
  accentColor?: string
  fontFamily?: string
  brandName?: string
}

// ============================================================================
// 2. Default options
// ============================================================================

const DEFAULT_UI_OPTIONS: UIPrototypeOptions = {
  theme: 'dark',
  accentColor: '#00ff88',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
}

// ============================================================================
// 3. UIPrototypeRenderer
// ============================================================================

export class UIPrototypeRenderer {
  private options: UIPrototypeOptions

  constructor(options?: Partial<UIPrototypeOptions>) {
    this.options = { ...DEFAULT_UI_OPTIONS, ...options }
  }

  // === Render a wireframe page ===
  renderWireframe(pages: PageSpec[]): string {
    if (pages.length === 0) return this.renderEmpty()

    // Single page — render directly
    if (pages.length === 1) {
      return this.renderPage(pages[0])
    }

    // Multi-page — render with tab navigation
    return this.renderMultiPage(pages)
  }

  // === Render a single component set ===
  renderComponent(components: ComponentSpec[]): string {
    const body = components.map(c => this.renderComponentHTML(c)).join('\n')

    return this.wrapInUIPrototype('Components', `
      <div class="prototype-component-grid">
        ${body}
      </div>
    `)
  }

  // === Render a dashboard layout ===
  renderDashboard(layout: DashboardLayout): string {
    const navHtml = layout.nav.map(item => `
      <a href="${item.href}" class="proto-nav-item${item.active ? ' active' : ''}">
        ${item.icon ? `<span class="proto-nav-icon">${item.icon}</span>` : ''}
        ${this.esc(item.label)}
      </a>
    `).join('')

    const widgetHtml = layout.widgets.map(w => {
      const sizeClass = w.size === 'large' ? 'widget-lg' : w.size === 'small' ? 'widget-sm' : 'widget-md'
      return `
        <div class="proto-widget ${sizeClass}">
          <div class="proto-widget-header">${this.esc(w.title)}</div>
          <div class="proto-widget-body">${this.renderWidgetContent(w)}</div>
        </div>
      `
    }).join('')

    return this.wrapInUIPrototype(layout.title, `
      <nav class="proto-sidebar">
        <div class="proto-sidebar-brand">${this.esc(layout.title)}</div>
        ${navHtml}
      </nav>
      <main class="proto-main">
        ${layout.description ? `<p class="proto-desc">${this.esc(layout.description)}</p>` : ''}
        <div class="proto-widget-grid">
          ${widgetHtml}
        </div>
      </main>
    `, true)
  }

  // === Write to file ===
  writeToFile(html: string, filePath: string): string {
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, html, 'utf-8')
    return filePath
  }

  // === Internal: Render a single page ===
  private renderPage(page: PageSpec): string {
    const navHtml = page.navigation ? `
      <nav class="proto-topnav">
        ${page.navigation.map(item => `
          <a href="${item.href}" class="proto-nav-item${item.active ? ' active' : ''}">${this.esc(item.label)}</a>
        `).join('')}
      </nav>
    ` : ''

    const componentsHtml = page.components.map(c => this.renderComponentHTML(c)).join('\n')

    const layoutClass = page.layout === 'two-column' ? 'proto-layout-2col'
      : page.layout === 'sidebar' ? 'proto-layout-sidebar'
      : page.layout === 'dashboard' ? 'proto-layout-dashboard'
      : page.layout === 'grid' ? 'proto-layout-grid'
      : 'proto-layout-single'

    return this.wrapInUIPrototype(page.title, `
      ${navHtml}
      <main class="proto-main ${layoutClass}">
        <h1 class="proto-page-title">${this.esc(page.title)}</h1>
        ${page.description ? `<p class="proto-desc">${this.esc(page.description)}</p>` : ''}
        <div class="proto-components">
          ${componentsHtml}
        </div>
      </main>
    `)
  }

  // === Internal: Multi-page with tabs ===
  private renderMultiPage(pages: PageSpec[]): string {
    const tabsHtml = pages.map((p, i) => `
      <button class="proto-tab${i === 0 ? ' active' : ''}" onclick="showPage(${i})">${this.esc(p.name)}</button>
    `).join('')

    const pagesHtml = pages.map((p, i) => `
      <div class="proto-page-panel${i === 0 ? '' : ' hidden'}" data-page="${i}">
        ${p.components.map(c => this.renderComponentHTML(c)).join('\n')}
      </div>
    `).join('')

    return this.wrapInUIPrototype(pages[0].title, `
      <div class="proto-tabs">${tabsHtml}</div>
      <main class="proto-main">
        ${pagesHtml}
      </main>
      <script>
        function showPage(idx) {
          document.querySelectorAll('.proto-page-panel').forEach((p, i) => {
            p.classList.toggle('hidden', i !== idx);
          });
          document.querySelectorAll('.proto-tab').forEach((t, i) => {
            t.classList.toggle('active', i === idx);
          });
        }
      </script>
    `)
  }

  // === Internal: Render a single component ===
  private renderComponentHTML(comp: ComponentSpec): string {
    switch (comp.type) {
      case 'header':
        return `<header class="proto-component proto-header"><h2>${this.esc(comp.title ?? 'Header')}</h2></header>`

      case 'card':
        return `<div class="proto-component proto-card">
          ${comp.title ? `<div class="proto-card-title">${this.esc(comp.title)}</div>` : ''}
          <div class="proto-card-body">${comp.data?.content ? this.esc(String(comp.data.content)) : '<span class="proto-placeholder">Card content</span>'}</div>
        </div>`

      case 'table':
        return this.renderTableComponent(comp)

      case 'form':
        return this.renderFormComponent(comp)

      case 'hero':
        return `<section class="proto-component proto-hero">
          <h2>${this.esc(comp.title ?? 'Hero Title')}</h2>
          <p>${comp.data?.subtitle ? this.esc(String(comp.data.subtitle)) : 'Hero description'}</p>
          <button class="proto-btn proto-btn-primary">Get Started</button>
        </section>`

      case 'list':
        return this.renderListComponent(comp)

      case 'tabs':
        return `<div class="proto-component proto-tabs-box">
          <div class="proto-tabs-inner">
            ${(comp.data?.items as string[] ?? ['Tab 1', 'Tab 2']).map((t: string, i: number) =>
              `<span class="proto-tab-pill${i === 0 ? ' active' : ''}">${this.esc(t)}</span>`
            ).join('')}
          </div>
          <div class="proto-tabs-content"><span class="proto-placeholder">Tab content</span></div>
        </div>`

      case 'footer':
        return `<footer class="proto-component proto-footer"><p>${this.esc(comp.title ?? 'Footer')}</p></footer>`

      default:
        return `<div class="proto-component proto-custom">${comp.title ? `<strong>${this.esc(comp.title)}</strong>` : ''}<span class="proto-placeholder">Component</span></div>`
    }
  }

  private renderTableComponent(comp: ComponentSpec): string {
    const headers = (comp.data?.headers as string[]) ?? ['Column 1', 'Column 2', 'Column 3']
    const rows = (comp.data?.rows as string[][]) ?? [['A1', 'B1', 'C1'], ['A2', 'B2', 'C2']]
    return `<div class="proto-component proto-table-wrap">
      ${comp.title ? `<div class="proto-card-title">${this.esc(comp.title)}</div>` : ''}
      <table class="proto-table">
        <thead><tr>${headers.map(h => `<th>${this.esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${this.esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`
  }

  private renderFormComponent(comp: ComponentSpec): string {
    const fields = (comp.data?.fields as Array<{ label: string; type: string; placeholder?: string }>) ?? [
      { label: 'Name', type: 'text', placeholder: 'Enter name' },
      { label: 'Email', type: 'email', placeholder: 'Enter email' },
    ]
    return `<div class="proto-component proto-form">
      ${comp.title ? `<div class="proto-card-title">${this.esc(comp.title)}</div>` : ''}
      ${fields.map(f => `
        <div class="proto-form-field">
          <label>${this.esc(f.label)}</label>
          <input type="${f.type}" placeholder="${this.esc(f.placeholder ?? '')}" disabled>
        </div>
      `).join('')}
      <button class="proto-btn proto-btn-primary" disabled>Submit</button>
    </div>`
  }

  private renderListComponent(comp: ComponentSpec): string {
    const items = (comp.data?.items as string[]) ?? ['Item 1', 'Item 2', 'Item 3']
    return `<div class="proto-component proto-list">
      ${comp.title ? `<div class="proto-card-title">${this.esc(comp.title)}</div>` : ''}
      <ul>${items.map(item => `<li>${this.esc(item)}</li>`).join('')}</ul>
    </div>`
  }

  private renderWidgetContent(widget: DashboardWidget): string {
    switch (widget.type) {
      case 'metric':
        return `<div class="widget-metric">
          <div class="widget-metric-value">${this.esc(String(widget.data.value ?? '—'))}</div>
          <div class="widget-metric-label">${this.esc(String(widget.data.label ?? ''))}</div>
        </div>`
      case 'chart':
        return `<div class="widget-chart-placeholder"><span class="proto-placeholder">Chart</span></div>`
      case 'table':
        return this.renderTableComponent({ type: 'table', data: widget.data })
      case 'list':
        return this.renderListComponent({ type: 'list', data: widget.data })
      case 'status':
        return `<div class="widget-status">
          <span class="status-dot ${widget.data.ok ? 'green' : 'red'}"></span>
          <span>${this.esc(String(widget.data.message ?? 'Status'))}</span>
        </div>`
      default:
        return '<span class="proto-placeholder">Widget</span>'
    }
  }

  private renderEmpty(): string {
    return this.wrapInUIPrototype('Empty Prototype', '<p class="proto-placeholder">No pages defined</p>')
  }

  // === Internal: Wrap in full UI Prototype HTML ===
  private wrapInUIPrototype(title: string, bodyHtml: string, hasSidebar = false): string {
    const opts = this.options
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.esc(title)} — UI Prototype</title>
  <style>
    :root {
      --proto-bg: ${opts.theme === 'dark' ? '#0f0f0f' : '#ffffff'};
      --proto-bg-surface: ${opts.theme === 'dark' ? '#1a1a1a' : '#f5f5f5'};
      --proto-bg-elevated: ${opts.theme === 'dark' ? '#242424' : '#eeeeee'};
      --proto-fg: ${opts.theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
      --proto-fg-muted: ${opts.theme === 'dark' ? '#808080' : '#666666'};
      --proto-border: ${opts.theme === 'dark' ? '#333' : '#ddd'};
      --proto-accent: ${opts.accentColor ?? '#00ff88'};
      --proto-font: ${opts.fontFamily ?? "system-ui, sans-serif"};
      --proto-radius: 8px;
      --proto-sidebar-w: 220px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--proto-font);
      background: var(--proto-bg);
      color: var(--proto-fg);
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
    }
    /* Sidebar */
    .proto-sidebar {
      width: var(--proto-sidebar-w);
      min-width: var(--proto-sidebar-w);
      background: var(--proto-bg-surface);
      border-right: 1px solid var(--proto-border);
      padding: 1.5rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .proto-sidebar-brand {
      color: var(--proto-accent);
      font-weight: 700;
      font-size: 0.9rem;
      padding: 0.5rem 0;
      margin-bottom: 1rem;
      border-bottom: 1px solid var(--proto-border);
    }
    .proto-nav-item {
      display: block;
      color: var(--proto-fg-muted);
      text-decoration: none;
      padding: 0.4rem 0.75rem;
      border-radius: 4px;
      font-size: 0.85rem;
      transition: all 0.15s;
    }
    .proto-nav-item:hover { color: var(--proto-fg); background: var(--proto-bg-elevated); }
    .proto-nav-item.active { color: var(--proto-accent); background: var(--proto-bg-elevated); }

    /* Top nav */
    .proto-topnav {
      background: var(--proto-bg-surface);
      padding: 0.75rem 1.5rem;
      display: flex;
      gap: 1rem;
      border-bottom: 1px solid var(--proto-border);
    }

    /* Main */
    .proto-main {
      flex: 1;
      padding: 2rem;
      overflow-y: auto;
    }
    .proto-page-title {
      color: var(--proto-accent);
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }
    .proto-desc { color: var(--proto-fg-muted); margin-bottom: 1.5rem; }

    /* Layouts */
    .proto-layout-2col .proto-components { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .proto-layout-grid .proto-components { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }

    /* Components */
    .proto-component {
      background: var(--proto-bg-surface);
      border: 1px solid var(--proto-border);
      border-radius: var(--proto-radius);
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .proto-header { background: none; border: none; padding: 0.5rem 0; }
    .proto-header h2 { font-size: 1.1rem; }
    .proto-card-title { font-weight: 600; margin-bottom: 0.5rem; font-size: 0.9rem; }
    .proto-card-body { font-size: 0.85rem; }

    /* Hero */
    .proto-hero {
      text-align: center;
      padding: 3rem 2rem;
      background: linear-gradient(135deg, var(--proto-bg-surface), var(--proto-bg-elevated));
    }
    .proto-hero h2 { font-size: 1.75rem; margin-bottom: 0.5rem; color: var(--proto-accent); }
    .proto-hero p { color: var(--proto-fg-muted); margin-bottom: 1.5rem; }

    /* Buttons */
    .proto-btn {
      padding: 0.5rem 1.5rem;
      border-radius: 4px;
      border: 1px solid var(--proto-border);
      background: var(--proto-bg-elevated);
      color: var(--proto-fg);
      cursor: pointer;
      font-size: 0.85rem;
    }
    .proto-btn-primary {
      background: var(--proto-accent);
      color: ${opts.theme === 'dark' ? '#000' : '#fff'};
      border-color: var(--proto-accent);
      font-weight: 600;
    }

    /* Table */
    .proto-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .proto-table th, .proto-table td {
      padding: 0.5rem 0.75rem;
      text-align: left;
      border-bottom: 1px solid var(--proto-border);
    }
    .proto-table th { color: var(--proto-fg-muted); font-size: 0.75rem; text-transform: uppercase; }

    /* Form */
    .proto-form-field { margin-bottom: 1rem; }
    .proto-form-field label { display: block; font-size: 0.8rem; color: var(--proto-fg-muted); margin-bottom: 0.25rem; }
    .proto-form-field input {
      width: 100%;
      padding: 0.5rem 0.75rem;
      background: var(--proto-bg-elevated);
      border: 1px solid var(--proto-border);
      border-radius: 4px;
      color: var(--proto-fg);
      font-size: 0.85rem;
    }

    /* List */
    .proto-list ul { list-style: none; padding: 0; }
    .proto-list li {
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--proto-border);
      font-size: 0.85rem;
    }

    /* Tabs */
    .proto-tabs {
      background: var(--proto-bg-surface);
      padding: 0.75rem 1.5rem;
      display: flex;
      gap: 0.5rem;
      border-bottom: 1px solid var(--proto-border);
    }
    .proto-tab {
      padding: 0.4rem 1rem;
      border: 1px solid var(--proto-border);
      border-radius: 4px;
      background: none;
      color: var(--proto-fg-muted);
      cursor: pointer;
      font-size: 0.85rem;
    }
    .proto-tab.active {
      color: var(--proto-accent);
      border-color: var(--proto-accent);
    }
    .proto-tab-pill {
      padding: 0.3rem 0.75rem;
      border-radius: 20px;
      font-size: 0.8rem;
      color: var(--proto-fg-muted);
      cursor: pointer;
    }
    .proto-tab-pill.active {
      background: var(--proto-accent);
      color: ${opts.theme === 'dark' ? '#000' : '#fff'};
    }

    /* Widgets */
    .proto-widget-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 1rem;
    }
    .proto-widget {
      background: var(--proto-bg-surface);
      border: 1px solid var(--proto-border);
      border-radius: var(--proto-radius);
      padding: 1rem;
    }
    .proto-widget.widget-lg { grid-column: span 2; }
    .proto-widget-header {
      font-size: 0.75rem;
      color: var(--proto-fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
    }
    .widget-metric-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--proto-accent);
    }
    .widget-metric-label {
      font-size: 0.75rem;
      color: var(--proto-fg-muted);
    }
    .widget-chart-placeholder {
      height: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 0.5rem;
    }
    .status-dot.green { background: var(--proto-accent); }
    .status-dot.red { background: #ff4444; }

    /* Placeholder */
    .proto-placeholder {
      color: var(--proto-fg-muted);
      font-size: 0.85rem;
      font-style: italic;
    }

    /* Footer */
    .proto-footer {
      text-align: center;
      padding: 1.5rem;
      color: var(--proto-fg-muted);
      font-size: 0.8rem;
    }

    .hidden { display: none; }

    /* Print */
    @media print {
      body { background: #fff; color: #000; }
      .proto-sidebar { display: none; }
      .proto-tabs { display: none; }
    }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`
  }

  // === Utility ===
  private esc(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
}
