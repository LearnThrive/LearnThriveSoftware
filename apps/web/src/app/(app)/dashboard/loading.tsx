/**
 * Plan6 section 69: a skeleton that mirrors the shape of what's coming, so the page doesn't
 * flash empty then reflow. The shell (sidebar, topbar) stays put throughout — only the content
 * area is replaced, which is the whole reason the shell lives in a layout.
 */
export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="skeleton skeleton--title" />
      <div className="skeleton-grid">
        {[0, 1, 2, 3].map((index) => <div className="skeleton skeleton--tile" key={index} />)}
      </div>
      <div className="grid-2">
        {[0, 1].map((column) => (
          <div className="card" key={column} style={{ padding: "var(--space-5)" }}>
            <div className="skeleton skeleton--text" style={{ width: "35%", height: "1.1rem", marginBottom: "var(--space-4)" }} />
            {[0, 1, 2].map((row) => <div className="skeleton skeleton--row" key={row} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
