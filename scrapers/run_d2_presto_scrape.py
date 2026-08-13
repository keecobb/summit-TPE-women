"""D2 scraper for PrestoSports-hosted teams (18 D2 teams tagged
SiteType="Presto" in the Teams sheet) -- rosters, schedules, and full
box scores, written into WomensSummitTPE.xlsx.

Deliberately a SEPARATE script from run_d2_scrape.py (the Sidearm one)
rather than a shared-module refactor, per an explicit choice: faster to
build and zero risk to the already-working Sidearm scraper, at the cost
of duplicating the Context/player-identity/PlayerSeasons-upsert logic
between the two files. If a bug like the Division mislabeling one (see
process_boxscore_side() below, already fixed here from the start) ever
needs fixing again, it has to be applied in BOTH files -- worth knowing
if this project's scope grows much further.

Built on presto_client.py, verified against two real schools (Ferris
State, Tampa) via a long diagnostic bootstrap process -- see that
module's docstring for everything confirmed live about PrestoSports'
page structure. Follows the exact same Context/process_team/finalize
architecture as run_d2_scrape.py so the two scrapers' output is
structurally identical in the workbook.

URL SHAPE: unlike Sidearm, the Teams sheet's "Roster URL" for every
Presto team stores the team-hub/stats page
(".../sports/<code>/<season>/teams/<slug>") rather than an actual
roster page. This script derives the actual per-season roster and game
log URLs from that one stored URL -- see presto_url_parts()/
roster_url()/gamelog_url(). Two earlier approaches were tried and
deprecated before landing on the game log page:
  1. team_page_url()/get_team_page_games() -- the team-hub page's
     static Date/Opponent/Result table, only 6 of 33 real Ferris State
     games.
  2. schedule_url()/get_schedule_boxscore_links() -- the '/schedule'
     page, which turned out to embed box score links via at least two
     different inconsistent HTML templates depending on school/month,
     and for ~20 of Tampa's ~30 games the link wasn't present as text
     anywhere in that page's raw response at all.
The '<team-hub-url>?view=gamelog' page's Score-cell links (see
presto_client.get_gamelog_boxscore_links()) are the real, reliable
source -- confirmed live to match a team's actual season record
exactly, with genuinely-missing box scores (not all games have one
posted) simply having no link, cleanly distinguishable from a parsing
failure.

Usage:
    python scrapers/run_d2_presto_scrape.py
    python scrapers/run_d2_presto_scrape.py --seasons 2025-26
    python scrapers/run_d2_presto_scrape.py --only "Ferris State,Tampa"
"""

import argparse
import csv
import datetime
import difflib
import os
import re
import sys
import time
from collections import defaultdict
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import presto_client as presto
from scrapers.xlsx_io import (
    append_row, append_rows, ensure_columns, header_map, iter_data_rows,
    open_workbook, save_with_retry, wipe_data_rows,
)

LAST_REVISED = "2026-07-27 (support 'stats/<season>' hub URL shape)"

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")
DEFAULT_SEASONS = ["2025-26"]
CHECKPOINT_EVERY = 4
SLEEP_BETWEEN_TEAMS = 2.0
SLEEP_BETWEEN_GAMES = 0.8
CONSECUTIVE_FAILURE_LIMIT = 2  # circuit breaker -- see process_team()'s box score loop
FUZZY_THRESHOLD = 0.87

PLAYER_NEW_COLUMNS = ["External ID", "Source", "Division", "Transfer History", "Schools Attended"]
PLAYER_SEASONS_HEADERS = [
    "Player ID", "Season", "Team ID", "Division", "Position", "Height",
    "Class", "Games Played", "Games Started", "Finished",
]
PLAYER_SEASONS_NEW_COLUMNS = ["Team Name"]

# Shared with run_d2_scrape.py deliberately -- overrides correct a
# specific person's identity match regardless of which scraper found
# them, and Player IDs are shared across the whole workbook (D1, Sidearm
# D2, and now Presto D2 all draw from the same Players sheet/ID space).
OVERRIDES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "d2_player_overrides.csv")

CLASS_MAP = {
    "fr.": "FR", "fr": "FR", "freshman": "FR",
    "so.": "SO", "so": "SO", "sophomore": "SO",
    "jr.": "JR", "jr": "JR", "junior": "JR",
    "sr.": "SR", "sr": "SR", "senior": "SR",
    "gr.": "GR", "gr": "GR", "graduate": "GR", "grad": "GR",
}


def normalize_text(value):
    if not value:
        return ""
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9 ]", "", value)
    value = re.sub(r"\s+", " ", value)
    return value


INSTITUTION_SUFFIX_RE = re.compile(r"\b(university|college|univ)\b")

# Standard NCAA-style state-name abbreviations, confirmed live via a
# full-workbook audit (task #46): 5,742 unresolved opponent-name
# occurrences across 1,060 distinct names, of which these abbreviations
# alone account for 1,311 occurrences / 51 distinct names -- every one
# hand-verified correct ("N.M. Highlands" -> "New Mexico Highlands",
# "Cal St. Dom. Hills" -> "Cal State Dominguez Hills", "Truman St." ->
# "Truman State", etc.). A separate, much larger-looking "mascot suffix"
# match (dropping trailing words like "Islanders"/"Cowboys") was tested
# and REJECTED -- it produced real false positives ("Minnesota St." ->
# wrongly matched "Minnesota", "Cal Poly Pomona" -> wrongly matched "Cal
# Poly", "USC Beaufort" -> wrongly matched "USC"), so only this
# deterministic, information-preserving abbreviation table is applied.
# "St." is deliberately NOT in this dict -- see expand_state_abbreviations().
STATE_ABBR_MAP = {
    "mo.": "missouri", "conn.": "connecticut", "n.h.": "new hampshire",
    "okla.": "oklahoma", "wash.": "washington", "neb.": "nebraska", "ark.": "arkansas",
    "fla.": "florida", "colo.": "colorado", "ga.": "georgia", "n.m.": "new mexico",
    "ill.": "illinois", "mich.": "michigan", "minn.": "minnesota", "wis.": "wisconsin",
    "tenn.": "tennessee", "mass.": "massachusetts", "calif.": "california", "ky.": "kentucky",
    "ind.": "indiana", "tex.": "texas", "ala.": "alabama", "miss.": "mississippi",
    "va.": "virginia", "n.c.": "north carolina", "s.c.": "south carolina", "n.d.": "north dakota",
    "s.d.": "south dakota", "penn.": "pennsylvania", "sch.": "school", "dom.": "dominguez",
    "atl.": "atlantic",
    # Added task #56 (round 3), kept in sync with run_d2_scrape.py's
    # identical dict -- see that file's comment for the two confirmed
    # cases ("San Fran. St." -> San Francisco State, "American Int'l" ->
    # American International).
    "fran.": "francisco", "int'l": "international",
}

# Added task #56, kept in sync with run_d2_scrape.py's identical dict --
# see that file's comment for the full rationale and per-school
# verification notes (Roster URL/mascot checked for each before adding).
TEAM_NAME_ALIASES = {
    484: ["Cal Poly Humboldt"],
    536: ["MSU Moorhead", "Minnesota State Moorhead"],
    595: ["Southern New Hampshire"],
    648: ["Western Colorado", "Western Colo."],
    487: ["UIndy"],
    592: ["USC Beaufort"],
    591: ["USC Aiken"],
    542: ["UNC Pembroke"],
}


def narrow_normalize(value):
    """State-abbreviation expansion + normalize_text() only -- no
    University/College suffix stripping. See run_d2_scrape.py's
    identical helper for the full rationale."""
    return normalize_text(expand_state_abbreviations(value or ""))


def strip_trailing_parenthetical(value):
    """See run_d2_scrape.py's identical helper for the full rationale."""
    return re.sub(r"\s*\([^)]*\)\s*$", "", value or "").strip()


def _tier1_keys(name, full):
    """See run_d2_scrape.py's identical helper for the full rationale.
    Kept in sync deliberately."""
    keys = set()
    if name:
        keys.add(normalize_text(name))
        keys.add(narrow_normalize(name))
        keys.add(narrow_normalize(name.replace("-", " ")))
        if full:
            keys.add(normalize_team_name(name))
    keys.discard("")
    return keys


def _tier2_keys(name, team_id):
    """See run_d2_scrape.py's identical helper for the full rationale --
    kept as a SEPARATE tier from _tier1_keys() because merging these
    into one flat collision pool broke 4 previously-working exact
    matches ("California (PA)" colliding with "California", etc.)."""
    keys = set()
    for alias in TEAM_NAME_ALIASES.get(team_id, []):
        keys.add(narrow_normalize(alias))
    if name:
        stripped = strip_trailing_parenthetical(name)
        if stripped and stripped != name:
            keys.add(narrow_normalize(stripped))
    keys.discard("")
    return keys


def build_team_index(name_team_pairs, full=False):
    """See run_d2_scrape.py's identical helper for the full rationale.
    Kept in sync deliberately."""
    tier1 = defaultdict(set)
    tier2 = defaultdict(set)
    for name, team_id in name_team_pairs:
        if team_id is None:
            continue
        for key in _tier1_keys(name, full):
            tier1[key].add(team_id)
        for key in _tier2_keys(name, team_id):
            tier2[key].add(team_id)

    index = {key: next(iter(ids)) for key, ids in tier1.items() if len(ids) == 1}
    for key, ids in tier2.items():
        if key in index:
            continue
        if len(ids) == 1:
            index[key] = next(iter(ids))
    return index


def expand_state_abbreviations(value):
    """Expands standard NCAA-style state abbreviations before the rest of
    normalize_team_name() runs -- see STATE_ABBR_MAP's comment for the
    audit numbers this was built and verified against.

    "St." is handled separately from the dict above, not as a blanket
    word swap: every one of the 51 confirmed-correct matches has "St."
    meaning "State" and NOT in the first word position ("Truman St.",
    "Cal St. Dom. Hills", ...), while real "Saint ..." schools in this
    dataset always spell "Saint" out in full when it's the first word
    ("Saint Francis", "Saint Leo" -- confirmed in the audit sample) and
    only ever abbreviate the trailing "State" as "St." Only expanding
    "St." when it is NOT the first word captures every real case without
    ever risking turning a real "St. Mary's"/"St. Cloud St."-style name
    into a wrong "State Mary's" guess."""
    if not value:
        return value
    words = value.split()
    out = []
    for i, w in enumerate(words):
        key = w.lower().rstrip(",")
        if key in ("st.", "st") and i > 0:
            out.append("State")
        else:
            out.append(STATE_ABBR_MAP.get(key, w))
    return " ".join(out)


def normalize_team_name(value):
    """normalize_text(), plus expand_state_abbreviations() (see above)
    and stripping trailing institution words like "University"/
    "College"/"Univ." -- some conferences' box scores render opponent
    names in this full formal style ("Holy Family University") while
    the Teams sheet uses the short branding name ("Holy Family"), so
    resolve_opponent_team_id() never matched them. Deliberately a
    SEPARATE function from normalize_text() rather than changing it in
    place -- normalize_text() is also used for player name matching,
    where this extra processing is harmless but pointless; keeping this
    isolated avoids any risk of touching player-identity matching by
    accident."""
    text = expand_state_abbreviations(value or "")
    text = normalize_text(text)
    text = INSTITUTION_SUFFIX_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_name_key(value):
    """Order-insensitive -- see run_d2_scrape.py's identical helper for
    why (Sidearm confirmed roster-page vs box-score-page name-order
    mismatches; not yet specifically confirmed on a Presto site, but
    cheap insurance and keeps behavior consistent between the two
    scrapers)."""
    return " ".join(sorted(normalize_text(value).split()))


def normalize_height(value):
    if not value:
        return None
    m = re.match(r"(\d+)-(\d+)", str(value).strip())
    if not m:
        return str(value).strip() or None
    feet, inches = m.group(1), m.group(2)
    return f"{feet}' {inches}\""


def normalize_class(value):
    if not value:
        return None
    key = str(value).strip().lower()
    return CLASS_MAP.get(key, str(value).strip())


def presto_url_parts(stored_url):
    """stored_url is normally the 'teams/<slug>' team-hub page URL.
    Returns (base_url, sport_code, team_slug, hub_style). Example:
        stored: https://ferrisstatebulldogs.com/sports/wbkb/2025-26/teams/ferrisst
        -> ('https://ferrisstatebulldogs.com', 'wbkb', 'ferrisst', 'teams')

    BUG FIXED HERE: confirmed live (Millersville, St. Cloud State) --
    at least one other Presto template uses a DIFFERENT team-hub URL
    shape entirely, with no team slug and 'stats' BEFORE the season
    instead of 'teams/<slug>' after it:
        stored: https://millersvilleathletics.com/sports/womens-basketball/stats/2025-26
        -> ('https://millersvilleathletics.com', 'womens-basketball', None, 'stats')
    Both teams failed every single run with "Could not parse sport
    code/team slug" since the original version only recognized the
    'teams' shape at all. hub_style tells team_page_url() below which
    shape to reconstruct for a different season."""
    parsed = urlparse(str(stored_url))
    parts = [p for p in parsed.path.split("/") if p]
    sport_code = parts[1] if len(parts) > 1 and parts[0] == "sports" else None
    team_slug = None
    hub_style = None
    if "teams" in parts:
        idx = parts.index("teams")
        if len(parts) > idx + 1:
            team_slug = parts[idx + 1]
            hub_style = "teams"
    elif "stats" in parts:
        hub_style = "stats"
    return f"{parsed.scheme}://{parsed.netloc}", sport_code, team_slug, hub_style


def roster_url(base_url, sport_code, season):
    return f"{base_url}/sports/{sport_code}/{season}/roster"


def team_page_url(base_url, sport_code, season, team_slug, hub_style="teams"):
    if hub_style == "stats":
        return f"{base_url}/sports/{sport_code}/stats/{season}"
    return f"{base_url}/sports/{sport_code}/{season}/teams/{team_slug}"


def schedule_url(base_url, sport_code, season):
    """DEPRECATED -- see gamelog_url() below, the real replacement.
    Same URL shape as roster_url(), just 'schedule' instead of
    'roster'."""
    return f"{base_url}/sports/{sport_code}/{season}/schedule"


def gamelog_url(base_url, sport_code, season, team_slug, hub_style="teams"):
    """The real, complete, reliable source of a season's box score
    links -- see presto_client.get_gamelog_boxscore_links() for the
    full story on why the team-hub page (team_page_url) and the
    '/schedule' page (schedule_url) were both replaced by this. Same
    team-hub URL already stored in the Teams sheet, just with
    '?view=gamelog' appended."""
    return f"{team_page_url(base_url, sport_code, season, team_slug, hub_style)}?view=gamelog"


def load_overrides():
    if not os.path.exists(OVERRIDES_PATH):
        with open(OVERRIDES_PATH, "w", newline="") as f:
            csv.writer(f).writerow(["Wrong Key (first|last|hometown)", "Correct Player ID"])
        return {}
    overrides = {}
    with open(OVERRIDES_PATH, newline="") as f:
        for row in csv.DictReader(f):
            key = (row.get("Wrong Key (first|last|hometown)") or "").strip()
            pid = (row.get("Correct Player ID") or "").strip()
            if key and pid:
                overrides[key] = int(pid)
    return overrides


class Context:
    """Identical shape to run_d2_scrape.py's Context -- see that file
    for detailed comments on the identity-resolution/upsert logic this
    duplicates. The only functional difference: resolve_player_id()
    writes Source="Presto" instead of "Sidearm" below."""

    def __init__(self, wb):
        self.wb = wb
        self.teams_ws = wb["Teams"]
        self.players_ws = wb["Players"]
        self.games_ws = wb["Games"]
        self.pgs_ws = wb["PlayerGameStats"]
        self.seasons_ws = wb["PlayerSeasons"]

        self.teams_hmap = header_map(self.teams_ws)
        self.players_hmap = ensure_columns(self.players_ws, PLAYER_NEW_COLUMNS)
        self.games_hmap = header_map(self.games_ws)
        self.pgs_hmap = header_map(self.pgs_ws)

        self.team_rows = []
        self.team_id_to_info = {}
        self.team_id_to_conf = {}
        self.team_name_norm_to_id = {}
        self._load_teams()

        self.person_key_to_player_id = {}
        self.name_team_to_player_id = {}
        self.next_player_id = 1
        self._load_players()

        self.overrides = load_overrides()

        self.games_seen = set()
        self.next_row_players = self.players_ws.max_row + 1
        self.next_row_games = self.games_ws.max_row + 1
        self.next_row_pgs = self.pgs_ws.max_row + 1
        self._load_games_seen()

        # See run_d2_scrape.py's Context for the full incident writeup
        # (936 duplicate Games rows found across the D2 dataset,
        # confirmed live via Ferris State/Tampa vs already-Sidearm-
        # scraped opponents like Grand Valley State) -- games_seen
        # (keyed by each site's own opaque Game ID) can't catch a game
        # scraped once from EACH participating team's own site. Same
        # fix duplicated here per this project's separate-script
        # architecture.
        self.games_by_score_key = {}
        self._load_games_score_index()

        self.season_agg = {}

    def _load_teams(self):
        h = self.teams_hmap
        # BUG FIXED HERE: see run_d2_scrape.py's identical fix for the
        # full rationale -- writing straight into team_name_norm_to_id
        # inside this loop let a normalized-name collision between two
        # DIFFERENT real teams ("Boston College" / "Boston University",
        # both strip to "boston") silently resolve to whichever row came
        # last, a deterministic mis-resolution risk for any third team's
        # box score naming either school as an opponent. Collect every
        # (key -> team_id) candidate first, then only keep a key in the
        # final index if every candidate for it agrees on one team_id.
        name_team_pairs = []
        for row in range(2, self.teams_ws.max_row + 1):
            name = self.teams_ws.cell(row=row, column=h["Team"]).value
            if not name:
                continue
            team_id = self.teams_ws.cell(row=row, column=h["Team ID"]).value
            division = self.teams_ws.cell(row=row, column=h["Division"]).value
            conference = self.teams_ws.cell(row=row, column=h["Conference"]).value
            roster_url_val = self.teams_ws.cell(row=row, column=h["Roster URL"]).value
            site_type = self.teams_ws.cell(row=row, column=h["SiteType"]).value
            status = self.teams_ws.cell(row=row, column=h["Scrape Status"]).value
            last_seasons = self.teams_ws.cell(row=row, column=h["Last Scraped Season"]).value

            info = {
                "row": row, "team_id": team_id, "name": name, "division": division,
                "conference": conference, "roster_url": roster_url_val, "site_type": site_type,
                "status": status, "done_seasons": set((last_seasons or "").split(",")) - {""},
            }
            self.team_rows.append(info)
            if team_id is not None:
                self.team_id_to_info[team_id] = info
                self.team_id_to_conf[team_id] = conference
                name_team_pairs.append((name, team_id))

        # task #56 round 3: shared, tier-aware index builder -- see
        # run_d2_scrape.py's build_team_index() docstring for the
        # tier-1/tier-2 priority fix.
        self.team_name_norm_to_id = build_team_index(name_team_pairs, full=True)

    def _load_players(self):
        h = self.players_hmap
        max_id = 0
        for row in range(2, self.players_ws.max_row + 1):
            pid = self.players_ws.cell(row=row, column=h["Player ID"]).value
            first = self.players_ws.cell(row=row, column=h["First Name"]).value
            last = self.players_ws.cell(row=row, column=h["Last Name"]).value
            team_id = self.players_ws.cell(row=row, column=h["Team ID"]).value
            if pid:
                max_id = max(max_id, pid)
            if first and last:
                nt_key = (team_id, normalize_text(first), normalize_text(last))
                self.name_team_to_player_id.setdefault(nt_key, pid)
        self.next_player_id = max_id + 1

    def _load_games_seen(self):
        h = self.games_hmap
        col = h["Game ID"]
        for row in range(2, self.games_ws.max_row + 1):
            gid = self.games_ws.cell(row=row, column=col).value
            if gid:
                self.games_seen.add(str(gid))

    def _load_games_score_index(self):
        h = self.games_hmap
        for row in range(2, self.games_ws.max_row + 1):
            season = self.games_ws.cell(row=row, column=h["Season"]).value
            home_id = self.games_ws.cell(row=row, column=h["Home Team ID"]).value
            away_id = self.games_ws.cell(row=row, column=h["Away Team ID"]).value
            home_score = self.games_ws.cell(row=row, column=h["Home Score"]).value
            away_score = self.games_ws.cell(row=row, column=h["Away Score"]).value
            gid = self.games_ws.cell(row=row, column=h["Game ID"]).value
            if home_id is None or away_id is None or home_score is None or away_score is None:
                continue
            if home_id <= away_id:
                pair, scores = (home_id, away_id), (home_score, away_score)
            else:
                pair, scores = (away_id, home_id), (away_score, home_score)
            self.games_by_score_key[(season, pair, scores)] = gid

    def find_duplicate_game(self, season, team_a, team_b, score_a, score_b):
        """Returns the existing Game ID if a game between this team
        pair, same season, with these exact final scores has already
        been recorded (by either side, under any Game ID) -- or None."""
        if score_a is None or score_b is None or team_a is None or team_b is None:
            return None
        if team_a <= team_b:
            pair, scores = (team_a, team_b), (score_a, score_b)
        else:
            pair, scores = (team_b, team_a), (score_b, score_a)
        return self.games_by_score_key.get((season, pair, scores))

    def note_person_key(self, player_id, first, last, hometown):
        if not hometown:
            return
        key = (normalize_text(first), normalize_text(last), normalize_text(hometown))
        self.person_key_to_player_id.setdefault(key, player_id)

    def resolve_player_id(self, first, last, hometown, team_id, position, division,
                           height=None, class_year=None):
        override_key = f"{normalize_text(first)}|{normalize_text(last)}|{normalize_text(hometown)}"
        if override_key in self.overrides:
            pid = self.overrides[override_key]
            self.note_person_key(pid, first, last, hometown)
            return pid

        key = (normalize_text(first), normalize_text(last), normalize_text(hometown)) if hometown else None
        if key and key in self.person_key_to_player_id:
            return self.person_key_to_player_id[key]

        weak_key = (team_id, normalize_text(first), normalize_text(last))
        if weak_key in self.name_team_to_player_id:
            pid = self.name_team_to_player_id[weak_key]
            self.note_person_key(pid, first, last, hometown)
            return pid

        pid = self.next_player_id
        self.next_player_id += 1

        h = self.players_hmap
        row = self.next_row_players
        self.next_row_players += 1
        self.players_ws.cell(row=row, column=h["Player ID"], value=pid)
        self.players_ws.cell(row=row, column=h["First Name"], value=first)
        self.players_ws.cell(row=row, column=h["Last Name"], value=last)
        self.players_ws.cell(row=row, column=h["Team ID"], value=team_id)
        self.players_ws.cell(row=row, column=h["Position"], value=position)
        self.players_ws.cell(row=row, column=h["Height"], value=height)
        self.players_ws.cell(row=row, column=h["Class"], value=class_year)
        self.players_ws.cell(row=row, column=h["Finished"], value="Yes")
        self.players_ws.cell(row=row, column=h["Source"], value="Presto")
        self.players_ws.cell(row=row, column=h["Division"], value=division)

        self.note_person_key(pid, first, last, hometown)
        self.name_team_to_player_id.setdefault((team_id, normalize_text(first), normalize_text(last)), pid)
        return pid

    def resolve_opponent_team_id(self, name):
        if not name:
            return None
        norm = normalize_team_name(name)
        if norm in self.team_name_norm_to_id:
            return self.team_name_norm_to_id[norm]
        close = difflib.get_close_matches(norm, list(self.team_name_norm_to_id.keys()), n=1, cutoff=FUZZY_THRESHOLD)
        if close:
            return self.team_name_norm_to_id[close[0]]
        return None

    def note_season_stat(self, player_id, season, team_id, division, position,
                          height, class_year, gs):
        key = (player_id, season)
        agg = self.season_agg.setdefault(key, {
            "team_id": team_id, "division": division, "position": position,
            "height": height, "class_year": class_year, "games": 0, "starts": 0,
        })
        agg["team_id"] = team_id
        agg["division"] = division
        if position:
            agg["position"] = position
        if height:
            agg["height"] = height
        if class_year:
            agg["class_year"] = class_year
        agg["games"] += 1
        if gs:
            agg["starts"] += 1

    def write_game_row(self, game_id, date, season, home_team_id, home_name,
                        away_team_id, away_name, home_score, away_score):
        h = self.games_hmap
        row = self.next_row_games
        self.next_row_games += 1

        winner_id = None
        margin = None
        if home_score is not None and away_score is not None:
            winner_id = home_team_id if home_score > away_score else away_team_id
            margin = home_score - away_score

        conf_game = None
        if home_team_id in self.team_id_to_conf and away_team_id in self.team_id_to_conf:
            conf_game = self.team_id_to_conf[home_team_id] == self.team_id_to_conf[away_team_id]

        values = {
            "Game ID": game_id, "Date": date, "Season": season,
            "Home Team ID": home_team_id, "Home Team": home_name,
            "Away Team ID": away_team_id, "Away Team": away_name,
            "conference Game": conf_game, "Conference Game": conf_game,
            "Home Score": home_score, "Away Score": away_score,
            "Winner": winner_id, "Margin": margin,
        }
        for key, val in values.items():
            col = h.get(key)
            if col:
                self.games_ws.cell(row=row, column=col, value=val)
        self.games_seen.add(str(game_id))

        # BUG FIXED HERE: confirmed live, crashed EVERY game for
        # EVERY team in the first real 15-team batch run the moment an
        # opponent's Team ID couldn't be resolved (untracked/unmatched
        # opponent -- ctx.resolve_opponent_team_id() returns None for
        # those, a normal, expected case) -- this guarded against None
        # SCORES but not None TEAM IDS, so home_team_id <= away_team_id
        # raised "'<=' not supported between instances of 'int' and
        # 'NoneType'", an uncaught TypeError that aborted the entire
        # team's remaining games via main()'s outer catch-all.
        if (
            home_score is not None and away_score is not None
            and home_team_id is not None and away_team_id is not None
        ):
            if home_team_id <= away_team_id:
                pair, scores = (home_team_id, away_team_id), (home_score, away_score)
            else:
                pair, scores = (away_team_id, home_team_id), (away_score, home_score)
            self.games_by_score_key[(season, pair, scores)] = game_id

    def write_player_game_stat(self, player_id, team_id, opponent_name, opponent_team_id,
                                opponent_level, date, gs, minutes, fgm, fga, fg3m, fg3a,
                                ftm, fta, rebound, foul, ast, to, blk, stl, points,
                                game_id, season):
        h = self.pgs_hmap
        row = self.next_row_pgs
        self.next_row_pgs += 1
        values = {
            "Player ID": player_id, "Team ID": team_id, "Opponent": opponent_name,
            "Opponent Team ID": opponent_team_id, "Opponent Level": opponent_level,
            "Date": date, "GS": "Yes" if gs else "No", "Min": minutes,
            "FG Made": fgm, "FG Attempt": fga, "3FG M": fg3m, "3FG A": fg3a,
            "FT M": ftm, "FT A": fta, "Rebound": rebound, "Foul": foul,
            "Ast": ast, "To": to, "Blk": blk, "Stl": stl, "Points": points,
            "Game ID": game_id, "Season": season,
        }
        for key, val in values.items():
            col = h.get(key)
            if col:
                self.pgs_ws.cell(row=row, column=col, value=val)

    def mark_team_status(self, info, status, error=None, add_season=None):
        h = self.teams_hmap
        row = info["row"]
        if add_season:
            info["done_seasons"].add(str(add_season))
        self.teams_ws.cell(row=row, column=h["Scrape Status"], value=status)
        self.teams_ws.cell(
            row=row, column=h["Last Scraped Season"],
            value=",".join(sorted(info["done_seasons"])),
        )
        self.teams_ws.cell(row=row, column=h["Scrape Error"], value=error)
        self.teams_ws.cell(
            row=row, column=h["Last Updated"],
            value=datetime.datetime.now().isoformat(timespec="seconds"),
        )


GAME_ID_RE = re.compile(r"/boxscores/([^/?]+)\.xml")


def extract_game_id(boxscore_url):
    m = GAME_ID_RE.search(boxscore_url)
    if m:
        return m.group(1)
    return boxscore_url


def _split_name(full_name):
    name = str(full_name).strip()
    if "," in name:
        last, first = name.split(",", 1)
        return first.strip(), last.strip()
    parts = name.split()
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def process_roster(ctx, info, season, roster_url_val):
    try:
        roster = presto.get_roster(roster_url_val)
    except presto.PrestoError as exc:
        print(f"    [!] roster fetch failed for {info['name']} {season}: {exc}")
        return {}, str(exc)

    by_name = {}
    for p in roster:
        first, last = _split_name(p["name"])
        height = normalize_height(p.get("height"))
        class_year = normalize_class(p.get("class_year"))
        player_id = ctx.resolve_player_id(
            first=first, last=last, hometown=p.get("hometown"),
            team_id=info["team_id"], position=p.get("position"),
            division=info["division"], height=height, class_year=class_year,
        )
        by_name[normalize_name_key(p["name"])] = {
            "player_id": player_id, "position": p.get("position"),
            "height": height, "class_year": class_year,
        }
    return by_name, None


def process_boxscore_side(ctx, season, info, opponent_team_id, opponent_name,
                           opponent_level, date, game_id, team_id, roster_by_name,
                           players):
    # Same Division fix as run_d2_scrape.py's process_boxscore_side() --
    # look up team_id's REAL division from the full Teams sheet rather
    # than blindly trusting info["division"] (which is only correct for
    # the "my side" call, not the opponent side). See that file's
    # comment for the full incident writeup (642 mislabeled rows on the
    # Sidearm side); applying the fix here from the start rather than
    # waiting to discover the same bug independently on Presto data.
    division = ctx.team_id_to_info.get(team_id, {}).get("division") or info["division"]

    for p in players:
        norm_name = normalize_name_key(p["name"])
        roster_entry = roster_by_name.get(norm_name)
        if roster_entry:
            player_id = roster_entry["player_id"]
            position = roster_entry["position"]
            height = roster_entry["height"]
            class_year = roster_entry["class_year"]
        else:
            first, last = _split_name(p["name"])
            player_id = ctx.resolve_player_id(
                first=first, last=last, hometown=None, team_id=team_id,
                position=None, division=division,
            )
            position, height, class_year = None, None, None

        fgm, fga = presto.split_made_attempted(p.get("fg"))
        fg3m, fg3a = presto.split_made_attempted(p.get("3pt"))
        ftm, fta = presto.split_made_attempted(p.get("ft"))

        ctx.write_player_game_stat(
            player_id=player_id, team_id=team_id, opponent_name=opponent_name,
            opponent_team_id=opponent_team_id, opponent_level=opponent_level,
            date=date, gs=p.get("starter"), minutes=presto.parse_float(p.get("min")),
            fgm=fgm, fga=fga, fg3m=fg3m, fg3a=fg3a, ftm=ftm, fta=fta,
            rebound=presto.parse_int(p.get("reb")), foul=presto.parse_int(p.get("pf")),
            ast=presto.parse_int(p.get("ast")), to=presto.parse_int(p.get("to")),
            blk=presto.parse_int(p.get("blk")), stl=presto.parse_int(p.get("stl")),
            points=presto.parse_int(p.get("pts")), game_id=game_id, season=season,
        )

        ctx.note_season_stat(
            player_id=player_id, season=season, team_id=team_id,
            division=division, position=position, height=height,
            class_year=class_year, gs=bool(p.get("starter")),
        )


def process_team(ctx, info, seasons, force=False):
    # BUG FIXED HERE: --force (added in main() below) only bypassed the
    # OUTER skip check in main()'s loop -- this INNER per-season check
    # was a second, separate gate on the exact same info["done_seasons"]
    # data that --force never touched. Confirmed live: several straight
    # "silent 0 games" runs turned out to be this loop returning
    # immediately every time, before even the roster fetch -- "2025-26"
    # had gotten marked done during an early run from BEFORE
    # get_gamelog_boxscore_links() raised loudly on failure, back when
    # a fetch problem could silently succeed with 0 games and still
    # mark the season done.
    any_error = None
    base_url, sport_code, team_slug, hub_style = presto_url_parts(info["roster_url"])
    # team_slug is only required for the "teams" hub_style -- the
    # "stats" hub_style (see presto_url_parts()'s incident comment)
    # needs no slug at all.
    if not sport_code or not hub_style or (hub_style == "teams" and not team_slug):
        error = f"Could not parse sport code/team slug from Roster URL: {info['roster_url']!r}"
        print(f"    [!] {error}")
        ctx.mark_team_status(info, "Failed", error=error)
        return

    for season in seasons:
        if season in info["done_seasons"] and not force:
            continue

        season_error = None
        roster_by_name, roster_error = process_roster(
            ctx, info, season, roster_url(base_url, sport_code, season)
        )
        if roster_error:
            season_error = roster_error
            any_error = season_error

        # Small delay before this second request to the same host --
        # added after two real runs silently returned 0 games for BOTH
        # teams (no exception, no error print) immediately after the
        # roster fetch, right after the exact same gamelog function had
        # just worked correctly in an isolated one-request-per-process
        # diagnostic. Suspected rate-limit/bot-throttle on rapid
        # consecutive requests to the same host; get_gamelog_boxscore_
        # links() now also raises loudly instead of returning [] if
        # this happens again, so this run will surface it as a real
        # error if the delay alone doesn't fix it.
        time.sleep(1.5)
        gl_url = gamelog_url(base_url, sport_code, season, team_slug, hub_style)
        try:
            boxscore_links = presto.get_gamelog_boxscore_links(gl_url)
        except presto.PrestoError as exc:
            season_error = str(exc)
            any_error = season_error
            print(f"    [!] game log page fetch failed for {info['name']} {season}: {exc}")
            continue

        already_seen_count = sum(
            1 for link in boxscore_links if extract_game_id(link["url"]) in ctx.games_seen
        )
        print(
            f"    [debug] {len(boxscore_links)} box score link(s) found, "
            f"{already_seen_count} already in games_seen, "
            f"{len(boxscore_links) - already_seen_count} new"
        )

        consecutive_boxscore_failures = 0
        for link in boxscore_links:
            url = link["url"]
            game_id = extract_game_id(url)
            if game_id in ctx.games_seen:
                continue
            try:
                box = presto.get_boxscore(url)
            except presto.PrestoError as exc:
                season_error = str(exc)
                any_error = season_error
                print(f"    [!] box score failed for {info['name']} ({url}): {exc}")
                consecutive_boxscore_failures += 1
                if consecutive_boxscore_failures >= CONSECUTIVE_FAILURE_LIMIT:
                    # Circuit breaker -- confirmed live (Tampa): once
                    # the site starts returning HTTP 459 (a non-
                    # standard rate-limit/block code, not a transient
                    # blip), it does NOT clear within a few seconds --
                    # every remaining game in that same run failed the
                    # same way, 10 games in a row, each burning 3
                    # retries with growing backoff for nothing. Bailing
                    # out of this team's remaining games early instead
                    # of hammering an active block. Not marking the
                    # season done (season_error stays set), so a later
                    # run (after real cooldown time, no --force needed)
                    # will pick up exactly where this one stopped --
                    # already-recorded games are skipped via
                    # games_seen either way.
                    print(
                        f"    [!] {consecutive_boxscore_failures} consecutive box score "
                        f"failures for {info['name']} -- likely an active rate-limit/block, "
                        f"not transient. Stopping this team's remaining games for now; "
                        f"they'll be retried on a later run."
                    )
                    break
                continue
            consecutive_boxscore_failures = 0

            teams = box["teams"]
            if len(teams) != 2:
                continue

            overlap_counts = []
            for t in teams:
                names = {normalize_name_key(p["name"]) for p in t["players"]}
                overlap_counts.append(len(names & set(roster_by_name.keys())))
            if overlap_counts[0] == overlap_counts[1]:
                print(
                    f"    [!] can't tell which side is {info['name']} at {url} "
                    f"(roster overlap tied {overlap_counts[0]}-{overlap_counts[1]}) -- skipping this game"
                )
                continue
            my_idx = 0 if overlap_counts[0] > overlap_counts[1] else 1
            opp_idx = 1 - my_idx

            my_side = teams[my_idx]
            opp_side = teams[opp_idx]
            opponent_team_id = ctx.resolve_opponent_team_id(opp_side.get("name"))
            opponent_level = ctx.team_id_to_info.get(opponent_team_id, {}).get("division")

            # See Context.games_by_score_key's incident comment -- catches
            # this same real game already having been recorded from the
            # OPPONENT's own site scrape (e.g. a Sidearm D2 opponent
            # already in the dataset), which games_seen (by opaque
            # per-site Game ID) can't detect on its own.
            dup_gid = ctx.find_duplicate_game(
                season, info["team_id"], opponent_team_id,
                my_side.get("score"), opp_side.get("score"),
            )
            if dup_gid:
                print(
                    f"    [skip] {info['name']} vs {opp_side.get('name')} ({my_side.get('score')}-"
                    f"{opp_side.get('score')}) already recorded as Game ID {dup_gid} -- "
                    f"skipping duplicate from the other team's site"
                )
                continue

            ctx.write_game_row(
                game_id=game_id, date=None, season=season,
                home_team_id=info["team_id"], home_name=info["name"],
                away_team_id=opponent_team_id, away_name=opp_side.get("name"),
                home_score=my_side.get("score"), away_score=opp_side.get("score"),
            )

            process_boxscore_side(
                ctx, season, info, opponent_team_id, opp_side.get("name"),
                opponent_level, None, game_id, info["team_id"], roster_by_name,
                my_side["players"],
            )
            process_boxscore_side(
                ctx, season, info, info["team_id"], info["name"],
                info["division"], None, game_id, opponent_team_id or -1,
                roster_by_name, opp_side["players"],
            )

            time.sleep(SLEEP_BETWEEN_GAMES)

        if season_error:
            ctx.mark_team_status(info, "In Progress", error=season_error)
        else:
            ctx.mark_team_status(info, "In Progress", error=None, add_season=season)

    ctx.mark_team_status(info, "Done" if not any_error else "Done with errors", error=any_error)


def finalize(ctx, current_season_label):
    """Identical to run_d2_scrape.py's finalize() -- see that file for
    the detailed comments on the duplicate/undercount bugs this upsert
    logic avoids. Duplicated here rather than shared per the separate-
    script decision."""
    h = ctx.players_hmap = header_map(ctx.players_ws)

    most_recent_by_player = {}
    for (player_id, season), agg in ctx.season_agg.items():
        prev = most_recent_by_player.get(player_id)
        if prev is None or season > prev[0]:
            most_recent_by_player[player_id] = (season, agg)

    for player_id, (season, agg) in most_recent_by_player.items():
        for row in range(2, ctx.players_ws.max_row + 1):
            if ctx.players_ws.cell(row=row, column=h["Player ID"]).value == player_id:
                ctx.players_ws.cell(row=row, column=h["Team ID"], value=agg["team_id"])
                ctx.players_ws.cell(row=row, column=h["Division"], value=agg["division"])
                if agg.get("height"):
                    ctx.players_ws.cell(row=row, column=h["Height"], value=agg["height"])
                if season == current_season_label and agg.get("class_year"):
                    ctx.players_ws.cell(row=row, column=h["Class"], value=agg["class_year"])
                break

    sh = ensure_columns(ctx.seasons_ws, PLAYER_SEASONS_NEW_COLUMNS)

    def team_name(team_id):
        info = ctx.team_id_to_info.get(team_id)
        return info["name"] if info else None

    touched_keys = set(ctx.season_agg.keys())

    pgs_h = ctx.pgs_hmap
    col_pid = pgs_h["Player ID"]
    col_season = pgs_h["Season"]
    col_gs = pgs_h["GS"]
    col_team = pgs_h["Team ID"]
    full_counts = {}
    for row in ctx.pgs_ws.iter_rows(min_row=2):
        pid = row[col_pid - 1].value
        season = row[col_season - 1].value
        key = (pid, season)
        if key not in touched_keys:
            continue
        entry = full_counts.setdefault(key, {"games": 0, "starts": 0, "team_id": None})
        entry["team_id"] = row[col_team - 1].value
        entry["games"] += 1
        if row[col_gs - 1].value == "Yes":
            entry["starts"] += 1

    existing_extra = {}
    keep_rows = []
    for _row_idx, values in iter_data_rows(ctx.seasons_ws, sh):
        key = (values.get("Player ID"), values.get("Season"))
        if key in touched_keys:
            existing_extra[key] = (
                values.get("Height"), values.get("Class"), values.get("Position"),
            )
            continue
        keep_rows.append(values)

    new_ws = wipe_data_rows(ctx.wb, "PlayerSeasons", keep_header=True)
    ctx.seasons_ws = new_ws
    sh = header_map(new_ws)
    append_rows(new_ws, sh, keep_rows)

    written = 0
    for key in sorted(touched_keys):
        player_id, season = key
        agg = ctx.season_agg[key]
        counts = full_counts.get(
            key, {"games": agg["games"], "starts": agg["starts"], "team_id": agg["team_id"]}
        )
        old_height, old_class, old_position = existing_extra.get(key, (None, None, None))
        height = agg.get("height") or old_height
        class_year = None
        if season == current_season_label:
            class_year = agg.get("class_year") or old_class
        position = agg.get("position") or old_position
        row_values = {
            "Player ID": player_id, "Season": season, "Team ID": counts["team_id"],
            "Team Name": team_name(counts["team_id"]), "Division": agg["division"],
            "Position": position, "Height": height, "Class": class_year,
            "Games Played": counts["games"], "Games Started": counts["starts"], "Finished": "Yes",
        }
        append_row(new_ws, sh, row_values)
        written += 1
    print(f"PlayerSeasons: upserted {written} Presto D2 player-season rows "
          f"({len(keep_rows)} untouched rows preserved, duplicates from prior partial runs removed).")

    seasons_by_player = {}
    for (player_id, season), agg in ctx.season_agg.items():
        seasons_by_player.setdefault(player_id, []).append((season, agg["team_id"]))

    for row in range(2, ctx.players_ws.max_row + 1):
        pid = ctx.players_ws.cell(row=row, column=h["Player ID"]).value
        if not pid or pid not in seasons_by_player:
            continue
        timeline = sorted(set(seasons_by_player.get(pid, [])))
        stints = []
        for season, team_id in timeline:
            school = team_name(team_id) or f"Team {team_id}"
            if stints and stints[-1]["school"] == school:
                stints[-1]["end"] = season
            else:
                stints.append({"school": school, "start": season, "end": season})
        parts = []
        for stint in stints:
            if stint["start"] == stint["end"]:
                parts.append(f"{stint['school']} ({stint['start']})")
            else:
                parts.append(f"{stint['school']} ({stint['start']} -- {stint['end']})")
        distinct_schools = len({s["school"] for s in stints})
        ctx.players_ws.cell(row=row, column=h["Transfer History"], value=" -> ".join(parts) or None)
        ctx.players_ws.cell(row=row, column=h["Schools Attended"], value=distinct_schools or None)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", default=DEFAULT_PATH)
    parser.add_argument("--seasons", nargs="+", default=DEFAULT_SEASONS)
    parser.add_argument("--only", help="Comma-separated team names, for testing on a few schools first")
    parser.add_argument(
        "--force", action="store_true",
        help="Reprocess teams even if already marked Done for the requested season(s) -- "
             "needed after a parser fix, since a season can get marked done even from a "
             "partially-broken run (no hard exception raised). Games already recorded "
             "(by Game ID) are still skipped either way, so this only adds newly-found games.",
    )
    args = parser.parse_args()

    print(f"run_d2_presto_scrape.py -- last revised {LAST_REVISED}")
    print(f"Opening {args.path} ...")
    wb = open_workbook(args.path)
    ctx = Context(wb)

    targets = [
        t for t in ctx.team_rows
        if t["division"] == "D2" and str(t.get("site_type") or "").strip().lower() == "presto"
    ]
    if args.only:
        wanted = {n.strip().lower() for n in args.only.split(",")}
        targets = [t for t in targets if t["name"].lower() in wanted]

    print(f"{len(targets)} Presto D2 teams to process, seasons {args.seasons}.")

    for i, info in enumerate(targets, start=1):
        if not args.force and set(args.seasons) <= info["done_seasons"] and info["status"] == "Done":
            continue
        if not info.get("roster_url"):
            ctx.mark_team_status(info, "Needs Roster URL")
            continue

        print(f"[{i}/{len(targets)}] {info['name']} ({info['roster_url']}) ...")
        try:
            process_team(ctx, info, args.seasons, force=args.force)
        except Exception as exc:  # noqa: BLE001 -- keep the run alive across one bad team
            print(f"    [!] unexpected error on {info['name']}: {exc}")
            ctx.mark_team_status(info, "Failed", error=str(exc))

        if i % CHECKPOINT_EVERY == 0:
            print("  -- saving checkpoint --")
            save_with_retry(ctx.wb, args.path)

        time.sleep(SLEEP_BETWEEN_TEAMS)

    print("Finalizing player identities and season history ...")
    finalize(ctx, args.seasons[-1] if args.seasons else DEFAULT_SEASONS[-1])

    print("Final save ...")
    save_with_retry(ctx.wb, args.path)
    print("Done.")


if __name__ == "__main__":
    main()
