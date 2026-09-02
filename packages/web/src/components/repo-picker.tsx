export interface ProjectRepoCatalogEntry {
  slug: string;
  provider: string;
  baseBranch: string;
  dest: string;
  readOnly?: boolean;
  isDefault?: boolean;
}

interface Props {
  catalog: ProjectRepoCatalogEntry[];
  selected: string[];
  onChange: (slugs: string[]) => void;
  disabled?: boolean;
}

export function RepoPicker({ catalog, selected, onChange, disabled }: Props) {
  function toggle(slug: string) {
    if (disabled) return;
    if (selected.includes(slug)) {
      if (selected.length === 1) return;
      onChange(selected.filter((s) => s !== slug));
      return;
    }
    onChange([...selected, slug]);
  }

  if (catalog.length === 0) {
    return <p className="repo-picker-empty">No repos configured for this project.</p>;
  }

  return (
    <ul className="repo-picker-list">
      {catalog.map((repo) => {
        const checked = selected.includes(repo.slug);
        return (
          <li key={repo.slug}>
            <label className="repo-picker-item">
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(repo.slug)}
              />
              <span className="repo-picker-slug">{repo.slug}</span>
              <span className="repo-picker-meta">
                {repo.dest}
                {repo.isDefault ? " · default" : ""}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
