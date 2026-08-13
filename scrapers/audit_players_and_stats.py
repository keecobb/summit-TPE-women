"""Audit + repair for the Players / PlayerGameStats / PlayerSeasons sheets
(task #27/#50/#51/#52 follow-up).

Two independent jobs in one script, since both need the same full pass over
PlayerGameStats (731k+ rows -- too large for a quick sandbox read, so this
runs on your machine like the other full-workbook scripts this session):

1. REPORT (always runs, read-only): completeness/accuracy audit --
   duplicate (Player ID, Game ID) rows, orphaned Player ID / Game ID
   references, box-score stat sanity (FG Made > FG Attempt, negative
   values, Points not matching 2*(FGM-3PM) + 3*3PM + FTM, absurd Minutes),
   and a breakdown of missing Position/Height/Class by Source (Sidearm/
   ESPN/Presto) -- confirmed this is a real, LARGE, but already-understood
   gap (Sidearm 80% missing, Presto 91% missing, ESPN 0% missing), a
   known trade-off from task #30 (roster parser was deliberately relaxed
   to accept a table missing Class OR Height rather than reject the whole
   roster), not a new bug -- reported here for visibility only, no fix
   attempted.

2. REPAIR (read-only unless --write): recovers "-1 sentinel" Team IDs.

   Root cause, confirmed by reading run_d2_scrape.py: when a box score's
   OPPONENT team name fails to resolve via resolve_opponent_team_id()
   (the exact same name-matching path that Games-sheet opponent
   resolution uses, and that task #46 fixed 1,408+ occurrences of this
   session via state-abbreviation expansion + 2 garbled Teams-sheet name
   corrections), process_team() falls back to `opponent_team_id or -1`
   when writing that opponent's OWN players' stat lines. So every
   opponent player who shows up with Team ID == -1 in Players and
   PlayerGameStats (7,474 players / confirmed via a full audit) is a
   direct casualty of an unresolved opponent name at scrape time -- the
   exact class of bug task #46 already fixed for the Games sheet, just
   never backfilled here.

   The literal opponent name text always survives on the OTHER (known)
   side's Games-sheet row (Home Team / Away Team columns are always
   written as plain text, resolved or not). This script:
     a. Builds the SAME collision-safe Teams-sheet name index used by
        repair_opponent_names.py (narrow_normalize: state-abbreviation
        expansion + normalize_text only, no University/College suffix
        stripping -- for the identical false-positive-avoidance reasons
        documented in that script).
     b. For every Player ID that has >=1 Team ID == -1 row, finds every
        Game ID it appears in, looks up the Games-sheet row, and takes
        the literal name of whichever side is NOT the known opponent
        (Opponent Team ID column on that PlayerGameStats row already
        tells us which side WAS resolved).
     c. Re-resolves that literal name against the CURRENT (already-
        improved) Teams-sheet index. If every occurrence for a given
        player agrees on one Team ID, the player is "recoverable". If
        different games produce conflicting resolutions for the same
        player (can happen if two different opposing sites spell the
        same team differently and only one form now resolves), the
        player is left alone and reported as ambiguous rather than
        guessed.
     d. With --write: backfills Team ID (and Division, from the
        resolved team's own Teams-sheet Division) on every affected
        Players, PlayerGameStats, and PlayerSeasons row for recovered
        players only. Unresolved/ambiguous players are untouched --
        this can be re-run safely after future opponent-name fixes to
        pick up more of them.

Usage:
    python scrapers/audit_players_and_stats.py               # report only
    python scrapers/audit_players_and_stats.py --write        # + repair
"""

import argparse
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from run_d2_scrape import build_team_index as _build_shared_team_index
from run_d2_scrape import query_candidates
from scrapers.xlsx_io import header_map, open_workbook, save_with_retry

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")


def load_team_index(teams_ws, th):
    """Team-name resolution index for the -1 repair, built through the
    shared, tier-aware run_d2_scrape.build_team_index() (task #56) --
    same hyphen-swap/parenthetical-strip/alias improvements as
    repair_opponent_names_round3.py, kept in sync automatically since
    both scripts call the one shared function rather than maintaining
    their own copies. full=False: deliberately narrow, no University/
    College suffix stripping (see repair_opponent_names.py's docstring
    for why every repair script in this project stays on that side of
    the tradeoff). Also returns team_div/team_name, which the shared
    function doesn't track (it only returns the name index itself)."""
    name_team_pairs = []
    team_div = {}
    team_name = {}
    for row in teams_ws.iter_rows(min_row=2, values_only=True):
        name = row[th["Team"] - 1]
        team_id = row[th["Team ID"] - 1]
        div = row[th["Division"] - 1]
        if name and team_id is not None:
            name_team_pairs.append((name, team_id))
            team_div[team_id] = div
            team_name[team_id] = name
    name_to_id = _build_shared_team_index(name_team_pairs, full=False)
    return name_to_id, team_div, team_name


def build_games_index(games_ws, gh):
    idx = {}
    for row in games_ws.iter_rows(min_row=2, values_only=True):
        gid = row[gh["Game ID"] - 1]
        if gid is None:
            continue
        idx[gid] = (
            row[gh["Home Team ID"] - 1], row[gh["Home Team"] - 1],
            row[gh["Away Team ID"] - 1], row[gh["Away Team"] - 1],
        )
    return idx


def audit_players(players_ws, ph, team_ids):
    total = 0
    dup_ids = Counter()
    missing_first = missing_last = 0
    missing_pos_by_src = Counter()
    total_by_src = Counter()
    all_pids = set()
    minus1_pids = set()
    other_orphan = Counter()
    for row in players_ws.iter_rows(min_row=2, values_only=True):
        pid = row[ph["Player ID"] - 1]
        if pid is None:
            continue
        total += 1
        dup_ids[pid] += 1
        all_pids.add(pid)
        fn, ln = row[ph["First Name"] - 1], row[ph["Last Name"] - 1]
        if not fn:
            missing_first += 1
        if not ln:
            missing_last += 1
        src = row[ph["Source"] - 1]
        total_by_src[src] += 1
        if not row[ph["Position"] - 1]:
            missing_pos_by_src[src] += 1
        tid = row[ph["Team ID"] - 1]
        if tid == -1:
            minus1_pids.add(pid)
        elif tid is not None and tid not in team_ids:
            other_orphan[tid] += 1
    dups = {pid: c for pid, c in dup_ids.items() if c > 1}
    print(f"\n=== Players sheet: {total} rows ===")
    print(f"Duplicate Player IDs: {len(dups)}")
    print(f"Missing First/Last name: {missing_first}/{missing_last}")
    print(f"Team ID == -1 (unresolved opponent, see REPAIR section below): {len(minus1_pids)}")
    print(f"Other orphan Team IDs (not -1, not in Teams sheet): {dict(other_orphan)}")
    print("Missing Position, by Source:")
    for src, n in total_by_src.items():
        m = missing_pos_by_src.get(src, 0)
        print(f"  {src!r}: {m}/{n} ({m/n:.0%})  -- known Sidearm/Presto template gap, not a new bug" if src in ("Sidearm", "Presto") else f"  {src!r}: {m}/{n} ({m/n:.0%})")
    return all_pids, minus1_pids


def audit_and_scan_pgs(pgs_ws, pgh, player_ids, games_idx):
    pid_col = pgh["Player ID"] - 1
    tid_col = pgh["Team ID"] - 1
    opp_tid_col = pgh["Opponent Team ID"] - 1
    gid_col = pgh["Game ID"] - 1
    fgm_col, fga_col = pgh["FG Made"] - 1, pgh["FG Attempt"] - 1
    tgm_col, tga_col = pgh["3FG M"] - 1, pgh["3FG A"] - 1
    ftm_col, fta_col = pgh["FT M"] - 1, pgh["FT A"] - 1
    pts_col = pgh["Points"] - 1
    min_col = pgh["Min"] - 1

    total = 0
    seen_pairs = Counter()
    orphan_player = 0
    orphan_game = 0
    bad_fg = bad_3fg = bad_ft = 0
    bad_points = 0
    bad_minutes = 0
    negative_stat = 0

    # For the -1 repair: player_id -> set of (candidate_name_literal)
    minus1_occurrences = defaultdict(set)
    minus1_row_count = 0

    for row in pgs_ws.iter_rows(min_row=2, values_only=True):
        pid = row[pid_col]
        if pid is None:
            continue
        total += 1
        gid = row[gid_col]
        seen_pairs[(pid, gid)] += 1
        if pid not in player_ids:
            orphan_player += 1
        if gid not in games_idx:
            orphan_game += 1

        fgm, fga = row[fgm_col], row[fga_col]
        tgm, tga = row[tgm_col], row[tga_col]
        ftm, fta = row[ftm_col], row[fta_col]
        pts = row[pts_col]
        minutes = row[min_col]

        if fgm is not None and fga is not None and fgm > fga:
            bad_fg += 1
        if tgm is not None and tga is not None and tgm > tga:
            bad_3fg += 1
        if ftm is not None and fta is not None and ftm > fta:
            bad_ft += 1
        for v in (fgm, fga, tgm, tga, ftm, fta, row[pgh["Rebound"] - 1], row[pgh["Ast"] - 1], pts):
            if v is not None and v < 0:
                negative_stat += 1
                break
        if None not in (fgm, tgm, ftm, pts):
            expected = 2 * (fgm - tgm) + 3 * tgm + ftm
            if pts != expected:
                bad_points += 1
        if minutes is not None and (minutes < 0 or minutes > 60):
            bad_minutes += 1

        tid = row[tid_col]
        if tid == -1:
            minus1_row_count += 1
            opp_tid = row[opp_tid_col]
            g = games_idx.get(gid)
            if g:
                home_id, home_name, away_id, away_name = g
                if opp_tid == home_id:
                    candidate = away_name
                elif opp_tid == away_id:
                    candidate = home_name
                else:
                    candidate = None
                if candidate:
                    minus1_occurrences[pid].add(candidate)

    dup_pairs = {k: c for k, c in seen_pairs.items() if c > 1}

    print(f"\n=== PlayerGameStats sheet: {total} rows ===")
    print(f"Duplicate (Player ID, Game ID) rows: {len(dup_pairs)}")
    print(f"Orphan Player ID (not in Players sheet): {orphan_player}")
    print(f"Orphan Game ID (not in Games sheet): {orphan_game}")
    print(f"FG Made > FG Attempt: {bad_fg}   3FG M > 3FG A: {bad_3fg}   FT M > FT A: {bad_ft}")
    print(f"Points != 2*(FGM-3PM)+3*3PM+FTM: {bad_points}")
    print(f"Minutes < 0 or > 60: {bad_minutes}")
    print(f"Any negative counting stat: {negative_stat}")
    print(f"Team ID == -1 rows: {minus1_row_count}  (across {len(minus1_occurrences)} distinct players with a recoverable game link)")

    return minus1_occurrences


def resolve_minus1_players(minus1_occurrences, name_to_id, team_div, team_name):
    recovered = {}
    ambiguous = {}
    unresolved = {}
    for pid, candidates in minus1_occurrences.items():
        resolved_ids = set()
        for cand in candidates:
            # task #56: try every safe query form (exact/narrow/hyphen-
            # swap), NOT just a single narrow_normalize() call -- picks
            # up the same hyphen-swapped-campus-name matches round 3
            # added for the Games sheet. Deliberately uses
            # query_candidates() rather than build_match_candidates(),
            # which would also try stripping cand's OWN parenthetical
            # qualifier -- unsafe on a query string, see that function's
            # docstring for the real "Notre Dame (OH)" bug this caught.
            rid = None
            for key in query_candidates(cand):
                rid = name_to_id.get(key)
                if rid is not None:
                    break
            if rid is not None:
                resolved_ids.add(rid)
        if len(resolved_ids) == 1:
            recovered[pid] = next(iter(resolved_ids))
        elif len(resolved_ids) > 1:
            ambiguous[pid] = (candidates, resolved_ids)
        else:
            unresolved[pid] = candidates
    return recovered, ambiguous, unresolved


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--write", action="store_true", help="Backfill recovered Team IDs into Players/PlayerGameStats/PlayerSeasons and save")
    parser.add_argument("path", nargs="?", default=DEFAULT_PATH)
    args = parser.parse_args()

    print(f"Opening {args.path} ...")
    wb = open_workbook(args.path)

    tws = wb["Teams"]
    th = header_map(tws)
    name_to_id, team_div, team_name = load_team_index(tws, th)
    team_ids = set(team_div.keys())

    gws = wb["Games"]
    gh = header_map(gws)
    games_idx = build_games_index(gws, gh)

    pws = wb["Players"]
    ph = header_map(pws)
    all_pids, minus1_pids = audit_players(pws, ph, team_ids)

    pgws = wb["PlayerGameStats"]
    pgh = header_map(pgws)
    minus1_occurrences = audit_and_scan_pgs(pgws, pgh, all_pids, games_idx)

    print("\n=== -1 Team ID repair analysis ===")
    recovered, ambiguous, unresolved = resolve_minus1_players(minus1_occurrences, name_to_id, team_div, team_name)
    print(f"Recoverable (all occurrences agree on one team): {len(recovered)}")
    print(f"Ambiguous (occurrences disagree -- left alone): {len(ambiguous)}")
    print(f"Still unresolved (no candidate name matched): {len(unresolved)}")

    if recovered:
        by_team = Counter(recovered.values())
        print("\nTop recovered teams by player count:")
        for tid, n in by_team.most_common(15):
            print(f"  {n:4d}  {team_name.get(tid, tid)}  (Team ID {tid}, {team_div.get(tid)})")

    if ambiguous:
        print("\nSample ambiguous players (not touched):")
        for pid, (cands, ids) in list(ambiguous.items())[:10]:
            print(f"  Player ID {pid}: candidates {cands} -> resolved to {[team_name.get(i, i) for i in ids]}")

    if not args.write:
        print("\n(report only -- rerun with --write to backfill recovered players)")
        return

    if not recovered:
        print("\nNothing to write.")
        return

    print(f"\nWriting Team ID (+ Division) for {len(recovered)} recovered players ...")

    # Players sheet
    updated_players = 0
    for row in range(2, pws.max_row + 1):
        pid = pws.cell(row=row, column=ph["Player ID"]).value
        if pid in recovered:
            rid = recovered[pid]
            pws.cell(row=row, column=ph["Team ID"], value=rid)
            pws.cell(row=row, column=ph["Division"], value=team_div.get(rid))
            updated_players += 1
    print(f"  Players sheet: {updated_players} rows updated")

    # PlayerGameStats sheet
    updated_pgs = 0
    tid_col_1based = pgh["Team ID"]
    pid_col_1based = pgh["Player ID"]
    for row in range(2, pgws.max_row + 1):
        current_tid = pgws.cell(row=row, column=tid_col_1based).value
        if current_tid != -1:
            continue
        pid = pgws.cell(row=row, column=pid_col_1based).value
        if pid in recovered:
            pgws.cell(row=row, column=tid_col_1based, value=recovered[pid])
            updated_pgs += 1
    print(f"  PlayerGameStats sheet: {updated_pgs} rows updated")

    # PlayerSeasons sheet
    psws = wb["PlayerSeasons"]
    psh = header_map(psws)
    updated_ps = 0
    for row in range(2, psws.max_row + 1):
        current_tid = psws.cell(row=row, column=psh["Team ID"]).value
        pid = psws.cell(row=row, column=psh["Player ID"]).value
        if current_tid == -1 and pid in recovered:
            rid = recovered[pid]
            psws.cell(row=row, column=psh["Team ID"], value=rid)
            psws.cell(row=row, column=psh["Division"], value=team_div.get(rid))
            psws.cell(row=row, column=psh["Team Name"], value=team_name.get(rid))
            updated_ps += 1
    print(f"  PlayerSeasons sheet: {updated_ps} rows updated")

    print("\nSaving ...")
    save_with_retry(wb, args.path)
    print("Done.")


if __name__ == "__main__":
    main()
