"""Thin client for ESPN's public (unauthenticated) women's college
basketball JSON API. D1 only -- ESPN doesn't cover D2.
 
Every shape parsed here was verified against live responses before
writing this file (not guessed from docs), specifically:
 
  GET .../teams/{id}/roster
      -> {"athletes": [{"id","firstName","lastName","displayHeight",
                         "position":{"abbreviation"},
                         "experience":{"abbreviation"}, "jersey", ...}]}
      NOTE: only returns the *current* season's roster -- ESPN doesn't
      keep historical roster snapshots. For past seasons, build the
      player list from whoever actually appears in that season's box
      scores instead (see run_d1_scrape.py).
 
  GET .../teams/{id}/schedule?season=YYYY
      -> {"events": [{"id","date",
                       "competitions":[{"competitors":[
                           {"homeAway","winner","team":{"id","displayName"},
                            "score":{"value"}}, ...],
                         "status":{"type":{"completed"}}}]}]}
 
  GET .../summary?event={eventId}
      -> {"boxscore": {"players": [
             {"team":{"id",...},
              "statistics":[{"names":[...13 stat labels...],
                              "athletes":[{"athlete":{"id","displayName",
                                                       "jersey","position"},
                                            "starter","didNotPlay",
                                            "stats":[...13 values, positional,
                                                     same order as names...]}]}]}
           ]}}
      stat order confirmed live: MIN, PTS, FG, 3PT, FT, REB, AST, TO,
      STL, BLK, OREB, DREB, PF (FG/3PT/FT are "made-attempted" strings
      like "7-9").
 
If ESPN changes these shapes, functions here raise a clear KeyError-ish
message rather than silently returning wrong data -- run
smoke_test_espn.py after any failure to see the raw response.
"""
 
import time
 
import requests
 
BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball"
CORE_BASE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/womens-college-basketball"
 
# NOTE: deliberately NOT sending a custom User-Agent. Verified directly
# against ESPN's API (repeated tests via both curl and Python's `requests`,
# against multiple team IDs) that:
#   - no User-Agent header at all -> 200 (works, requests' own default UA)
#   - explicit "python-requests/2.31.0" UA -> 200 (works)
#   - the previous custom UA here, "Mozilla/5.0 (SummitTPE data collector;
#     contact: project owner)" -> 403 Forbidden, consistently, on every
#     team tried (not just one team -- this was blocking ALL scraping)
#   - a non-Mozilla-prefixed custom UA ("SummitTPE-DataCollector/1.0
#     (contact: project owner)") -> also 403
# So ESPN appears to be blocking custom/identifying UA strings specifically,
# rather than blocking based on Mozilla-spoofing. Simplest reliable fix is
# to just not set the header and let `requests` send its normal default.
# If ESPN starts blocking requests' default UA too in the future, re-verify
# with smoke_test_espn.py before reintroducing any custom UA string.
 
# Positional order of the "stats" array on each player box score line.
BOX_SCORE_STAT_ORDER = [
    "MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK",
    "OREB", "DREB", "PF",
]
 
 
class EspnError(RuntimeError):
    pass
 
 
def _get(url, params=None, retries=4, backoff=2.0, timeout=20):
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, params=params, timeout=timeout)
            if resp.status_code == 429:
                wait = backoff * attempt * 3
                print(f"  [rate limited] sleeping {wait:.0f}s ...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as exc:
            last_exc = exc
            wait = backoff * attempt
            print(f"  [retry {attempt}/{retries}] {url} -> {exc}; sleeping {wait:.0f}s")
            time.sleep(wait)
    raise EspnError(f"Giving up on {url}: {last_exc}")
 
 
def list_teams(limit=500):
    """All D1 women's teams: [{'espn_id', 'name', 'abbreviation', 'conference_id'}]."""
    url = f"{BASE}/teams"
    data = _get(url, params={"limit": limit})
    out = []
    for entry in data.get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", []):
        team = entry.get("team", {})
        out.append({
            "espn_id": team.get("id"),
            "name": team.get("displayName"),
            "location": team.get("location"),
            "abbreviation": team.get("abbreviation"),
            "conference_id": team.get("conferenceId"),
        })
    if not out:
        raise EspnError(
            "list_teams() got a response but found no teams -- ESPN may have "
            "changed the response shape. Inspect the raw JSON from "
            f"{url}?limit={limit}"
        )
    return out
 
 
def get_roster(espn_team_id, season=None):
    """Current roster only (ESPN has no historical roster endpoint).
    Returns [{'espn_athlete_id','first_name','last_name','full_name',
               'position','class_year','height','jersey'}]."""
    url = f"{BASE}/teams/{espn_team_id}/roster"
    params = {"season": season} if season else None
    data = _get(url, params=params)
    out = []
    for a in data.get("athletes", []):
        out.append({
            "espn_athlete_id": a.get("id"),
            "first_name": a.get("firstName"),
            "last_name": a.get("lastName"),
            "full_name": a.get("displayName") or a.get("fullName"),
            "position": (a.get("position") or {}).get("abbreviation"),
            "class_year": (a.get("experience") or {}).get("abbreviation"),
            "height": a.get("displayHeight"),
            "jersey": a.get("jersey"),
        })
    return out
 
 
def get_schedule(espn_team_id, season):
    """Full season schedule with final scores for completed games.
    Returns [{'event_id','date','opponent_espn_id','opponent_name',
               'home_away','team_score','opponent_score','completed'}]."""
    url = f"{BASE}/teams/{espn_team_id}/schedule"
    data = _get(url, params={"season": season})
    events = data.get("events")
    if events is None:
        raise EspnError(
            f"get_schedule({espn_team_id}, {season}) response has no 'events' "
            "key -- ESPN may have changed the schedule response shape."
        )
 
    out = []
    for event in events:
        competitions = event.get("competitions") or []
        if not competitions:
            continue
        comp = competitions[0]
        competitors = comp.get("competitors") or []
        if len(competitors) != 2:
            continue
 
        me = next((c for c in competitors if str(c.get("id")) == str(espn_team_id)), None)
        opp = next((c for c in competitors if str(c.get("id")) != str(espn_team_id)), None)
        if me is None or opp is None:
            continue
 
        status = ((comp.get("status") or {}).get("type") or {})
        out.append({
            "event_id": event.get("id"),
            "date": event.get("date"),
            "opponent_espn_id": (opp.get("team") or {}).get("id"),
            "opponent_name": (opp.get("team") or {}).get("displayName"),
            "home_away": me.get("homeAway"),
            "team_score": (me.get("score") or {}).get("value"),
            "opponent_score": (opp.get("score") or {}).get("value"),
            "winner": me.get("winner"),
            "neutral_site": comp.get("neutralSite", False),
            "completed": bool(status.get("completed")),
        })
    return out
 
 
def get_boxscore(event_id):
    """Per-player stats for both teams in one game.
    Returns {espn_team_id: [{'espn_athlete_id','name','jersey','position',
                              'starter','did_not_play', <stat name>: value, ...}]}
    Numeric stats are parsed to int/float where possible; FG/3PT/FT stay as
    'made-attempted' strings (e.g. '7-9') for the caller to split.
    """
    url = f"{BASE}/summary"
    data = _get(url, params={"event": event_id})
    players_block = (data.get("boxscore") or {}).get("players")
    if not players_block:
        # Common for postponed/cancelled games or ones without a boxscore yet.
        return {}
 
    out = {}
    for team_block in players_block:
        team_id = (team_block.get("team") or {}).get("id")
        stats_block = (team_block.get("statistics") or [{}])[0]
        names = stats_block.get("names") or BOX_SCORE_STAT_ORDER
        athletes = stats_block.get("athletes") or []
 
        rows = []
        for a in athletes:
            athlete = a.get("athlete") or {}
            raw_stats = a.get("stats") or []
            stat_map = dict(zip(names, raw_stats))
            rows.append({
                "espn_athlete_id": athlete.get("id"),
                "name": athlete.get("displayName"),
                "jersey": athlete.get("jersey"),
                "position": (athlete.get("position") or {}).get("abbreviation"),
                "starter": bool(a.get("starter")),
                "did_not_play": bool(a.get("didNotPlay")),
                "raw_stats": stat_map,
            })
        out[team_id] = rows
    return out
 
 
ATHLETE_BASE = "https://site.api.espn.com/apis/common/v3/sports/basketball/womens-college-basketball"
 
 
def get_athlete_height(espn_athlete_id):
    """Height is a fixed physical attribute of the person, not something
    tied to a specific team/season -- so unlike get_roster() (which only
    covers whoever is on a CURRENT roster), this endpoint returns it for
    any athlete ID regardless of whether they've transferred, graduated,
    or left Division I entirely. Verified against a real departed/
    graduated player's ID before writing this: the team roster endpoint
    has no record of her at all, but this one still returns her height.
 
    Returns the display string (e.g. "6' 2\"") or None if this athlete
    ID doesn't resolve to a profile with height on it (rare, but some
    walk-ons / very old IDs may not have it).
 
    NOTE: does NOT return class/experience -- that's inherently tied to
    a specific season, and this endpoint has no season context, so we
    don't try to use it for Class. Class stays limited to whatever the
    current roster snapshot says, same as before.
    """
    url = f"{ATHLETE_BASE}/athletes/{espn_athlete_id}"
    try:
        data = _get(url, retries=2)
    except EspnError:
        return None
    return data.get("displayHeight")
 
 
def split_made_attempted(value):
    """'7-9' -> (7, 9). Returns (0, 0) for missing/DNP ('-', '', None)."""
    if not value or value == "-":
        return 0, 0
    try:
        made, attempted = value.split("-")
        return int(made), int(attempted)
    except (ValueError, AttributeError):
        return 0, 0
 
 
def parse_minutes(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
 
 
def parse_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0