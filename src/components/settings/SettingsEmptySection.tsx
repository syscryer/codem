type SettingsEmptySectionProps = {
  title: string;
};

export function SettingsEmptySection({ title }: SettingsEmptySectionProps) {
  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>{title}</h1>
      </header>
      <div className="settings-empty-panel">
        <strong>{title}</strong>
        <span>此分类稍后接入。</span>
      </div>
    </section>
  );
}
