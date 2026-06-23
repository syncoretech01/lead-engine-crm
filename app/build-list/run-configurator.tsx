"use client";

import { useMemo, useState } from "react";
import { Database, DollarSign, ListChecks, Play, Target } from "lucide-react";
import { createLeadJobAction } from "@/app/actions";
import { ToastButton } from "@/app/build-list/toaster";
import { StatCard } from "@/components/ui-metrics";
import { estimateLeadJobCost } from "@/lib/phase1/lead-cost";
import { formatCurrency, formatNumber } from "@/lib/utils";

export type ConfiguratorProfile = {
  id: string;
  name: string;
  estimatedVolume: number;
  recommendedSources: string[];
  rationale: string;
};

const SOURCE_COLORS: Record<string, string> = {
  Apollo: "var(--primary)",
  Hunter: "var(--teal-500)",
  "Google Places": "var(--blue-300)",
  Apify: "var(--teal-400)",
  "CSV Upload": "var(--ink-300)"
};

const money = (cents: number) => formatCurrency(cents / 100);

export function RunConfigurator({
  profiles,
  sourceOptions,
  initialProfileId
}: {
  profiles: ConfiguratorProfile[];
  sourceOptions: string[];
  initialProfileId: string;
}) {
  const [profileId, setProfileId] = useState(initialProfileId);
  const profile = profiles.find((item) => item.id === profileId) ?? profiles[0];
  const [chosenSources, setChosenSources] = useState<string[]>(profile?.recommendedSources ?? []);
  const [records, setRecords] = useState<number>(profile?.estimatedVolume ?? 100);
  const [budgetDollars, setBudgetDollars] = useState<number | "">("");

  const onProfile = (id: string) => {
    const next = profiles.find((item) => item.id === id);
    setProfileId(id);
    if (next) {
      setChosenSources([...next.recommendedSources]);
      setRecords(next.estimatedVolume);
      setBudgetDollars("");
    }
  };

  const toggleSource = (name: string) =>
    setChosenSources((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]));

  const cost = useMemo(
    () =>
      estimateLeadJobCost({
        sources: chosenSources,
        requestedRecords: records || 0,
        budgetCapCents: budgetDollars === "" ? undefined : Math.round(Number(budgetDollars) * 100)
      }),
    [chosenSources, records, budgetDollars]
  );

  const recommendedCapDollars = useMemo(
    () => Math.round(estimateLeadJobCost({ sources: chosenSources, requestedRecords: records || 0 }).budgetCapCents / 100),
    [chosenSources, records]
  );

  if (!profile) return null;

  const hasSources = chosenSources.length > 0;
  const withinBudget = cost.budgetStatus === "Within budget";
  const budgetCapDollars = Math.round(cost.budgetCapCents / 100);
  const maxCost = Math.max(...cost.sourceEstimates.map((estimate) => estimate.estimatedCostCents), 1);

  return (
    <div className="form-grid">
      <div className="field">
        <label htmlFor="run-profile">Search profile</label>
        <select id="run-profile" value={profileId} onChange={(event) => onProfile(event.target.value)}>
          {profiles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="run-records">Requested records</label>
        <input
          id="run-records"
          type="number"
          min="1"
          value={records}
          onChange={(event) => setRecords(Math.max(0, Math.round(Number(event.target.value) || 0)))}
        />
      </div>

      <div className="field">
        <label htmlFor="run-budget">Budget cap ($)</label>
        <input
          id="run-budget"
          type="number"
          min="0"
          value={budgetDollars}
          placeholder={String(recommendedCapDollars)}
          onChange={(event) =>
            setBudgetDollars(event.target.value === "" ? "" : Math.max(0, Math.round(Number(event.target.value) || 0)))
          }
        />
      </div>

      <div className="field integration-options">
        <label>Sources</label>
        <div className="chip-row">
          {sourceOptions.map((name) => {
            const selected = chosenSources.includes(name);
            return (
              <button
                key={name}
                type="button"
                className={`source-chip${selected ? " selected" : ""}`}
                onClick={() => toggleSource(name)}
              >
                <span className="source-chip-dot" />
                {name}
              </button>
            );
          })}
        </div>
        <p className="surface-note">{profile.rationale}</p>
      </div>

      <div className="stat-grid">
        <StatCard icon={Database} label="Est. records" value={formatNumber(cost.estimatedRecords)} note="Across selected sources" />
        <StatCard icon={DollarSign} label="Est. cost" value={money(cost.estimatedCostCents)} note="Acquisition + enrichment" />
        <StatCard icon={ListChecks} label="Credits" value={formatNumber(cost.estimatedCredits)} note="Estimated provider credits" />
        <StatCard
          icon={Target}
          label="Budget cap"
          value={money(cost.budgetCapCents)}
          note={cost.budgetStatus}
          tone={withinBudget ? "success" : "warning"}
        />
      </div>

      {hasSources ? (
        <div className="cost-bars">
          <span className="cost-bars-title">Cost by source</span>
          {cost.sourceEstimates.map((estimate) => (
            <div className="cost-bar-row" key={estimate.source}>
              <span className="cost-bar-name">{estimate.source}</span>
              <span className="cost-bar-track">
                <span
                  className="cost-bar-fill"
                  style={{
                    width: `${Math.max(5, (estimate.estimatedCostCents / maxCost) * 100)}%`,
                    background: SOURCE_COLORS[estimate.source] ?? "var(--ink-300)"
                  }}
                />
              </span>
              <span className="cost-bar-value">
                <strong>{money(estimate.estimatedCostCents)}</strong> · {formatNumber(estimate.estimatedRecords)} rec
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {!hasSources ? (
        <p className="surface-note">Select at least one source to preview cost and queue the run.</p>
      ) : withinBudget ? (
        <form action={createLeadJobAction} className="form-grid">
          <input type="hidden" name="searchProfileId" value={profile.id} />
          <input type="hidden" name="name" value={`${profile.name} Job`} />
          <input type="hidden" name="budgetCapDollars" value={budgetCapDollars} />
          <input type="hidden" name="requestedRecords" value={records || 0} />
          <input type="hidden" name="budgetConfirmed" value="on" />
          {chosenSources.map((source) => (
            <input type="hidden" name="sources" value={source} key={source} />
          ))}
          <div className="field integration-actions">
            <ToastButton toast="Run queued — extraction starts when source data arrives.">
              <Play size={17} aria-hidden="true" />
              Confirm &amp; queue run · {money(cost.estimatedCostCents)}
            </ToastButton>
          </div>
        </form>
      ) : (
        <div className="build-next">
          <span>
            Over budget. Raise the cap to at least <strong>{money(cost.estimatedCostCents)}</strong> to queue.
          </span>
          <button type="button" className="button secondary" onClick={() => setBudgetDollars(recommendedCapDollars)}>
            Use recommended · ${recommendedCapDollars}
          </button>
        </div>
      )}
    </div>
  );
}
