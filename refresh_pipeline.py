"""Refreshes a summit_tpe_cache_<sport>.sqlite from a workbook that's
already been updated (scraped/backfilled) -- the mechanical, safe-to-
automate half of keeping a live site's data current, without the manual
"SSH in, run build_cache.py, restart uvicorn" dance, and without a live
site ever serving a half-written or known-bad cache.

Deliberately does NOT run the scraper or any backfill script itself --
those have needed human judgment more than once this project (see e.g.
backfill_pgs_team_300.py's history), so this pipeline starts from "the
workbook is already in the state you want" and handles everything after
that point:

  1. check_data_health.py against the workbook -- if it finds any ERROR-
     level issue (duplicate ESPN IDs, a blown-up roster, orphaned team
     refs, etc), this ABORTS before touching the live cache at all. A
     corrupted workbook should never silently become a corrupted live
     cache just because a refresh happened to run.
  2. build_cache.py --sport <sport>, writing to a TEMP file, not the live
     path -- so a build that fails partway through (crash, disk full,
     whatever) never leaves the live cache half-written.
  3. Backs up the current live cache to <out>.bak (one generation of
     rollback) if one exists.
  4. Atomically swaps the temp file into the live path (os.replace).

Refreshing one sport's cache never touches the other sport's file -- see
--sport below and api.py's DB_PATHS (each sport reads its own file).

No API restart is needed after this: api.py's get_conn(sport) opens a
fresh sqlite3 connection per request rather than holding one open for the
process lifetime, so the very next request after the swap reads the new
data. That's an existing property of api.py, not something this script
does -- confirmed by reading get_conn() rather than assumed.

Usage:
    python refresh_pipeline.py --path WomensSummitTPE.xlsx --sport women
    python refresh_pipeline.py --path MensSummitTPE.xlsx --sport men
    python refresh_pipeline.py --path WomensSummitTPE.xlsx --sport women --out summit_tpe_cache_women.sqlite
    python refresh_pipeline.py --path WomensSummitTPE.xlsx --sport women --skip-health-check   # not recommended
    python refresh_pipeline.py --path WomensSummitTPE.xlsx --sport women --max-roster 30       # passed through to check_data_health.py

Exit code is 0 only if the live cache was actually updated. Non-zero on
any failure (health check failed, build failed) -- suitable for a cron
job/scheduled task to alert on.
"""
 
import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path
 
HERE = Path(__file__).parent
 
 
def run_step(description, cmd):
    print(f"\n--- {description} ---")
    print(f"$ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=HERE)
    return result.returncode == 0
 
 
def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--path", required=True, help="Path to the already-updated workbook "
                                                        "(WomensSummitTPE.xlsx or MensSummitTPE.xlsx)")
    parser.add_argument("--sport", required=True, choices=["women", "men"],
                         help="Which sport this workbook covers -- passed straight through to "
                              "build_cache.py --sport, and picks the default --out filename.")
    parser.add_argument("--out", default=None, help="Live cache path api.py reads from. Defaults to "
                                                      "summit_tpe_cache_<sport>.sqlite if not given.")
    parser.add_argument("--skip-health-check", action="store_true",
                         help="Skip check_data_health.py and build anyway. Not recommended -- "
                              "this is the guardrail that stops known-bad data from going live.")
    parser.add_argument("--max-roster", type=int, default=None, help="Passed through to check_data_health.py")
    parser.add_argument("--min-roster", type=int, default=None, help="Passed through to check_data_health.py")
    args = parser.parse_args()
 
    workbook = Path(args.path)
    if not workbook.exists():
        sys.exit(f"No workbook at {workbook} -- nothing to refresh from.")
 
    out_name = args.out or f"summit_tpe_cache_{args.sport}.sqlite"
    live_path = HERE / out_name
    tmp_path = HERE / f"{out_name}.building-{int(time.time())}"
    bak_path = HERE / f"{out_name}.bak"
 
    # ---- 1. health check gate ----
    if args.skip_health_check:
        print("--skip-health-check given -- SKIPPING the corruption gate. Proceeding blind.")
    else:
        cmd = [sys.executable, "check_data_health.py", "--path", str(workbook)]
        if args.max_roster is not None:
            cmd += ["--max-roster", str(args.max_roster)]
        if args.min_roster is not None:
            cmd += ["--min-roster", str(args.min_roster)]
        ok = run_step("1/3 Data health check (gates everything below)", cmd)
        if not ok:
            print("\nHealth check found ERROR-level issues (see above). ABORTING before touching the "
                  "live cache -- fix the workbook first, or re-run with --skip-health-check if you've "
                  "reviewed the findings and are confident they're false positives.")
            sys.exit(1)
        print("Health check passed (no ERROR-level findings).")
 
    # ---- 2. build to a temp file, never directly to the live path ----
    ok = run_step("2/3 Building cache to a temp file",
                   [sys.executable, "build_cache.py", "--path", str(workbook), "--sport", args.sport,
                    "--out", str(tmp_path)])
    if not ok:
        tmp_path.unlink(missing_ok=True)
        print("\nbuild_cache.py failed (see above). Live cache was NOT touched.")
        sys.exit(1)
    if not tmp_path.exists():
        print("\nbuild_cache.py reported success but produced no output file -- aborting, live cache "
              "was NOT touched.")
        sys.exit(1)
 
    # ---- 3. backup + atomic swap ----
    print(f"\n--- 3/3 Swapping the new cache into place ---")
    if live_path.exists():
        shutil.copy2(live_path, bak_path)
        print(f"Backed up previous live cache to {bak_path.name} (one generation of rollback).")
    tmp_path.replace(live_path)  # os.replace -- atomic on the same filesystem
    print(f"Live cache updated: {live_path.name}")
    print("No API restart needed -- api.py opens a fresh connection per request, so the very next "
          "request will read this new data.")
    return 0
 
 
if __name__ == "__main__":
    sys.exit(main())