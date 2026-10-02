"use client";

/**
 * The last-resort boundary (plan15 Wave 10 section 14.5): it replaces the root layout when the layout
 * itself throws, so it must supply <html> and <body> and cannot rely on the site's stylesheets,
 * fonts or components — everything here is inline and self-contained, in the brand's navy and mint.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-GB">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          background: "#0e2a47",
          color: "#f2f7fa",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <main style={{ maxWidth: "34rem" }}>
          <p style={{ margin: 0, color: "#8ed2ad", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            LearnThrive Tuition
          </p>
          <h1 style={{ margin: "0.6rem 0 1rem", fontSize: "2.2rem", lineHeight: 1.1 }}>Something went wrong</h1>
          <p style={{ margin: "0 0 1.6rem", lineHeight: 1.6, color: "rgba(242,247,250,0.84)" }}>
            Sorry — the site could not load. Please try again in a moment. If it keeps happening you can
            email info@learnthrivetuition.co.uk.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "0.8rem 1.4rem",
              border: 0,
              borderRadius: "0.6rem",
              background: "#8ed2ad",
              color: "#0e2a47",
              fontWeight: 700,
              fontSize: "1rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
