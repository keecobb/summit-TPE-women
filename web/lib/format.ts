// The backend's category labels (projection.py's CATEGORY_INFO, e.g.
// "scoring", "perimeter defense / steals") are lowercase by design on the
// API side. Capitalize for display here rather than changing the API
// contract, since other consumers (future mobile app, direct API users)
// may already depend on the lowercase form.
export function titleCase(s: string): string {
  return s.replace(/(^|\s|\/|\()([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}
