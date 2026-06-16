var API = window.location.origin, currentModule = null;

async function init() {
  var r = await fetch(API + '/api/modules');
  var mods = await r.json();
  var sel = document.getElementById('module-select');
  sel.innerHTML = mods.map(function(m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
  if (mods.length > 0) selectModule(mods[0]);
}

async function selectModule(mod) {
  currentModule = mod;
  document.getElementById('content').innerHTML = '<div class="loading"><div class="spinner"></div>加载 ' + mod + ' 报告...</div>';
  var fr = await fetch(API + '/api/files/' + encodeURIComponent(mod));
  var fd = await fr.json();
  var files = (fd.files || []).sort(function(a, b) { return b.mtime.localeCompare(a.mtime); });
  var reports = files.filter(function(f) { return f.ext === '.md'; });
  var chinese = reports.filter(function(f) { return f.name.indexOf('chinese_report') === 0; });
  var mainReport = chinese[0] || reports[0];
  renderDownloads(mod, files);
  if (mainReport) {
    var rr = await fetch(API + '/api/file/' + encodeURIComponent(mod + '/' + mainReport.relPath));
    var rd = await rr.json();
    renderReport(mod, rd.content, mainReport, files);
  } else {
    document.getElementById('content').innerHTML = '<div class="report-header"><h1>' + mod + '</h1></div><p style="color:var(--fg3)">暂无报告文件</p>';
    document.getElementById('nav-toc').innerHTML = '';
  }
}

function renderReport(mod, md, file, files) {
  var lines = md.split('\n');
  var toc = [];
  lines.forEach(function(line) {
    var m = line.match(/^(#{1,3})\s+(.+)/);
    if (m) {
      var level = m[1].length;
      var text = m[2].replace(/[*_>/#]/g, '').trim();
      if (text) toc.push({ level: level, text: text });
    }
  });

  var navHtml = toc.map(function(t) {
    var indent = t.level > 1 ? 'style="padding-left:' + ((t.level - 1) * 12) + 'px;font-size:12px"' : '';
    var bold = t.level === 1 ? '<strong>' + t.text + '</strong>' : t.text;
    return '<a class="nav-item" ' + indent + ' href="#' + encodeURIComponent(t.text) + '" onclick="scrollToH(this);return false">' + bold + '</a>';
  }).join('');
  document.getElementById('nav-toc').innerHTML = navHtml;

  var html = renderMD(md, mod);

  var date = new Date(file.mtime).toLocaleString('zh-CN');
  var size = file.size > 1024 ? (file.size / 1024).toFixed(0) + 'KB' : file.size + 'B';
  var header = '<div class="report-header"><h1>' + mod + ' 靶点分析报告</h1><div class="meta">' + file.name + ' · ' + date + ' · ' + size + '</div></div>';

  var pptx = files.filter(function(f) { return f.isPptx; });
  var dlBar = '<div class="download-bar">';
  if (pptx.length > 0) dlBar += '<a class="dl-btn primary" href="' + API + '/api/file/' + encodeURIComponent(mod + '/' + pptx[0].relPath) + '" download>下载 PPT</a>';
  dlBar += '</div>';

  document.getElementById('content').innerHTML = header + dlBar + '<div class="md-content">' + html + '</div>';
}

function renderMD(md, mod) {
  var h = md;

  // Image paths
  h = h.replace(/!\[([^\]]*)\]\(skills\/target-intelligence\/output\/([^/]+)\/([^)]+)\)/g,
    function(all, alt, m, img) { return '<img src="' + API + '/api/file/' + encodeURIComponent(m + '/' + img) + '" alt="' + alt + '">'; });
  h = h.replace(/!\[([^\]]*)\]\((?!http)([^)]+\.png)\)/g,
    function(all, alt, img) { return '<img src="' + API + '/api/file/' + encodeURIComponent(mod + '/' + img) + '" alt="' + alt + '">'; });

  // Headers with IDs
  h = h.replace(/^### (.+)$/gm, function(all, t) {
    var id = t.replace(/[*_>/#]/g, '').trim();
    return '<h3 id="' + encodeURIComponent(id) + '">' + t + '</h3>';
  });
  h = h.replace(/^## (.+)$/gm, function(all, t) {
    var id = t.replace(/[*_>/#]/g, '').trim();
    return '<h2 id="' + encodeURIComponent(id) + '">' + t + '</h2>';
  });
  h = h.replace(/^# (.+)$/gm, function(all, t) {
    var id = t.replace(/[*_>/#]/g, '').trim();
    return '<h1 id="' + encodeURIComponent(id) + '">' + t + '</h1>';
  });

  // Bold and italic
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Blockquote
  h = h.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // HR
  h = h.replace(/^---$/gm, '<hr>');

  // Unordered list
  h = h.replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, function(x) { return '<ul>' + x + '</ul>'; });

  // Ordered list
  h = h.replace(/^\d+\.\s+(.+)$/gm, '<oli>$1</oli>');
  h = h.replace(/(<oli>[\s\S]*?<\/oli>\n?)+/g, function(x) {
    return '<ol>' + x.replace(/<\/?oli>/g, function(t) { return t.replace('oli', 'li'); }) + '</ol>';
  });

  // Tables
  h = h.replace(/^(\|.+)\|$/gm, '<trow>$1</trow>');
  h = h.replace(/(<trow>[\s\S]*?<\/trow>\n?)+/g, function(block) {
    var rows = block.match(/<trow>[\s\S]*?<\/trow>/g) || [];
    if (rows.length < 2) return block.replace(/<\/?trow>/g, '');
    var table = '<table>';
    var isFirst = true;
    rows.forEach(function(row) {
      var content = row.replace(/<\/?trow>/g, '');
      var cells = content.split('|').map(function(c) { return c.trim(); }).filter(function(c) { return c.length > 0; });
      if (cells.every(function(c) { return /^[-:]+$/.test(c); })) return;
      var tag = isFirst ? 'th' : 'td';
      isFirst = false;
      table += '<tr>' + cells.map(function(c) { return '<' + tag + '>' + c + '</' + tag + '>'; }).join('') + '</tr>';
    });
    return table + '</table>';
  });

  // Paragraphs
  h = h.replace(/^(?!<[a-z/])(.+)$/gm, '<p>$1</p>');
  h = h.replace(/<p>\s*<\/p>/g, '');

  return h;
}

function renderDownloads(mod, files) {
  var pptx = files.filter(function(f) { return f.isPptx; });
  var html = '';
  pptx.forEach(function(f) {
    var size = f.size > 1024 * 1024 ? (f.size / 1024 / 1024).toFixed(1) + 'MB' : (f.size / 1024).toFixed(0) + 'KB';
    html += '<a class="nav-item" href="' + API + '/api/file/' + encodeURIComponent(mod + '/' + f.relPath) + '" download>下载 PPT (' + size + ')</a>';
  });
  document.getElementById('nav-downloads').innerHTML = html;
}

function scrollToH(el) {
  var id = decodeURIComponent(el.getAttribute('href').substring(1));
  var headings = document.querySelectorAll('.md-content h1, .md-content h2, .md-content h3');
  for (var i = 0; i < headings.length; i++) {
    var text = headings[i].textContent.replace(/[*_>/#]/g, '').trim();
    if (text === id) {
      headings[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  }
}

init();
