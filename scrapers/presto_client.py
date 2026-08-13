"""Parser for PrestoSports athletics sites -- the second CMS platform
(after Sidearm) our D2 schools' sites turn out to use. 18 D2 teams are
tagged SiteType="Presto" in the Teams sheet.

Verified against two real schools before writing this (Ferris State,
https://ferrisstatebulldogs.com, and Tampa, https://www.tampaspartans.com)
via a series of manual diagnostic fetches -- see diag_presto_page.py,
diag_row_cells.py, diag_presto_boxscore_xml.py, diag_presto_xhr_headers.py
in this directory, all built for this bootstrap process the same way
diag_roster_table.py was built to bootstrap sidearm_client.py.

STRUCTURAL DIFFERENCES FROM SIDEARM, all confirmed live:

1. The Teams sheet's "Roster URL" column stores the team's STATS/HUB
   page (".../sports/<code>/<season>/teams/<slug>"), not an actual
   roster page -- this project's own convention (the user standardized
   all 18 Presto teams to this URL shape specifically because it's the
   one page that has BOTH a real static schedule/results table AND
   (via query param) real box score data, unlike Sidearm where the
   stored URL needed reshaping into /roster and /schedule). Roster and
   the team-hub page are siblings under the same season path -- see
   presto_site_parts()/roster_url()/team_page_url() below.

2. Box scores are served at a URL ending in ".xml" but are NOT static
   XML files and are NOT reachable by content negotiation (Accept/
   X-Requested-With headers made no difference, confirmed live) --
   fetching that URL plain returns the site's generic ~900KB page shell
   with no game data in it at all. The real data only appears when
   "?view=boxscore" is appended to the SAME url. Found via the user
   manually searching their browser's Network tab response bodies for a
   player's name (Ctrl+Shift+F in Chrome DevTools) since no combination
   of request headers reproduced it from a plain fetch.

3. PrestoSports tables don't use a clean <thead>/<tbody> split the way
   Sidearm's do -- every table's FIRST <tr> holds the header text (all
   <th>), but subsequent DATA rows ALSO use a <th> for their first cell
   (a "row label" cell -- the player's identity on a roster/box-score
   row, or the team name on a schedule/score row), with the remaining
   cells as plain <td>. This means naively collecting `table.find_all
   ("th")` (Sidearm's approach) sweeps up every row's label text too,
   not just real column headers -- confirmed live (see diag_row_cells.py
   output during the build): a roster table's "headers" looked like
   ['No.', 'Name', 'Pos.', ... 'Mia McLaughlin', 'Mara Mitchell', ...]
   with every single player's name mixed in as a fake "header". All the
   table-scanning code below works around this by treating ONLY THE
   FIRST <tr> of a table as its header row, never table.find_all("th").

4. Roster data cells use a "Label:Value" text format baked directly
   into each cell (e.g. a <td> literally reads "Pos.:G", not just "G")
   -- a responsive-design pattern (a CSS-generated mobile label,
   apparently rendered server-side into the actual text rather than via
   CSS ::before content). See _parse_label_value_cells() below. This
   also means the roster row's cell COUNT doesn't reliably match the
   header row's cell count (confirmed live: 8 cells for a 7-column
   header row, one extra unlabeled leading cell) -- label-based lookup
   sidesteps needing positional alignment entirely.

5. The roster's player-name <th> cell text is frequently polluted with
   embedded whitespace (confirmed, Ferris State: "Mia\\r\\n\\t...
   McLaughlin") or, worse, an EXACT self-duplication with no separator
   at all between the two copies (confirmed, Tampa: "BailyWaldenBaily
   Walden" -- "Baily Walden" typed back-to-back twice). See
   _clean_presto_name() below.

6. The team-hub ("teams/<slug>") page's box-score link discovery and
   the actual box-score page itself, once fetched, are NOT reliably
   single occurrences -- confirmed live (Ferris State's ?view=boxscore
   response): the SAME two teams' box score tables appear FIVE times
   each in one page's raw HTML (almost certainly one copy per UI tab --
   Box Score / Play by Play / Team Stats / Coach's View -- all rendered
   into the DOM at once and toggled client-side rather than fetched
   separately). Parsing must de-duplicate by table content, not assume
   "exactly 2 tables = the 2 teams" the way Sidearm's parser safely
   could.

Reuses sidearm_client's generic (not actually Sidearm-specific) helpers
where the logic is identical: _get_html (plain requests + retries),
_first_alias_present (case/period-insensitive header alias matching),
_parse_hometown_combined, split_made_attempted/parse_int/parse_float.
"""

import re

import requests
from bs4 import BeautifulSoup

import sidearm_client as sidearm
from sidearm_client import (
    CLASS_HEADER_ALIASES,
    HEIGHT_HEADER_ALIASES,
    NAME_HEADER_ALIASES,
    POS_HEADER_ALIASES,
    _first_alias_present,
    _get_html,
    _parse_hometown_combined,
    parse_float,
    parse_int,
    split_made_attempted,
)


class PrestoError(RuntimeError):
    pass


BIO_ID_RE = re.compile(r"/bios/([^/?#]+)")
PLAYER_LINK_ID_RE = re.compile(r"/players\?id=([^&#]+)")

# Box score data-row label format -- CONFIRMED to vary by school, not a
# single fixed pattern:
#   Format A (Ferris State): "44 -Mya Hiram- F" / "21-Kadyn Blanchard- G"
#     -- jersey, name, position separated by dashes (spacing around them
#     is inconsistent).
#   Format B (Tampa AND its opponents -- confirmed live, Nova
#     Southeastern): "G02Giorgia Palmieri" / "21Hagy,Katelynn" --
#     position, jersey, and name concatenated with NO separator at all.
#     Position is itself OPTIONAL here -- confirmed live, several
#     reserves on both Tampa's and Nova Southeastern's rosters have no
#     leading position letter at all, just jersey+name directly.
# BUG FIXED HERE: the original version of this module only had Format
# A's regex. Format B text never matches it at all (no dashes), so
# EVERY Tampa box score parsed zero players on BOTH sides -- which
# silently looks exactly like a real "can't tell which side" roster-
# overlap tie (0-0) rather than an obvious parse failure, since 0 vs 0
# is technically a valid (if uninformative) tie. Confirmed live: 100%
# of Tampa's games hit that tie in a real run, 0 of Ferris State's
# (dashed format) did.
PLAYER_ROW_RE_DASHED = re.compile(r"^\s*(\d+)\s*-\s*(.+?)\s*-\s*([A-Za-z/]+)\s*$")
PLAYER_ROW_RE_CONCAT = re.compile(r"^([A-Za-z/]*)(\d+)(.+)$")


def _parse_player_row_label(label):
    """Returns (jersey, name, position_or_None), or None if this label
    isn't a player row at all (STARTERS/RESERVES/TM-TEAM/TOTALS/a
    shooting-percentage row -- none of those contain any digit at all,
    which both formats above require, so they never match either
    pattern and fall through to None here).

    Tries the dashed format first: Format B's looser concat pattern
    would technically also match Format A's text (matching zero
    characters for its optional leading letters, then swallowing the
    rest -- dashes and all -- as "name"), so trying the stricter,
    unambiguous dashed pattern first avoids ever misparsing Format A
    text as Format B."""
    m = PLAYER_ROW_RE_DASHED.match(label)
    if m:
        jersey, name, position = m.group(1), m.group(2).strip(), m.group(3)
        return jersey, name, position
    m = PLAYER_ROW_RE_CONCAT.match(label)
    if m:
        position, jersey, name = m.group(1), m.group(2), m.group(3).strip()
        return jersey, name, (position or None)
    return None


def _clean_presto_name(raw):
    """See module docstring point 5. Collapse whitespace, then detect
    and strip an exact self-duplication (some Presto templates render
    both a visible name and a visually-hidden duplicate, e.g. for
    screen readers, in the same cell with no separator)."""
    collapsed = re.sub(r"\s+", " ", raw or "").strip()
    n = len(collapsed)
    if n % 2 == 0:
        half = n // 2
        first_half, second_half = collapsed[:half], collapsed[half:]
        if first_half and first_half == second_half:
            return first_half
    return collapsed


def _parse_label_value_cells(cells):
    """See module docstring point 4. Returns {label: value}, skipping
    any cell whose text has no ':' at all (e.g. the unlabeled duplicate
    leading jersey-number cell confirmed live on the roster page)."""
    result = {}
    for cell in cells:
        text = re.sub(r"\s+", " ", cell.get_text(strip=True))
        if ":" not in text:
            continue
        label, _, value = text.partition(":")
        label = label.strip()
        value = value.strip()
        if label:
            result[label] = value
    return result


def _find_roster_table(soup):
    """See module docstring point 3 -- only the table's FIRST <tr> is
    trusted as its header row. Returns (table, resolved_headers) where
    resolved_headers is {"name": "...", "pos": "..."} (real header text,
    not the alias), or (None, None)."""
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        header_cells = rows[0].find_all(["th", "td"])
        headers = {c.get_text(strip=True) for c in header_cells}
        name_h = _first_alias_present(headers, NAME_HEADER_ALIASES)
        pos_h = _first_alias_present(headers, POS_HEADER_ALIASES)
        if name_h and pos_h:
            return table, {"name": name_h, "pos": pos_h}
    return None, None


def parse_roster(html, base_url):
    """Returns [{'external_id','name','position','height','class_year',
    'hometown','high_school','previous_school','jersey'}], matching
    sidearm_client.parse_roster()'s shape so run_d2_presto_scrape.py can
    reuse the same downstream field names."""
    soup = BeautifulSoup(html, "lxml")
    table, _resolved = _find_roster_table(soup)
    if table is None:
        raise PrestoError(f"No roster table found at {base_url} (page layout may differ)")

    rows = table.find_all("tr")
    out = []
    for tr in rows[1:]:  # skip the header row (rows[0])
        cells = tr.find_all(["th", "td"])
        if not cells:
            continue
        name_th = tr.find("th")
        if name_th is None:
            continue  # a row with no <th> at all isn't a real player row here
        name = _clean_presto_name(name_th.get_text(strip=True))
        if not name:
            continue

        link = name_th.find("a", href=True)
        m = BIO_ID_RE.search(link["href"]) if link else None
        external_id = m.group(1) if m else None

        fields = _parse_label_value_cells(cells)
        field_keys = set(fields.keys())
        pos_h = _first_alias_present(field_keys, POS_HEADER_ALIASES)
        height_h = _first_alias_present(field_keys, HEIGHT_HEADER_ALIASES)
        class_h = _first_alias_present(field_keys, CLASS_HEADER_ALIASES)
        jersey_h = _first_alias_present(field_keys, ["No.", "No", "#"])

        combined_header = next(
            (k for k in field_keys if "hometown" in k.lower() and "school" in k.lower()),
            None,
        )
        hometown, high_school, previous_school = (None, None, None)
        if combined_header:
            hometown, high_school, previous_school = _parse_hometown_combined(
                re.sub(r"\s+", " ", fields.get(combined_header, ""))
            )
        else:
            hometown_h = _first_alias_present(field_keys, ["Hometown"])
            hs_h = _first_alias_present(field_keys, ["High School"])
            prev_h = _first_alias_present(field_keys, ["Previous College", "Previous School"])
            hometown = fields.get(hometown_h) if hometown_h else None
            high_school = fields.get(hs_h) if hs_h else None
            previous_school = fields.get(prev_h) if prev_h else None

        out.append({
            "external_id": external_id,
            "name": name,
            "jersey": fields.get(jersey_h) if jersey_h else None,
            "position": fields.get(pos_h) if pos_h else None,
            "height": fields.get(height_h) if height_h else None,
            "class_year": fields.get(class_h) if class_h else None,
            "hometown": hometown,
            "high_school": high_school,
            "previous_school": previous_school,
        })
    return out


def get_roster(roster_url):
    """Unlike Sidearm, season is already baked into roster_url by the
    caller (see run_d2_presto_scrape.py's roster_url()) -- Presto's
    season path is consistently the short 'YYYY-YY' form in every
    school confirmed so far, no short/long fallback dance needed."""
    try:
        html = _get_html(roster_url, min_bytes=50000)
    except sidearm.SidearmError as exc:
        # BUG FIXED HERE: _get_html's exhausted-retries failure raises
        # sidearm.SidearmError, not presto.PrestoError -- confirmed
        # live this was NOT being caught by callers' `except
        # presto.PrestoError` blocks and was propagating all the way up
        # to main()'s outer catch-all, aborting an ENTIRE team's run
        # (all remaining games skipped) over a single persistently-
        # throttled request. Normalizing to PrestoError here so every
        # public function in this module only ever raises one
        # exception type, exactly as the rest of this module already
        # assumes.
        raise PrestoError(str(exc)) from exc
    return parse_roster(html, roster_url)


DATE_OPPONENT_RESULT = ("Date", "Opponent", "Result")
DATE_OPPONENT_SCORE = ("Date", "Opponent", "Score")


def get_gamelog_boxscore_links(gamelog_url):
    """THE REAL, RELIABLE source of a season's box score links --
    replaces both get_team_page_games() (deprecated, only 6/33 real
    games) and get_schedule_boxscore_links() (deprecated, chased two
    different inline-HTML template variants across schools/months and
    still came up short: Tampa's non-November months' href/data-boxscore
    text wasn't even present anywhere in that page's raw response for
    ~20 of ~30 games).

    The '<team-hub-url>?view=gamelog' page (same base URL already
    stored in the Teams sheet, just a different query param -- see
    gamelog_url() in run_d2_presto_scrape.py) has a 'Date/Opponent/
    Score' table whose SCORE CELL carries a real, plain, relative
    <a href="../boxscores/<date>_<code>.xml"> link for every game that
    has a posted box score -- confirmed live (Tampa): 30 data rows,
    exactly matching Tampa's actual 19-11 record (the '/schedule'
    page's 32 "events" included 2 extras -- exhibition/non-counted
    games, same pattern as the Western State exhibition game noted
    earlier this project -- that don't belong in the real season
    anyway). Games with no box score posted yet/at all simply have no
    <a> in that cell and are skipped, which is the CORRECT behavior,
    not a bug -- confirmed live this is a real, not a parsing, gap (the
    user independently spotted this while investigating the '/schedule'
    page's inconsistent per-game href presence).

    Multiple tables on this page share the same 'Date/Opponent/Score'
    first-three-headers signature (separate derived-stat tables --
    rebounding, turnovers, etc. -- confirmed live: table[2] through
    table[9] on Tampa's page), but they all list the identical game set,
    so only the FIRST matching table is used.

    Returns [{'url': ...}], each with '?view=boxscore' appended (still
    required for the real box score page content -- see module
    docstring point 2), de-duplicated by URL."""
    try:
        html = _get_html(gamelog_url, min_bytes=50000)
    except sidearm.SidearmError as exc:
        # See get_roster()'s identical fix above for why this is needed.
        raise PrestoError(str(exc)) from exc
    soup = BeautifulSoup(html, "lxml")
    out = []
    seen = set()
    found_table = False
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        header_cells = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]
        if tuple(header_cells[:3]) != DATE_OPPONENT_SCORE:
            continue
        found_table = True
        for tr in rows[1:]:
            cells = tr.find_all(["th", "td"])
            if len(cells) < 3:
                continue
            link = cells[2].find("a", href=True)
            if not link:
                continue  # no box score posted for this game -- not a bug, a real gap
            href = link["href"]
            full_url = href if href.startswith("http") else requests.compat.urljoin(gamelog_url, href)
            sep = "&" if "?" in full_url else "?"
            box_url = full_url if "view=boxscore" in full_url else f"{full_url}{sep}view=boxscore"
            if box_url in seen:
                continue
            seen.add(box_url)
            out.append({"url": box_url})
        break  # first matching table has the complete game list; the rest are duplicates
    if not found_table:
        # BUG FIXED HERE: originally this silently returned [] whenever
        # no Date/Opponent/Score table was found at all -- confirmed
        # live this is indistinguishable from "genuinely 0 games have a
        # box score" and masked a real failure: two back-to-back real
        # scraper runs (roster fetch immediately followed by this
        # gamelog fetch, no delay between them) both silently returned
        # [] for BOTH teams with zero exceptions raised anywhere, right
        # after this exact function had just returned the correct
        # 33/30 results when called alone (one request per process, no
        # preceding roster fetch). Most likely explanation: some
        # rate-limit/bot-throttle response to rapid consecutive
        # requests to the same host, served as a normal 200 OK with
        # different/thin content rather than an HTTP error -- silent
        # either way unless we check for it here. Raising loudly now
        # instead of returning [] so this shows up as a real, visible
        # error in a run's output rather than a phantom "0 games".
        raise PrestoError(
            f"No Date/Opponent/Score table found at {gamelog_url} "
            f"({len(html)} bytes fetched) -- page layout may differ, "
            f"or this may be a rate-limit/bot-throttle response rather "
            f"than the real page."
        )
    if not out:
        # Second guard, same incident: a real run came back with the
        # Date/Opponent/Score table genuinely found (found_table=True,
        # so the check above didn't fire) but ZERO of its rows had a
        # link in the Score cell -- for a completed ~30-game season
        # that's implausible (confirmed live minutes earlier: 33/30
        # real links found the same way for these same two teams).
        # Most likely a throttled response that still has the right
        # table skeleton/row count but strips the interactive <a>
        # elements out of each cell. A handful of missing links mixed
        # in with real ones is normal (not every game has a posted box
        # score) and stays silent; ALL of them missing at once is not.
        raise PrestoError(
            f"Date/Opponent/Score table found at {gamelog_url} but 0 rows had a "
            f"Score-cell link ({len(html)} bytes fetched) -- implausible for a "
            f"completed season; likely a throttled/stripped response rather than "
            f"the real page."
        )
    return out


def get_team_page_games(team_page_url):
    """DEPRECATED -- see get_gamelog_boxscore_links() above, the real
    replacement. Scrapes the team-hub page's Date/Opponent/Result table
    for box score links, appending '?view=boxscore' to each. Kept only
    for reference. Returns [{'url': ...}], de-duplicated by URL."""
    html = _get_html(team_page_url)
    soup = BeautifulSoup(html, "lxml")
    seen = set()
    out = []
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        header_cells = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]
        if tuple(header_cells[:3]) != DATE_OPPONENT_RESULT:
            continue
        for tr in rows[1:]:
            cells = tr.find_all(["th", "td"])
            if len(cells) < 3:
                continue
            link = cells[2].find("a", href=True)
            if not link:
                continue
            href = link["href"]
            full_url = href if href.startswith("http") else requests.compat.urljoin(team_page_url, href)
            sep = "&" if "?" in full_url else "?"
            box_url = full_url if "view=boxscore" in full_url else f"{full_url}{sep}view=boxscore"
            if box_url in seen:
                continue
            seen.add(box_url)
            out.append({"url": box_url})
    return out


# BUG FIXED HERE (second version): the first version of this function
# only matched a `data-boxscore="..."` attribute, found via the user's
# Network-tab response-body search on Ferris State's page (33/33 games
# matched that way). But confirmed live on Tampa's page (user expanded
# a collapsed "December" accordion section and pasted the raw HTML): a
# DIFFERENT month on the SAME page used a completely different, plain
# `href="/sports/wbkb/2025-26/boxscores/20251203_y8al.xml"` directly on
# the <a> tag -- no data-boxscore attribute at all for that game. Only
# 10 of Tampa's ~30 games (exactly November's count) were being found
# because only November happened to use the data-boxscore-attribute
# template; every other month used the plain-href template instead.
# Rather than chase a third/fourth template variant later, this now
# matches the box-score URL PATTERN ITSELF anywhere it appears in the
# raw HTML text, regardless of which attribute (data-boxscore, href, or
# anything else) it's sitting inside of.
BOXSCORE_URL_RE = re.compile(r'(/sports/[a-z0-9]+/\d{4}-\d{2}/boxscores/[^"\'\s]+\.xml)', re.IGNORECASE)


def get_schedule_boxscore_links(schedule_url):
    """The REAL, complete source of a season's box score links -- the
    '/schedule' page (not the team-hub page used by get_team_page_games
    above, which is now DEPRECATED -- confirmed live to only have 6 of
    33 real Ferris State games in its static Date/Opponent/Result
    table).

    The '/schedule' page itself returns 0 <table> elements and 0
    <a href> links matching a naive box-score text/href pattern on a
    plain fetch -- it LOOKS empty at first glance. This was investigated
    at length: an iframe glimpsed in DevTools turned out to be an
    unrelated Twitter embed widget (a red herring), and a Network-tab
    Fetch/XHR scan found no separate JSON API call being made either.
    Expanding a collapsed month's accordion in the browser fires no new
    network request at all -- confirmed live (Tampa, December) -- so
    every month's data is already present in the ONE plain fetch this
    function makes; it just isn't laid out consistently.

    The actual answer, found via the user searching the Network tab's
    RESPONSE BODIES (not just request names) for the literal string
    "boxscore": the full game list IS present in the plain-fetched raw
    HTML of '/schedule' itself -- but NOT in one consistent place.
    Confirmed live across two schools that the box score URL shows up
    embedded in the HTML via at least two different templates: a
    `data-boxscore="..."` attribute (Ferris State; also Tampa's
    November games specifically) that a client-side script reads to
    build the visible "Box Score" button's real href at runtime, AND a
    plain, already-real `href="..."` directly on the <a> tag (Tampa's
    December games, and presumably other months/schools). Rather than
    keep chasing template variants one at a time, BOXSCORE_URL_RE above
    matches the URL pattern itself anywhere it occurs in the raw HTML
    text, independent of which attribute wraps it.

    Returns [{'url': ...}], each with '?view=boxscore' appended (still
    required for the real box score page content -- see module
    docstring point 2), de-duplicated by URL."""
    html = _get_html(schedule_url)
    seen = set()
    out = []
    for href in BOXSCORE_URL_RE.findall(html):
        full_url = href if href.startswith("http") else requests.compat.urljoin(schedule_url, href)
        sep = "&" if "?" in full_url else "?"
        box_url = full_url if "view=boxscore" in full_url else f"{full_url}{sep}view=boxscore"
        if box_url in seen:
            continue
        seen.add(box_url)
        out.append({"url": box_url})
    return out


BOX_SCORE_HEADER_SIGNATURE = {"Player", "MIN", "PTS"}


def _find_player_boxscore_tables(soup):
    """See module docstring point 6 -- the same two team tables can
    appear multiple times on one page (confirmed live: anywhere from 3
    to 5 copies per team depending on the game, not a fixed count).

    BUG FIXED HERE (first version of this function): originally
    de-duplicated by each table's raw `get_text(strip=True)` as a
    signature, on the theory that repeated copies are byte-for-byte
    identical. Confirmed live this doesn't hold -- a real run against
    Ferris State and Tampa found 10 (or 6) "unique" tables instead of 2
    every single time, meaning every duplicate copy's whitespace/
    formatting differs just enough (presumably each UI tab -- Box Score/
    Play by Play/Team Stats/Coach's View -- renders its own copy from
    the same underlying data with slightly different template
    whitespace) that no two copies' text ever matched exactly.

    Fix: don't try to detect duplicates at all -- rely on confirmed
    document order instead. diag_roster_table.py's dump against a real
    page showed the tables always appear as consistent, alternating
    (home, away) pairs in a stable order (table[1]/[2], then the exact
    same pair repeated at [9]/[10], [11]/[12], etc.) -- so the FIRST two
    tables matching the header signature are always the real ones,
    regardless of how many repeats follow. Stops scanning as soon as 2
    are found."""
    tables = []
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        header_cells = {c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])}
        if BOX_SCORE_HEADER_SIGNATURE <= header_cells:
            tables.append(table)
        if len(tables) >= 2:
            break
    return tables


def _find_final_score_table(soup):
    """The quarter-by-quarter score table (headers start with 'Final')
    -- used to pull each team's name and final score. Also duplicated
    multiple times on the page like the player tables; only the first
    copy is used since they're identical."""
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        header_cells = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]
        if header_cells and header_cells[0] == "Final":
            return table
    return None


def parse_boxscore(html, url):
    """Returns the same shape as sidearm_client.parse_boxscore():
    {'teams': [{'name','score','players':[...]}, ...]} -- exactly 2
    teams, in whatever order the page lists them (same caveat as
    Sidearm: don't trust this order to mean home/away, match by roster
    overlap in the caller instead)."""
    soup = BeautifulSoup(html, "lxml")

    score_table = _find_final_score_table(soup)
    team_meta = []  # [(name, score), ...] in page order
    if score_table is not None:
        for tr in score_table.find_all("tr")[1:]:
            cells = tr.find_all(["th", "td"])
            if not cells:
                continue
            name = cells[0].get_text(strip=True)
            score = None
            if len(cells) > 1:
                score = parse_int(cells[-1].get_text(strip=True))
            team_meta.append((name, score))

    player_tables = _find_player_boxscore_tables(soup)
    if len(player_tables) != 2:
        raise PrestoError(
            f"Expected 2 box score tables at {url}, found {len(player_tables)} -- "
            "page layout may differ from what this parser expects."
        )

    teams = []
    for i, table in enumerate(player_tables):
        rows = table.find_all("tr")
        headers = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]

        players = []
        in_starters = False
        for tr in rows[1:]:
            cells = tr.find_all(["th", "td"])
            if not cells:
                continue
            label = cells[0].get_text(strip=True)
            label_upper = label.upper()
            if label_upper == "STARTERS":
                in_starters = True
                continue
            if label_upper == "RESERVES":
                in_starters = False
                continue

            parsed_label = _parse_player_row_label(label)
            if parsed_label is None:
                continue  # TM-TEAM / TOTALS / shooting-pct row / anything else non-player
            jersey, name, position = parsed_label
            name = _clean_presto_name(name)

            link = cells[0].find("a", href=True)
            pid_m = PLAYER_LINK_ID_RE.search(link["href"]) if link else None
            external_id = pid_m.group(1) if pid_m else None

            cell_texts = [c.get_text(strip=True) for c in cells]
            row = dict(zip(headers, cell_texts))

            players.append({
                "external_id": external_id,
                "name": name,
                "jersey": jersey,
                "position": position,
                "starter": in_starters,
                "min": row.get("MIN"),
                "fg": row.get("FGM-A"),
                "3pt": row.get("3PM-A"),
                "ft": row.get("FTM-A"),
                "oreb": row.get("OREB"),
                "dreb": row.get("DREB"),
                "reb": row.get("REB"),
                "ast": row.get("AST"),
                "stl": row.get("STL"),
                "blk": row.get("BLK"),
                "to": row.get("TO"),
                "pf": row.get("PF"),
                "pts": row.get("PTS"),
            })

        name, score = (None, None)
        if i < len(team_meta):
            name, score = team_meta[i]
        teams.append({"name": name, "score": score, "players": players})

    return {"teams": teams}


def get_boxscore(url):
    try:
        html = _get_html(url, min_bytes=100000)
    except sidearm.SidearmError as exc:
        # See get_roster()'s identical fix for why this is needed --
        # this one matters most: an uncaught SidearmError here was
        # confirmed live to abort an entire team's remaining games
        # (Tampa, 29 of 30 games never attempted) over ONE persistently
        # -throttled box score URL.
        raise PrestoError(str(exc)) from exc
    return parse_boxscore(html, url)
