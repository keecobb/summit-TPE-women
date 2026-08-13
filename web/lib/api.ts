import "server-only";
// The "server-only" import above makes Next.js fail the build with a
// clear error if this file is ever accidentally imported into a Client
// Component -- SUMMIT_TPE_API_KEY must never reach the browser bundle.

const API_URL = process.env.SUMMIT_TPE_API_URL;
const API_KEY = process.env.SUMMIT_TPE_API_KEY;

if (!API_URL) {
  // Doesn't throw at import time (build/dev server should still start),
  // but every actual fetch below will -- see apiFetch().
  console.warn(
    "[summit-tpe-web] SUMMIT_TPE_API_URL is not set -- pages that fetch data will error until " +
      "it's configured. Copy .env.example to .env.local and fill it in."
  );
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

type Params = Record<string, string | number | boolean | undefined | (string | number)[]>;

/**
 * Server-side-only fetch against the Summit TPE API. Always attaches the
 * X-API-Key header here (never in client code) so the key is never sent
 * to, or visible from, a visitor's browser -- pages import this directly
 * as Server Components, and it's only ever exposed via the app's own
 * server, matching how api.py's key check is meant to be used from a
 * real frontend rather than a public `curl`.
 */
export async function apiFetch<T>(
  path: string,
  { params, revalidate = 60 }: { params?: Params; revalidate?: number } = {}
): Promise<T> {
  if (!API_URL) {
    throw new ApiError(0, "SUMMIT_TPE_API_URL is not configured on this deployment.");
  }
  const url = new URL(path, API_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === "") continue;
      if (Array.isArray(value)) {
        // Repeated query params, e.g. ?stats=per40_reb&stats=per40_blk --
        // matches FastAPI's list[str] Query parsing on the other end.
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const res = await fetch(url.toString(), {
    headers: API_KEY ? { "X-API-Key": API_KEY } : {},
    // Short revalidation window rather than fully static -- the live
    // cache behind the API can change after a refresh_pipeline.py run
    // at any time, with no deploy/restart of this site needed to see it.
    next: { revalidate },
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // response wasn't JSON -- fall back to statusText above
    }
    throw new ApiError(res.status, detail);
  }

  return (await res.json()) as T;
}
