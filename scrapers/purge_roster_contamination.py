"""Purge confirmed roster contamination from PlayerGameStats/Players/
PlayerSeasons (task #63 cleanup pass -- see detect_roster_contamination.py
for how these were found).

Re-runs the SAME two detection signals against the live workbook:
  - MERGED_OPPONENT: a team's total logged Minutes for one game is
    roughly double normal (~400 vs ~200) -- a second real team's box
    score got attributed to the wrong Team ID. NOT auto-cleaned here --
    there's no reliable way to automatically tell which players belong
    to which real team from stats alone, so these are only reported for
    manual review (3 confirmed live: Lamar/Texas College, Fort Valley
    State/Fort Valley St., Missouri S&T/Missouri St.).
  - PHANTOM_CLUSTER: extra zero-minute players with a tight, consecutive
    block of ESPN External IDs glued onto an otherwise-correct box
    score. Confirmed live as a STABLE set repeating across a whole
    season for 5 teams -- e.g. the same 11 phantom players show up at 0
    minutes in all 26 of Providence's 2024-25 games, the same 6 phantom
    players in all 20 of UT Martin's. These ARE auto-cleaned, but only
    the exact (Game ID, Team ID, Player ID) triples that were actually
    flagged -- never a broader "delete everything for this player ID"
    rule.

Safety design, two layers:
  1. PlayerGameStats: only the exact flagged (Game ID, Team ID,
     Player ID) rows are removed -- nothing else.
  2. Players sheet: a player's row is only removed if she has ZERO
     PlayerGameStats rows left ANYWHERE (any team, any game, any
     season) after step 1 -- i.e. she has no real appearance in this
     database at all. If she has real rows under some other, correctly-
     tracked team (this DOES happen -- some phantom blocks turned out to
     be real players from OTHER tracked schools who got erroneously
     glued onto a second team's box scores too), her Players row is left
     completely alone.
  3. PlayerSeasons: cleaned at the (Player ID, Team ID, Season) grain,
     not the player grain -- confirmed live in testing that a player who
     keeps her Players row (because she has real rows elsewhere) can
     still be left with a STALE PlayerSeasons row for the phantom
     team/season if that's only checked at the player level. This script
     removes a PlayerSeasons row whenever its exact (Player ID, Team ID,
     Season) combination has zero PlayerGameStats rows remaining after
     cleanup, regardless of whether the player's Players row is kept.

Default is a DRY RUN -- prints exactly what would change, touches
nothing. Pass --write to actually modify and save the workbook.

Usage:
    python scrapers/purge_roster_contamination.py                # dry run
    python scrapers/purge_roster_contamination.py --write         # apply
"""

import argparse
import collections
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scrapers.xlsx_io import header_map, open_workbook, save_with_retry, wipe_data_rows

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")

MERGED_OPPONENT_MINUTES_MIN = 320
DEFAULT_MIN_PLAYERS = 18
DEFAULT_MIN_ZERO = 8
ID_CLUSTER_GAP = 500
ID_CLUSTER_MIN_SIZE = 6


def find_id_clusters(pid_ext_pairs, gap, min_size):
    usable = [(int(ext), pid) for pid, ext in pid_ext_pairs if ext not in (None, "")]
    usable.sort()
    clusters = []
    current = []
    for ext, pid in usable:
        if current and ext - current[-1][0] > gap:
            if len(current) >= min_size:
                clusters.append([p for _, p in current])
            current = []
        current.append((ext, pid))
    if len(current) >= min_size:
        clusters.append([p for _, p in current])
    return clusters


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--min-players", type=int, default=DEFAULT_MIN_PLAYERS)
    parser.add_argument("--min-zero", type=int, default=DEFAULT_MIN_ZERO)
    parser.add_argument("--write", action="store_true", help="Actually modify and save the workbook (default: dry run)")
    parser.add_argument("path", nargs="?", default=DEFAULT_PATH)
    args = parser.parse_args()

    print(f"Opening {args.path} ...")
    wb = open_workbook(args.path)

    tws = wb["Teams"]
    th = header_map(tws)
    team_name = {}
    for row in range(2, tws.max_row + 1):
        tid = tws.cell(row=row, column=th["Team ID"]).value
        if tid is not None:
            team_name[tid] = tws.cell(row=row, column=th["Team"]).value

    pws = wb["Players"]
    ph = header_map(pws)
    player_name = {}
    player_ext = {}
    for row in range(2, pws.max_row + 1):
        pid = pws.cell(row=row, column=ph["Player ID"]).value
        if pid is None:
            continue
        first = pws.cell(row=row, column=ph["First Name"]).value or ""
        last = pws.cell(row=row, column=ph["Last Name"]).value or ""
        player_name[pid] = f"{first} {last}".strip()
        player_ext[pid] = pws.cell(row=row, column=ph["External ID"]).value if "External ID" in ph else None

    pgws = wb["PlayerGameStats"]
    pgh = header_map(pgws)

    print("Scanning PlayerGameStats ...")
    groups = collections.defaultdict(list)          # (team_id, game_id) -> [(row, pid, min, pts, opp, date, season)]
    all_rows_by_pid = collections.defaultdict(list)  # player_id -> [row_idx, ...]
    row_pts_season = {}                               # row_idx -> (pid, team_id, season)
    n = 0
    for row in range(2, pgws.max_row + 1):
        pid = pgws.cell(row=row, column=pgh["Player ID"]).value
        if pid is None:
            continue
        n += 1
        tid = pgws.cell(row=row, column=pgh["Team ID"]).value
        gid = pgws.cell(row=row, column=pgh["Game ID"]).value
        mins = pgws.cell(row=row, column=pgh["Min"]).value or 0
        pts = pgws.cell(row=row, column=pgh["Points"]).value or 0
        opp = pgws.cell(row=row, column=pgh["Opponent"]).value if "Opponent" in pgh else None
        date = pgws.cell(row=row, column=pgh["Date"]).value if "Date" in pgh else None
        season = pgws.cell(row=row, column=pgh["Season"]).value if "Season" in pgh else None
        if tid is not None and gid is not None:
            groups[(tid, gid)].append((row, pid, mins, pts, opp, date, season))
        all_rows_by_pid[pid].append(row)
        row_pts_season[row] = (pid, tid, season)
        if n % 200000 == 0:
            print(f"  ... {n} rows scanned")

    print(f"{n} PlayerGameStats rows scanned, {len(groups)} distinct (Team, Game) box scores.")

    merged_opponent = []
    rows_to_delete = set()
    deleted_pids = set()
    phantom_summary = []

    for (tid, gid), rows in groups.items():
        total_min = sum(r[2] for r in rows)
        player_count = len(rows)
        zero_min_count = sum(1 for r in rows if r[2] == 0)

        if total_min >= MERGED_OPPONENT_MINUTES_MIN:
            merged_opponent.append((tid, gid, rows, total_min))
        elif player_count >= args.min_players and zero_min_count >= args.min_zero:
            zero_pairs = [(pid, player_ext.get(pid)) for _, pid, mins, *_ in rows if mins == 0]
            clusters = find_id_clusters(zero_pairs, ID_CLUSTER_GAP, ID_CLUSTER_MIN_SIZE)
            suspect_pids = {pid for c in clusters for pid in c}
            if not suspect_pids:
                continue
            suspect_rows = [r for r in rows if r[1] in suspect_pids]
            for r in suspect_rows:
                rows_to_delete.add(r[0])
                deleted_pids.add(r[1])
            phantom_summary.append((tid, gid, rows[0][4], rows[0][5], rows[0][6], suspect_pids))

    print(f"\n{len(merged_opponent)} MERGED_OPPONENT game(s) found -- NOT auto-cleaned, review manually:")
    for tid, gid, rows, total_min in merged_opponent:
        print(f"    {team_name.get(tid, tid)} (Team ID {tid}), Game ID {gid}: "
              f"{len(rows)} players, {total_min} total minutes")

    print(f"\n{len(phantom_summary)} PHANTOM_CLUSTER game(s) -- {len(rows_to_delete)} PlayerGameStats rows to remove, "
          f"{len(deleted_pids)} distinct players affected:")
    for tid, gid, opp, date, season, suspect_pids in phantom_summary:
        print(f"    {team_name.get(tid, tid)} (Team ID {tid}) vs {opp} on {date} (Season {season}, Game ID {gid}): "
              f"{len(suspect_pids)} phantom rows")

    # Layer 2 safety check: does each affected player have ANY remaining
    # PlayerGameStats row anywhere after removing rows_to_delete?
    fully_remove_pids = set()
    partial_pids = set()
    for pid in deleted_pids:
        remaining = [r for r in all_rows_by_pid[pid] if r not in rows_to_delete]
        if remaining:
            partial_pids.add(pid)
        else:
            fully_remove_pids.add(pid)

    print(f"\n{len(fully_remove_pids)} player(s) have ZERO remaining appearances anywhere after cleanup "
          f"-- their Players rows will also be removed:")
    for pid in sorted(fully_remove_pids):
        print(f"    Player ID {pid}: {player_name.get(pid, '?')} (ext {player_ext.get(pid)})")

    if partial_pids:
        print(f"\n{len(partial_pids)} player(s) have OTHER real appearances elsewhere -- "
              f"only their bogus rows are removed, Players row is KEPT:")
        for pid in sorted(partial_pids):
            print(f"    Player ID {pid}: {player_name.get(pid, '?')} (ext {player_ext.get(pid)})")

    # Layer 3: which (Player ID, Team ID, Season) combos have zero
    # PlayerGameStats rows remaining -- these PlayerSeasons rows are stale
    # regardless of whether the player's Players row is kept or removed.
    remaining_combos = set()
    removed_combos = set()
    for row, (pid, tid, season) in row_pts_season.items():
        combo = (pid, tid, season)
        if row in rows_to_delete:
            removed_combos.add(combo)
        else:
            remaining_combos.add(combo)
    stale_combos = removed_combos - remaining_combos
    print(f"\n{len(stale_combos)} (Player, Team, Season) combination(s) have zero PlayerGameStats rows left "
          f"-- their PlayerSeasons row(s) will be removed:")
    for pid, tid, season in sorted(stale_combos):
        print(f"    Player ID {pid} / Team ID {tid} ({team_name.get(tid, '?')}) / {season}")

    if not args.write:
        print("\n--write not passed: dry run only, workbook NOT modified.")
        return

    if not rows_to_delete:
        print("\nNothing to change.")
        return

    print("\nRebuilding PlayerGameStats (removing flagged rows) ...")
    kept_rows = []
    for row in range(2, pgws.max_row + 1):
        if row in rows_to_delete:
            continue
        vals = [pgws.cell(row=row, column=c).value for c in range(1, pgws.max_column + 1)]
        if all(v is None for v in vals):
            continue
        kept_rows.append(vals)
    new_pgws = wipe_data_rows(wb, "PlayerGameStats", keep_header=True)
    for vals in kept_rows:
        new_pgws.append(vals)
    print(f"  PlayerGameStats: {len(kept_rows)} rows kept, {len(rows_to_delete)} removed.")

    if fully_remove_pids:
        print("Rebuilding Players (removing fully-phantom rows) ...")
        p_kept = []
        for row in range(2, pws.max_row + 1):
            pid = pws.cell(row=row, column=ph["Player ID"]).value
            if pid in fully_remove_pids:
                continue
            vals = [pws.cell(row=row, column=c).value for c in range(1, pws.max_column + 1)]
            if all(v is None for v in vals):
                continue
            p_kept.append(vals)
        new_pws = wipe_data_rows(wb, "Players", keep_header=True)
        for vals in p_kept:
            new_pws.append(vals)
        print(f"  Players: {len(p_kept)} rows kept, {len(fully_remove_pids)} removed.")

    if stale_combos:
        print("Rebuilding PlayerSeasons (removing stale Player/Team/Season rows) ...")
        psws = wb["PlayerSeasons"]
        psh = header_map(psws)
        ps_kept = []
        removed_ps = 0
        for row in range(2, psws.max_row + 1):
            pid = psws.cell(row=row, column=psh["Player ID"]).value
            tid = psws.cell(row=row, column=psh["Team ID"]).value
            season = psws.cell(row=row, column=psh["Season"]).value
            if (pid, tid, season) in stale_combos:
                removed_ps += 1
                continue
            vals = [psws.cell(row=row, column=c).value for c in range(1, psws.max_column + 1)]
            if all(v is None for v in vals):
                continue
            ps_kept.append(vals)
        new_psws = wipe_data_rows(wb, "PlayerSeasons", keep_header=True)
        for vals in ps_kept:
            new_psws.append(vals)
        print(f"  PlayerSeasons: {len(ps_kept)} rows kept, {removed_ps} removed.")

    print("\nSaving ...")
    save_with_retry(wb, args.path)
    print("Done.")


if __name__ == "__main__":
    main()
