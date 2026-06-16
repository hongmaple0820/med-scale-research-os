"""
Structured report generator for target intelligence.
Produces JSON, Markdown, and interactive HTML reports.

Features:
- Chinese language support (default)
- Medical report compliance (disclaimer, version, references)
- Interactive HTML dashboard with ECharts + DataTables + Bootstrap 5
- PDF/DOCX export via weasyprint + python-docx
"""

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class ReportSection:
    """A single section in the report."""
    title: str
    content: str = ""
    data: Dict[str, Any] = field(default_factory=dict)
    figures: List[str] = field(default_factory=list)
    tables: List[Dict[str, Any]] = field(default_factory=list)
    subsections: List["ReportSection"] = field(default_factory=list)
    provenance: Optional[Dict[str, Any]] = field(default_factory=dict)


@dataclass
class TargetReport:
    """Complete target intelligence report."""
    target_gene: str
    phase: str
    generated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    sections: List[ReportSection] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    language: str = "zh"  # zh or en

    def add_section(self, title: str, **kwargs) -> ReportSection:
        section = ReportSection(title=title, **kwargs)
        self.sections.append(section)
        return section

    def to_dict(self) -> Dict:
        return asdict(self)

    def to_json(self, path: Optional[Path] = None) -> str:
        text = json.dumps(self.to_dict(), indent=2, ensure_ascii=False)
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        return text

    def to_markdown(self, path: Optional[Path] = None) -> str:
        lines = [
            f"# 靶点情报报告: {self.target_gene}",
            f"",
            f"**阶段:** {self.phase}",
            f"**生成时间:** {self.generated_at}",
            f"**免责声明:** 本报告由 AI 系统自动生成，仅供参考，不构成临床建议或投资建议。",
            f"",
        ]

        if self.warnings:
            lines.append("## 警告")
            for w in self.warnings:
                lines.append(f"- {w}")
            lines.append("")

        for section in self.sections:
            lines.append(f"## {section.title}")
            if section.content:
                lines.append(section.content)
                lines.append("")
            if section.tables:
                for table in section.tables:
                    headers = table.get("headers", [])
                    rows = table.get("rows", [])
                    if headers:
                        lines.append("| " + " | ".join(str(h) for h in headers) + " |")
                        lines.append("| " + " | ".join("---" for _ in headers) + " |")
                    for row in rows:
                        lines.append("| " + " | ".join(str(c) for c in row) + " |")
                    lines.append("")
            if section.figures:
                for fig in section.figures:
                    lines.append(f"![{section.title}]({fig})")
                    lines.append("")

        lines.append("---")
        lines.append(f"*报告版本: v2.0 | 生成引擎: Target Intelligence*")

        text = "\n".join(lines)
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        return text

    def _generate_provenance_html(self) -> str:
        """Generate Data Provenance section HTML from section provenance fields.

        Scans all sections for ``provenance`` dicts and renders an HTML table
        listing each data source, its API endpoint, query time, and confidence
        level.  Returns empty string when no provenance data is present.

        Expected provenance dict shape per section::

            {
                "source": "GTEx Portal v2",
                "api_endpoint": "https://gtexportal.org/api/v2/expression/geneExpression",
                "query_time": "2026-06-05T10:30:00",
                "confidence": "HIGH",          # HIGH | MEDIUM | LOW
                "url": "https://gtexportal.org"  # optional clickable link
            }
        """
        provenance_items = []
        for section in self.sections:
            prov = section.provenance
            if prov and isinstance(prov, dict) and prov.get("source"):
                provenance_items.append(prov)

        if not provenance_items:
            return ""

        confidence_class = {
            "HIGH": "confidence-high",
            "MEDIUM": "confidence-medium",
            "LOW": "confidence-low",
        }

        rows = []
        for item in provenance_items:
            source = item.get("source", "Unknown")
            url = item.get("url", "")
            source_cell = f'<a href="{url}" target="_blank">{source}</a>' if url else source
            endpoint = item.get("api_endpoint", "N/A")
            endpoint_cell = f'<code>{endpoint}</code>' if endpoint != "N/A" else endpoint
            query_time = item.get("query_time", "N/A")
            confidence = item.get("confidence", "MEDIUM")
            conf_cls = confidence_class.get(confidence, "confidence-medium")
            rows.append(
                f"<tr>"
                f"<td>{source_cell}</td>"
                f"<td>{endpoint_cell}</td>"
                f"<td>{query_time}</td>"
                f'<td><span class="{conf_cls}">{confidence}</span></td>'
                f"</tr>"
            )

        return f"""
<div class="provenance">
<h3>数据溯源 (Data Provenance)</h3>
<p>以下列出本报告中使用的所有数据来源及其溯源信息，确保结果可追溯、可验证。</p>
<table>
<tr><th>数据来源</th><th>API 端点</th><th>查询时间</th><th>置信度</th></tr>
{"".join(rows)}
</table>
</div>"""

    def to_html(self, path: Optional[Path] = None) -> str:
        """Generate a styled HTML report with medical compliance elements."""
        disclaimer = (
            "本报告由 AI 系统自动生成，仅供科研参考，不构成临床诊断或治疗建议。"
            "数据来源包括公共数据库（GTEx、cBioPortal、Open Targets、ChEMBL 等），"
            "准确性受数据源质量约束。使用前请核实关键数据。"
        )

        html_parts = [f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>靶点情报报告: {self.target_gene}</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; background: #f8fafc; color: #1e293b; line-height: 1.6; }}
h1 {{ color: #1e40af; border-bottom: 3px solid #2563eb; padding-bottom: 10px; }}
h2 {{ color: #1e40af; margin-top: 30px; border-left: 4px solid #2563eb; padding-left: 10px; }}
.meta {{ background: #eff6ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; }}
.disclaimer {{ background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 15px; margin: 15px 0; border-radius: 0 4px 4px 0; font-size: 0.9em; color: #92400e; }}
.warning {{ background: #fee2e2; border-left: 4px solid #ef4444; padding: 10px 15px; margin: 10px 0; border-radius: 0 4px 4px 0; }}
.success {{ background: #dcfce7; border-left: 4px solid #22c55e; padding: 10px 15px; margin: 10px 0; border-radius: 0 4px 4px 0; }}
table {{ border-collapse: collapse; width: 100%; margin: 15px 0; }}
th, td {{ border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }}
th {{ background: #2563eb; color: white; }}
tr:nth-child(even) {{ background: #f3f4f6; }}
tr:hover {{ background: #e0e7ff; }}
img {{ max-width: 100%; height: auto; margin: 15px 0; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
.source {{ font-size: 0.85em; color: #6b7280; font-style: italic; }}
.kpi {{ display: inline-block; background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 20px; margin: 5px; text-align: center; }}
.kpi-value {{ font-size: 1.5em; font-weight: bold; color: #1e40af; }}
.kpi-label {{ font-size: 0.85em; color: #6b7280; }}
.footer {{ margin-top: 40px; padding-top: 20px; border-top: 1px solid #d1d5db; font-size: 0.85em; color: #6b7280; }}
.provenance {{ margin-top: 30px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; }}
.provenance h3 {{ color: #0369a1; margin-top: 0; }}
.provenance table {{ font-size: 0.9em; }}
.provenance a {{ color: #2563eb; text-decoration: none; }}
.provenance a:hover {{ text-decoration: underline; }}
.confidence-high {{ color: #15803d; font-weight: bold; }}
.confidence-medium {{ color: #a16207; font-weight: bold; }}
.confidence-low {{ color: #dc2626; font-weight: bold; }}
</style>
</head>
<body>
<h1>靶点情报报告: {self.target_gene}</h1>
<div class="meta">
<strong>阶段:</strong> {self.phase} | <strong>生成时间:</strong> {self.generated_at} | <strong>版本:</strong> v2.0
</div>
<div class="disclaimer">
<strong>免责声明:</strong> {disclaimer}
</div>
"""]

        if self.warnings:
            html_parts.append("<h2>警告</h2>")
            for w in self.warnings:
                html_parts.append(f'<div class="warning">{w}</div>')

        for section in self.sections:
            html_parts.append(f"<h2>{section.title}</h2>")
            if section.content:
                html_parts.append(f"<p>{section.content}</p>")
            if section.tables:
                for table in section.tables:
                    headers = table.get("headers", [])
                    rows = table.get("rows", [])
                    html_parts.append("<table>")
                    if headers:
                        html_parts.append("<tr>" + "".join(f"<th>{h}</th>" for h in headers) + "</tr>")
                    for row in rows:
                        html_parts.append("<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>")
                    html_parts.append("</table>")
            if section.figures:
                for fig in section.figures:
                    fig_html = fig.replace("\\", "/") if fig else ""
                    html_parts.append(f'<img src="{fig_html}" alt="{section.title}">')

        provenance_html = self._generate_provenance_html()
        if provenance_html:
            html_parts.append(provenance_html)

        html_parts.append(f"""
<div class="footer">
<p>报告版本: v2.0 | 生成引擎: Target Intelligence | 数据来源: GTEx, cBioPortal, Open Targets, ChEMBL, ClinicalTrials.gov, UniProt, STRING</p>
<p>生成时间: {self.generated_at}</p>
</div>
</body></html>""")
        html_text = "\n".join(html_parts)

        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(html_text, encoding="utf-8")
        return html_text

    def to_interactive_html(self, path: Optional[Path] = None) -> str:
        """Generate an interactive HTML dashboard with ECharts + DataTables + Bootstrap 5.

        Features:
        - Tab navigation across report sections
        - ECharts for expression bar chart, survival KM curve, immune heatmap
        - DataTables for sortable/filterable tables
        - Export buttons (PDF, DOCX, CSV)
        - Responsive Bootstrap 5 layout
        """
        disclaimer = (
            "本报告由 AI 系统自动生成，仅供科研参考，不构成临床诊断或治疗建议。"
            "数据来源包括公共数据库（GTEx、cBioPortal、Open Targets、ChEMBL 等），"
            "准确性受数据源质量约束。使用前请核实关键数据。"
        )

        # Extract chart data from sections
        expression_data = self._extract_expression_data()
        survival_data = self._extract_survival_data()
        immune_data = self._extract_immune_data()

        # Build tab navigation
        tab_nav = []
        tab_content = []
        for i, section in enumerate(self.sections):
            active = "active" if i == 0 else ""
            selected = "true" if i == 0 else "false"
            tab_id = f"section-{i}"
            tab_nav.append(
                f'<li class="nav-item">'
                f'<a class="nav-link {active}" id="tab-{tab_id}" data-bs-toggle="tab" '
                f'href="#{tab_id}" role="tab" aria-controls="{tab_id}" '
                f'aria-selected="{selected}">{section.title}</a></li>'
            )
            tab_content.append(self._render_section_html(section, tab_id, active, i))

        # Build KPI summary cards
        kpi_html = self._build_kpi_cards()

        # Build warnings HTML
        warnings_html = ""
        if self.warnings:
            warnings_items = "".join(f'<div class="alert alert-danger">{w}</div>' for w in self.warnings)
            warnings_html = f'<div class="mb-3">{warnings_items}</div>'

        # Serialize chart data for JavaScript
        expr_json = json.dumps(expression_data, ensure_ascii=False)
        survival_json = json.dumps(survival_data, ensure_ascii=False)
        immune_json = json.dumps(immune_data, ensure_ascii=False)

        html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>靶点情报报告: {self.target_gene}</title>
<!-- Bootstrap 5 -->
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<!-- DataTables -->
<link href="https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css" rel="stylesheet">
<link href="https://cdn.datatables.net/buttons/2.4.2/css/buttons.bootstrap5.min.css" rel="stylesheet">
<style>
body {{ background: #f0f2f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }}
.report-header {{ background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 2rem 0; margin-bottom: 1.5rem; }}
.report-header h1 {{ margin: 0; font-size: 1.8rem; }}
.report-header .meta {{ opacity: 0.9; font-size: 0.95rem; }}
.disclaimer {{ background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; margin-bottom: 1.5rem; border-radius: 0 6px 6px 0; font-size: 0.9em; color: #92400e; }}
.kpi-card {{ background: white; border-radius: 10px; padding: 1.2rem; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.08); transition: transform 0.2s; }}
.kpi-card:hover {{ transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.12); }}
.kpi-value {{ font-size: 1.8rem; font-weight: 700; color: #1e40af; }}
.kpi-label {{ font-size: 0.85rem; color: #6b7280; margin-top: 4px; }}
.chart-container {{ background: white; border-radius: 10px; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 1.5rem; }}
.chart-title {{ font-size: 1rem; font-weight: 600; color: #1e293b; margin-bottom: 0.5rem; padding-bottom: 0.5rem; border-bottom: 1px solid #e5e7eb; }}
.section-card {{ background: white; border-radius: 10px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 1.5rem; }}
.section-card h3 {{ color: #1e40af; font-size: 1.2rem; margin-bottom: 1rem; }}
.nav-tabs .nav-link {{ color: #4b5563; font-weight: 500; }}
.nav-tabs .nav-link.active {{ color: #1e40af; font-weight: 600; border-bottom-color: #1e40af; }}
.table th {{ background: #1e40af; color: white; white-space: nowrap; }}
.table td {{ vertical-align: middle; }}
.footer {{ background: white; border-top: 1px solid #e5e7eb; padding: 1.5rem 0; margin-top: 2rem; font-size: 0.85em; color: #6b7280; }}
.export-btns {{ margin-bottom: 1rem; }}
@media print {{
  .nav-tabs, .export-btns, .dt-buttons {{ display: none !important; }}
  .tab-pane {{ display: block !important; opacity: 1 !important; }}
  .section-card {{ break-inside: avoid; }}
}}
</style>
</head>
<body>

<div class="report-header">
  <div class="container">
    <div class="d-flex justify-content-between align-items-center">
      <div>
        <h1>靶点情报报告: {self.target_gene}</h1>
        <div class="meta">{self.phase} | 生成时间: {self.generated_at} | v2.0</div>
      </div>
      <div class="export-btns">
        <button class="btn btn-light btn-sm" onclick="window.print()">
          <i class="bi bi-printer"></i> 打印/PDF
        </button>
        <button class="btn btn-light btn-sm ms-1" onclick="exportCSV()">
          <i class="bi bi-download"></i> 导出CSV
        </button>
      </div>
    </div>
  </div>
</div>

<div class="container">
  <div class="disclaimer">
    <strong>免责声明:</strong> {disclaimer}
  </div>

  {warnings_html}
  {kpi_html}

  <!-- Tab Navigation -->
  <ul class="nav nav-tabs mb-3" id="reportTabs" role="tablist">
    {"".join(tab_nav)}
  </ul>

  <!-- Tab Content -->
  <div class="tab-content" id="reportTabContent">
    {"".join(tab_content)}
  </div>
</div>

<div class="footer">
  <div class="container">
    <div class="row">
      <div class="col-md-6">
        报告版本: v2.0 | 生成引擎: Target Intelligence
      </div>
      <div class="col-md-6 text-end">
        数据来源: GTEx, cBioPortal, Open Targets, ChEMBL, ClinicalTrials.gov, UniProt, STRING
      </div>
    </div>
  </div>
</div>

<!-- Bootstrap 5 JS -->
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<!-- jQuery + DataTables -->
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
<script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
<script src="https://cdn.datatables.net/buttons/2.4.2/js/dataTables.buttons.min.js"></script>
<script src="https://cdn.datatables.net/buttons/2.4.2/js/buttons.bootstrap5.min.js"></script>
<script src="https://cdn.datatables.net/buttons/2.4.2/js/buttons.html5.min.js"></script>
<script src="https://cdn.datatables.net/buttons/2.4.2/js/buttons.print.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<!-- ECharts -->
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>

<script>
// Initialize DataTables
$(document).ready(function() {{
  $('table.data-table').DataTable({{
    pageLength: 25,
    order: [],
    dom: 'Bfrtip',
    buttons: [
      {{ extend: 'csv', text: '导出CSV', className: 'btn btn-sm btn-outline-primary' }},
      {{ extend: 'print', text: '打印', className: 'btn btn-sm btn-outline-secondary' }}
    ],
    language: {{
      search: '搜索:',
      lengthMenu: '每页显示 _MENU_ 条',
      info: '显示 _START_ 至 _END_ 共 _TOTAL_ 条',
      paginate: {{ first: '首页', last: '末页', previous: '上一页', next: '下一页' }},
      emptyTable: '暂无数据',
      zeroRecords: '未找到匹配记录'
    }}
  }});
}});

// Export all tables to CSV
function exportCSV() {{
  var csv = '';
  document.querySelectorAll('table.data-table').forEach(function(table) {{
    var rows = [];
    table.querySelectorAll('tr').forEach(function(tr) {{
      var cols = [];
      tr.querySelectorAll('th, td').forEach(function(cell) {{
        cols.push('"' + cell.textContent.replace(/"/g, '""') + '"');
      }});
      rows.push(cols.join(','));
    }});
    csv += rows.join('\\n') + '\\n\\n';
  }});
  var blob = new Blob(['\\uFEFF' + csv], {{ type: 'text/csv;charset=utf-8;' }});
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = '{self.target_gene}_report.csv';
  link.click();
}}

// ECharts: Expression Bar Chart
var exprData = {expr_json};
if (exprData && exprData.length > 0) {{
  var exprChart = echarts.init(document.getElementById('chart-expression'));
  if (exprChart) {{
    var sortedData = exprData.sort(function(a, b) {{ return b.value - a.value; }});
    var topData = sortedData.slice(0, 20);
    exprChart.setOption({{
      tooltip: {{ trigger: 'axis', axisPointer: {{ type: 'shadow' }} }},
      grid: {{ left: '25%', right: '4%', bottom: '3%' }},
      xAxis: {{ type: 'value', name: 'TPM' }},
      yAxis: {{
        type: 'category',
        data: topData.map(function(d) {{ return d.name; }}).reverse(),
        axisLabel: {{ fontSize: 11 }}
      }},
      series: [{{
        type: 'bar',
        data: topData.map(function(d) {{ return d.value; }}).reverse(),
        itemStyle: {{
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            {{ offset: 0, color: '#3b82f6' }},
            {{ offset: 1, color: '#1e40af' }}
          ])
        }},
        label: {{ show: true, position: 'right', formatter: '{{c}}', fontSize: 11 }}
      }}]
    }});
    window.addEventListener('resize', function() {{ exprChart.resize(); }});
  }}
}}

// ECharts: Survival KM Curve
var survivalData = {survival_json};
if (survivalData && survivalData.times && survivalData.times.length > 0) {{
  var survChart = echarts.init(document.getElementById('chart-survival'));
  if (survChart) {{
    survChart.setOption({{
      tooltip: {{ trigger: 'axis', formatter: function(params) {{
        var t = params[0].axisValue;
        var s = (params[0].data * 100).toFixed(1);
        return '时间: ' + t + ' 月<br>生存率: ' + s + '%';
      }} }},
      grid: {{ left: '10%', right: '4%', bottom: '12%', top: '10%' }},
      xAxis: {{ type: 'category', data: survivalData.times, name: '时间 (月)', nameLocation: 'center', nameGap: 30 }},
      yAxis: {{ type: 'value', name: '生存率', min: 0, max: 1, axisLabel: {{ formatter: function(v) {{ return (v*100) + '%'; }} }} }},
      series: [{{
        type: 'line',
        data: survivalData.survival,
        step: 'end',
        lineStyle: {{ color: '#ef4444', width: 2 }},
        areaStyle: {{ color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          {{ offset: 0, color: 'rgba(239,68,68,0.3)' }},
          {{ offset: 1, color: 'rgba(239,68,68,0.02)' }}
        ]) }},
        symbol: 'none'
      }}]
    }});
    window.addEventListener('resize', function() {{ survChart.resize(); }});
  }}
}}

// ECharts: Immune Correlation Heatmap
var immuneData = {immune_json};
if (immuneData && immuneData.length > 0) {{
  var immuneChart = echarts.init(document.getElementById('chart-immune'));
  if (immuneChart) {{
    var cellTypes = immuneData.map(function(d) {{ return d.cell; }});
    var corrValues = immuneData.map(function(d, i) {{ return [0, i, d.correlation]; }});
    immuneChart.setOption({{
      tooltip: {{ formatter: function(p) {{ return cellTypes[p.data[1]] + ': r=' + p.data[2].toFixed(3); }} }},
      grid: {{ left: '20%', right: '15%', bottom: '10%', top: '5%' }},
      xAxis: {{ type: 'category', data: ['相关系数'], splitArea: {{ show: true }} }},
      yAxis: {{ type: 'category', data: cellTypes, axisLabel: {{ fontSize: 11 }} }},
      visualMap: {{
        min: -1, max: 1, calculable: true, orient: 'vertical', right: '2%', top: 'center',
        inRange: {{ color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#fee090', '#fdae61', '#f46d43', '#d73027'] }},
        textStyle: {{ fontSize: 11 }}
      }},
      series: [{{
        type: 'heatmap',
        data: corrValues,
        label: {{ show: true, formatter: function(p) {{ return p.data[2].toFixed(2); }}, fontSize: 10 }},
        emphasis: {{ itemStyle: {{ shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' }} }}
      }}]
    }});
    window.addEventListener('resize', function() {{ immuneChart.resize(); }});
  }}
}}
</script>

</body>
</html>"""

        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(html, encoding="utf-8")
        return html

    def _extract_expression_data(self) -> List[Dict]:
        """Extract expression data for ECharts bar chart."""
        for section in self.sections:
            data = section.data
            if not data:
                continue
            # Check for expression_by_tissue in data
            expr = data.get("expression_by_tissue") or data.get("expression") or data.get("tissue_expression")
            if expr and isinstance(expr, dict):
                return [{"name": k, "value": round(v, 2) if isinstance(v, (int, float)) else v}
                        for k, v in expr.items()]
            # Check if data itself is a flat tissue→TPM dict (no nested dicts)
            if isinstance(data, dict) and data and not any(isinstance(v, dict) for v in data.values()):
                numeric = {k: v for k, v in data.items() if isinstance(v, (int, float))}
                if numeric:
                    return [{"name": k, "value": round(v, 2)} for k, v in numeric.items()]
            # Check for top_tissues list
            tissues = data.get("top_tissues")
            if tissues and isinstance(tissues, list):
                result = []
                for t in tissues:
                    if isinstance(t, dict):
                        name = t.get("tissue", t.get("name", ""))
                        val = t.get("tpm", t.get("value", 0))
                        result.append({"name": name, "value": round(float(val), 2)})
                    elif isinstance(t, (list, tuple)) and len(t) >= 2:
                        result.append({"name": str(t[0]), "value": round(float(t[1]), 2)})
                return result
            # Check for gtex_summary with expression_by_tissue file reference
            gtex_file = data.get("gtex_expression_file")
            if gtex_file:
                try:
                    gtex = json.loads(Path(gtex_file).read_text(encoding="utf-8"))
                    expr = gtex.get("expression_by_tissue", {})
                    if expr:
                        return [{"name": k, "value": round(v, 2)} for k, v in expr.items()]
                except Exception:
                    pass
        return []

    def _extract_survival_data(self) -> Dict:
        """Extract survival data for ECharts KM curve."""
        for section in self.sections:
            data = section.data
            if not data:
                continue
            surv = data.get("survival_stats") or data.get("survival") or data.get("km_data")
            if surv and isinstance(surv, dict):
                times = surv.get("times") or surv.get("time_points") or []
                survival = surv.get("survival") or surv.get("survival_probs") or surv.get("km_curve") or []
                if times and survival:
                    return {"times": times, "survival": survival}
            # Match km_curve_high structure (from Phase 1 survival analysis)
            km = data.get("km_curve_high")
            if km and isinstance(km, dict):
                times = km.get("timeline", [])
                survival = km.get("survival_function", [])
                if times and survival:
                    return {"times": [round(t, 1) for t in times], "survival": survival}
            # Check for Cox HR data to display as annotation
            cox = data.get("cox_stats") or data.get("cox_hazard_ratio") or data.get("cox_regression")
            if cox:
                return {"times": [], "survival": [], "cox": cox}
        return {"times": [], "survival": []}

    def _extract_immune_data(self) -> List[Dict]:
        """Extract immune cell correlation data for heatmap."""
        for section in self.sections:
            data = section.data
            if not data:
                continue
            # Check for explicitly named immune keys
            immune = data.get("immune_correlations") or data.get("immune") or data.get("cell_correlations")
            if immune and isinstance(immune, dict):
                # Check if values are dicts with "r" key (Phase 1 format)
                sample_val = next(iter(immune.values()), None)
                if isinstance(sample_val, dict) and "r" in sample_val:
                    return [{"cell": k, "correlation": round(float(v.get("r", 0)), 3)} for k, v in immune.items()]
                # Values are plain numbers
                return [{"cell": k, "correlation": round(float(v), 3) if isinstance(v, (int, float)) else 0}
                        for k, v in immune.items()]
            if immune and isinstance(immune, list):
                result = []
                for item in immune:
                    if isinstance(item, dict):
                        cell = item.get("cell_type", item.get("cell", ""))
                        corr = item.get("correlation", item.get("r", 0))
                        result.append({"cell": cell, "correlation": round(float(corr), 3)})
                return result
            # Match Phase 1 format: cell types as top-level keys with r/pvalue sub-keys
            cell_keys = [k for k in data if isinstance(data[k], dict) and "r" in data[k]]
            if cell_keys:
                return [{"cell": k, "correlation": round(float(data[k]["r"]), 3)} for k in cell_keys]
        return []

    def _build_kpi_cards(self) -> str:
        """Build KPI summary cards from report data."""
        kpis = []
        for section in self.sections:
            data = section.data
            if not data:
                continue
            # Expression KPI
            if "mean_tumor" in data:
                kpis.append(("肿瘤均值", f"{data['mean_tumor']:.1f}", "TPM"))
            if "mean_normal" in data:
                kpis.append(("正常均值", f"{data['mean_normal']:.1f}", "TPM"))
            if "log2fc" in data:
                val = data["log2fc"]
                kpis.append(("log2FC", f"{val:.2f}", "上调" if val > 0 else "下调"))
            if "pvalue" in data:
                p = data["pvalue"]
                kpis.append(("P值", f"{p:.2e}", "显著" if p < 0.05 else "不显著"))
            if "hazard_ratio" in data:
                kpis.append(("风险比HR", f"{data['hazard_ratio']:.2f}", "风险因子" if data["hazard_ratio"] > 1 else "保护因子"))
            # Competition KPI
            if "total_drugs" in data:
                kpis.append(("药物数量", str(data["total_drugs"]), "个"))
            if "total_trials" in data:
                kpis.append(("临床试验", str(data["total_trials"]), "项"))
            # Patent KPI
            if "total_patents" in data:
                kpis.append(("专利数量", str(data["total_patents"]), "件"))

        if not kpis:
            return ""

        cards = []
        for label, value, unit in kpis[:8]:  # Max 8 KPI cards
            cards.append(f"""
<div class="col">
  <div class="kpi-card">
    <div class="kpi-value">{value}</div>
    <div class="kpi-label">{label} ({unit})</div>
  </div>
</div>""")

        return f'<div class="row row-cols-2 row-cols-md-4 g-3 mb-4">{"".join(cards)}</div>'

    def _render_section_html(self, section: ReportSection, tab_id: str, active: str, index: int) -> str:
        """Render a single section as a Bootstrap tab pane."""
        parts = [f'<div class="tab-pane fade show {active}" id="{tab_id}" role="tabpanel" aria-labelledby="tab-{tab_id}">']

        # Section content
        if section.content:
            parts.append(f'<div class="section-card"><p>{section.content}</p></div>')

        # Charts (expression, survival, immune) — only in relevant sections
        if index == 0:  # First section typically has expression data
            parts.append("""
<div class="row">
  <div class="col-lg-6">
    <div class="chart-container">
      <div class="chart-title">组织表达分布 (Top 20)</div>
      <div id="chart-expression" style="height: 500px;"></div>
    </div>
  </div>
  <div class="col-lg-6">
    <div class="chart-container">
      <div class="chart-title">生存分析曲线 (KM)</div>
      <div id="chart-survival" style="height: 400px;"></div>
    </div>
  </div>
</div>
<div class="row">
  <div class="col-12">
    <div class="chart-container">
      <div class="chart-title">免疫细胞相关性</div>
      <div id="chart-immune" style="height: 350px;"></div>
    </div>
  </div>
</div>""")

        # Tables
        for table in section.tables:
            headers = table.get("headers", [])
            rows = table.get("rows", [])
            if headers:
                parts.append('<div class="table-responsive">')
                parts.append('<table class="table table-striped table-hover data-table">')
                parts.append("<thead><tr>" + "".join(f"<th>{h}</th>" for h in headers) + "</tr></thead>")
                parts.append("<tbody>")
                for row in rows:
                    parts.append("<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>")
                parts.append("</tbody></table></div>")

        # Figures
        for fig in section.figures:
            if fig:
                fig_html = fig.replace("\\", "/")
                parts.append(f'<div class="text-center my-3"><img src="{fig_html}" class="img-fluid rounded shadow-sm" alt="{section.title}"></div>')

        parts.append("</div>")
        return "\n".join(parts)

    def to_pdf(self, path: Optional[Path] = None) -> Optional[str]:
        """Export report to PDF using weasyprint.

        Requires: pip install weasyprint
        """
        try:
            from weasyprint import HTML
            html_content = self.to_html()
            if path:
                path.parent.mkdir(parents=True, exist_ok=True)
                HTML(string=html_content).write_pdf(str(path))
                print(f"[Report] PDF saved: {path}")
                return str(path)
        except ImportError:
            print("[Report] weasyprint not installed. Run: pip install weasyprint")
        except Exception as e:
            print(f"[Report] PDF export failed: {e}")
        return None

    def to_docx(self, path: Optional[Path] = None) -> Optional[str]:
        """Export report to DOCX using python-docx.

        Requires: pip install python-docx
        """
        try:
            from docx import Document
            from docx.shared import Inches, Pt, RGBColor
            from docx.enum.text import WD_ALIGN_PARAGRAPH

            doc = Document()

            # Title
            title = doc.add_heading(f"靶点情报报告: {self.target_gene}", level=0)

            # Metadata
            meta = doc.add_paragraph()
            meta.add_run(f"阶段: {self.phase}\n").bold = True
            meta.add_run(f"生成时间: {self.generated_at}\n")
            meta.add_run(f"版本: v2.0")

            # Disclaimer
            disclaimer = doc.add_paragraph()
            disclaimer.style = doc.styles["Intense Quote"]
            disclaimer.add_run("免责声明: ").bold = True
            disclaimer.add_run(
                "本报告由 AI 系统自动生成，仅供科研参考，不构成临床诊断或治疗建议。"
            )

            # Warnings
            if self.warnings:
                doc.add_heading("警告", level=1)
                for w in self.warnings:
                    p = doc.add_paragraph(w, style="List Bullet")

            # Sections
            for section in self.sections:
                doc.add_heading(section.title, level=1)
                if section.content:
                    doc.add_paragraph(section.content)
                for table in section.tables:
                    headers = table.get("headers", [])
                    rows = table.get("rows", [])
                    if headers:
                        t = doc.add_table(rows=1 + len(rows), cols=len(headers))
                        t.style = "Light Grid Accent 1"
                        for i, h in enumerate(headers):
                            t.rows[0].cells[i].text = str(h)
                        for r_idx, row in enumerate(rows):
                            for c_idx, cell in enumerate(row):
                                t.rows[r_idx + 1].cells[c_idx].text = str(cell)

            # Footer
            doc.add_paragraph()
            footer = doc.add_paragraph()
            footer.add_run("报告版本: v2.0 | 生成引擎: Target Intelligence\n").font.size = Pt(9)
            footer.add_run("数据来源: GTEx, cBioPortal, Open Targets, ChEMBL, ClinicalTrials.gov, UniProt, STRING").font.size = Pt(9)

            if path:
                path.parent.mkdir(parents=True, exist_ok=True)
                doc.save(str(path))
                print(f"[Report] DOCX saved: {path}")
                return str(path)
        except ImportError:
            print("[Report] python-docx not installed. Run: pip install python-docx")
        except Exception as e:
            print(f"[Report] DOCX export failed: {e}")
        return None
