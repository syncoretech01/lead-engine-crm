"use client";

import { useMemo, useState } from "react";
import { Filter, SlidersHorizontal, UserPlus } from "lucide-react";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import { isMeaningfulCompanyName, isMeaningfulPersonName } from "@/lib/phase1/lead-data-quality";
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
  reviewReason: string;
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
const reasonFilters = [
  "All",
  "Ready",
  "Needs enrichment",
  "Personal email domain",
  "Missing company",
  "Missing contact name",
  "Missing phone",
  "Invalid email",
  "Suppressed"
] as const;
const PAGE_SIZE = 25;

export function StagingWorkbench({ leads }: StagingWorkbenchProps) {
  const [grade, setGrade] = useState<(typeof gradeFilters)[number]>("All");
  const [status, setStatus] = useState<(typeof statusFilters)[number]>("All");
  const [reason, setReason] = useState<(typeof reasonFilters)[number]>("All");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const matchesGrade = grade === "All" || lead.emailGrade === grade;
      const matchesStatus = status === "All" || lead.status === status;
      const matchesReason = reason === "All" || lead.reviewReason === reason;
      const haystack = `${lead.contactName} ${lead.company} ${lead.domain} ${lead.email} ${lead.phone} ${lead.segment}`.toLowerCase();
      const matchesQuery = haystack.includes(query.toLowerCase());
      return matchesGrade && matchesStatus && matchesReason && matchesQuery;
    });
  }, [grade, leads, query, reason, status]);
  const pageCount = Math.max(1, Math.ceil(filteredLeads.length / PAGE_SIZE));
  const activePage = Math.min(page, pageCount);
  const pagedLeads = filteredLeads.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE);

  function resetPage() {
    setPage(1);
  }

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
            Open exports
          </a>
        </div>
      </div>
      <div className="panel-body">
        <div className="toolbar">
          <label className="search-box">
            <Filter size={17} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                resetPage();
              }}
              placeholder="Filter staged leads"
            />
          </label>
          <div className="segmented" aria-label="Email grade filter">
            {gradeFilters.map((option) => (
              <button
                key={option}
                className={`segment-button ${grade === option ? "active" : ""}`}
                onClick={() => {
                  setGrade(option);
                  resetPage();
                }}
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
                onClick={() => {
                  setStatus(option);
                  resetPage();
                }}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
          <div className="segmented" aria-label="Review reason filter">
            {reasonFilters.map((option) => (
              <button
                key={option}
                className={`segment-button ${reason === option ? "active" : ""}`}
                onClick={() => {
                  setReason(option);
                  resetPage();
                }}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="table-wrap">
          <table className="compact-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Account</th>
                <th>Grade</th>
                <th>Score</th>
                <th>Status</th>
                <th>Segment</th>
                <th>Owner</th>
                <th>Reason</th>
                <th>Verification</th>
              </tr>
            </thead>
            <tbody>
              {pagedLeads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <div className="entity">
                      <strong>{displayLeadName(lead)}</strong>
                      <span>{lead.title}</span>
                      <span>{lead.email}</span>
                    </div>
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{displayAccountName(lead)}</strong>
                      <span>{displayAccountLocation(lead)}</span>
                      <span>{lead.domain}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`grade ${lead.emailGrade.toLowerCase()}`}>{lead.emailGrade}</span>
                  </td>
                  <td>
                    <div className="table-score-cell">
                      <strong>{lead.score}</strong>
                      <ProgressBar value={lead.score} />
                    </div>
                  </td>
                  <td>
                    <StatusPill label={lead.status} tone={statusTone(lead.status)} />
                  </td>
                  <td>{lead.segment}</td>
                  <td>{lead.owner}</td>
                  <td>
                    <StatusPill label={lead.reviewReason} tone={lead.reviewReason === "Ready" ? "success" : "warning"} />
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{lead.verification}</strong>
                      <span>{lead.source}</span>
                    </div>
                  </td>
                </tr>
              ))}
              {pagedLeads.length === 0 ? (
                <tr>
                  <td colSpan={9}>No staged records match the current filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="table-pagination">
          <span>
            Showing {pagedLeads.length ? (activePage - 1) * PAGE_SIZE + 1 : 0}-
            {Math.min(activePage * PAGE_SIZE, filteredLeads.length)} of {filteredLeads.length}
          </span>
          <div className="item-card-actions">
            <button className="button secondary" type="button" disabled={activePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              Previous
            </button>
            <button className="button secondary" type="button" disabled={activePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
              Next
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function displayLeadName(lead: StagedLeadRow) {
  if (isMeaningfulPersonName(lead.contactName)) {
    return lead.contactName;
  }

  if (lead.email) {
    return lead.email;
  }

  return isMeaningfulCompanyName(lead.company) ? lead.company : "Unknown lead";
}

function displayAccountLocation(lead: StagedLeadRow) {
  const location = [lead.city, lead.state].filter(Boolean).join(", ");
  return location || "No location";
}

function displayAccountName(lead: StagedLeadRow) {
  return isMeaningfulCompanyName(lead.company) ? lead.company : "No company";
}
