"""
Preview and navigation utilities for pipeline outputs.

Provides:
- Clickable file:// links in console
- Browser auto-open for HTML reports
- Summary dashboard generation
"""

import webbrowser
from pathlib import Path
from typing import Dict, List, Optional


def file_uri(path: Path) -> str:
    """Convert a path to a file:// URI."""
    return path.resolve().as_uri()


def print_file_link(path: Path, label: str = "") -> None:
    """Print a clickable file:// link to console."""
    uri = file_uri(path)
    display = label or path.name
    print(f"  {display}: {uri}")


def open_in_browser(path: Path) -> bool:
    """Open an HTML file in the default browser."""
    try:
        uri = file_uri(path)
        webbrowser.open(uri)
        print(f"  [Opened] {path.name}")
        return True
    except Exception as e:
        print(f"  [Preview] Could not open {path.name}: {e}")
        return False


def print_dashboard_hint(port: int = 3457) -> None:
    """Print the dynamic dashboard URL for viewing results interactively."""
    import socket
    import sys

    # Force UTF-8 output for emoji support
    _out = sys.stdout
    try:
        if hasattr(_out, 'reconfigure'):
            _out.reconfigure(encoding='utf-8')
    except Exception:
        pass

    def _port_open(p):
        try:
            with socket.create_connection(("localhost", p), timeout=1):
                return True
        except OSError:
            return False

    if _port_open(port):
        print(f"\n  [Dashboard] http://localhost:{port}")
    else:
        print(f"\n  [Dashboard] Start the dashboard server:")
        print(f"     cd E:\\yixue-scale-engine && PORT={port} node scripts/dashboard-server.mjs")
        print(f"     Then open: http://localhost:{port}")


def collect_output_files(output_dir: Path) -> Dict[str, List[Path]]:
    """Collect all output files organized by type."""
    categories = {
        "reports": [],
        "figures": [],
        "data": [],
        "dashboards": [],
    }
    for f in sorted(output_dir.rglob("*")):
        if not f.is_file():
            continue
        ext = f.suffix.lower()
        if ext in (".html",) and "dashboard" in f.name.lower():
            categories["dashboards"].append(f)
        elif ext in (".html", ".md", ".pdf", ".docx"):
            categories["reports"].append(f)
        elif ext in (".png", ".svg", ".jpg"):
            categories["figures"].append(f)
        elif ext in (".json", ".csv"):
            categories["data"].append(f)
    return categories


def generate_summary_dashboard(
    output_dir: Path,
    gene: str,
    disease: str = "",
    phase_files: Optional[Dict[str, List[str]]] = None,
) -> Path:
    """Generate a master dashboard linking all pipeline outputs.

    Args:
        output_dir: Output directory
        gene: Gene symbol
        disease: Disease name
        phase_files: Optional dict of {phase_name: [file_paths]}

    Returns:
        Path to the generated dashboard.html
    """
    categories = collect_output_files(output_dir)

    def file_rows(files: List[Path]) -> str:
        if not files:
            return '<tr><td colspan="3" class="text-muted">No files</td></tr>'
        rows = []
        for f in files:
            size = f.stat().st_size
            if size < 1024:
                size_str = f"{size} B"
            elif size < 1024 * 1024:
                size_str = f"{size / 1024:.1f} KB"
            else:
                size_str = f"{size / (1024 * 1024):.1f} MB"
            uri = file_uri(f)
            ext = f.suffix.lower()
            icon = {
                ".html": "📊", ".md": "📝", ".pdf": "📄", ".docx": "📃",
                ".png": "🖼️", ".svg": "🖼️", ".json": "📦", ".csv": "📋",
            }.get(ext, "📎")
            rows.append(
                f'<tr><td>{icon} <a href="{uri}" target="_blank">{f.name}</a></td>'
                f'<td>{size_str}</td>'
                f'<td class="text-muted">{f.parent.relative_to(output_dir) if f.parent != output_dir else "."}</td></tr>'
            )
        return "\n".join(rows)

    # Count stats
    total_files = sum(len(v) for v in categories.values())
    total_size = sum(f.stat().st_size for files in categories.values() for f in files)

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pipeline Dashboard: {gene}</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif; background: #f0f2f5; color: #1e293b; }}
.header {{ background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 2rem; }}
.header h1 {{ font-size: 1.6rem; margin-bottom: 0.3rem; }}
.header .meta {{ opacity: 0.9; font-size: 0.9rem; }}
.container {{ max-width: 1100px; margin: 0 auto; padding: 1.5rem; }}
.stats {{ display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }}
.stat-card {{ background: white; border-radius: 10px; padding: 1rem 1.5rem; flex: 1; min-width: 140px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); text-align: center; }}
.stat-value {{ font-size: 1.8rem; font-weight: 700; color: #1e40af; }}
.stat-label {{ font-size: 0.8rem; color: #6b7280; margin-top: 2px; }}
.section {{ background: white; border-radius: 10px; padding: 1.2rem 1.5rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }}
.section h2 {{ font-size: 1.1rem; color: #1e40af; margin-bottom: 0.8rem; padding-bottom: 0.5rem; border-bottom: 1px solid #e5e7eb; }}
table {{ width: 100%; border-collapse: collapse; }}
th {{ text-align: left; padding: 0.5rem; color: #6b7280; font-size: 0.8rem; border-bottom: 2px solid #e5e7eb; }}
td {{ padding: 0.5rem; border-bottom: 1px solid #f3f4f6; font-size: 0.9rem; }}
a {{ color: #2563eb; text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
.footer {{ text-align: center; padding: 1.5rem; color: #9ca3af; font-size: 0.8rem; }}
</style>
</head>
<body>
<div class="header">
  <h1>Target Intelligence Pipeline Dashboard</h1>
  <div class="meta">{gene} {'| ' + disease if disease else ''} | Generated outputs</div>
</div>
<div class="container">
  <div class="stats">
    <div class="stat-card"><div class="stat-value">{total_files}</div><div class="stat-label">Total Files</div></div>
    <div class="stat-card"><div class="stat-value">{len(categories['reports'])}</div><div class="stat-label">Reports</div></div>
    <div class="stat-card"><div class="stat-value">{len(categories['figures'])}</div><div class="stat-label">Figures</div></div>
    <div class="stat-card"><div class="stat-value">{len(categories['data'])}</div><div class="stat-label">Data Files</div></div>
    <div class="stat-card"><div class="stat-value">{total_size // 1024}KB</div><div class="stat-label">Total Size</div></div>
  </div>

  <div class="section">
    <h2>Reports</h2>
    <table><thead><tr><th>File</th><th>Size</th><th>Path</th></tr></thead>
    <tbody>{file_rows(categories['reports'])}</tbody></table>
  </div>

  <div class="section">
    <h2>Figures</h2>
    <table><thead><tr><th>File</th><th>Size</th><th>Path</th></tr></thead>
    <tbody>{file_rows(categories['figures'])}</tbody></table>
  </div>

  <div class="section">
    <h2>Data Files</h2>
    <table><thead><tr><th>File</th><th>Size</th><th>Path</th></tr></thead>
    <tbody>{file_rows(categories['data'])}</tbody></table>
  </div>
</div>
<div class="footer">Target Intelligence Pipeline | {gene}</div>
</body></html>"""

    dashboard_path = output_dir / "dashboard.html"
    dashboard_path.write_text(html, encoding="utf-8")
    return dashboard_path
