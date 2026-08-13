"""Optional follow-up analysis for projection.py's projected_range.
 
The original production_factor fit (see projection.py's module docstring,
"Calibration note") used the ~1,359 real transfers findable in the
workbook (a player whose Team ID changes between two consecutive seasons
in PlayerSeasons) to fit a straight line through the MEDIAN actual
per40_pts change per strength-gap bucket. That gives a good POINT
estimate, but says nothing about the SPREAD of real outcomes within a
bucket -- which is exactly what a numeric confidence range needs.
 
This script reruns the same real-transfer detection, but for each
strength-gap bucket reports the full percentile spread (p10/p25/median/
p75/p90) of the actual production_factor (actual per40_pts in the new
season / per40_pts in the old season) observed in that bucket, instead of
just the median used for the point-estimate fit.
 
This is READ-ONLY -- it never writes to the workbook. It reuses
build_cache.py's exact season-profile math (so per40_pts here is computed
identically to what's in the live cache), just run across every season
pair instead of only the current season.
 
Usage:
    python compute_transfer_calibration_spread.py --path WomensSummitTPE.xlsx
 
Output: printed only. If you want to fold the results into
projection.py's projected_range (replacing the current heuristic -- see
CONFIDENCE_RANGE_FRACTION and the honesty note in projection.py's module
docstring), send me the printed table and I'll refit it the same way the
original production_factor line was fit.
"""
 
import argparse
import statistics
from collections import defaultdict
 
from build_cache import compute_season_profiles, load
 
BUCKET_WIDTH_STD = 0.5
BUCKET_RANGE_STD = 3.0
MIN_BUCKET_N = 5
 
 
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", required=True)
    args = parser.parse_args()
 
    data = load(args.path)
    seasons = sorted(data["games_by_season"].keys())
    print(f"\nSeasons found: {seasons}")
 
    # player_id -> {season: {team_id, per40_pts, rating}}
    by_player = defaultdict(dict)
    season_std = {}
    for season in seasons:
        print(f"Computing {season} profiles ...")
        result = compute_season_profiles(data, season)
        rat_by_team = {t["team_id"]: t["current_rating"] for t in result["team_rows"]}
        season_std[season] = result["league_std_rat"]
        for p in result["player_rows"]:
            by_player[p["player_id"]][season] = dict(
                team_id=p["team_id"], per40_pts=p["per40_pts"],
                rating=rat_by_team.get(p["team_id"]),
            )
 
    # find real transfers: consecutive seasons, team_id changes
    buckets = defaultdict(list)  # bucket_center -> [actual_factor, ...]
    n_transfers = 0
    for pid, by_season in by_player.items():
        avail = [s for s in seasons if s in by_season]
        for i in range(len(avail) - 1):
            s_prev, s_next = avail[i], avail[i + 1]
            prev, nxt = by_season[s_prev], by_season[s_next]
            if prev["team_id"] == nxt["team_id"]:
                continue  # same team, not a transfer
            if prev["per40_pts"] is None or not prev["per40_pts"]:
                continue
            if prev["rating"] is None or nxt["rating"] is None:
                continue
            std = season_std[s_next] or 1.0
            gap_std = (nxt["rating"] - prev["rating"]) / std
            actual_factor = nxt["per40_pts"] / prev["per40_pts"]
            bucket_center = round(gap_std / BUCKET_WIDTH_STD) * BUCKET_WIDTH_STD
            bucket_center = max(-BUCKET_RANGE_STD, min(BUCKET_RANGE_STD, bucket_center))
            buckets[bucket_center].append(actual_factor)
            n_transfers += 1
 
    print(f"\nReal transfers found: {n_transfers}")
    print(f"\n{'gap_std bucket':>15} {'n':>5} {'p10':>7} {'p25':>7} {'median':>7} {'p75':>7} {'p90':>7}")
    for center in sorted(buckets):
        vals = sorted(buckets[center])
        n = len(vals)
        if n < MIN_BUCKET_N:
            print(f"{center:>15.1f} {n:>5}  (fewer than {MIN_BUCKET_N} real cases -- skipped)")
            continue
 
        def pct(p):
            k = (n - 1) * p
            f, c = int(k), min(int(k) + 1, n - 1)
            return vals[f] + (vals[c] - vals[f]) * (k - f)
 
        print(f"{center:>15.1f} {n:>5} {pct(0.10):>7.2f} {pct(0.25):>7.2f} "
              f"{statistics.median(vals):>7.2f} {pct(0.75):>7.2f} {pct(0.90):>7.2f}")
 
    print("\nDone. Paste this table back if you want projected_range refit against it "
          "instead of the current confidence-tier heuristic.")
 
 
if __name__ == "__main__":
    main()