import {
  CheckCircle2,
  KeyRound,
  PlugZap,
  ShieldCheck,
  SlidersHorizontal,
  TestTube2,
  ToggleLeft,
  Zap
} from "lucide-react";
import {
  disableProviderConnectionAction,
  saveProviderConnectionAction,
  setProviderExecutionModeAction,
  testProviderConnectionAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import { providerConnectionViewsForWorkspace } from "@/lib/phase1/provider-connections";
import { getDeveloperWorkspaceContext } from "@/lib/phase1/store";
import type { ProviderConnectionSafeView } from "@/lib/phase1/provider-connections";
import { formatNumber } from "@/lib/utils";
import { StatCard } from "@/components/ui-metrics";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const { state, session, workspaceId } = await getDeveloperWorkspaceContext();
  const connections = providerConnectionViewsForWorkspace(state, workspaceId);
  const audits = state.providerCredentialAudits
    .filter((audit) => audit.workspaceId === workspaceId)
    .slice(0, 18);
  const active = connections.filter((connection) => connection.status === "Connected").length;
  const enabled = connections.filter((connection) => connection.enabled).length;
  const needsAttention = connections.filter((connection) => connection.status === "Needs attention").length;
  const configured = connections.filter((connection) => connection.hasSecret).length;
  const providerStateGuide = [
    {
      label: "Mock mode",
      tone: "info" as const,
      title: "No live calls",
      copy: "Every adapter stays local in this build. Tests, sends, and webhooks never touch a real provider."
    },
    {
      label: "Not configured",
      tone: "default" as const,
      title: "Idle lane",
      copy: "The provider exists in the selected stack, but no server-side credential has been stored yet."
    },
    {
      label: "Active",
      tone: "success" as const,
      title: "Mock-ready",
      copy: "Enabled, credentialed, and locally testable. This is the final state before a live adapter is introduced."
    },
    {
      label: "Needs attention",
      tone: "warning" as const,
      title: "Configuration gap",
      copy: "A lane is enabled but still missing a valid credential, compatible settings, or a passing local test."
    }
  ];
  const stats = [
    {
      label: "Providers",
      value: formatNumber(connections.length),
      note: "Selected provider strategy for production readiness.",
      icon: PlugZap,
      tone: "info" as const
    },
    {
      label: "Configured",
      value: formatNumber(configured),
      note: "Connections with a server-side secret reference.",
      icon: KeyRound,
      tone: configured ? "success" as const : "warning" as const
    },
    {
      label: "Enabled",
      value: formatNumber(enabled),
      note: "Providers allowed for future job execution.",
      icon: Zap,
      tone: enabled ? "success" as const : "info" as const
    },
    {
      label: "Needs attention",
      value: formatNumber(needsAttention),
      note: `${formatNumber(active)} mock-ready lanes passed a local test.`,
      icon: ShieldCheck,
      tone: needsAttention ? "warning" as const : "success" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Workspace settings"
        title="Integration Center"
        copy="Provider connection controls for lead sources, verification, enrichment, outreach, and transactional email. Configuration runs through server-only actions with redacted credential state."
      />

      <section className="stat-grid" aria-label="Integration metrics">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      <section className="state-guide-grid" aria-label="Provider state guide">
        {providerStateGuide.map((state) => (
          <article className="state-guide-card" key={state.label}>
            <span className="state-guide-label">
              <StatusPill label={state.label} tone={state.tone} />
            </span>
            <strong>{state.title}</strong>
            <p>{state.copy}</p>
          </article>
        ))}
      </section>

      <section className="grid two integrations-grid">
        {connections.map((connection) => (
          <ProviderConnectionCard key={connection.id} connection={connection} />
        ))}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Credential audit history</h2>
            <p className="section-subtitle">
              Redacted lifecycle events for provider credential changes, tests, and status updates.
            </p>
          </div>
          <StatusPill label={`${audits.length} recent events`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Provider</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Version</th>
                <th>Redacted metadata</th>
              </tr>
            </thead>
            <tbody>
              {audits.length ? (
                audits.map((audit) => (
                  <tr key={audit.id}>
                    <td>
                      {new Date(audit.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit"
                      })}
                    </td>
                    <td>
                      <div className="entity">
                        <strong>{providerName(connections, audit.providerId)}</strong>
                        <span>{audit.providerId}</span>
                      </div>
                    </td>
                    <td>
                      <StatusPill label={audit.action} tone="info" />
                    </td>
                    <td>{state.users.find((user) => user.id === audit.actorUserId)?.name ?? session.user.name}</td>
                    <td>v{audit.secretVersion}</td>
                    <td>
                      <div className="chip-row">
                        {Object.entries(audit.redactedMetadata).slice(0, 5).map(([key, value]) => (
                          <span className="pill" key={key}>
                            {key}: {Array.isArray(value) ? value.join(", ") : String(value)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <KeyRound size={24} aria-hidden="true" />
                      <span>No credential lifecycle events yet.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ProviderConnectionCard({ connection }: { connection: ProviderConnectionSafeView }) {
  const stateLabel = connection.status === "Connected" ? "Active" : connection.status;

  return (
    <article className="item-card integration-card">
      <div className="item-card-header">
        <div className="entity">
          <strong>{connection.displayName}</strong>
          <span>{connection.categories.map(labelize).join(" / ")}</span>
        </div>
        <div className="chip-row">
          <StatusPill label={stateLabel} tone={statusTone(stateLabel)} />
          <StatusPill label={connection.executionMode} tone="info" />
        </div>
      </div>

      <div className="chip-row">
        {connection.capabilities.map((capability) => (
          <span className="pill" key={capability}>
            {labelize(capability)}
          </span>
        ))}
      </div>

      <p className="surface-note">{providerStateSummary(connection)}</p>

      <form action={saveProviderConnectionAction} className="form-grid compact-form">
        <input name="providerId" type="hidden" value={connection.providerId} />
        <div className="field">
          <label htmlFor={`${connection.id}-label`}>Credential label</label>
          <input
            id={`${connection.id}-label`}
            name="credentialLabel"
            defaultValue={connection.credentialLabel ?? ""}
            placeholder={`${connection.displayName} production key`}
          />
        </div>
        <div className="field">
          <label htmlFor={`${connection.id}-secret`}>API key / token</label>
          <input
            id={`${connection.id}-secret`}
            name="secretValue"
            type="password"
            autoComplete="off"
            placeholder={connection.hasSecret ? `Stored ending ${connection.maskedSecretSuffix}` : "Paste credential for mock save"}
          />
          <span className="field-note">
            Stored server-side only. In this phase the adapter stays in {connection.executionMode} mode with no network access.
          </span>
        </div>
        <div className="field">
          <label htmlFor={`${connection.id}-scopes`}>Scopes</label>
          <input
            id={`${connection.id}-scopes`}
            name="scopes"
            defaultValue={connection.scopes.join(", ")}
            placeholder="read, verify, send"
          />
        </div>
        <div className="field">
          <label htmlFor={`${connection.id}-rate`}>Rate limit / min</label>
          <input
            id={`${connection.id}-rate`}
            name="rateLimitPerMinute"
            type="number"
            min="0"
            defaultValue={connection.rateLimitPerMinute ?? ""}
          />
        </div>
        <div className="field">
          <label htmlFor={`${connection.id}-budget`}>Daily budget cents</label>
          <input
            id={`${connection.id}-budget`}
            name="dailyBudgetCents"
            type="number"
            min="0"
            defaultValue={connection.dailyBudgetCents ?? ""}
          />
        </div>
        <div className="field">
          <label htmlFor={`${connection.id}-order`}>Waterfall order</label>
          <input
            id={`${connection.id}-order`}
            name="waterfallOrder"
            type="number"
            min="1"
            defaultValue={connection.waterfallOrder}
          />
        </div>
        <div className="field integration-options">
          <label>Allowed operations</label>
          <div className="chip-row">
            {connection.capabilities.map((capability) => (
              <label className="pill" key={capability}>
                <input
                  name="allowedOperations"
                  type="checkbox"
                  value={capability}
                  defaultChecked={connection.allowedOperations.includes(capability)}
                />
                {labelize(capability)}
              </label>
            ))}
          </div>
        </div>
        <div className="field integration-options">
          <label>Status controls</label>
          <label className="pill">
            <input name="enabled" type="checkbox" defaultChecked={connection.enabled} />
            Enabled for future jobs
          </label>
        </div>
        <div className="field integration-actions">
          <label aria-hidden="true">&nbsp;</label>
          <button className="button primary" type="submit">
            <SlidersHorizontal size={17} aria-hidden="true" />
            Save config
          </button>
        </div>
      </form>

      <div className="item-card-actions">
        <form action={testProviderConnectionAction}>
          <input name="providerId" type="hidden" value={connection.providerId} />
          <button className="button secondary" type="submit">
            <TestTube2 size={17} aria-hidden="true" />
            Test
          </button>
        </form>
        <form action={setProviderExecutionModeAction}>
          <input name="providerId" type="hidden" value={connection.providerId} />
          <input name="executionMode" type="hidden" value={connection.executionMode === "live" ? "mock" : "live"} />
          <button className="button subtle" type="submit">
            <Zap size={17} aria-hidden="true" />
            {connection.executionMode === "live" ? "Set to mock" : "Set live"}
          </button>
        </form>
        <form action={disableProviderConnectionAction}>
          <input name="providerId" type="hidden" value={connection.providerId} />
          <input name="reason" type="hidden" value="Disabled from Integration Center" />
          <button className="button subtle" type="submit">
            <ToggleLeft size={17} aria-hidden="true" />
            Disable
          </button>
        </form>
        <span className="pill">
          <CheckCircle2 size={14} aria-hidden="true" />
          Last test: {connection.lastTestStatus}
        </span>
      </div>
    </article>
  );
}


function labelize(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function providerName(connections: ProviderConnectionSafeView[], providerId: string) {
  return connections.find((connection) => connection.providerId === providerId)?.displayName ?? providerId;
}

function providerStateSummary(connection: ProviderConnectionSafeView) {
  if (connection.status === "Connected") {
    return "Active in mock mode. The lane is enabled, a credential is stored server-side, and local connection tests can pass without calling the provider.";
  }

  if (connection.status === "Needs attention") {
    return "Enabled, but still missing a passing mock test, a stored credential, or compatible operation settings.";
  }

  if (connection.status === "Disabled" && connection.hasSecret) {
    return "Credentialed but paused. The lane stays available for future activation while all execution remains blocked.";
  }

  return "Not configured yet. Store a server-side credential and enable the lane when you are ready to simulate the connection flow.";
}
