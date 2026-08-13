"""Summit TPE data-ingestion scrapers.

Everything in this package writes into WomensSummitTPE.xlsx directly
(per your call to keep one Excel file as the system of record, rather
than staging in a separate database). Because of that, every script
here is built to be safely re-run:

- Teams sheet gets tracking columns (Scrape Status / Last Scraped
  Season / Scrape Error) so a script can skip teams it already
  finished and retry ones that failed, instead of re-scraping
  everything from scratch every run.
- Writes are batched and the workbook is saved periodically (not
  after every single row), because re-saving a multi-MB .xlsx on
  every write would make a run take hours. See CHECKPOINT_EVERY in
  each orchestrator script if you want to tune that tradeoff.

These scripts need real internet access, so they're meant to be run
from your own machine (using the .venv already in this project), not
from any sandboxed environment.
"""
