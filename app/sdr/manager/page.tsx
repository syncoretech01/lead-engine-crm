import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Clock,
  GitBranch,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Users
} from "lucide-react";
import {
  applyReassignmentRulesAction,
  createReassignmentRuleAction,
  deleteReassignmentRuleAction,
  reassignSdrAssignmentAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import {
  assignmentMethods,
  managerDashboardSnapshot,
  reassignmentTriggers,
  sdrUsers
} from "@/lib/phase1/sdr";
import { getWorkspaceContext } from "@/lib/phase1/store";
import type { AppState } from "@/lib/phase1/types";
import { formatNumber, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SdrManagerPage() {
  const { state, workspaceId } = await getWorkspaceContext("manage_sdr");
  const snapshot = managerDashboardSnapshot(state, workspaceId);
  const users = sdrUsers(state, workspaceId);
  const teams = state.sdrTeams.filter((team) => team.workspaceId === workspaceId);

  return (
    <>
      <PageHeader
        kicker="Phase 5"
        title="SDR manager dashboard"
        copy="Monitor workload, SLA adherence, untouched P1 leads, follow-up risk, and reassignment recommendations."
        actions={
          <>
            <form action={applyReassignmentRulesAction}>
              <button className="button secondary" type="submit">
                <RefreshCw size={17} aria-hidden="true" />
                Apply recommendations
              </button>
            </form>
            <Link href="/sdr/queue" className="button primary">
              <ListChecks size={17} aria-hidden="true" />
              SDR queue
            </Link>
          </>
        }
      />

      <section className="grid metrics">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Active assigned</span>
            <Users size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.metrics.activeAssigned)}</div>
          <span className="metric-note">Open SDR assignments.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">SLA adherence</span>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatPercent(snapshot.metrics.slaAdherence)}</div>
          <span className="metric-note">{formatPercent(snapshot.metrics.contactedRate)} touched rate.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Untouched P1</span>
            <AlertTriangle size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.metrics.untouchedP1)}</div>
          <span className="metric-note">Highest priority leads without touch.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Overdue</span>
            <Clock size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.metrics.overdue)}</div>
          <span className="metric-note">Assignments past active SLA.</span>
        </article>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">SDR workload</h2>
              <p className="section-subtitle">Active load, P1 pressure, meetings, and SLA adherence by rep.</p>
            </div>
            <BarChart3 size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SDR</th>
                  <th>Active</th>
                  <th>P1</th>
                  <th>Overdue</th>
                  <th>Touched</th>
                  <th>Meetings</th>
                  <th>SLA</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.workloads.map((workload) => (
                  <tr key={workload.userId}>
                    <td>
                      <div className="entity">
                        <strong>{workload.name}</strong>
                        <span>{teamForUser(teams, workload.userId)?.name ?? "No team"}</span>
                      </div>
                    </td>
                    <td>{workload.active}</td>
                    <td>{workload.p1}</td>
                    <td>
                      <StatusPill label={`${workload.overdue}`} tone={workload.overdue ? "danger" : "success"} />
                    </td>
                    <td>{workload.touched}</td>
                    <td>{workload.meetings}</td>
                    <td>{formatPercent(workload.slaAdherence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Teams and routing coverage</h2>
              <p className="section-subtitle">Territory and industry coverage used by the assignment engine.</p>
            </div>
            <GitBranch size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            {teams.map((team) => (
              <div className="list-row" key={team.id}>
                <div className="row-meta">
                  <strong>{team.name}</strong>
                  <StatusPill label={team.active ? "Active" : "Paused"} tone={team.active ? "success" : "warning"} />
                </div>
                <div className="chip-row">
                  {team.memberUserIds.map((userId) => (
                    <span className="pill" key={userId}>
                      {state.users.find((user) => user.id === userId)?.name ?? userId}
                    </span>
                  ))}
                </div>
                <p className="section-subtitle">
                  Territories: {team.territories.join(", ")}. Industries: {team.industries.join(", ")}.
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Reassignment recommendations</h2>
            <p className="section-subtitle">Overdue SLA and P1 load-balance recommendations generated from current assignments.</p>
          </div>
          <StatusPill label={`${snapshot.recommendations.length} recommended`} tone={snapshot.recommendations.length ? "warning" : "success"} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Current</th>
                <th>Recommended</th>
                <th>Reason</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.recommendations.map((recommendation) => (
                <tr key={recommendation.assignmentId}>
                  <td>
                    <div className="entity">
                      <strong>{recommendation.contactName}</strong>
                      <span>{recommendation.companyName}</span>
                    </div>
                  </td>
                  <td>{recommendation.currentOwner}</td>
                  <td>{recommendation.recommendedOwner}</td>
                  <td>
                    <div className="entity">
                      <strong>{recommendation.reason}</strong>
                      <span>{recommendation.method} - {recommendation.slaStatus}</span>
                    </div>
                  </td>
                  <td>
                    <form action={reassignSdrAssignmentAction} className="item-card-actions">
                      <input name="assignmentId" type="hidden" value={recommendation.assignmentId} />
                      <input name="nextSdrId" type="hidden" value={recommendation.recommendedSdrId} />
                      <input name="assignmentMethod" type="hidden" value={recommendation.method} />
                      <input name="reason" type="hidden" value={recommendation.reason} />
                      <button className="button primary" type="submit">
                        Reassign
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {snapshot.recommendations.length === 0 ? (
                <tr>
                  <td colSpan={5}>No reassignment recommendations right now.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Manual reassignment</h2>
              <p className="section-subtitle">Move any active assignment to another SDR with a manager reason.</p>
            </div>
            <Users size={20} aria-hidden="true" />
          </div>
          <form action={reassignSdrAssignmentAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="assignmentId">Assignment</label>
              <select id="assignmentId" name="assignmentId" required>
                {snapshot.assignments.map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignment.contactName} - {assignment.ownerName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="nextSdrId">New SDR</label>
              <select id="nextSdrId" name="nextSdrId" required>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="assignmentMethod">Method</label>
              <select id="assignmentMethod" name="assignmentMethod" defaultValue="Capacity-based">
                {assignmentMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="reason">Reason</label>
              <input id="reason" name="reason" placeholder="Capacity rebalance" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Reassign lead
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Reassignment rules</h2>
              <p className="section-subtitle">Rules define when manager recommendations should move work.</p>
            </div>
            <StatusPill label={`${snapshot.rules.length} rules`} tone="info" />
          </div>
          <form action={createReassignmentRuleAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="name">Rule name</label>
              <input id="name" name="name" placeholder="Overdue rescue" />
            </div>
            <div className="field">
              <label htmlFor="trigger">Trigger</label>
              <select id="trigger" name="trigger" defaultValue="SLA overdue">
                {reassignmentTriggers.map((trigger) => (
                  <option key={trigger} value={trigger}>
                    {trigger}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rule-method">Method</label>
              <select id="rule-method" name="assignmentMethod" defaultValue="Capacity-based">
                {assignmentMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="thresholdHours">Threshold hours</label>
              <input id="thresholdHours" name="thresholdHours" type="number" min="1" defaultValue="4" />
            </div>
            <div className="field">
              <label htmlFor="targetTeamId">Target team</label>
              <select id="targetTeamId" name="targetTeamId" defaultValue="">
                <option value="">Any available team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Create rule
              </button>
            </div>
          </form>
          <div className="panel-body stage-list">
            {snapshot.rules.map((rule) => (
              <div className="list-row" key={rule.id}>
                <div className="row-meta">
                  <strong>{rule.name}</strong>
                  <StatusPill label={rule.trigger} tone={statusTone(rule.trigger)} />
                </div>
                <p className="section-subtitle">
                  {rule.assignmentMethod}, threshold {rule.thresholdHours}h
                </p>
                <form action={deleteReassignmentRuleAction}>
                  <input name="id" type="hidden" value={rule.id} />
                  <button className="button danger" type="submit">
                    Delete
                  </button>
                </form>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function teamForUser(teams: AppState["sdrTeams"], userId: string) {
  return teams.find((team) => team.memberUserIds.includes(userId));
}
