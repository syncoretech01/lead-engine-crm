export default function Loading() {
  return (
    <div className="loading-shell" aria-busy="true" aria-live="polite">
      <header className="page-header">
        <div>
          <div className="skeleton line kicker" />
          <div className="skeleton title" style={{ marginTop: "10px" }} />
          <div className="skeleton line copy" style={{ marginTop: "10px" }} />
        </div>
      </header>

      <section className="loading-grid" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <article className="loading-card" key={index}>
            <div className="skeleton line" style={{ width: "42%" }} />
            <div className="skeleton value" />
            <div className="skeleton line" style={{ width: "78%" }} />
          </article>
        ))}
      </section>

      <section className="grid two">
        <article className="loading-card">
          <div className="skeleton line" style={{ width: "34%" }} />
          <div className="skeleton card-copy" />
        </article>
        <article className="loading-card">
          <div className="skeleton line" style={{ width: "30%" }} />
          <div className="skeleton card-copy" />
        </article>
      </section>
    </div>
  );
}
