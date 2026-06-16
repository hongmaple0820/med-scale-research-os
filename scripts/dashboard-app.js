// Dashboard application logic - embedded into HTML by build-dashboard.mjs
var FILE_DATA = __FILE_DATA__;
var FILES = __FILES__;
var MODULE_META = __MODULE_META__;
var currentFile = null;

function init() {
  buildSidebar();
  buildStats();
}

function buildSidebar() {
  var c = document.getElementById('file-list');
  var mods = {};
  FILES.forEach(function(f) {
    if (!mods[f.module]) mods[f.module] = [];
    mods[f.module].push(f);
  });
  var h = '';
  Object.keys(mods).forEach(function(mod) {
    var m = MODULE_META[mod] || { icon: ' ', label: mod };
    h += '<div class="module-group"><div class="module-label">' + m.icon + ' ' + m.label + '</div>';
    mods[mod].forEach(function(f) {
      var sz = f.size > 102400 ? (f.size / 1024).toFixed(0) + 'KB' : f.size > 1024 ? (f.size / 1024).toFixed(1) + 'KB' : f.size + 'B';
      h += '<div class="file-item" data-path="' + f.relPath + '" onclick="selectFile(this.getAttribute(&apos;data-path&apos;))">';
      h += '<span class="ext-badge">' + f.ext.replace('.', '') + '</span>';
      h += '<span>' + f.name + '</span>';
      h += '<span class="size-info">' + sz + '</span>';
      h += '</div>';
    });
    h += '</div>';
  });
  c.innerHTML = h;
}

function buildStats() {
  var g = document.getElementById('stats-grid');
  var ts = FILES.reduce(function(s, f) { return s + f.size; }, 0);
  var arr = [
    { n: FILES.length, l: '文件总数' },
    { n: Object.keys(MODULE_META).length, l: '分析模块' },
    { n: (ts / 1024).toFixed(0) + 'KB', l: '总数据量' },
    { n: '4', l: '已完成阶段' }
  ];
  g.innerHTML = arr.map(function(s) {
    return '<div class="stat-card"><div class="num">' + s.n + '</div><div class="label">' + s.l + '</div></div>';
  }).join('');
}

function selectFile(path) {
  currentFile = FILES.find(function(f) { return f.relPath === path; });
  if (!currentFile) return;
  document.querySelectorAll('.file-item').forEach(function(el) { el.classList.remove('active'); });
  var a = document.querySelector('.file-item[data-path="' + path + '"]');
  if (a) a.classList.add('active');
  document.getElementById('toolbar').style.display = 'flex';
  document.getElementById('toolbar-title').textContent = currentFile.name;
  renderPreview(path);
}

function renderPreview(path) {
  var area = document.getElementById('content-area');
  area.className = 'content-area';
  var data = FILE_DATA[path];
  if (!data) { area.innerHTML = '<p style="color:var(--fg3)">无法预览此文件</p>'; return; }
  if (data.type === 'json') renderJSON(area, data.content);
  else if (data.type === 'md') renderMD(area, data.content);
  else if (data.type === 'html') renderHTML(area, data.content);
  else if (data.type === 'image') renderImg(area, data.content);
  else renderTxt(area, data.content || '');
}

function renderJSON(area, c) {
  try {
    var o = JSON.parse(c);
    area.innerHTML = '<div class="preview-json"><pre>' + syntaxHL(JSON.stringify(o, null, 2)) + '</pre></div>';
  } catch (e) {
    area.innerHTML = '<div class="preview-text"><pre>' + esc(c) + '</pre></div>';
  }
}

function syntaxHL(j) {
  return j.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"([^"\\]|\\.)*"\s*:/g, function(m) { return '<span class="key">' + m + '</span>'; })
    .replace(/:"([^"\\]|\\.)*"/g, function(m) { var p = m.split(':'); return p[0] + ':<span class="string">' + p[1] + '</span>'; })
    .replace(/:\s*(\d+\.?\d*)/g, function(m) { var p = m.split(':'); return p[0] + ':<span class="number">' + p[1] + '</span>'; })
    .replace(/:\s*(true|false)/g, function(m) { var p = m.split(':'); return p[0] + ':<span class="bool">' + p[1] + '</span>'; })
    .replace(/:\s*null/g, function(m) { var p = m.split(':'); return p[0] + ':<span class="null">' + p[1] + '</span>'; });
}

function renderMD(area, c) {
  if (typeof marked !== 'undefined') {
    area.innerHTML = '<div class="preview-md">' + marked.parse(c) + '</div>';
  } else {
    area.innerHTML = '<div class="preview-text"><pre>' + esc(c) + '</pre></div>';
  }
}

function renderHTML(area, c) {
  area.innerHTML = '<iframe class="preview-html-frame" sandbox="allow-same-origin"></iframe>';
  var f = area.querySelector('iframe');
  var d = f.contentDocument || f.contentWindow.document;
  d.open(); d.write(c); d.close();
  setTimeout(function() { try { f.style.height = d.body.scrollHeight + 40 + 'px'; } catch (e) {} }, 300);
}

function renderImg(area, c) {
  area.innerHTML = '<div class="preview-image"><img src="' + c + '" alt="preview"></div>';
}

function renderTxt(area, c) {
  area.innerHTML = '<div class="preview-text"><pre>' + esc(c) + '</pre></div>';
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getMD() {
  if (!currentFile) return '';
  var d = FILE_DATA[currentFile.relPath];
  if (!d) return '';
  if (d.type === 'md') return d.content;
  if (d.type === 'json') {
    try { return '# ' + currentFile.name + '\n\n```json\n' + JSON.stringify(JSON.parse(d.content), null, 2) + '\n```'; }
    catch (e) { return d.content; }
  }
  if (d.type === 'html') return '# ' + currentFile.name + '\n\n' + d.content;
  if (d.type === 'image') return '# ' + currentFile.name + '\n\n![' + currentFile.name + '](' + currentFile.relPath + ')';
  return '# ' + currentFile.name + '\n\n' + (d.content || '');
}

function copyContent() {
  var md = getMD();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(md).then(function() { showToast('已复制到剪贴板'); });
  } else {
    var ta = document.createElement('textarea');
    ta.value = md; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    showToast('已复制到剪贴板');
  }
}

function downloadMD() {
  var md = getMD();
  dl(currentFile.name.replace(/\.[^.]+$/, '') + '.md', md, 'text/markdown');
  showToast('Markdown 已下载');
}

function downloadDOCX() {
  if (typeof docx === 'undefined') { showToast('DOCX 库未加载，请检查网络'); return; }
  var md = getMD();
  var pars = md.split('\n').map(function(line) {
    if (line.indexOf('# ') === 0) return new docx.Paragraph({ children: [new docx.TextRun({ text: line.slice(2), bold: true, size: 32 })], heading: docx.HeadingLevel.HEADING_1 });
    if (line.indexOf('## ') === 0) return new docx.Paragraph({ children: [new docx.TextRun({ text: line.slice(3), bold: true, size: 28 })], heading: docx.HeadingLevel.HEADING_2 });
    if (line.indexOf('### ') === 0) return new docx.Paragraph({ children: [new docx.TextRun({ text: line.slice(4), bold: true, size: 24 })], heading: docx.HeadingLevel.HEADING_3 });
    if (line.trim() === '') return new docx.Paragraph({ children: [] });
    return new docx.Paragraph({ children: [new docx.TextRun({ text: line, size: 22 })] });
  });
  var doc = new docx.Document({ sections: [{ children: pars }] });
  docx.Packer.toBlob(doc).then(function(blob) {
    var u = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = u; a.download = currentFile.name.replace(/\.[^.]+$/, '') + '.docx';
    a.click(); URL.revokeObjectURL(u);
    showToast('DOCX 已下载');
  });
}

function downloadPPT() {
  if (typeof PptxGenJS === 'undefined') { showToast('PPT 库未加载，请检查网络'); return; }
  var pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  var data = FILE_DATA[currentFile.relPath];
  var title = currentFile.name.replace(/\.[^.]+$/, '');
  var s1 = pptx.addSlide();
  s1.addText(title, { x: 0.5, y: 1.5, w: '90%', fontSize: 36, color: '3B82F6', bold: true });
  s1.addText('EGFR Target Intelligence Report', { x: 0.5, y: 2.5, w: '90%', fontSize: 18, color: '94A3B8' });
  s1.addText(new Date().toISOString().slice(0, 10), { x: 0.5, y: 3.5, w: '90%', fontSize: 14, color: '64748B' });
  if (data) {
    var content = '';
    if (data.type === 'json') { try { content = JSON.stringify(JSON.parse(data.content), null, 2); } catch (e) { content = data.content; } }
    else { content = data.content || ''; }
    var lines = content.split('\n'); var chunk = []; var sn = 1;
    lines.forEach(function(line) {
      chunk.push(line);
      if (chunk.length >= 25) {
        var s = pptx.addSlide();
        s.addText('Part ' + (++sn), { x: 0.5, y: 0.2, w: '90%', fontSize: 20, color: '3B82F6', bold: true });
        s.addText(chunk.join('\n'), { x: 0.5, y: 0.8, w: '90%', h: '85%', fontSize: 10, color: '334155', fontFace: 'Courier New', valign: 'top' });
        chunk = [];
      }
    });
    if (chunk.length > 0) {
      var s = pptx.addSlide();
      s.addText('Part ' + (++sn), { x: 0.5, y: 0.2, w: '90%', fontSize: 20, color: '3B82F6', bold: true });
      s.addText(chunk.join('\n'), { x: 0.5, y: 0.8, w: '90%', h: '85%', fontSize: 10, color: '334155', fontFace: 'Courier New', valign: 'top' });
    }
  }
  pptx.writeFile({ fileName: title + '.pptx' }).then(function() { showToast('PPT 已下载'); });
}

function downloadFile() {
  if (!currentFile) return;
  var d = FILE_DATA[currentFile.relPath];
  if (!d) return;
  if (d.type === 'image') {
    var a = document.createElement('a'); a.href = d.content; a.download = currentFile.name; a.click();
  } else {
    dl(currentFile.name, d.content || '', 'application/octet-stream');
  }
  showToast('文件已下载');
}

function dl(name, content, mime) {
  var b = new Blob([content], { type: mime });
  var u = URL.createObjectURL(b);
  var a = document.createElement('a');
  a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u);
}

function printPreview() { window.print(); }

function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2000);
}

init();
