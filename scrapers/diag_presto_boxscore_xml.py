"""Diagnostic for a PrestoSports box score, which turns out to be served
as raw XML (confirmed live, Ferris State: the "teams/<slug>" stats
page's Date/Opponent/Result table links to
.../boxscores/<id>.xml) rather than an HTML page like Sidearm's. This
fetches that XML with the same plain-requests code path as everything
else, prints the element tree structure (tag names + attributes, a few
levels deep) so we can see the real field names without guessing, and
also prints the raw XML text (truncated) directly to stdout so it can
be pasted back without a second round trip through a saved file.

Usage:
    python scrapers/diag_presto_boxscore_xml.py <url>

Example:
    python scrapers/diag_presto_boxscore_xml.py https://ferrisstatebulldogs.com/sports/wbkb/2025-26/boxscores/20260226_svaw.xml
"""

import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sidearm_client as sidearm

if len(sys.argv) < 2:
    print("Usage: python scrapers/diag_presto_boxscore_xml.py <url>")
    sys.exit(1)

url = sys.argv[1]
text, final_url = sidearm._get_html(url, return_final_url=True)
print(f"Requested: {url}")
print(f"Final URL: {final_url}")
print(f"Fetched {len(text)} bytes")

try:
    root = ET.fromstring(text)
except ET.ParseError as exc:
    print(f"XML PARSE ERROR: {exc}")
    root = None

if root is not None:
    print()
    print(f"=== Root element: <{root.tag}> attrs={root.attrib} ===")

    def walk(el, depth=0, max_depth=3, max_children_shown=6):
        if depth > max_depth:
            return
        children = list(el)
        shown = children[:max_children_shown]
        for child in shown:
            indent = "  " * (depth + 1)
            text_preview = (child.text or "").strip()[:40]
            print(f"{indent}<{child.tag}> attrs={child.attrib} text={text_preview!r}")
            walk(child, depth + 1, max_depth, max_children_shown)
        if len(children) > max_children_shown:
            indent = "  " * (depth + 1)
            print(f"{indent}... ({len(children) - max_children_shown} more <{shown[0].tag if shown else '?'}>-like siblings not shown)")

    walk(root)

    # Also specifically look for anything that looks like a per-player
    # stat line, since that's the thing we actually need.
    print()
    print("=== Elements with 5+ attributes (likely per-player stat rows) ===")
    count = 0
    for el in root.iter():
        if len(el.attrib) >= 5:
            print(f"  <{el.tag}> {el.attrib}")
            count += 1
            if count >= 30:
                print("  ... (truncated)")
                break

out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "diag_presto_boxscore.xml")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(text)
print(f"\nFull raw XML saved to {out_path}")
print()
print("=== Raw XML (first 4000 chars) ===")
print(text[:4000])
