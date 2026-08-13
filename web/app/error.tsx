"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="error-box">
      <strong>Couldn&apos;t load this page.</strong>
      <p style={{ margin: "8px 0 12px" }}>
        {error.message || "The Summit TPE API didn't respond as expected."}
      </p>
      <button className="btn" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
