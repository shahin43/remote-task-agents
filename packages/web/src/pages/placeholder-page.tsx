interface Props {
  title: string;
  summary: string;
  items: string[];
}

/**
 * Reusable "coming soon" surface for future-scope sections (Repos, Context
 * layers, Memory & Skills). Kept extendable: each becomes a real configuration
 * page driven by the same /api board surface when its backing domain lands.
 */
export function PlaceholderPage({ title, summary, items }: Props) {
  return (
    <main className="placeholder-page">
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          <p>{summary}</p>
        </div>
      </header>
      <div className="placeholder-body">
        <div className="placeholder-card">
          <span className="soon-badge">Coming soon</span>
          <h2>Planned for a future scope</h2>
          <p>This section is scaffolded so it can be driven by users from the UI later.</p>
          <ul>
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
