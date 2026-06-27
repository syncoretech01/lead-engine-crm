"use client";

import { useEffect, useState } from "react";

export type RailStage = {
  id: string;
  n: number;
  label: string;
  meta: string;
  status: "done" | "active" | "upcoming";
};

/**
 * Sticky build-progress rail: reflects each stage's server-derived status, scroll-
 * spies the active stage as you read, and jumps to a stage on click. Presentation
 * only - all state lives on the server.
 */
export function BuildProgressRail({
  stages,
  stepLabel,
  progressPct
}: {
  stages: RailStage[];
  stepLabel: string;
  progressPct: number;
}) {
  const [active, setActive] = useState<string>(
    stages.find((stage) => stage.status === "active")?.id ?? stages[0]?.id ?? ""
  );

  useEffect(() => {
    const sections = stages
      .map((stage) => document.getElementById(`stage-${stage.id}`))
      .filter((el): el is HTMLElement => Boolean(el));
    if (sections.length === 0) return;

    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace(/^stage-/, "");
          ratios.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        let best = "";
        let bestRatio = -1;
        for (const [id, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = id;
          }
        }
        if (best && bestRatio > 0) setActive(best);
      },
      { rootMargin: "-12% 0px -55% 0px", threshold: [0, 0.2, 0.5, 0.8, 1] }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [stages]);

  const jump = (id: string) => {
    document.getElementById(`stage-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <aside className="build-rail" aria-label="Build progress">
      <div className="build-rail-head">
        <div className="build-rail-head-row">
          <span className="build-rail-kicker">Build progress</span>
          <span className="build-rail-step">{stepLabel}</span>
        </div>
        <div className="build-progress-track">
          <div className="build-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>
      {stages.map((stage) => (
        <button
          key={stage.id}
          type="button"
          className={`build-stage-link${active === stage.id ? " active" : ""}`}
          onClick={() => jump(stage.id)}
        >
          <span className={`build-badge${stage.status === "done" ? " done" : stage.status === "active" ? " active" : ""}`}>
            {stage.status === "done" ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7" />
              </svg>
            ) : (
              stage.n
            )}
          </span>
          <span className="build-stage-link-text">
            <span className="build-stage-link-label">{stage.label}</span>
            <span className="build-stage-link-meta">{stage.meta}</span>
          </span>
        </button>
      ))}
    </aside>
  );
}
