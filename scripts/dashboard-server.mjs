#!/usr/bin/env node
import { createServer } from 'http';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'skills', 'target-intelligence', 'output');
const VUE_DIST = join(ROOT, 'dashboard', 'dist');
const PORT = process.env.PORT || 3457;

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function listModules() {
  if (!existsSync(OUTPUT_DIR)) return [];
  return readdirSync(OUTPUT_DIR).filter(d => statSync(join(OUTPUT_DIR, d)).isDirectory());
}

function listFiles(dir, prefix = '') {
  const r = []; if (!existsSync(dir)) return r;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e), rel = prefix ? prefix + '/' + e : e, st = statSync(full);
    if (st.isDirectory()) r.push(...listFiles(full, rel));
    else r.push({ name: e, relPath: rel, size: st.size, ext: extname(e).toLowerCase(), mtime: st.mtime.toISOString() });
  }
  return r;
}

function readJSON(fp) { try { return JSON.parse(readFileSync(fp, 'utf-8')); } catch { return null; } }

// Normalize the two provenance shapes used across the pipeline into one shape
// the dashboard can render: { sources:[{name,url,confidence,timestamp,status}], warnings, generated_at }.
function normProvenance(p) {
  if (!p || typeof p !== 'object') return null;
  if (Array.isArray(p.sources) && p.sources.length) {
    return {
      sources: p.sources.map(s => ({
        name: s.database || s.source || 'unknown',
        url: s.url || s.api_url || null,
        confidence: s.confidence || null,
        timestamp: s.timestamp || null,
        status: s.status || 'ok',
      })),
      warnings: p.warnings || [],
      generated_at: p.generated_at || null,
    };
  }
  if (p.source || p.api_url) {
    return {
      sources: [{ name: p.source || 'unknown', url: p.api_url || null, confidence: p.confidence || null, timestamp: p.timestamp || null, status: p.status || 'ok' }],
      warnings: [],
      generated_at: p.timestamp || null,
    };
  }
  return null;
}

function getModuleOverview(module) {
  const dir = join(OUTPUT_DIR, module);
  const ov = { module, files: [], sections: {}, dataSources: [] };
  const jf = listFiles(dir).filter(f => f.ext === '.json');
  ov.files = jf.map(f => f.name);
  const _seenSrc = new Set();
  for (const f of jf) {
    const data = readJSON(join(dir, f.relPath)); if (!data) continue;
    const fileProv = normProvenance(data.provenance);
    if (fileProv) for (const s of fileProv.sources) { const k = s.name + '|' + (s.url || ''); if (!_seenSrc.has(k)) { _seenSrc.add(k); ov.dataSources.push(s); } }
    if (data.expression_by_tissue) {
      ov.sections.expression = {
        tissues: Object.entries(data.expression_by_tissue).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t, v]) => ({ tissue: t, tpm: Math.round(v * 100) / 100 })),
        tau_index: data.summary_stats?.tau_index, specificity: data.summary_stats?.specificity_level,
        total_tissues: Object.keys(data.expression_by_tissue).length,
        provenance: fileProv,
      };
    }
    if (data.survival_stats) {
      const ss = data.survival_stats;
      ov.sections.survival = {
        hazard_ratio: ss.cox_regression?.hazard_ratio, hr_ci_lower: ss.cox_regression?.hr_ci_lower,
        hr_ci_upper: ss.cox_regression?.hr_ci_upper, cox_pvalue: ss.cox_regression?.cox_pvalue,
        logrank_pvalue: ss.logrank_pvalue, median_high: ss.median_survival_high_months,
        median_low: ss.median_survival_low_months, n_high: ss.n_high, n_low: ss.n_low,
        events_high: ss.events_high, events_low: ss.events_low, km_high: ss.km_curve_high, km_low: ss.km_curve_low,
        provenance: fileProv,
      };
    }
    if (data.immune_correlations) {
      ov.sections.immune = {
        n_samples: data.n_samples_analyzed, method: data.method,
        cells: Object.entries(data.immune_correlations).map(([c, v]) => ({ cell: c, r: Math.round(v.r * 1000) / 1000, pvalue: v.pvalue, adj_pvalue: v.adj_pvalue, significant: v.significant })),
        provenance: fileProv,
      };
    }
    if (data.competition) {
      const comp = data.competition;
      ov.sections.competitive = {
        total_trials: comp.total_trials,
        approved_drugs: (comp.approved_drugs || []).map(d => ({ name: d.name, mechanism: d.mechanism })),
        key_mechanisms: comp.key_mechanisms || [], phase_distribution: comp.phase_distribution || {},
        provenance: fileProv,
      };
    }
    if (data.patent_trends) ov.sections.patents = { total: data.patent_trends.total_patents, top_assignees: data.patent_trends.top_assignees || {}, provenance: fileProv };
    if (data.protein_info) {
      ov.sections.protein = {
        name: data.protein_info.protein_name, accession: data.protein_info.accession,
        subcellular_location: data.protein_info.subcellular_location,
        interactions: (data.interactions || []).slice(0, 10).map(i => ({ partner: i.partner, score: i.score })),
        provenance: fileProv,
      };
    }
    if (data.milestones) {
      const phases = data.milestones.map(m => ({ name: m.phase || m.name, start: m.start_date || m.start, end: m.end_date || m.end, duration_months: m.duration_months }));
      const total = typeof data.total_timeline_months === 'number' ? data.total_timeline_months : phases.reduce((s, p) => s + (p.duration_months || 0), 0);
      ov.sections.milestones = { modality: data.modality, total_months: total, phases, risks: data.risks || [], adjustments: data.adjustments || [], provenance: fileProv };
    }
    if (data.phenotype && data.immune_cells) {
      ov.sections.tme = {
        phenotype: data.phenotype, phenotype_info: data.phenotype_info, immune_score: data.immune_score,
        stromal_score: data.stromal_score, immune_cells: data.immune_cells,
        immunotherapy_prediction: data.immunotherapy_prediction,
        provenance: fileProv,
      };
    }
    if (data.overall_grade && data.paths) {
      ov.sections.research_profile = {
        overall_grade_info: data.overall_grade_info, confidence_score: data.confidence_score,
        paths: Object.entries(data.paths).map(([pid, p]) => ({ id: pid, name: p.name, best_grade: p.best_grade, evidence_count: p.evidence_count, summary: p.summary })),
        provenance: fileProv,
      };
    }
  }
  return ov;
}

function serveVueApp(req, res) {
  const indexPath = join(VUE_DIST, 'index.html');
  if (!existsSync(indexPath)) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Vue app not built. Run: cd dashboard && pnpm build'); return; }
  const html = readFileSync(indexPath, 'utf-8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function serveStaticFile(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const filePath = join(VUE_DIST, url.pathname);
  if (!existsSync(filePath)) return false;
  const ext = extname(filePath).toLowerCase();
  const mimeMap = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };
  const mime = mimeMap[ext] || 'application/octet-stream';
  const content = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': content.length, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000' });
  res.end(content);
  return true;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (pathname === '/' || pathname === '/index.html') { serveVueApp(req, res); }
  else if (pathname === '/api/modules') { json(res, listModules()); }
  else if (pathname.startsWith('/api/overview/')) {
    const mod = decodeURIComponent(pathname.slice('/api/overview/'.length));
    if (!existsSync(join(OUTPUT_DIR, mod))) { json(res, { error: 'Module not found' }, 404); return; }
    json(res, getModuleOverview(mod));
  }
  else if (pathname.startsWith('/api/file/')) {
    const fp = decodeURIComponent(pathname.slice('/api/file/'.length));
    const full = join(OUTPUT_DIR, fp);
    if (!existsSync(full)) { json(res, { error: 'File not found' }, 404); return; }
    const ext = extname(full).toLowerCase();
    try {
      if (['.png', '.jpg', '.jpeg', '.svg'].includes(ext)) {
        const buf = readFileSync(full);
        const mime = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg';
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=3600' });
        res.end(buf);
      } else if (ext === '.pptx') {
        const buf = readFileSync(full);
        res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'Content-Disposition': 'attachment; filename="' + basename(full) + '"', 'Content-Length': buf.length });
        res.end(buf);
      } else {
        let content = readFileSync(full, 'utf-8');
        if (ext === '.md') content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        json(res, { type: ext === '.json' ? 'json' : ext === '.md' ? 'md' : 'text', content });
      }
    } catch (e) { json(res, { error: e.message }, 500); }
  } else if (pathname.startsWith('/api/files/')) {
    const mod = decodeURIComponent(pathname.slice('/api/files/'.length));
    const dir = join(OUTPUT_DIR, mod);
    if (!existsSync(dir)) { json(res, { error: 'Module not found' }, 404); return; }
    json(res, { module: mod, files: listFiles(dir).map(f => ({ name: f.name, relPath: f.relPath, size: f.size, ext: f.ext, mtime: f.mtime, isPptx: f.ext === '.pptx', isImage: ['.png','.jpg','.jpeg','.svg'].includes(f.ext), isData: ['.json','.csv'].includes(f.ext), isReport: ['.md','.html','.pdf'].includes(f.ext) })) });
  } else if (serveStaticFile(req, res)) { /* served */ }
  else { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not Found'); }
});

server.listen(PORT, () => { console.log(`靶点智能分析平台 running at http://localhost:${PORT}`); });
