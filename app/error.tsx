"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="error-shell">
      <section className="error-card" role="alert">
        <AlertTriangle aria-hidden="true" />
        <div>
          <h1 className="page-title">Workspace unavailable</h1>
          <p>{error.message || "Something went wrong while loading this workspace. Please try the page again."}</p>
        </div>
        <div className="error-actions">
          <button className="button primary" onClick={() => reset()} type="button">
            <RefreshCw size={17} aria-hidden="true" />
            Try again
          </button>
        </div>
      </section>
    </div>
  );
}
