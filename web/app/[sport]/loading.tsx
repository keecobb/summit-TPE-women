// Next.js file-based Suspense boundary -- covers every route nested under
// [sport]/ that doesn't define its own loading.tsx (which, as of this
// file, is all of them: players/[id], teams/[id], data, tpe, etc.).
//
// Without this, clicking a player/team link had no immediate feedback at
// all: Next has to finish the ENTIRE server render (including every
// apiFetch() call on the destination page) before showing anything, so a
// slow backend response (the Summit TPE API waking up from an idle
// spin-down, see lib/api.ts's apiFetch timeout comment) reads as "nothing
// happened when I clicked" for however long that takes. This file makes
// the navigation itself instant -- the URL changes and this shows up
// immediately -- while the real page streams in behind it.
export default function SportSectionLoading() {
  return (
    <div className="card" style={{ textAlign: "center", padding: "48px 24px", color: "var(--text-dim)" }}>
      Loading&hellip;
    </div>
  );
}
