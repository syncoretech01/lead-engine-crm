"use client";

import { useMemo, useState } from "react";
import { Filter, SlidersHorizontal, UserPlus } from "lucide-react";
import { StatusPill, statusTone } from "@/components/status-pill";
import type { LeadGrade, LeadStatus } from "@/lib/phase1/types";

type StagedLeadRow = {
  id: string;
  contactName: string;
  title: string;
  company: string;
  domain: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  source: string;
  emailGrade: LeadGrade;
  score: number;
  priority: string;
  status: LeadStatus;
  segment: string;
  owner: string;
  verification: string;
  lastSeen: string;
};

type StagingWorkbenchProps = {
  leads: StagedLeadRow[];
};

const gradeFilters: Array<"All" | LeadGrade> = ["All", "A", "B", "C", "D", "S"];
const statusFilters: Array<"All" | LeadStatus> = [
  "All",
  "Ready for SDR",
  "Needs enrichment",
  "In review",
  "Exported",
  "Suppressed"
];

export function StagingWorkbench({ leads }: StagingWorkbenchProps) {
  const [grade, setGrade] = useState<(typeof gradeFilters)[number]>("All");
  const [status, setStatus] = useState<(typeof statusFilters)[number]>("All");
  const [query, setQuery] = useState("");

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const matchesGrade = grade === "All" || lead.emailGrade === grade;
      const matchesStatus = status === "All" || lead.status === status;
      const haystack = `${lead.contactName} ${lead.company} ${lead.domain} ${lead.segment}`.toLowerCase();
      const matchesQuery = haystack.includes(query.toLowerCase());
      return matchesGrade && matchesStatus && matchesQuery;
    });
  }, [grade, leads, query, status]);

  return (
    <section className="panel">
      <div className="panel-header">
        <div className="panel-title-wrap">
          <h2 className="section-title">Staged records</h2>
          <p className="section-subtitle">Filter by verification grade, processing state, or account/contact text.</p>
        </div>
        <div className="page-actions">
          <a className="button secondary" href="#import-csv">
            <SlidersHorizontal size={17} aria-hidden="true" />
            Map fields
          </a>
          <a className="button primary" href="/exports">
            <UserPlus size={17} aria-hidden="true" />
            Export ready leads
          </a>
        </div>
      </div>
      <div className="panel-body">
        <div className="toolbar">
          <label className="search-box">
            <Filter size={17} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter staged leads"
            />
          </label>
          <div className="segmented" aria-label="Email grade filter">
            {gradeFilters.map((option) => (
              <button
                key={option}
                className={`segment-button ${grade === option ? "active" : ""}`}
                onClick={() => setGrade(option)}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
          <div className="segmented" aria-label="Status filter">
            {statusFilters.map((option) => (
              <button
                key={option}
                className={`segment-button ${status === option ? "active" : ""}`}
                onClick={() => setStatus(option)}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Account</th>
                <th>Grade</th>
                <th>Score</th>
                <th>Status</th>
                <th>Segment</th>
                <th>Owner</th>
                <th>Verification</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <div className="entity">
                      <strong>{lead.contactName}</strong>
                      <span>{lead.title}</span>
                      <span>{lead.email}</span>
                    </div>
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{lead.company}</strong>
                      <span>{lead.domain}</span>
                      <span>
                        {lead.city}, {lead.state}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`grade ${lead.emailGrade.toLowerCase()}`}>{lead.emailGrade}</span>
                  </td>
                  <td>
                    <div className="score-ring">{lead.score}</div>
                  </td>
                  <td>
                    <StatusPill label={lead.status} tone={statusTone(lead.status)} />
                  </td>
                  <td>{lead.segment}</td>
                  <td>{lead.owner}</td>
                  <td>
                    <div className="entity">
                      <strong>{lead.verification}</strong>
                      <span>{lead.source}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
