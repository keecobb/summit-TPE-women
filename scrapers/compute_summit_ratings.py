"""Summit TPE's own team ratings/SoS engine (task #40).

Computes an INDEPENDENT iterative margin-based rating (Massey/Colley-style)
from Summit TPE's own Games data -- separate from the existing Massey
Ratings import (Rat/Off/Def/SoS columns already on the Teams sheet), which
stays untouched as an external reference point.

Design, confirmed with the user before building:

1. D1 and D2 are rated as two SEPARATE iterative pools, each solved only
   from that division's own within-division games. This was a deliberate
   choice over one combined D1+D2 scale: in the 2025-26 season there are
   9,379 within-division games but only 76 D1-vs-D2 crossover games
   (~0.8%), and those crossover games are disproportionately early-season
   "guarantee games" (a D1 team hosting a smaller D2 opponent, often
   lopsided). Solving one connected system across both divisions would let
   that thin, biased bridge distort the primary within-division ratings.

2. A SECOND, secondary column -- "Summit CombinedRat" -- uses those same
   76 crossover games to fit a single scalar offset ("bridge shift") that
   aligns the D2 rating pool onto the D1 scale, via ordinary least squares
   on one parameter. This gives a rough cross-division comparison without
   ever letting the crossover games influence the primary Off/Def/Rat
   values computed in step 1. If a division has too few crossover games in
   a season to fit reliably (< MIN_CROSSOVER_GAMES), the bridge is skipped
   and Summit CombinedRat is left blank for that run rather than guessed.

Methodology detail -- iterative Off/Def solve (within one division):
    Off_i, Def_i start at team i's simple average points scored/allowed.
    Each iteration:
        Off_i <- mean over i's games of (points scored by i in that game
                  - Def_opponent) + league_avg_def
        Def_i <- mean over i's games of (points allowed by i in that game
                  - Off_opponent) + league_avg_off
    where league_avg_off/def are the means of the PREVIOUS iteration's
    Off/Def values (this anchors the scale each pass so it doesn't drift).
    Repeats until the largest single change is below TOL or MAX_ITER is
    hit. This is a standard iterative strength-of-schedule-aware fit: a
    team's Off/Def naturally gets pulled toward "how much better/worse
    than expected against this opponent's Def/Off", which is what makes it
    margin-based and SoS-aware rather than a flat scoring average.

    Rat_i = Off_i - Def_i  (net efficiency-style rating)
    SoS_i = the simple average of Rat_j across every opponent j faced
            (each game counted once per occurrence, so playing a strong
            team twice weighs it twice -- matches how strength of schedule
            is meant to reflect the ACTUAL schedule played, not just the
            unique-opponent list)

Season scope: rates ONE season at a time (default: the most recently
COMPLETED season found in the Games sheet -- verified live that 2025-26
runs Nov 2025 through Apr 2026 and is fully finished as of this writing).
This matches the existing Massey Rat/Off/Def/SoS columns, which are also a
single current-season snapshot rather than one column per season. Re-run
this script with --season to rate a different season, or after each new
season completes to refresh.

Teams with zero within-division games in the selected season (isolated --
e.g. newly added, or a data gap) are left BLANK on all Summit columns
rather than given a default/average rating, since there's no game data to
support any value.

Usage:
    python scrapers/compute_summit_ratings.py
    python scrapers/compute_summit_ratings.py --season 2024-25
    python scrapers/compute_summit_ratings.py --dry-run   # print only, no save
"""

import argparse
import datetime
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scrapers.xlsx_io import ensure_columns, header_map, open_workbook, save_with_retry

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")

TOL = 1e-4
MAX_ITER = 200
MIN_CROSSOVER_GAMES = 10

SUMMIT_COLUMNS = [
    "Summit Rat", "Summit Off", "Summit Def", "Summit SoS",
    "Summit CombinedRat", "Summit Season", "Summit Last Updated",
]


def pick_latest_season(games_ws, gh):
    """Most recently completed season = the one with the latest max game
    date among seasons that have resolved+scored games."""
    latest = {}
    for row in games_ws.iter_rows(min_row=2, values_only=False):
        season = row[gh["Season"] - 1].value
        date = row[gh["Date"] - 1].value
        hs = row[gh["Home Score"] - 1].value
        as_ = row[gh["Away Score"] - 1].value
        if season is None or date is None or hs is None or as_ is None:
            continue
        if season not in latest or date > latest[season]:
            latest[season] = date
    if not latest:
        raise SystemExit("No scored games found in the Games sheet -- nothing to rate.")
    return max(latest, key=latest.get)


def load_teams(teams_ws, th):
    team_div = {}
    for row in teams_ws.iter_rows(min_row=2, values_only=False):
        tid = row[th["Team ID"] - 1].value
        div = row[th["Division"] - 1].value
        if tid is not None:
            team_div[tid] = div
    return team_div


def load_season_games(games_ws, gh, season, team_div):
    """Returns (within_division_games_by_div, crossover_games).
    within_division_games_by_div: {division: [(home_id, away_id, hs, as_), ...]}
    crossover_games: [(d1_id, d2_id, d1_score, d2_score), ...]
    Only games where both teams resolve to a known Team ID with a known
    Division, and both scores are present, are included.
    """
    by_div = defaultdict(list)
    crossover = []
    for row in games_ws.iter_rows(min_row=2, values_only=False):
        if row[gh["Season"] - 1].value != season:
            continue
        home_id = row[gh["Home Team ID"] - 1].value
        away_id = row[gh["Away Team ID"] - 1].value
        hs = row[gh["Home Score"] - 1].value
        as_ = row[gh["Away Score"] - 1].value
        if home_id is None or away_id is None or hs is None or as_ is None:
            continue
        hd = team_div.get(home_id)
        ad = team_div.get(away_id)
        if hd is None or ad is None:
            continue
        if hd == ad:
            by_div[hd].append((home_id, away_id, hs, as_))
        elif hd == "D1" and ad == "D2":
            crossover.append((home_id, away_id, hs, as_))
        elif hd == "D2" and ad == "D1":
            crossover.append((away_id, home_id, as_, hs))
    return by_div, crossover


def iterative_off_def(games, team_ids):
    """games: [(home_id, away_id, home_score, away_score), ...] all within
    one division. team_ids: set of every team id in that division (some
    may have zero games -- left out of the returned dict entirely).

    Returns (off, def_) dicts keyed by team_id, only for teams that
    actually played >=1 in-division game.
    """
    per_team_games = defaultdict(list)  # team_id -> [(scored, allowed, opponent_id), ...]
    for h, a, hs, as_ in games:
        per_team_games[h].append((hs, as_, a))
        per_team_games[a].append((as_, hs, h))

    active = [t for t in team_ids if per_team_games.get(t)]
    if not active:
        return {}, {}

    off = {t: sum(s for s, _, _ in per_team_games[t]) / len(per_team_games[t]) for t in active}
    def_ = {t: sum(al for _, al, _ in per_team_games[t]) / len(per_team_games[t]) for t in active}

    for _ in range(MAX_ITER):
        league_off = sum(off.values()) / len(off)
        league_def = sum(def_.values()) / len(def_)
        new_off = {}
        new_def = {}
        for t in active:
            gms = per_team_games[t]
            new_off[t] = sum((scored - def_[opp]) for scored, _, opp in gms) / len(gms) + league_def
            new_def[t] = sum((allowed - off[opp]) for _, allowed, opp in gms) / len(gms) + league_off
        max_change = max(
            max(abs(new_off[t] - off[t]) for t in active),
            max(abs(new_def[t] - def_[t]) for t in active),
        )
        off, def_ = new_off, new_def
        if max_change < TOL:
            break

    return off, def_


def compute_sos(games, rat):
    """Simple average of opponents' Rat, one entry per game played
    (so a team faced twice counts twice)."""
    opponents = defaultdict(list)
    for h, a, _, _ in games:
        if h in rat and a in rat:
            opponents[h].append(rat[a])
            opponents[a].append(rat[h])
    return {t: sum(vals) / len(vals) for t, vals in opponents.items() if vals}


def compute_bridge_shift(crossover_games, rat_d1, rat_d2):
    """Least-squares single-parameter offset aligning D2 ratings onto the
    D1 scale, using only crossover games where BOTH sides already have a
    within-division rating. Returns (shift, n_games_used) or (None, n)
    if too few usable games."""
    residuals = []
    for d1_id, d2_id, d1_score, d2_score in crossover_games:
        if d1_id not in rat_d1 or d2_id not in rat_d2:
            continue
        actual_margin = d1_score - d2_score
        residuals.append(rat_d1[d1_id] - rat_d2[d2_id] - actual_margin)
    if len(residuals) < MIN_CROSSOVER_GAMES:
        return None, len(residuals)
    shift = sum(residuals) / len(residuals)
    return shift, len(residuals)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", default=None, help="Season to rate, e.g. 2025-26 (default: most recently completed season found)")
    parser.add_argument("--dry-run", action="store_true", help="Compute and print results only, don't write/save")
    parser.add_argument("path", nargs="?", default=DEFAULT_PATH)
    args = parser.parse_args()

    print(f"Opening {args.path} ...")
    wb = open_workbook(args.path)

    tws = wb["Teams"]
    th = header_map(tws)
    team_div = load_teams(tws, th)
    team_name = {}
    for row in tws.iter_rows(min_row=2, values_only=False):
        tid = row[th["Team ID"] - 1].value
        name = row[th["Team"] - 1].value
        if tid is not None:
            team_name[tid] = name

    gws = wb["Games"]
    gh = header_map(gws)

    season = args.season or pick_latest_season(gws, gh)
    print(f"Rating season: {season}")

    by_div, crossover = load_season_games(gws, gh, season, team_div)
    print(f"Within-division games: D1={len(by_div.get('D1', []))}  D2={len(by_div.get('D2', []))}")
    print(f"Crossover (D1 vs D2) games: {len(crossover)}")

    all_off, all_def, all_rat, all_sos = {}, {}, {}, {}
    for div in ("D1", "D2"):
        div_team_ids = {t for t, d in team_div.items() if d == div}
        games = by_div.get(div, [])
        off, def_ = iterative_off_def(games, div_team_ids)
        rat = {t: off[t] - def_[t] for t in off}
        sos = compute_sos(games, rat)
        n_isolated = len(div_team_ids) - len(off)
        print(f"  {div}: rated {len(off)} teams, {n_isolated} isolated (no in-division game this season, left blank)")
        all_off.update(off)
        all_def.update(def_)
        all_rat.update(rat)
        all_sos.update(sos)

    rat_d1 = {t: r for t, r in all_rat.items() if team_div[t] == "D1"}
    rat_d2 = {t: r for t, r in all_rat.items() if team_div[t] == "D2"}
    shift, n_used = compute_bridge_shift(crossover, rat_d1, rat_d2)
    if shift is None:
        print(f"Bridge: only {n_used} usable crossover games (< {MIN_CROSSOVER_GAMES}) -- skipping Summit CombinedRat.")
    else:
        print(f"Bridge: fit from {n_used} crossover games, D2 shift = {shift:+.3f}")

    combined = {}
    for t, r in all_rat.items():
        if team_div[t] == "D1":
            combined[t] = r
        elif shift is not None:
            combined[t] = r + shift

    print("\nTop 10 D1 by Summit Rat:")
    for t in sorted(rat_d1, key=lambda t: -all_rat[t])[:10]:
        print(f"  {all_rat[t]:+7.2f}  {team_name.get(t, t)}")
    print("\nTop 10 D2 by Summit Rat:")
    for t in sorted(rat_d2, key=lambda t: -all_rat[t])[:10]:
        print(f"  {all_rat[t]:+7.2f}  {team_name.get(t, t)}")
    if shift is not None:
        print("\nTop 10 overall by Summit CombinedRat (D1+D2 on one scale):")
        for t in sorted(combined, key=lambda t: -combined[t])[:10]:
            print(f"  {combined[t]:+7.2f}  {team_name.get(t, t)}  ({team_div[t]})")

    if args.dry_run:
        print("\n--dry-run: not writing anything.")
        return

    th = ensure_columns(tws, SUMMIT_COLUMNS)
    now_str = datetime.datetime.now().isoformat(timespec="seconds")
    written = 0
    for row in range(2, tws.max_row + 1):
        tid = tws.cell(row=row, column=th["Team ID"]).value
        if tid is None:
            continue
        tws.cell(row=row, column=th["Summit Rat"], value=all_rat.get(tid))
        tws.cell(row=row, column=th["Summit Off"], value=all_off.get(tid))
        tws.cell(row=row, column=th["Summit Def"], value=all_def.get(tid))
        tws.cell(row=row, column=th["Summit SoS"], value=all_sos.get(tid))
        tws.cell(row=row, column=th["Summit CombinedRat"], value=combined.get(tid))
        tws.cell(row=row, column=th["Summit Season"], value=season)
        tws.cell(row=row, column=th["Summit Last Updated"], value=now_str)
        written += 1

    print(f"\nWrote Summit columns for {written} Teams-sheet rows.")
    print("Saving ...")
    save_with_retry(wb, args.path)
    print("Done.")


if __name__ == "__main__":
    main()
