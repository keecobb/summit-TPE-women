# Summit TPE API -- deploy image
#
# This bakes the current summit_tpe_cache.sqlite into the image, so the
# running container never depends on your computer, an attached volume,
# or anything outside itself. To ship a data refresh: run
# refresh_pipeline.py locally as usual, then rebuild + redeploy this
# image (see the platform-specific notes in DEPLOY.md). Your machine only
# needs to be on for the minute or two that takes -- not continuously.
#
# Build from the HoopScoreImporter folder itself (same folder as api.py):
#   docker build -t summit-tpe-api .

FROM python:3.11-slim

WORKDIR /app

# Only the runtime deps -- fastapi + its ASGI server. openpyxl and the
# rest of requirements_calculator.txt are build-time-only (build_cache.py
# needs them; the running API does not) and are deliberately left out to
# keep the image small.
COPY requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt

# Only what api.py actually imports at runtime, plus the data file it
# reads. Not build_cache.py, not the xlsx workbook, not the scrapers --
# see .dockerignore for the full exclusion list.
COPY api.py projection.py summit_calc.py ./
COPY summit_tpe_cache.sqlite ./

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
