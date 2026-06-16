#!/usr/bin/env node
/**
 * build-dashboard.mjs
 * Reads all output files and generates a self-contained interactive HTML dashboard.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'output');
const OUT_FILE = join(OUTPUT_DIR, 'dashboard.html');

function collectFiles(dir, prefix = '') {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'dashboard.html') continue;
    const full = join(dir, entry);
    const rel = prefix ? prefix + '/' + entry : entry;
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectFiles(full, rel));
    } else {
      results.push({
        name: entry, relPath: rel, fullPath: full, size: st.size,
        ext: extname(entry).toLowerCase(), module: prefix.split('/')[0] || 'root',
        mtime: st.mtime.toISOString(),
      });
    }
  }
  return results;
}

const files = collectFiles(OUTPUT_DIR);

function readFileData(f) {
  try {
    const ext = f.ext;
    if (ext === '.json') return { type: 'json', content: readFileSync(f.fullPath, 'utf-8') };
    if (ext === '.md') return { type: 'md', content: readFileSync(f.fullPath, 'utf-8') };
    if (ext === '.html' || ext === '.htm') return { type: 'html', content: readFileSync(f.fullPath, 'utf-8') };
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) {
      const buf = readFileSync(f.fullPath);
      const mime = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg';
      return { type: 'image', content: 'data:' + mime + ';base64,' + buf.toString('base64') };
    }
    return { type: 'text', content: readFileSync(f.fullPath, 'utf-8') };
  } catch { return null; }
}

const fileDataMap = {};
for (const f of files) { const d = readFileData(f); if (d) fileDataMap[f.relPath] = d; }

const moduleMeta = {
  EGFR: { icon: '🧬', label: 'EGFR 靶点分析', color: '#2563eb' },
  screening: { icon: '🔬', label: '可药性筛选', color: '#7c3aed' },
  research: { icon: '📊', label: '竞争情报', color: '#059669' },
  business: { icon: '📈', label: '商业里程碑', color: '#d97706' },
  test_phase1: { icon: '🧪', label: 'Phase 1 测试', color: '#dc2626' },
};

const today = new Date().toISOString().slice(0, 10);

// Read JS app and replace placeholders
let js = readFileSync(join(__dirname, 'dashboard-app.js'), 'utf-8');
js = js.replace('__FILE_DATA__', JSON.stringify(fileDataMap));
js = js.replace('__FILES__', JSON.stringify(files.map(f => ({
  name: f.name, relPath: f.relPath, size: f.size, ext: f.ext, module: f.module, mtime: f.mtime
}))));
js = js.replace('__MODULE_META__', JSON.stringify(moduleMeta));

const css = readFileSync(join(__dirname, 'dashboard-style.css'), 'utf-8');

const html = [
  '<!DOCTYPE html>',
  '<html lang="zh-CN">',
  '<head>',
  '<meta charset="UTF-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '<title>EGFR 靶点智能分析看板</title>',
  '<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></scr' + 'ipt>',
  '<script src="https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.min.js"></scr' + 'ipt>',
  '<script src="https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js"></scr' + 'ipt>',
  '<style>' + css + '</style>',
  '</head>',
  '<body>',
  '<div class="sidebar">',
  '  <div class="sidebar-header">',
  '    <h1>🧬 <span>EGFR 分析看板</span></h1>',
  '    <div class="subtitle">scale-engine v0.43.0 | ' + today + '</div>',
  '  </div>',
  '  <div id="file-list"></div>',
  '</div>',
  '<div class="main">',
  '  <div class="toolbar" id="toolbar" style="display:none;">',
  '    <span class="title" id="toolbar-title"></span>',
  '    <button class="btn" onclick="copyContent()" title="复制内容">📋 复制</button>',
  '    <button class="btn" onclick="downloadMD()" title="下载 Markdown">📝 MD</button>',
  '    <button class="btn" onclick="downloadDOCX()" title="下载 Word">📄 DOCX</button>',
  '    <button class="btn" onclick="downloadPPT()" title="下载 PPT">📊 PPT</button>',
  '    <button class="btn" onclick="downloadFile()" title="下载原始文件">⬇️ 原文件</button>',
  '    <button class="btn primary" onclick="printPreview()" title="打印">🖨️ 打印</button>',
  '  </div>',
  '  <div class="content-area" id="content-area">',
  '    <div class="welcome-card">',
  '      <h2>EGFR 靶点智能分析看板</h2>',
  '      <p>点击左侧文件查看预览。支持 JSON / Markdown / HTML / 图片预览，<br>可导出为 MD、DOCX、PPT 格式，支持打印和复制。</p>',
  '      <div class="stats-grid" id="stats-grid"></div>',
  '    </div>',
  '  </div>',
  '</div>',
  '<div class="toast" id="toast"></div>',
  '<scr' + 'ipt>' + js + '</scr' + 'ipt>',
  '</body>',
  '</html>',
].join('\n');

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, html, 'utf-8');
console.log('Dashboard: ' + OUT_FILE);
console.log(files.length + ' files, ' + Object.keys(moduleMeta).length + ' modules, ' + (Buffer.byteLength(html) / 1024).toFixed(0) + 'KB');
