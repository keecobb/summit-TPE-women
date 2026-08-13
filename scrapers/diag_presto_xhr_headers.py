"""The plain fetch of a PrestoSports '.xml' box score URL returned a
full ~900KB HTML page (the site's normal template), not real XML data --
strongly suggesting the actual box score content is loaded client-side
via JavaScript after the page loads, and the real data lives behind a
separate AJAX/XHR request our plain fetch never triggers.

Before assuming we need a JS-rendering approach (much heavier), test the
cheaper hypothesis first: maybe the server distinguishes an XHR/AJAX
request (typical headers: Accept: application/xml, X-Requested-With:
XMLHttpRequest) from a normal browser navigation and only serves real
data to the former, falling back to the full HTML app-shell otherwise.
Tries a few header combinations against the same URL and reports which
one (if any) returns something that isn't the ~900KB HTML shell.

Usage:
    python scrapers/diag_presto_xhr_headers.py <url>
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import requests

if len(sys.argv) < 2:
    print("Usage: python scrapers/diag_presto_xhr_headers.py <url>")
    sys.exit(1)

url = sys.argv[1]
USER_AGENT = "Mozilla/5.0 (SummitTPE data collector; contact: project owner)"

referer = url.rsplit("/boxscores/", 1)[0] + "/schedule"

attempts = [
    ("plain (User-Agent only)", {"User-Agent": USER_AGENT}),
    ("Accept: application/xml", {"User-Agent": USER_AGENT, "Accept": "application/xml, text/xml"}),
    ("X-Requested-With: XMLHttpRequest", {"User-Agent": USER_AGENT, "X-Requested-With": "XMLHttpRequest"}),
    ("both XHR headers", {
        "User-Agent": USER_AGENT,
        "Accept": "application/xml, text/xml, */*",
        "X-Requested-With": "XMLHttpRequest",
    }),
    ("Referer + XHR headers", {
        "User-Agent": USER_AGENT,
        "Accept": "application/xml, text/xml, */*",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": referer,
    }),
    ("Accept: text/xml exactly", {"User-Agent": USER_AGENT, "Accept": "text/xml"}),
]

for label, headers in attempts:
    try:
        resp = requests.get(url, headers=headers, timeout=20)
        content_type = resp.headers.get("Content-Type", "")
        snippet = resp.text[:200].replace("\n", " ")
        print(f"--- {label} ---")
        print(f"  status={resp.status_code} content-type={content_type!r} bytes={len(resp.text)}")
        print(f"  first 200 chars: {snippet!r}")
        print()
    except requests.RequestException as exc:
        print(f"--- {label} ---")
        print(f"  FAILED: {exc}")
        print()
