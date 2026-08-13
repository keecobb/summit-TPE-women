"""Parser for Sidearm Sports athletics sites (the CMS platform behind
302 of the 327 D2/D1 schools we already have a Roster URL for).

Verified against a real school (Adams State, https://asugrizzlies.com)
before writing this:
  - Roster page: a real HTML <table> with headers "#, Name, Pos.,
    Ht., Yr., Hometown, High School, Previous School" and a season
    dropdown, so historical rosters ARE available (unlike ESPN, which
    only has the current one) via /roster/<season>.
  - Schedule page: /schedule/<season>, with a "boxscore" link per
    completed game pointing at
    /stats/<season>/<opponent-slug>/boxscore/<id>.
  - Boxscore page: two real HTML <table>s (one per team), headers
    "#, Player, GS, MIN, FG, 3PT, FT, ORB-DRB, REB, PF, A, TO, BLK,
    STL, PTS", each preceded by a heading with "<School> <Score>".
    IMPORTANT: only the HOME school's own players are hyperlinked to
    a roster bio (with a stable numeric ID in the URL) -- opposing
    players show as plain text with no ID on this page. That's why
    run_d2_scrape.py matches opposing players by (team, name) rather
    than a native ID; a proper ID for them shows up once *their own*
    school's site gets scraped.

This parser finds tables by matching header text rather than CSS
classes/IDs, because those vary and aren't something we can verify
without hand-checking every one of ~300 individual school sites.
Header-based matching is far more likely to survive Sidearm template
differences between schools. Still: this has only been verified
against ONE real school. Run smoke_test_sidearm.py against a handful
of schools from different conferences before trusting a full run.
"""

import re
import time

import requests
from bs4 import BeautifulSoup

# BUG FIXED HERE: the old self-identifying UA ("...SummitTPE data
# collector; contact: project owner)") is very likely why a handful of
# sites (Western Colorado, Sul Ross, Lane, LeMoyne-Owen -- see task #44)
# kept failing on live reruns while a normal browser fetch of the exact
# same URL returned perfectly good content every time. Strongest single
# piece of evidence: Western Colorado's box-score 500 error resolved to
# https://gomountaineers.com/sorry.ashx -- a "sorry" landing page is a
# textbook bot-mitigation response, not a real site error. Switched to
# an ordinary browser UA string; this can only make already-working
# sites MORE likely to succeed, not less, since it's strictly less
# distinguishable from real browser traffic.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

BOX_SCORE_HEADER_SIGNATURE = {"MIN", "FG", "3PT", "FT", "PTS"}

# Every Sidearm roster table has a name/position/height/class-year
# column, but the exact header TEXT for each one varies a lot more
# between schools than originally assumed -- confirmed live across just
# a handful of D2 sites:
#   name:   "Name" (Adams State), "Full Name" (Adelphi)
#   pos:    "Pos." (Adams State/Adelphi), "Pos" no period (Albany State)
#   height: "Ht." (all seen so far)
#   class:  "Yr." (Adams State/Adelphi), "Academic Year" (Albany State),
#           "Cl." (American International), "CI." (Bentley -- confirmed
#           via raw HTML this is a literal typo baked into their site's
#           own template, "Cl." with the l swapped for a capital I, not
#           a rendering artifact on our end)
# Rather than one fixed header signature (which broke on the very next
# batch of schools after the first two), require ONE match from each of
# these alias lists -- a table only counts as a roster table if all
# four concepts are present, however each site happens to word them.
NAME_HEADER_ALIASES = ["Name", "Full Name", "Player", "Athlete"]
POS_HEADER_ALIASES = ["Pos.", "Pos", "Position"]
HEIGHT_HEADER_ALIASES = ["Ht.", "Height"]
CLASS_HEADER_ALIASES = ["Yr.", "Cl.", "CI.", "Class", "Academic Year", "Year"]
# Confirmed live (Hawaii Hilo): that school's roster table has NO "Name"
# (or "Full Name"/"Player"/"Athlete") column at all -- First and Last
# name are two separate columns headed literally "First" and "Last",
# unlike Newman's earlier-confirmed case (two columns both headed the
# SAME text "Name"). _find_roster_table() falls back to these whenever
# NAME_HEADER_ALIASES finds nothing.
FIRST_NAME_HEADER_ALIASES = ["First", "First Name"]
LAST_NAME_HEADER_ALIASES = ["Last", "Last Name"]

ROSTER_ID_RE = re.compile(r"/roster/[^/]+/(\d+)")
# Fallback name source for the "table has every roster column except
# Name" case -- see _names_from_profile_links() below.
PLAYER_PROFILE_LINK_RE = re.compile(r"/roster/[^/]+/(\d+)(?:[/?].*)?$")
PROFILE_NAME_SUFFIX_RE = re.compile(r"^(.*?)\s*-\s*View (?:Profile|Full Bio)$", re.IGNORECASE)
# Combined hometown/high-school/previous-school column -- confirmed live
# in at least three different shapes across D2 sites:
#   "Hometown / High School (Previous School)"   (Adelphi)
#   "Hometown / High School"                     (Albany State, 2 parts)
#   "Hometown / High School / Previous School"   (American Int'l, 3 parts,
#                                                  no parens at all)
# Handled generically by splitting on "/" and treating the 3rd+ segment
# (or a parenthetical on the 2nd segment) as the previous school -- see
# _parse_hometown_combined() below rather than a single regex, since a
# fixed regex couldn't cleanly cover both the parenthetical and
# slash-separated previous-school shapes at once.


class SidearmError(RuntimeError):
    pass


def _get_html(url, retries=3, backoff=2.0, timeout=20, return_final_url=False, min_bytes=None):
    """return_final_url=True also returns the URL actually served (after
    following any redirects) -- used by get_roster()/get_schedule_
    boxscore_links() to detect a season that silently redirected
    somewhere else instead of 404ing (see _season_path_candidates()).

    min_bytes: if set, a response shorter than this is treated as a
    retry-worthy failure just like a network exception, not just
    returned as-is. BUG FIXED HERE: confirmed live on PrestoSports
    sites (Tampa, right after 28 rapid consecutive requests to a
    DIFFERENT Presto-hosted school's site -- both "Powered by
    PrestoSports" per their page footers, suggesting shared rate-limit
    infrastructure across all their hosted schools) -- a throttled
    response comes back as a normal 200 OK with an empty or
    near-empty body, not an HTTP error or exception, so the retry loop
    below never used to trigger at all for this failure mode. Presto
    callers should pass a min_bytes floor well under a real page's
    typical size (400-600KB) but well above an empty/near-empty
    throttle response."""
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, timeout=timeout, headers={"User-Agent": USER_AGENT})
            resp.raise_for_status()
            if min_bytes is not None and len(resp.text) < min_bytes:
                raise requests.RequestException(
                    f"response too small ({len(resp.text)} bytes < {min_bytes} min) "
                    f"-- likely a rate-limit/throttle response, not the real page"
                )
            if return_final_url:
                return resp.text, resp.url
            return resp.text
        except requests.RequestException as exc:
            last_exc = exc
            wait = backoff * attempt
            print(f"  [retry {attempt}/{retries}] {url} -> {exc}; sleeping {wait:.0f}s")
            time.sleep(wait)
    raise SidearmError(f"Giving up on {url}: {last_exc}")


def _find_table_by_headers(soup, signature):
    for table in soup.find_all("table"):
        headers = {th.get_text(strip=True) for th in table.find_all("th")}
        headers_lower = {h.lower() for h in headers}
        if signature <= headers_lower:
            return table
    return None


def _normalize_header_text(text):
    """Lowercase + strip a trailing period, for loose header/alias
    comparison. The trailing-period stripping is confirmed necessary
    live (Cedarville): that school's roster table uses 'Ht' and 'Yr'
    with NO period, while every alias list before this fix only had the
    abbreviated-with-period form ('Ht.', 'Yr.') -- POS_HEADER_ALIASES
    happened to already have both 'Pos.' and 'Pos' as separate hardcoded
    entries (from an earlier, unrelated school), which papered over the
    same underlying issue for that one column only. Rather than keep
    hand-adding a no-period duplicate to every alias list as each new
    school's variant turns up, normalize the period away for ALL header
    comparisons so this whole class of variance stops recurring."""
    return text.lower().rstrip(".")


def _first_alias_present(headers, aliases):
    """Case- and period-insensitive alias match.

    Case-insensitivity confirmed live (Indianapolis): that school's
    roster table headers are written in ALL CAPS ('NAME', 'POS.', 'HT.',
    'CL.'), which never matched any alias here since this used to be a
    plain case-sensitive `alias in headers` check, silently failing "No
    roster table found" even though the real table with all the right
    columns was sitting right there.

    Period-insensitivity confirmed live (Cedarville) -- see
    _normalize_header_text()'s docstring.

    IMPORTANT: returns the REAL header text as it actually appears on
    the page (e.g. 'NAME', 'Ht'), not the alias that matched it (e.g.
    'Name', 'Ht.'). Callers use this return value as a dict key against
    row data built from those same real header strings (see
    parse_roster()'s `row.get(resolved["name"])`) -- returning the
    alias's own text instead would silently break that lookup even
    though the match itself succeeded, just trading one mismatch bug for
    another one step downstream."""
    headers_by_key = {_normalize_header_text(h): h for h in headers}
    for alias in aliases:
        real_header = headers_by_key.get(_normalize_header_text(alias))
        if real_header:
            return real_header
    return None


class _CIDict(dict):
    """dict wrapper with case-insensitive get()/`in` lookups, while still
    storing (and iterating) the real, original-case keys.

    Needed for the same reason _first_alias_present() had to go
    case-insensitive (see its docstring, confirmed live on Indianapolis's
    all-caps roster table): row dicts built straight from a table's own
    header text -- `dict(zip(headers, cell_texts))` -- carry whatever
    casing that specific site happens to use. A hardcoded literal lookup
    like `row.get("GS")` or `"Hometown" in row` silently fails the same
    way the old alias matching did if a site's real header text is
    `"gs"` or `"HOMETOWN"` instead. This wrapper fixes every such lookup
    at once rather than requiring a matching fix wherever a new literal
    header-text check gets added later."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._lower_map = {k.lower(): k for k in self.keys() if isinstance(k, str)}

    def get(self, key, default=None):
        real_key = self._lower_map.get(key.lower()) if isinstance(key, str) else key
        if real_key is None:
            return default
        return dict.get(self, real_key, default)

    def __contains__(self, key):
        if isinstance(key, str) and key.lower() in self._lower_map:
            return True
        return dict.__contains__(self, key)


def _names_from_profile_links(soup):
    """Page-wide (not table-scoped) fallback for recovering player names
    when the roster <table> itself has every expected column EXCEPT
    Name -- confirmed live (Salem WV, New Mexico Highlands's 2023-24
    archived season): the real <table> has Hometown/Previous School/#/
    Ht./Pos./Academic Year but genuinely no name cell at all; names only
    ever appear as linked headings/images in the styled card list above
    the table, structurally separate from it. Every one of those links
    points at the same /roster/<slug>/<id> profile URL ROSTER_ID_RE
    already knows how to pull an id out of -- this walks every such link
    on the page, in document order, dedupes by id (each player has
    several: image, heading, "View Full Bio" x2), and reads the name out
    of the alt/title text ("Aaliyah Nevarez - View Profile" / "...- View
    Full Bio") rather than reconstructing it from the URL slug -- the
    slug would need lossy guessing (hyphens standing in for both spaces
    AND real hyphenated names, apostrophes stripped, etc.), while the
    alt/title text is just the real display name as-is. Falls back to
    the link's own visible text (the "### [Name](href)" heading case)
    when neither alt nor title is present.

    Returns [(external_id, name), ...] in document order. The caller
    (_find_roster_table()) is responsible for only trusting this when
    the count exactly matches the table's row count -- see its docstring
    for why that guard matters."""
    seen_ids = set()
    out = []
    for a in soup.find_all("a", href=True):
        m = PLAYER_PROFILE_LINK_RE.search(a["href"])
        if not m:
            continue
        player_id = m.group(1)
        if player_id in seen_ids:
            continue
        name = None
        title_attr = a.get("title")
        if title_attr:
            name_m = PROFILE_NAME_SUFFIX_RE.match(title_attr.strip())
            name = name_m.group(1) if name_m else None
        if not name:
            img = a.find("img", alt=True)
            if img and img.get("alt"):
                name_m = PROFILE_NAME_SUFFIX_RE.match(img["alt"].strip())
                name = name_m.group(1) if name_m else None
        if not name:
            text = a.get_text(strip=True)
            if text and not text.isdigit() and text.lower() not in (
                "full bio", "view profile", "view full bio",
            ):
                name = text
        if not name:
            continue
        seen_ids.add(player_id)
        out.append((player_id, name))
    return out


def _find_roster_table(soup):
    """Like _find_table_by_headers, but for roster tables specifically:
    every Sidearm roster table has name/position/class-year columns,
    but the header TEXT for each varies by site (see the alias lists
    above this function). A table counts as a roster table if name and
    pos both resolve to a header actually present, PLUS at least one of
    height/class (see below for why neither is individually required).

    Height is not always required -- confirmed live (Azusa Pacific):
    that school's roster table has #/Full Name/Pos./Year/Major/
    Hometown-High School columns and no height column at all (height is
    only shown in a separate card/mobile view elsewhere on the page, not
    in the actual <table>). Requiring it made _find_roster_table() reject
    the only real roster table on the page and fail with "No roster
    table found".

    Class/year isn't always required either -- confirmed live (Humboldt
    State): that school's roster table has Full Name/#/Pos./Hometown/
    High School/Ht./Previous School/Major columns and NO class-year
    column at all (same "some schools just omit a field from the actual
    table" pattern as Azusa Pacific's missing height, just a different
    field this time).

    Since real schools have now been confirmed missing EITHER field
    individually, neither can be a hard requirement -- but dropping both
    down to fully optional (requiring only name+pos) risks matching some
    unrelated small table elsewhere on the page that happens to have
    both those columns (e.g. a "team leaders" stat table). Requiring at
    least ONE of height/class present is the middle ground: still a
    roster-specific signal, without over-requiring a field some real
    school's site happens to leave out. resolved["height"]/resolved
    ["class"] will be None for whichever one wasn't found, and
    parse_roster() below already handles a None-valued resolved key fine
    (row.get(None) just returns None).

    Returns (table, resolved_headers) where resolved_headers is
    {"name": "..." or (first_header, last_header), "pos": "...",
    "height": "..." or None, "class": "..." or None}, or (None, None) if
    no table on the page satisfies this. "name" is a 2-tuple of real
    header text -- confirmed live (Hawaii Hilo) -- when the site has no
    single Name-ish column at all, just separate "First"/"Last" columns
    (see FIRST_NAME_HEADER_ALIASES/LAST_NAME_HEADER_ALIASES above);
    parse_roster() checks for this shape and joins the two cells."""
    for table in soup.find_all("table"):
        headers = {th.get_text(strip=True) for th in table.find_all("th")}
        name_h = _first_alias_present(headers, NAME_HEADER_ALIASES)
        if not name_h:
            first_h = _first_alias_present(headers, FIRST_NAME_HEADER_ALIASES)
            last_h = _first_alias_present(headers, LAST_NAME_HEADER_ALIASES)
            if first_h and last_h:
                name_h = (first_h, last_h)
        pos_h = _first_alias_present(headers, POS_HEADER_ALIASES)
        height_h = _first_alias_present(headers, HEIGHT_HEADER_ALIASES)
        class_h = _first_alias_present(headers, CLASS_HEADER_ALIASES)
        if name_h and pos_h and (height_h or class_h):
            return table, {"name": name_h, "pos": pos_h, "height": height_h, "class": class_h}
        # BUG FIXED HERE (Salem WV, New Mexico Highlands 2023-24): some
        # Sidearm templates have a roster <table> with every OTHER
        # expected column but no Name column at all -- no amount of
        # alias matching can find a header that isn't there. Only fall
        # back to page-wide profile links (_names_from_profile_links())
        # when the table is otherwise a clear roster-table match (pos +
        # at least one of height/class) minus JUST the name, AND the
        # number of profile links found on the page exactly matches the
        # table's row count -- this keeps the fallback narrowly scoped
        # to "real roster table, name column genuinely missing" rather
        # than risking a wrong positional pairing, or a false match on
        # some unrelated small table elsewhere that happens to have a
        # Pos./Height column (e.g. a leaders/stats table).
        if not name_h and pos_h and (height_h or class_h):
            body = table.find("tbody") or table
            row_count = sum(1 for tr in body.find_all("tr") if tr.find_all("td"))
            profile_links = _names_from_profile_links(soup)
            if row_count and profile_links and len(profile_links) == row_count:
                return table, {
                    "name": "__PROFILE_LINKS__", "pos": pos_h,
                    "height": height_h, "class": class_h,
                    "_profile_links": profile_links,
                }
    return None, None


def _parse_hometown_combined(value):
    """Splits a combined hometown/high-school/previous-school cell into
    (hometown, high_school, previous_school). Confirmed live in three
    different shapes across D2 sites -- see the module-level comment
    above HOMETOWN_COMBINED docs for examples. Handled generically by
    splitting on "/": the first segment is always hometown; with two
    segments total the second may itself have a "(Previous School)"
    parenthetical; with three or more segments, the remainder (joined
    back with "/") is the previous school as plain text."""
    if not value:
        return None, None, None
    parts = [p.strip() for p in value.split("/")]
    hometown = parts[0] or None
    if len(parts) == 1:
        return hometown, None, None
    if len(parts) == 2:
        m = re.match(r"^(.*?)(?:\s*\((.*)\))?$", parts[1])
        high_school = (m.group(1) or "").strip() or None
        previous_school = m.group(2)
        return hometown, high_school, previous_school
    high_school = parts[1] or None
    previous_school = " / ".join(parts[2:]) or None
    return hometown, high_school, previous_school


def _row_cells_by_header(table):
    """Yield (header_index_map, cells, first_link_href) per data row."""
    header_cells = table.find_all("th") or table.find("tr").find_all(["th", "td"])
    headers = [h.get_text(strip=True) for h in header_cells]
    body = table.find("tbody") or table
    for tr in body.find_all("tr"):
        cells = tr.find_all("td")
        if not cells:
            continue
        link = tr.find("a", href=True)
        yield headers, cells, (link["href"] if link else None)


def _hometown_fields(row, headers):
    """Shared by both branches of parse_roster()'s per-row loop -- pulls
    (hometown, high_school, previous_school) out of a row, handling
    separate Hometown/High School/Previous School columns, a combined
    "Hometown / High School (Previous School)" column (see
    _parse_hometown_combined()), or the Indianapolis hybrid shape (a
    2-part combined column plus its own standalone Previous School
    column). See _parse_hometown_combined()'s docstring for the shape
    examples this was built against."""
    if "Hometown" in row:
        return row.get("Hometown"), row.get("High School"), row.get("Previous School")
    combined_header = next(
        (h for h in headers if "hometown" in h.lower() and "school" in h.lower()),
        None,
    )
    hometown, high_school, previous_school = _parse_hometown_combined(
        row.get(combined_header) if combined_header else None
    )
    if not previous_school:
        previous_school = row.get("Previous School")
    return hometown, high_school, previous_school


def parse_roster(html, base_url):
    """Returns [{'external_id','name','position','height','class_year',
                  'hometown','jersey'}]. external_id is None for players
    whose row wasn't hyperlinked (rare, but don't invent one)."""
    soup = BeautifulSoup(html, "lxml")
    table, resolved = _find_roster_table(soup)
    if table is None:
        raise SidearmError(f"No roster table found at {base_url} (page layout may differ)")

    out = []
    for row_idx, (headers, cells, href) in enumerate(_row_cells_by_header(table)):
        cell_texts = [c.get_text(strip=True) for c in cells]
        row = _CIDict(zip(headers, cell_texts))
        # BUG FIXED HERE (Salem WV, New Mexico Highlands 2023-24): no
        # Name column exists in this table at all -- _find_roster_table()
        # already verified profile_links lines up 1:1 with this table's
        # rows before handing back this marker (see its docstring), so
        # position-pairing row_idx against that list is safe here. Use
        # the profile link's own id as external_id too, rather than
        # ROSTER_ID_RE-searching this row's href -- there usually isn't
        # one, since the link lives in the card/heading, not this table.
        if resolved["name"] == "__PROFILE_LINKS__":
            profile_id, name = resolved["_profile_links"][row_idx]
            name = re.sub(r"\s+\d+$", "", name).strip()
            if not name:
                continue
            hometown, high_school, previous_school = _hometown_fields(row, headers)
            out.append({
                "external_id": profile_id,
                "name": name,
                "jersey": row.get("#"),
                "position": row.get(resolved["pos"]),
                "height": row.get(resolved["height"]),
                "class_year": row.get(resolved["class"]),
                "hometown": hometown,
                "high_school": high_school,
                "previous_school": previous_school,
            })
            continue
        # BUG FIXED HERE: dict(zip(headers, cell_texts)) silently drops
        # everything but the LAST cell on a duplicate header key.
        # Confirmed live (Newman University): that school's roster table
        # has First Name and Last Name in two separate columns, but both
        # are literally headed "Name" -- the naive dict build kept only
        # the Last Name cell, truncating every player to just a surname
        # ("Boris" instead of "Nikola Boris"), which then never matches
        # a box score's full-name text (0 roster overlap on every single
        # game, with no roster-fetch error at all since parsing itself
        # didn't fail, just silently produced wrong data). When the name
        # header appears more than once, join every cell under that
        # header in column order instead of trusting the collapsed dict
        # -- Sidearm always lists First before Last in this split shape.
        #
        # A DIFFERENT split-name shape, confirmed live (Hawaii Hilo):
        # separate First/Last columns headed literally "First"/"Last"
        # (not both "Name" like Newman) -- _find_roster_table() hands
        # back a (first_header, last_header) tuple for resolved["name"]
        # in that case, see its docstring.
        if isinstance(resolved["name"], tuple):
            first_h, last_h = resolved["name"]
            name = " ".join(part for part in (row.get(first_h), row.get(last_h)) if part).strip()
        else:
            name_positions = [i for i, h in enumerate(headers) if h == resolved["name"]]
            if len(name_positions) > 1:
                name = " ".join(cell_texts[i] for i in name_positions if cell_texts[i]).strip()
            else:
                name = row.get(resolved["name"])
        if not name:
            continue
        # Confirmed live (Cal State Dominguez Hills, gotoros.com): this
        # site's roster table Name cell has a hidden badge/count span
        # (unrelated to jersey number -- doesn't match the "#" column,
        # e.g. "N'dya Parks" is jersey #1 but the cell reads "N'dya Parks
        # 0") glued onto the end of the name text with no separating
        # markup BeautifulSoup's get_text() can distinguish. Left in,
        # this silently changes EVERY player's name (normalize_name_key
        # sorts tokens, so an extra "0"/"1"/etc. token never disappears),
        # which broke roster_by_name matching against box-score names for
        # 100% of this team's games (confirmed: 79/79 games logged a
        # "roster overlap tied 0-0" skip in one run) and is the real root
        # cause behind the earlier "wrong side picked" mystery on this
        # same team -- not a heuristic flaw, corrupted roster keys that
        # just barely coincidentally matched a few names here and there.
        # Real player names never end in a bare number, so stripping a
        # trailing " <digits>" is safe.
        name = re.sub(r"\s+\d+$", "", name).strip()
        if not name:
            continue
        m = ROSTER_ID_RE.search(href or "")
        hometown, high_school, previous_school = _hometown_fields(row, headers)

        out.append({
            "external_id": m.group(1) if m else None,
            "name": name,
            "jersey": row.get("#"),
            "position": row.get(resolved["pos"]),
            "height": row.get(resolved["height"]),
            "class_year": row.get(resolved["class"]),
            "hometown": hometown,
            "high_school": high_school,
            # Not every roster page has this column, and even when present
            # it's usually only populated for JUCO/grad transfers -- but
            # when it IS there it's a strong extra signal for matching the
            # same player across two different schools' sites (there's no
            # ESPN-style universal athlete ID for D2, so every extra signal
            # helps). See run_d2_scrape.py for how this gets used.
            "previous_school": previous_school,
        })
    return out


def _season_path_candidates(season_path):
    """season_path like '2024-25' -> ['2024-25', '2024-2025'] to try in
    order. Confirmed live (Adams State): the short 'YYYY-YY' form works
    for almost every season on that site (including its OWN 2023-24 and
    2025-26 pages), but its 2024-25 season specifically is only reachable
    at .../2024-2025 -- the long 'YYYY-YYYY' form. Not a simple "older
    seasons use long form" pattern either (2023-24 on the same site is
    short), so this isn't something a per-school override can predict --
    try short first since it's right almost everywhere, fall back to
    long only if that fails."""
    candidates = [season_path]
    m = re.match(r"^(\d{4})-(\d{2})$", season_path)
    if m:
        start_year = int(m.group(1))
        long_form = f"{start_year}-{start_year + 1}"
        if long_form not in candidates:
            candidates.append(long_form)
    return candidates


def _redirected_away_from_season(final_url, candidate):
    """True if the site 302'd us off the season-specific URL entirely
    (e.g. .../roster/2024-25 -> .../roster, silently serving the
    CURRENT season instead of 404ing). Confirmed live (Adams State):
    this happens on both roster AND schedule pages for a season path
    the site doesn't recognize -- and for schedule pages specifically,
    the redirected page still has real (non-empty) boxscore links on
    it, just for the WRONG season, so an empty-results check alone
    isn't enough to catch it. If the final URL no longer contains our
    requested season segment as a path piece, we didn't get what we
    asked for.

    BUG FIXED HERE (this function used to be the ONLY signal used to
    accept/reject a candidate): it turns out plenty of Sidearm sites
    redirect a CORRECTLY-formatted CURRENT-season URL to the bare,
    season-less canonical path too -- not just wrong-season URLs.
    Confirmed live on a full 281-team run: Bentley and Trevecca
    Nazarene (among 15 total) both 302 '.../roster/2025-2026' ->
    '.../roster' while requesting the actual current season, and the
    redirected page is the CORRECT, fully populated 2025-26 roster --
    this function alone can't tell that apart from Adams State's case
    (a stale/wrong season silently swapped for the current one at the
    same bare URL shape), so it was rejecting 15 schools' entirely
    valid current-season rosters, which cascaded into every one of
    their games showing a 0-0 "can't tell which side" overlap tie
    (empty roster -> nothing to match against) and getting skipped.
    URL shape genuinely can't disambiguate these two cases -- only the
    page's own declared season (see _extract_page_season() below) can.
    This function is now only a same-behavior FALLBACK for when the
    page's title doesn't parse into a recognizable season at all (some
    other template we haven't seen)."""
    return f"/{candidate}" not in final_url.rstrip("/") and not final_url.rstrip("/").endswith(f"/{candidate}")


PAGE_SEASON_RE = re.compile(r"<title>\s*(\d{4})-(\d{2,4})\s+Women's Basketball", re.IGNORECASE)


def _extract_page_season(html):
    """Pull the season the site itself thinks it served, straight out of
    the page's own <title> tag (e.g. "2025-26 Women's Basketball Roster
    - Cal State Dominguez Hills Athletics" -> "2025-26"). Confirmed live
    across gotoros.com, bentleyfalcons.com, and tnutrojans.com -- title
    format is consistent enough across Sidearm sites to trust as the
    primary signal for "did we actually get the season we asked for",
    which the URL/redirect alone can't reliably answer (see
    _redirected_away_from_season()'s docstring). Returns short 'YYYY-YY'
    form, or None if the title doesn't match this pattern at all (some
    other template -- caller should fall back to the URL check)."""
    m = PAGE_SEASON_RE.search(html)
    if not m:
        return None
    return f"{m.group(1)}-{m.group(2)[-2:]}"


def _normalize_season_short(season):
    """'2025-26' -> '2025-26', '2025-2026' -> '2025-26'. Shared by
    _season_matches() and get_roster()'s selector-fallback tail so both
    compare against the exact same short-form string."""
    m = re.match(r"^(\d{4})-(\d{2,4})$", season)
    return f"{m.group(1)}-{m.group(2)[-2:]}" if m else season


def _season_matches(html, final_url, candidate):
    """True if this fetch actually got us the requested season, checking
    the page's own declared season first (reliable, content-based) and
    only falling back to the URL/redirect heuristic if the title didn't
    parse (see _extract_page_season() and _redirected_away_from_season()
    docstrings for why content beats URL shape here)."""
    page_season = _extract_page_season(html)
    if page_season is not None:
        # candidate may be the long 'YYYY-YYYY' form (see
        # _season_path_candidates()) -- _extract_page_season() always
        # normalizes to short form, so normalize candidate the same way
        # before comparing rather than string-matching two different
        # shapes of the same season.
        return page_season == _normalize_season_short(candidate)
    return not _redirected_away_from_season(final_url, candidate)


SEASON_OPTION_TEXT_RE = re.compile(r"(\d{4})-(\d{2,4})")


def _find_season_url_from_selector(html, season_path):
    """Last-resort season-URL lookup via the page's own "Choose A
    Season" <select> dropdown (present on every Sidearm roster page
    seen so far -- diag_roster_table.py dumps it).

    Confirmed live (Minnesota Crookston): that site's per-season roster
    URLs don't follow either the short 'YYYY-YY' or long 'YYYY-YYYY'
    pattern _season_path_candidates() tries -- most seasons do, but the
    2025-26 season specifically is served at a bare single starting
    year, .../roster/2025, not .../roster/2025-26. Confirmed NOT a
    simple "older/newer seasons use a different fixed rule" pattern
    either (the same site's 2024-25 IS at the normal .../roster/2024-25,
    while 2021-22 is at .../roster/2021 and 2016-17 is at
    .../roster/2017 -- inconsistent even within one site, presumably
    from redesigns over the years), so no fixed-pattern guess can cover
    it. Rather than keep adding hardcoded per-school URL shapes, read
    the real target URL straight from the dropdown's own option value
    for whichever <option> text names the season we actually want.

    Returns a (possibly relative) URL string, or None if no <select>
    option matches this season at all."""
    soup = BeautifulSoup(html, "lxml")
    m = re.match(r"^(\d{4})-(\d{2,4})$", season_path)
    if not m:
        return None
    target_short = f"{m.group(1)}-{m.group(2)[-2:]}"
    for select in soup.find_all("select"):
        for option in select.find_all("option"):
            text = option.get_text(strip=True)
            om = SEASON_OPTION_TEXT_RE.search(text)
            if not om:
                continue
            option_short = f"{om.group(1)}-{om.group(2)[-2:]}"
            if option_short == target_short and "basketball" in text.lower():
                return option.get("value")
    return None


def get_roster(school_roster_url, season_path=None):
    """season_path: e.g. '2024-25' to get a historical roster, matching
    the pattern <roster_url>/<season>. Pass None for the current one."""
    url = school_roster_url.rstrip("/")
    if not season_path:
        html = _get_html(url)
        return parse_roster(html, url)

    last_exc = None
    bare_html, bare_final_url = None, None
    for candidate in _season_path_candidates(season_path):
        candidate_url = f"{url}/{candidate}"
        html, final_url = _get_html(candidate_url, return_final_url=True)
        if not _season_matches(html, final_url, candidate):
            last_exc = SidearmError(
                f"{candidate_url} redirected to {final_url} -- season not found on this site"
            )
            # The page we landed on after a rejected redirect is very
            # often the site's own bare/canonical roster page -- reuse
            # it below instead of re-fetching, since it's exactly the
            # page the season-selector dropdown lives on.
            bare_html, bare_final_url = html, final_url
            continue
        try:
            return parse_roster(html, candidate_url)
        except SidearmError as exc:
            last_exc = exc
            continue

    # Last resort: neither URL-pattern guess worked. Ask the page's own
    # season dropdown directly instead of guessing further -- see
    # _find_season_url_from_selector()'s docstring (confirmed necessary
    # live, Minnesota Crookston).
    if bare_html is None:
        try:
            bare_html, bare_final_url = _get_html(url, return_final_url=True)
        except SidearmError:
            raise last_exc
    selector_href = _find_season_url_from_selector(bare_html, season_path)
    if selector_href:
        selector_url = (
            selector_href if selector_href.startswith("http")
            else requests.compat.urljoin(bare_final_url, selector_href)
        )
        html, final_url = _get_html(selector_url, return_final_url=True)
        page_season = _extract_page_season(html)
        # Confirmed live (Minnesota Crookston): the selector-provided
        # URL (.../roster/2025, a bare starting year -- see
        # _find_season_url_from_selector()'s docstring) has NO
        # parseable <title> season at all, so _season_matches() would
        # fall back to _redirected_away_from_season()'s URL-shape check
        # -- which was written assuming 'YYYY-YY'/'YYYY-YYYY' URL
        # shapes and so ALSO can't recognize this one, producing a
        # false rejection of a page we already know is correct (we
        # picked this exact URL because the dropdown's own option text
        # named it as the season we asked for). Only fall back to the
        # URL-shape check when the title DOES parse into some other,
        # contradicting season -- that's a real mismatch worth
        # rejecting; a title that simply doesn't parse at all is not.
        matches = page_season == _normalize_season_short(season_path) if page_season is not None else True
        if matches:
            try:
                return parse_roster(html, selector_url)
            except SidearmError as exc:
                last_exc = exc
        else:
            last_exc = SidearmError(
                f"{selector_url} (from season selector) declared season {page_season!r}, "
                f"expected {season_path!r}"
            )
    raise last_exc


def find_boxscore_links(schedule_html, base_url):
    """[{'url', 'opponent_slug'}] for every completed game on a schedule page."""
    soup = BeautifulSoup(schedule_html, "lxml")
    out = []
    seen = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/boxscore/" not in href:
            continue
        full_url = href if href.startswith("http") else requests.compat.urljoin(base_url, href)
        if full_url in seen:
            continue
        seen.add(full_url)
        out.append({"url": full_url})
    return out


def get_schedule_boxscore_links(school_schedule_url, season_path=None):
    """Same short-vs-long season-path fallback as get_roster(). IMPORTANT:
    a wrong-format schedule URL redirecting to the CURRENT season's
    schedule is more dangerous than the equivalent roster case --
    confirmed live (Adams State, requesting schedule/2024-25): the site
    redirects to the bare /schedule path, which is NOT empty, it's a
    real schedule full of real boxscore links -- just for the current
    season (2025-26), not the 2024-25 we asked for. Those links would
    otherwise get silently recorded under the WRONG season label. In
    practice games_seen dedup happens to catch this for a team whose
    current season was already scraped (the "wrong" game IDs are
    already-seen and skipped) -- but that's a coincidence, not a
    guarantee, so this checks the same redirect signal get_roster() does
    rather than relying on it.

    BUG FIXED HERE: this used to fall through to `return []` when no
    candidate matched the requested season, instead of raising like
    get_roster() does for the equivalent case. Confirmed live (Sul Ross,
    2023-24): .../schedule/2023-24 silently redirects to the CURRENT
    season's schedule (title read "2025-26 Women's Basketball Schedule"),
    got correctly rejected by _season_matches(), and the long-form
    candidate also failed -- but with no exception raised, process_team()
    saw season_error stay None and marked 2023-24 "done" with zero games
    captured, permanently hiding the failure from every future run (no
    error ever showed in the console, and even --force couldn't help
    since there was nothing telling it to bypass done_seasons next time
    either). Raising here lets the caller record season_error and retry
    later instead of silently losing the season forever."""
    url = school_schedule_url.rstrip("/")
    if not season_path:
        html = _get_html(url)
        return find_boxscore_links(html, url)

    # any_matched: True once some candidate's page actually declared the
    # season we asked for (even if it turned out to have 0 games) -- that
    # is an authoritative, trustworthy answer and always wins over an
    # earlier candidate's rejection. last_reject_exc is only used as a
    # last resort, if EVERY candidate got redirected/rejected and we
    # never actually landed on the right season at all.
    any_matched = False
    last_reject_exc = None
    for candidate in _season_path_candidates(season_path):
        candidate_url = f"{url}/{candidate}"
        html, final_url = _get_html(candidate_url, return_final_url=True)
        if not _season_matches(html, final_url, candidate):
            last_reject_exc = SidearmError(
                f"{candidate_url} redirected to {final_url} -- season not found on this site"
            )
            continue
        any_matched = True
        links = find_boxscore_links(html, candidate_url)
        if links:
            return links
        # Season matched but the page has zero boxscore links -- keep
        # trying the other candidate in case it's a better match, but
        # this is otherwise a legitimate (if unusual) answer: a real
        # gameless page for a real season, not a redirect.

    if any_matched or last_reject_exc is None:
        return []
    raise last_reject_exc


def parse_boxscore(html, url):
    """Returns {'teams': [{'name','score','players':[{'external_id','name',
                'jersey','starter','min','fg','3pt','ft','reb','pf','ast',
                'to','blk','stl','pts'}]}]} -- exactly 2 teams, in the
    order they appear on the page (first heading = usually the home
    team on Sidearm pages, but don't assume -- match by score/context
    in the caller instead of trusting order if it matters)."""
    soup = BeautifulSoup(html, "lxml")
    teams = []

    for table in soup.find_all("table"):
        headers = {th.get_text(strip=True) for th in table.find_all("th")}
        # Case-insensitive against BOX_SCORE_HEADER_SIGNATURE (all-caps
        # already, so normalize the page's real headers up to match --
        # same reasoning as _first_alias_present()'s docstring, just
        # applied to a signature set instead of an alias list).
        headers_upper = {h.upper() for h in headers}
        if not (BOX_SCORE_HEADER_SIGNATURE <= headers_upper):
            continue
        # Confirmed live (Central Mo. vs Neb.-Kearney, a "found 6" case):
        # some Sidearm box score pages also include a "1st Box Score" /
        # "2nd Box Score" (half-by-half, or on other sites quarter-by-
        # quarter) breakdown further down the page, with one table per
        # team per period -- same MIN/FG/3PT/FT/PTS column signature as
        # the real full-game tables, so the old logic collected all of
        # them (2 full-game + 2 teams x N periods) and then choked on
        # "expected 2, found 6/10". The full-game tables are the only
        # ones with a "GS" (games-started) column -- confirmed real:
        # the period tables drop GS entirely since "started the 2nd
        # quarter" isn't a tracked stat. Require it here to skip the
        # period breakdown tables and keep only the full-game ones.
        if "GS" not in headers_upper:
            continue

        # Team name + score come from the nearest preceding heading,
        # e.g. "### Adams St. 56".
        heading = table.find_previous(["h2", "h3", "h4"])
        team_name, team_score = None, None
        if heading:
            text = heading.get_text(strip=True)
            m = re.match(r"^(.*\S)\s+(\d+)$", text)
            if m:
                team_name, team_score = m.group(1), int(m.group(2))
            else:
                team_name = text

        players = []
        for row_headers, cells, href in _row_cells_by_header(table):
            row = _CIDict(zip(row_headers, (c.get_text(strip=True) for c in cells)))
            name = row.get("Player", "")
            # Confirmed live (Adelphi vs. Caldwell box score): the "Player"
            # cell's text often has the jersey number glued onto the front
            # of the name -- e.g. "21 Reynoso,Jessaiah" or "04Cancer,
            # Me'Challe" -- almost certainly a hidden/mobile-view jersey
            # span BeautifulSoup's get_text() doesn't know to skip, since
            # it's a separate "##" column too. Left unstripped, this
            # corrupted every downstream name split: _split_name() would
            # read the jersey digits as part of the last name, and the
            # roster-name lookup in process_boxscore_side() (which
            # compares against the CLEAN roster-page name) would miss,
            # silently duplicating even a team's own roster players as
            # low-confidence fallback records. Strip a leading digit run
            # before anything else touches this string -- real names never
            # start with a digit, so this is safe.
            name = re.sub(r"^\d+\s*", "", name)
            # Team-totals rows show up as "TOTALS" / "TM TEAM" / "TEAM"
            # normally, but confirmed live (Adelphi's own box score) that
            # the same get_text() concatenation issue above sometimes
            # collapses "TM TEAM" to "TMTEAM" (no space between the two
            # words in the underlying HTML) -- strip whitespace from the
            # comparison too so both variants get excluded.
            if not name or name.strip().upper().replace(" ", "") in ("TOTALS", "TMTEAM", "TEAM"):
                continue
            m = ROSTER_ID_RE.search(href or "")
            players.append({
                "external_id": m.group(1) if m else None,
                "name": name,
                # Box score tables use "##" for the jersey column header
                # (roster tables use plain "#" -- confirmed different on
                # the real page, not a typo here).
                "jersey": row.get("##") or row.get("#"),
                "starter": "*" in (row.get("GS") or ""),
                "min": row.get("MIN"),
                "fg": row.get("FG"),
                "3pt": row.get("3PT"),
                "ft": row.get("FT"),
                "reb": row.get("REB"),
                "pf": row.get("PF"),
                "ast": row.get("A"),
                "to": row.get("TO"),
                "blk": row.get("BLK"),
                "stl": row.get("STL"),
                "pts": row.get("PTS"),
            })

        teams.append({"name": team_name, "score": team_score, "players": players})

    if len(teams) != 2:
        raise SidearmError(
            f"Expected 2 box score tables at {url}, found {len(teams)} -- "
            "page layout may differ from what this parser expects."
        )
    return {"teams": teams}


def get_boxscore(url):
    html = _get_html(url)
    return parse_boxscore(html, url)


def split_made_attempted(value):
    if not value or value == "-":
        return 0, 0
    try:
        made, attempted = value.split("-")
        return int(made), int(attempted)
    except (ValueError, AttributeError):
        return 0, 0


def parse_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def parse_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0
