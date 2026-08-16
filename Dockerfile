# Summit TPE API -- deploy image
#
# This bakes the current summit_tpe_cache_<sport>.sqlite file(s) into the
# image, so the running container never depends on your computer, an
# attached volume, or anything outside itself. To ship a data refresh: run
# refresh_pipeline.py --sport <sport> locally as usual, then rebuild +
# redeploy this image (see the platform-specific notes in DEPLOY.md). Your
# machine only needs to be on for the minute or two that takes -- not
# continuously.
#
# Build from the HoopScoreImporter folder itself (same folder as api.py):
#   docker build -t summit-tpe-api .
#
# REQUIRES at least summit_tpe_cache_women.sqlite to exist in the build
# context before building (run build_cache.py --sport women first if it
# doesn't -- see MENS_SCRAPER_PROGRESS.md phase 22 / ARCHITECTURE_HOSTING_
# PLAN.md for the sport-plumbing rollout this is part of). If a plain
# summit_tpe_cache.sqlite (the old, pre-sport-plumbing filename) is what
# you actually have on disk, rename it to summit_tpe_cache_women.sqlite --
# api.py's legacy-filename fallback exists for a not-yet-rebuilt RUNNING
# container, not to keep feeding this Dockerfile the old name forever.
# summit_tpe_cache_men.sqlite is copied in too if present, but its
# absence doesn't fail the build -- /men/* routes just 503 with a clear
# "run build_cache.py --sport men first" message until it's built.

FROM python:3.11-slim

WORKDIR /app

# Only the runtime deps -- fastapi + its ASGI server. openpyxl and the
# rest of requirements_calculator.txt are build-time-only (build_cache.py
# needs them; the running API does not) and are deliberately left out to
# keep the image small.
COPY requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt

# Only what api.py actually imports at runtime, plus the data file(s) it
# reads. Not build_cache.py, not the xlsx workbook, not the scrapers --
# see .dockerignore for the full exclusion list.
COPY api.py projection.py summit_calc.py ./
# Wildcard, not two explicit COPY lines: requires at least ONE match (so
# the build still fails loudly if you forgot to build the women's cache
# at all -- see the note above), but doesn't hard-require the men's file
# to exist yet, matching how api.py itself treats a missing sport cache
# (503, not a hard crash).
COPY summit_tpe_cache_*.sqlite ./

# api.py's own module-level warning already tells you at boot if these
# are left at their insecure defaults -- set both for real before this
# is public. See DEPLOY.md.
ENV SUMMIT_TPE_API_KEY=""
ENV SUMMIT_TPE_ALLOWED_ORIGINS="*"

EXPOSE 8000

# Fly/Render/Railway all set $PORT; default to 8000 for a plain
# `docker run` locally. --workers 1 is deliberate: get_conn() opens a
# fresh sqlite connection per request rather than pooling one for the
# process, so more workers just means more file handles, not more
# throughput, at this data size -- bump it later if real load justifies it.
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
