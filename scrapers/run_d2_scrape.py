"""Main D2 scraper: rosters, schedules, and full box scores for every
Sidearm-hosted D2 team across the target seasons, written into
WomensSummitTPE.xlsx.

Reference material: sidearm_import_all_teams_endpointFAST.py (the boys'
project's working D2 importer) was read for ideas but is NOT reused
directly and is left untouched -- it's built on Playwright (a real
headless browser) + xlwings (live Excel COM automation), which only
runs with Excel open on a Windows machine and would reintroduce the
file-locking problems this project already hit once. It also only
ever writes a player's game log with the opponent as a free-text
string -- no opponent Team ID, no score, no shared Game ID linking
both teams to the same game -- which is fine for a player-stats-only
sheet but not enough for the Games table Summit TPE's ratings/SoS
engine needs.

Instead, this script is built on the already-verified sidearm_client.py
(plain requests + BeautifulSoup, tested against a real school's roster/
schedule/box-score pages), following the same Context/process_team/
finalize architecture as run_d1_scrape.py. That gets us both the
player-stats side AND a proper Games table (real score, both team IDs,
a stable Game ID) in one pass, at the cost of more HTTP requests than
the FAST script's one-call-per-player-season endpoint trick.

THE BIG STRUCTURAL DIFFERENCE FROM D1: there's no ESPN-style universal
athlete ID for D2. Each school's Sidearm site assigns its own roster
player ID, with no crosswalk between schools -- so School A's player
"9921" and School B's player "9921" are two unrelated numbers, and a
transfer's ID at her old school tells us nothing about her ID at her
new one. Every Player ID here is therefore resolved by a NAME +
HOMETOWN match against the (global, shared-with-D1) Players sheet,
not an external ID lookup. This is inherently fuzzier than D1's exact
ESPN-ID match:
  - Two different people with the same name AND same hometown would
    incorrectly merge into one Player ID (rare, but possible).
  - The same person with slightly different hometown text between two
    sites (e.g. "Erie, PA" vs "Erie, Penn.") would incorrectly be
    treated as two different people.
Both failure modes are expected to need real-world correction once
this actually runs against all ~297 schools -- see PLAYER_OVERRIDES_PATH
below for the manual-fix mechanism (same pattern as
espn_team_overrides.csv). Treat the first full run's output as a
draft to review, not a final answer, exactly as asked.

ONE GENUINE IMPROVEMENT OVER D1: ESPN only ever exposes the CURRENT
season's roster, so D1's Height was backfilled from wherever a player
is NOW and Class was only ever accurate for the most recent season.
Sidearm rosters are available per-season via a URL pattern
(/roster/<season>), so this script fetches every target season's own
roster and can capture accurate Height AND Class for each season
directly -- no fallback/backfill needed the way D1 required.

Opponent resolution: Sidearm's schedule/box-score pages give the
opponent's name as text, not a Team ID -- resolved here by fuzzy name
match against the Teams sheet (same normalize+difflib approach as
team_match.py). Many D2 opponents are schools NOT in our Teams sheet
at all (D3, NAIA, juco) -- those games still get written with the
opponent's name, just no Team ID, no different from what happens to
an unmatched school anywhere else in this project.

Opposing players in a box score: per sidearm_client.py's own notes,
only the HOME school's players are hyperlinked (with an ID) on a box
score page -- the opponent's players show as plain text with no ID at
all on that page. Those get resolved by (team, name) match against
whatever we already know about that team's roster (from this run or a
prior one); if we don't have anything yet, they get a placeholder
Player ID keyed on name+team alone, which should self-correct into a
proper name+hometown match once that team's own roster gets scraped
(same run or a later one, order doesn't matter since Player ID
resolution always re-checks the full registry, not just this call).

Usage:
    python scrapers/run_d2_scrape.py
    python scrapers/run_d2_scrape.py --seasons 2023-24 2024-25 2025-26
    python scrapers/run_d2_scrape.py --only "Adams State,Adelphi"
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

import sidearm_client as sidearm
from scrapers.xlsx_io import (
    append_row, append_rows, ensure_columns, header_map, iter_data_rows,
    open_workbook, save_with_retry, wipe_data_rows,
)

# Bump this every time this file (or sidearm_client.py, which it
# depends on) is edited -- printed at the start of every run so it's
# obvious at a glance whether you're running the version with the
# latest template-variance fixes. Format: YYYY-MM-DD HH:MM PST/PDT
# (date alone wasn't enough -- multiple fixes landed on the same day).
LAST_REVISED = "2026-07-27 13:05 PDT"

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")
# Sidearm's own URL convention IS the season label already ("2023-24"),
# unlike ESPN's single end-year int -- no conversion needed here.
DEFAULT_SEASONS = ["2023-24", "2024-25", "2025-26"]
CHECKPOINT_EVERY = 8
SLEEP_BETWEEN_TEAMS = 0.5
SLEEP_BETWEEN_GAMES = 0.3
FUZZY_THRESHOLD = 0.87

PLAYER_NEW_COLUMNS = ["External ID", "Source", "Division", "Transfer History", "Schools Attended"]
PLAYER_SEASONS_HEADERS = [
    "Player ID", "Season", "Team ID", "Division", "Position", "Height",
    "Class", "Games Played", "Games Started", "Finished",
]
PLAYER_SEASONS_NEW_COLUMNS = ["Team Name"]

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

# See run_d2_presto_scrape.py's identical STATE_ABBR_MAP for the full
# rationale and audit numbers (task #46) this was built and verified
# against -- kept in sync between both scrapers deliberately.
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
    # Added task #56 (round 3 of opponent-name matching): not state
    # abbreviations exactly, but same "expand before normalizing" spot
    # is the right place for them. "fran." -> San Fran. St. = San
    # Francisco State (confirmed already-tracked, just under the
    # abbreviated form). "int'l" -> American Int'l = American
    # International (confirmed already-tracked).
    "fran.": "francisco", "int'l": "international",
}

# Added task #56: hand-verified aliases for schools whose Teams-sheet
# name doesn't match how their own site OR opponents' sites commonly
# refer to them (real renames, old names, initialisms) -- each verified
# individually via the team's own Roster URL/mascot before being added
# here, same diligence as the Midwestern State / Cal Poly Pomona
# corrections in repair_opponent_names.py. Keyed by Team ID so it's
# unambiguous which team an alias belongs to; every alias just adds one
# more accepted spelling to the matching index, it never changes what's
# displayed in the Teams sheet.
TEAM_NAME_ALIASES = {
    484: ["Cal Poly Humboldt"],                        # Humboldt State -- renamed 2022; roster URL humboldtathletics.com
    536: ["MSU Moorhead", "Minnesota State Moorhead"],  # Moorhead State -- roster URL msumdragons.com (Dragons) confirms
    595: ["Southern New Hampshire"],                    # South New Hampshire -- roster URL snhupenmen.com (SNHU) confirms
    648: ["Western Colorado", "Western Colo."],         # Western State -- real name Western Colorado University; roster URL gomountaineers.com
    487: ["UIndy"],                                     # Indianapolis (D2) -- NOT IU Indianapolis (Team ID 128, a separate D1 school)
    592: ["USC Beaufort"],                              # South Carolina Beaufort
    591: ["USC Aiken"],                                 # South Carolina Aiken
    542: ["UNC Pembroke"],                              # North Carolina Pembroke
}


def expand_state_abbreviations(value):
    """See run_d2_presto_scrape.py's identical helper for the full
    rationale on why "St." is handled separately from the dict above
    (positional "State" vs "Saint" ambiguity)."""
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


def narrow_normalize(value):
    """State-abbreviation expansion + normalize_text() only -- no
    University/College suffix stripping. Promoted here (task #56) from
    what used to be a copy-pasted local helper in every repair script,
    so all of them (and this file's own index-building) share one
    definition. See repair_opponent_names.py's module docstring for the
    full rationale on why this stays narrower than normalize_team_name()."""
    return normalize_text(expand_state_abbreviations(value or ""))


def strip_trailing_parenthetical(value):
    """"Northwood (MI)" -> "Northwood" -- Games-sheet opponent text
    almost never includes the Teams sheet's disambiguating state
    qualifier (confirmed live: Northwood, Regis, Northern State all
    unresolved for exactly this reason). Only used as an EXTRA
    candidate key during index-building, which still goes through the
    same collision-safe two-pass dedup as every other candidate, so two
    same-named schools with different qualifiers (e.g. two "Regis (X)"
    entries) would correctly cancel each other out rather than guess."""
    return re.sub(r"\s*\([^)]*\)\s*$", "", value or "").strip()


def _tier1_keys(name, full):
    """The "safe" candidate forms -- low collision risk, so these are
    allowed to freely collision-check against every OTHER team's tier-1
    forms same as always. `full=True` adds normalize_team_name()'s
    University/College-suffix strip (used by the live scraper's own
    broader index); `full=False` leaves it out (used by repair scripts,
    which deliberately stay narrower -- see repair_opponent_names.py's
    docstring for why: that strip is what caused the "Post University"
    mis-match)."""
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
    """The "risky" candidate forms (task #56, round 3): the
    parenthetical-qualifier-stripped form ("Northwood (MI)" ->
    "Northwood") and any hand-verified TEAM_NAME_ALIASES. BUG FOUND
    DURING TESTING: naively merging these into the same collision pool
    as tier 1 silently broke 4 previously-working exact matches --
    "California (PA)"/"Miami (OH)"/"Indiana (PA)"/"Charleston (WV)"
    stripped down to "california"/"miami"/"indiana"/"charleston", which
    collided with the REAL, already-correctly-resolving D1 schools of
    those bare names and made all 4 keys ambiguous (dropped) in the
    combined pool. Kept as a SEPARATE tier so build_team_index() can
    only apply a tier-2 key when no tier-1 (authoritative) candidate
    already claims it -- see that function."""
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
    """The single shared collision-safe opponent-name index builder
    (task #56, round 3) -- every script that needs to resolve an
    opponent name to a Team ID should build its index through this
    function rather than hand-rolling the candidate collection, so the
    tier-1/tier-2 priority fix above is applied everywhere consistently.

    name_team_pairs: iterable of (name, team_id). full: see _tier1_keys.

    Returns {normalized_key: team_id}. Two-stage collision safety:
      1. Tier-1 candidates (exact/narrow/hyphen-swap[/full]) across ALL
         teams -- a key claimed by more than one DISTINCT team_id is
         dropped, exactly like every prior version of this index.
      2. Tier-2 candidates (parenthetical-strip/alias) -- a key is only
         added if tier 1 doesn't already claim it (for ANY team,
         including the same one -- redundant in that case, harmless to
         skip); among the remaining tier-2-only keys, the same
         more-than-one-team-drops-it rule applies.
    """
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


def build_match_candidates(name, team_id):
    """Backward-compatible wrapper -- see build_team_index() for the
    real (tier-aware) index builder this project uses now. Kept only
    because a couple of scripts still call this directly for a single
    team's candidate set outside of full index-building; DON'T use this
    to build a whole-workbook index yourself, it doesn't have the
    tier-1/tier-2 priority fix. Also DON'T use this to generate lookup
    candidates for a QUERY string (a literal Games-sheet opponent name)
    -- use query_candidates() instead. See that function's docstring for
    why: this one includes the parenthetical-strip candidate, which is
    only safe on the TEAMS-sheet side."""
    return _tier1_keys(name, full=False) | _tier2_keys(name, team_id)


def query_candidates(name):
    """Candidate forms for looking up a literal opponent-name STRING
    (e.g. a Games-sheet "Home Team"/"Away Team" cell) against an index
    built by build_team_index(). Deliberately excludes the
    parenthetical-strip candidate that _tier2_keys()/build_match_candidates()
    include for the TEAMS-sheet side.

    BUG FOUND DURING TESTING (task #56): a first version of
    repair_opponent_names_round3.py used build_match_candidates() for
    BOTH sides. That let a query like "Notre Dame (OH)" strip its OWN
    "(OH)" qualifier down to bare "Notre Dame" and match whatever THAT
    resolves to -- which is very likely the WRONG school, since a
    qualifier in the literal game text was put there specifically to
    distinguish it from a more prominent same-named program (the real
    University of Notre Dame, D1, is separately tracked and legitimately
    owns the bare "notre dame" key). Stripping a TEAM's own stored
    qualifier is safe (opponents' sites rarely repeat it); stripping a
    QUERY's qualifier is not (it's meaningful disambiguating information
    the source chose to include). Only _tier1_keys() forms are safe on
    the query side."""
    return _tier1_keys(name, full=False)


def normalize_team_name(value):
    """normalize_text(), plus expand_state_abbreviations() and stripping
    trailing institution words like "University"/"College"/"Univ." --
    see run_d2_presto_scrape.py's identical helper for the full
    rationale (kept a separate function from normalize_text()
    deliberately, to avoid touching player-name matching)."""
    text = expand_state_abbreviations(value or "")
    text = normalize_text(text)
    text = INSTITUTION_SUFFIX_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_name_key(value):
    """Order-insensitive version of normalize_text(), for matching a
    player by name across two page types that format names differently.
    Confirmed live: Adelphi's roster page lists "Mia Ervin" (First
    Last), but its box score page lists the same person as "Ervin,
    Mia" (Last, First) -- normalize_text() alone gives "mia ervin" vs
    "ervin mia", which never match as strings even though it's the same
    person. That silently broke two things: the roster_by_name lookup
    in process_boxscore_side() (falls through to the weaker
    resolve_player_id() fallback for what should be an exact roster
    hit), and much more seriously, the "my side" overlap heuristic in
    process_team() -- with every name failing to match, both sides'
    overlap counts were 0 in effectively every game, so `my_idx = 0 if
    overlap_counts[0] >= overlap_counts[1] else 1` always defaulted to
    picking the FIRST team on the page as "us", regardless of whether
    that was actually true. Confirmed against real data: Adams State's
    Team ID accumulated 183 distinct "players" this way (should be ~11)
    -- most were actually opposing players from games where the real
    heuristic silently picked the wrong side. Sorting the words before
    joining makes the key immune to which order a page happens to use."""
    return " ".join(sorted(normalize_text(value).split()))


def normalize_height(value):
    """Sidearm shows '5-8' -- convert to D1's "5' 8\"" style so the
    Height column is consistent no matter which script wrote it."""
    if not value:
        return None
    m = re.match(r"(\d+)-(\d+)", str(value).strip())
    if not m:
        return str(value).strip() or None
    feet, inches = m.group(1), m.group(2)
    return f"{feet}' {inches}\""


def normalize_class(value):
    """Fr./So./Jr./Sr./Gr. -> FR/SO/JR/SR/GR, matching D1's style.
    Anything unrecognized (redshirt notations like 'R-Fr.', '5th', a
    typo, a template variant we haven't seen) is kept as-is rather than
    silently dropped -- better a slightly inconsistent value than a
    blank one."""
    if not value:
        return None
    key = str(value).strip().lower()
    return CLASS_MAP.get(key, str(value).strip())


def site_base_url(stored_url):
    """Teams.'Roster URL' actually stores a STATS page URL for these
    (e.g. '.../sports/womens-basketball/stats/2025-26'), confirmed by
    checking a real row -- not a roster-page URL despite the column
    name. Pull out just the site + sport path and rebuild roster/
    schedule URLs ourselves rather than trust the stored path shape."""
    parsed = urlparse(str(stored_url))
    path_parts = [p for p in parsed.path.split("/") if p]
    # Expect something like ['sports', 'womens-basketball', 'stats', '2025-26'].
    # BUG FIXED HERE: this used to keep only path_parts[1] ("womens-
    # basketball"), silently dropping the "sports/" prefix, so every
    # built URL (roster, schedule) was missing a path segment and 404'd
    # -- confirmed live against asugrizzlies.com/sports/womens-basketball/
    # roster/2025-26 (the real, working page) vs. the wrongly-built
    # asugrizzlies.com/womens-basketball/roster/2025-26 (404). Keep both
    # of the first two path segments together.
    if len(path_parts) >= 2 and path_parts[0] == "sports":
        sport_path = f"{path_parts[0]}/{path_parts[1]}"
    else:
        sport_path = "sports/womens-basketball"
    return f"{parsed.scheme}://{parsed.netloc}", sport_path


def load_overrides():
    """Manual fixes for player matches the automatic name+hometown key
    gets wrong -- same pattern as espn_team_overrides.csv. Row format:
    Wrong Key,Correct Player ID  where "Wrong Key" is
    "first|last|hometown" (normalized) as printed in the console log
    for any match this script made, so you can copy it in directly."""
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

        self.team_rows = []              # every team, any division -- needed for opponent matching
        self.team_id_to_info = {}
        self.team_id_to_conf = {}
        self.team_name_norm_to_id = {}
        self._load_teams()

        self.person_key_to_player_id = {}   # (first, last, hometown) normalized -> Player ID
        self.name_team_to_player_id = {}    # (team_id, first, last) normalized -> Player ID, weaker fallback
        self.next_player_id = 1
        self._load_players()

        self.overrides = load_overrides()

        self.games_seen = set()
        self.next_row_players = self.players_ws.max_row + 1
        self.next_row_games = self.games_ws.max_row + 1
        self.next_row_pgs = self.pgs_ws.max_row + 1
        self._load_games_seen()

        # BUG FIXED HERE: games_seen (Game ID -> already recorded) can't
        # catch the SAME real-world game being recorded TWICE when both
        # participating teams are independently tracked -- each team's
        # own site scrape writes its own opaque Game ID for that game,
        # so games_seen never recognizes them as the same event.
        # Confirmed live: 936 duplicate Games rows found across the D2
        # dataset this way (e.g. Grand Valley State showing 4-6 rows
        # against a single conference opponent in one season, when a
        # real double round-robin schedule should show 2). Team IDs are
        # canonical across the whole workbook (not site-specific) and a
        # final score is an extremely reliable fingerprint for "this is
        # the same real game" -- two DIFFERENT games between the same
        # pair landing on the exact same final score in one season is
        # implausible. See find_duplicate_game()/write_game_row() below.
        self.games_by_score_key = {}
        self._load_games_score_index()

        # (player_id, season) -> {team_id, division, position, height,
        # class_year, games, starts}. Unlike D1, height/class come from
        # THIS season's own roster fetch, not a current-only snapshot.
        self.season_agg = {}

    def _load_teams(self):
        h = self.teams_hmap
        # BUG FIXED HERE: writing straight into team_name_norm_to_id
        # inside this loop meant a normalized-name collision between two
        # DIFFERENT real teams silently resolved to whichever row came
        # LAST in the Teams sheet -- confirmed live: "Boston College"
        # and "Boston University" both strip down to the same
        # normalize_team_name() key ("boston"), since that helper
        # strips "College"/"University" as whole words (see its
        # docstring -- built for cases like "Holy Family University"
        # matching Teams-sheet "Holy Family", not accounting for two
        # DIFFERENT real schools differing only by that word). Any
        # third team's box score listing either Boston school as an
        # opponent had a real, deterministic (not random) chance of
        # getting misattributed to the wrong one of the two -- verified
        # 0 games actually hit this yet, but only because no third-team
        # game happened to reference either school before this fix, not
        # because the bug wasn't real. Collect every (key -> team_id)
        # candidate across all rows first, from both the exact name and
        # the suffix-stripped name, then only keep a key in the final
        # index if every candidate for it agrees on a single team_id --
        # a key more than one DISTINCT team claims is genuinely
        # ambiguous and gets dropped entirely rather than guessed.
        name_team_pairs = []
        for row in range(2, self.teams_ws.max_row + 1):
            name = self.teams_ws.cell(row=row, column=h["Team"]).value
            if not name:
                continue
            team_id = self.teams_ws.cell(row=row, column=h["Team ID"]).value
            division = self.teams_ws.cell(row=row, column=h["Division"]).value
            conference = self.teams_ws.cell(row=row, column=h["Conference"]).value
            roster_url = self.teams_ws.cell(row=row, column=h["Roster URL"]).value
            site_type = self.teams_ws.cell(row=row, column=h["SiteType"]).value
            status = self.teams_ws.cell(row=row, column=h["Scrape Status"]).value
            last_seasons = self.teams_ws.cell(row=row, column=h["Last Scraped Season"]).value

            info = {
                "row": row, "team_id": team_id, "name": name, "division": division,
                "conference": conference, "roster_url": roster_url, "site_type": site_type,
                "status": status, "done_seasons": set((last_seasons or "").split(",")) - {""},
            }
            self.team_rows.append(info)
            if team_id is not None:
                self.team_id_to_info[team_id] = info
                self.team_id_to_conf[team_id] = conference
                name_team_pairs.append((name, team_id))

        # task #56 round 3: shared, tier-aware index builder (see
        # build_team_index()'s docstring for the tier-1/tier-2 priority
        # fix -- naively merging parenthetical-strip candidates into one
        # flat collision pool broke 4 previously-working exact matches).
        # full=True includes normalize_team_name()'s University/College
        # strip, matching this class's pre-round-3 behavior.
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
                # Don't overwrite -- first row wins, this is only a
                # weak fallback used when we have no hometown to match on.
                self.name_team_to_player_id.setdefault(nt_key, pid)
        self.next_player_id = max_id + 1

        # Hometown isn't on the Players sheet itself, so the strong
        # (name, hometown) key gets built up incrementally as rosters
        # are fetched (see note_person()) rather than loaded up front.

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
        been recorded (by either side, under any Game ID) -- or None if
        this looks like a genuinely new game. See the incident comment
        on games_by_score_key above."""
        if score_a is None or score_b is None or team_a is None or team_b is None:
            return None
        if team_a <= team_b:
            pair, scores = (team_a, team_b), (score_a, score_b)
        else:
            pair, scores = (team_b, team_a), (score_b, score_a)
        return self.games_by_score_key.get((season, pair, scores))

    def note_person_key(self, player_id, first, last, hometown):
        """Register a (name, hometown) key -> Player ID so a LATER
        roster fetch (this team or another) that produces the same
        name+hometown resolves to the same person instead of creating
        a duplicate."""
        if not hometown:
            return
        key = (normalize_text(first), normalize_text(last), normalize_text(hometown))
        self.person_key_to_player_id.setdefault(key, player_id)

    def resolve_player_id(self, first, last, hometown, team_id, position, division,
                           height=None, class_year=None):
        """Get-or-create by (name, hometown) -- see module docstring
        for why this is inherently fuzzier than D1's ESPN-ID match."""
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
        self.players_ws.cell(row=row, column=h["Source"], value="Sidearm")
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

        # See run_d2_presto_scrape.py's identical fix for the incident
        # writeup -- confirmed live, this crashed every game for every
        # team the moment an opponent's Team ID couldn't be resolved
        # (None, a normal/expected case for an untracked opponent).
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


GAME_ID_RE = re.compile(r"/boxscore/(\d+)")


def extract_game_id(boxscore_url):
    m = GAME_ID_RE.search(boxscore_url)
    if m:
        return m.group(1)
    # Fall back to the whole URL if the pattern ever doesn't match --
    # still unique and stable, just less readable in the sheet.
    return boxscore_url


def process_roster(ctx, info, season, base_url, sport_path):
    """Returns (by_name_dict, error_or_None). The error is surfaced to the
    caller (rather than just printed and swallowed, as this used to do)
    so process_team() can treat a roster failure as a season error --
    see the comment at its call site for why that matters: without it,
    a team whose roster 404'd (or hit a layout the parser didn't
    recognize) but whose schedule/box scores still succeeded got marked
    "Done" anyway, permanently skipping any retry of just the roster."""
    roster_url = f"{base_url}/{sport_path}/roster"
    try:
        roster = sidearm.get_roster(roster_url, season_path=season)
    except sidearm.SidearmError as exc:
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
    # BUG FIXED HERE: this used to pass division=info["division"]
    # unconditionally for BOTH calls this function gets invoked with
    # (see process_team() below) -- correct for the "my side" call
    # (team_id == info["team_id"], a D2 team by construction, so
    # info["division"] == "D2" is right), but WRONG for the "opponent
    # side" call, where team_id is the OPPONENT's real team ID and
    # info["division"] is still just the D2 team CURRENTLY BEING
    # SCRAPED's division -- not the opponent's. Confirmed live: 642
    # PlayerSeasons rows ended up Division="D2" despite their Team ID
    # correctly pointing at a real D1 school in the Teams sheet (Iowa,
    # Stanford, Kansas, Colorado, etc.) -- these were all opponent-side
    # players from D2-vs-D1 non-conference games, mislabeled with the
    # scraping run's own division instead of their own team's actual
    # division. Look up team_id's real division from ctx.team_id_to_info
    # (built from the FULL Teams sheet, every division, in _load_teams())
    # instead of trusting info["division"] blindly; only fall back to it
    # when team_id can't be resolved at all (e.g. the -1 sentinel used
    # for an opponent whose own team row couldn't be matched).
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
            # Opponent's player (or someone who didn't match this
            # team's own roster fetch, e.g. name-format mismatch) --
            # resolve by name within this team only, no hometown
            # available from a box score page. Lower confidence; see
            # module docstring.
            first, last = _split_name(p["name"])
            player_id = ctx.resolve_player_id(
                first=first, last=last, hometown=None, team_id=team_id,
                position=None, division=division,
            )
            position, height, class_year = None, None, None

        fgm, fga = sidearm.split_made_attempted(p.get("fg"))
        fg3m, fg3a = sidearm.split_made_attempted(p.get("3pt"))
        ftm, fta = sidearm.split_made_attempted(p.get("ft"))

        ctx.write_player_game_stat(
            player_id=player_id, team_id=team_id, opponent_name=opponent_name,
            opponent_team_id=opponent_team_id, opponent_level=opponent_level,
            date=date, gs=p.get("starter"), minutes=sidearm.parse_float(p.get("min")),
            fgm=fgm, fga=fga, fg3m=fg3m, fg3a=fg3a, ftm=ftm, fta=fta,
            rebound=sidearm.parse_int(p.get("reb")), foul=sidearm.parse_int(p.get("pf")),
            ast=sidearm.parse_int(p.get("ast")), to=sidearm.parse_int(p.get("to")),
            blk=sidearm.parse_int(p.get("blk")), stl=sidearm.parse_int(p.get("stl")),
            points=sidearm.parse_int(p.get("pts")), game_id=game_id, season=season,
        )

        ctx.note_season_stat(
            player_id=player_id, season=season, team_id=team_id,
            division=division, position=position, height=height,
            class_year=class_year, gs=bool(p.get("starter")),
        )


def process_team(ctx, info, seasons, base_url, sport_path, force=False):
    # BUG FIXED HERE: with no way to bypass done_seasons, a season that
    # got marked "done" while genuinely incomplete (e.g. Western State's
    # 2024-25, which has 0 games in the Games sheet) could never be
    # re-attempted -- every rerun would silently skip straight past it,
    # even with --seasons naming it explicitly. Mirrors the --force fix
    # already applied in run_d2_presto_scrape.py's process_team().
    any_error = None
    for season in seasons:
        if season in info["done_seasons"] and not force:
            continue

        season_error = None
        roster_by_name, roster_error = process_roster(ctx, info, season, base_url, sport_path)
        if roster_error:
            # BUG FIXED HERE: a roster failure used to be silently
            # swallowed inside process_roster() and never counted
            # against season_error/any_error, so as long as the
            # schedule/box-score fetch afterward happened to succeed,
            # the season still got marked done -- permanently skipping
            # any future retry of the roster fetch, even after a parser
            # fix like the header-alias one made it fixable. Don't
            # `continue` here, though (unlike the schedule/box-score
            # failure cases below) -- still worth capturing whatever
            # game data we can this run; just make sure the season
            # doesn't get marked done so the roster gets retried later.
            season_error = roster_error
            any_error = season_error

        schedule_url = f"{base_url}/{sport_path}/schedule"
        try:
            boxscore_links = sidearm.get_schedule_boxscore_links(schedule_url, season_path=season)
        except sidearm.SidearmError as exc:
            season_error = str(exc)
            any_error = season_error
            print(f"    [!] schedule fetch failed for {info['name']} {season}: {exc}")
            continue

        for link in boxscore_links:
            url = link["url"]
            game_id = extract_game_id(url)
            if game_id in ctx.games_seen:
                continue
            try:
                box = sidearm.get_boxscore(url)
            except sidearm.SidearmError as exc:
                season_error = str(exc)
                any_error = season_error
                print(f"    [!] box score failed for {info['name']} ({url}): {exc}")
                continue

            teams = box["teams"]
            if len(teams) != 2:
                continue

            # Figure out which side is "us" -- the team whose players
            # match this team's own roster names most often. Sidearm
            # doesn't reliably mark home/away on this page, so this is
            # a heuristic, not a guarantee.
            overlap_counts = []
            for t in teams:
                names = {normalize_name_key(p["name"]) for p in t["players"]}
                overlap_counts.append(len(names & set(roster_by_name.keys())))
            # Confirmed live (Azusa Pacific: empty roster -> 0 vs 0 every
            # game; Cal State Dominguez Hills: at least 5 games where the
            # "wrong" side still somehow out-"overlapped" the real one --
            # root cause not fully pinned down, but in every confirmed
            # case the WINNING side's overlap was weak/tied, not a clear
            # majority match) -- a tie (including 0-0) has literally no
            # evidence behind it, `>=` picks index 0 anyway, and that
            # silently wrote an entire opposing roster in under our own
            # team_id both times. Require a real, strict majority before
            # trusting this game at all; treat a tie as "can't tell" and
            # skip the game (visible in the console / retryable) rather
            # than guess and silently corrupt two team's worth of player
            # identities.
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

            # See Context.games_by_score_key's incident comment -- a
            # game between two independently-tracked teams gets scraped
            # once from EACH side's own site, producing two different
            # opaque Game IDs for the same real event. games_seen (by
            # Game ID) can't catch this; a (season, team pair, exact
            # final score) fingerprint can, once we actually have the
            # score in hand (only possible after fetching/parsing the
            # box score, hence this check here rather than earlier).
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


def _split_name(full_name):
    name = str(full_name).strip()
    if "," in name:
        last, first = name.split(",", 1)
        return first.strip(), last.strip()
    parts = name.split()
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def finalize(ctx, current_season_label):
    """Same shape as run_d1_scrape.py's finalize_players(), simplified
    because D2's season_agg already carries height/class per season
    directly (from that season's own roster fetch) -- no current-
    roster-only backfill step needed the way D1 required."""
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

    # --- PlayerSeasons: targeted upsert (not blind append) -------------
    # This used to just append a fresh row per (player_id, season) in
    # ctx.season_agg every run, on the theory that D2 rows should never
    # get wiped so a combined D1+D2 run keeps both. That part's still
    # true (this never touches D1's rows), but blind append has two real
    # bugs, both confirmed live after reprocessing 9 D2 teams that had
    # failed partway through on the box-score-table-count bug:
    #
    # 1. Duplicates. games_seen dedup means a team reprocessed after a
    #    partial failure only re-fetches its NEW games this run --
    #    ctx.season_agg for that player only reflects THIS run's subset.
    #    Nothing removed the row a PRIOR run already appended for the
    #    same (player_id, season), so re-running just kept adding more.
    #    Confirmed: reprocessing those 9 teams created 615 duplicate
    #    (player_id, season) rows in one run.
    # 2. Undercounting. Even without a prior row to duplicate, a season's
    #    Games Played/Started would only reflect THIS run's slice of
    #    games, not the player's true season total -- the same bug
    #    already fixed on the D1 side (see build_full_season_agg() over
    #    there); D2 needed the equivalent fix.
    #
    # Fix: for every (player_id, season) touched this run, do a FULL
    # recount of games/starts from the complete, persisted
    # PlayerGameStats sheet (not just ctx.season_agg's this-run subset),
    # then replace (not append to) any existing row for that exact key.
    # Height/Class fall back to whatever the old row already had when
    # this run didn't re-fetch that player's roster (ctx.season_agg only
    # carries height/class for players whose roster got touched this
    # run). Rows for keys NOT touched this run -- every D1 row, plus
    # every D2 player-season this run didn't reprocess -- pass through
    # untouched.
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
        entry["team_id"] = row[col_team - 1].value  # most recent game in the season wins
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
        # BUG FIXED HERE: Position used to be written straight from
        # agg["position"] with no fallback to the existing row -- unlike
        # Height/Class just above, which already fall back correctly.
        # Position is NEVER available on the PlayerGameStats side (no
        # such column there), only ever set at the moment
        # process_boxscore_side() matches a player against THIS team's
        # own roster_by_name -- which only happens for a team's "my
        # side" table, never the opponent side (always position=None on
        # that branch, by design, since there's no roster to check
        # against for the other team). So any run whose touched games
        # for a given player happen to ONLY include a game where they
        # were the OPPONENT (recorded via a different, already-scraped
        # team's own schedule) -- with no game from their OWN team's
        # scrape also touched this run -- would aggregate position=None
        # and silently blank out a correctly-known Position from an
        # earlier run. Confirmed live: 1,116 D2 PlayerSeasons rows whose
        # (Team ID, Season) WAS successfully scraped as that team's own
        # roster still had a blank Position, exactly this mechanism.
        position = agg.get("position") or old_position
        row_values = {
            "Player ID": player_id, "Season": season, "Team ID": counts["team_id"],
            "Team Name": team_name(counts["team_id"]), "Division": agg["division"],
            "Position": position, "Height": height, "Class": class_year,
            "Games Played": counts["games"], "Games Started": counts["starts"], "Finished": "Yes",
        }
        append_row(new_ws, sh, row_values)
        written += 1
    print(f"PlayerSeasons: upserted {written} D2 player-season rows "
          f"({len(keep_rows)} untouched rows preserved, duplicates from prior partial runs removed).")

    # --- Transfer History rollup on Players -----------------------------
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
        help="Re-attempt seasons already marked done in done_seasons (use with --only for a specific team/season retry)",
    )
    args = parser.parse_args()

    print(f"run_d2_scrape.py -- last revised {LAST_REVISED}")
    print(f"Opening {args.path} ...")
    wb = open_workbook(args.path)
    ctx = Context(wb)

    targets = [
        t for t in ctx.team_rows
        if t["division"] == "D2" and str(t.get("site_type") or "").strip().lower() == "sidearm"
    ]
    if args.only:
        wanted = {n.strip().lower() for n in args.only.split(",")}
        targets = [t for t in targets if t["name"].lower() in wanted]

    print(f"{len(targets)} Sidearm D2 teams to process, seasons {args.seasons}.")

    for i, info in enumerate(targets, start=1):
        if not args.force and set(args.seasons) <= info["done_seasons"] and info["status"] == "Done":
            continue
        if not info.get("roster_url"):
            ctx.mark_team_status(info, "Needs Roster URL")
            continue

        base_url, sport_path = site_base_url(info["roster_url"])
        print(f"[{i}/{len(targets)}] {info['name']} ({base_url}) ...")
        try:
            process_team(ctx, info, args.seasons, base_url, sport_path, force=args.force)
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
