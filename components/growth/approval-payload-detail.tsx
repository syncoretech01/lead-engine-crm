import type { ApprovalPayload } from "@syncore/contracts";

/**
 * Renders one approval's type-specific detail.
 *
 * 🔴 EXHAUSTIVE BY CONSTRUCTION. The switch below covers all 11 members of the
 * contracts `ApprovalPayload` union, and the `default` branch assigns to
 * `never`. When contracts adds a twelfth gate, this file stops compiling — which
 * is the point. The alternative is a gate that renders as a blank panel and an
 * operator approving spend they cannot see.
 *
 * Contracts chose a discriminated union over a `payload: unknown` bag for
 * exactly this reason (see approval-payload.ts).
 */

const cents = (value: number) => `$${(value / 100).toFixed(2)}`;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-[--ui-fg-muted]">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function ApprovalPayloadDetail({ payload }: { payload: ApprovalPayload }) {
  switch (payload.type) {
    case "NICHE_TEST":
      return (
        <div data-testid="approval-detail-NICHE_TEST">
          <Row label="Niche" value={payload.brief.niche} />
          <Row label="Geography" value={payload.brief.geography} />
          <Row label="Buyer role" value={payload.brief.buyerRole} />
          <Row label="Priority score" value={`${payload.brief.priorityScore}/100`} />
          <Row label="Decision" value={payload.brief.decision} />
          <Row label="Recommended test size" value={payload.brief.recommendedTestSize} />
        </div>
      );

    case "PROVIDER_RUN":
    case "ENRICHMENT_RUN":
      return (
        <div data-testid={`approval-detail-${payload.type}`}>
          {payload.proposals.map((proposal) => (
            <div key={proposal.proposalId} className="border-t py-2 first:border-t-0">
              <Row label="Provider" value={proposal.provider} />
              <Row label="Purpose" value={proposal.purpose} />
              <Row label="Estimated records" value={proposal.estimatedRecords} />
              <Row label="Estimated cost" value={cents(proposal.estimatedCostCents)} />
              {/* The Hub pre-check is what makes these real numbers rather than
                  a guess (v9.1 §10, §26.14). Shown because they are the whole
                  basis for the decision. */}
              <Row
                label="Already in Hub"
                value={`${Math.round(proposal.hubOverlapEstimate * 100)}%`}
              />
              <Row label="Expected unique yield" value={proposal.expectedUniqueYield} />
              <Row label="Cost per unique" value={cents(proposal.costPerUniqueCents)} />
            </div>
          ))}
          {payload.remainingCeilingCents !== undefined && (
            <Row label="Remaining ceiling" value={cents(payload.remainingCeilingCents)} />
          )}
        </div>
      );

    case "PAID_VERIFICATION":
      return (
        <div data-testid="approval-detail-PAID_VERIFICATION">
          {/* MV runs on `unknown` only — the Hub executes, the CRM pays (§5.13). */}
          <Row label="Unresolved addresses" value={payload.unresolvedCount} />
          <Row label="Estimated cost" value={cents(payload.estimatedCostCents)} />
        </div>
      );

    case "PERSONALIZATION_SAMPLES":
      return (
        <div data-testid="approval-detail-PERSONALIZATION_SAMPLES">
          {/* You approve the pattern, not 300 emails (v9.1 §13). */}
          <Row label="Samples" value={payload.sampleCount} />
          <Row label="Sample set" value={payload.sampleSetId} />
          {payload.messageTemplateVersionId && (
            <Row label="Template version" value={payload.messageTemplateVersionId} />
          )}
        </div>
      );

    case "CAMPAIGN_LAUNCH":
      return (
        <div data-testid="approval-detail-CAMPAIGN_LAUNCH">
          <ul className="space-y-1 text-sm">
            {payload.checklist.map((entry) => (
              <li key={entry.item} className="flex items-center gap-2">
                <span aria-hidden>{entry.passed ? "✓" : "✗"}</span>
                <span className={entry.passed ? "" : "font-semibold"}>{entry.item}</span>
                <span className="sr-only">{entry.passed ? "passed" : "failed"}</span>
              </li>
            ))}
          </ul>
          {payload.approvedCopyHash && (
            <Row label="Approved copy hash" value={payload.approvedCopyHash.slice(0, 16)} />
          )}
        </div>
      );

    case "SPEND_EXCEPTION":
      return (
        <div data-testid="approval-detail-SPEND_EXCEPTION">
          {/* Actual exceeded approved beyond tolerance; the stage auto-parked (§11). */}
          <Row label="Approved" value={cents(payload.approvedCostCents)} />
          <Row label="Actual" value={cents(payload.actualCostCents)} />
          <Row
            label="Overrun"
            value={cents(Math.max(0, payload.actualCostCents - payload.approvedCostCents))}
          />
        </div>
      );

    case "SCALE":
      return (
        <div data-testid="approval-detail-SCALE">
          <Row label="Proposed test size" value={payload.proposedTestSize} />
          <Row label="Proposed budget cap" value={cents(payload.proposedBudgetCapCents)} />
        </div>
      );

    case "REPLY_EXCEPTION":
      return (
        <div data-testid="approval-detail-REPLY_EXCEPTION">
          <Row label="Classification" value={payload.replyClassification} />
          {payload.contactId && <Row label="Contact" value={payload.contactId} />}
        </div>
      );

    case "SUPPRESS_BULK":
      return (
        <div data-testid="approval-detail-SUPPRESS_BULK">
          <Row label="Records" value={payload.recordCount} />
          <Row label="Reason" value={payload.reason} />
        </div>
      );

    case "RESUME_AFTER_BREAKER":
      return (
        <div data-testid="approval-detail-RESUME_AFTER_BREAKER">
          <Row label="Breaker rule" value={payload.breakerRule} />
          {payload.observedRatePct !== undefined && (
            <Row label="Observed rate" value={`${payload.observedRatePct}%`} />
          )}
        </div>
      );

    default: {
      // If this line stops compiling, contracts added a gate and this file has
      // to handle it. Do not widen the type to make it build.
      const unhandled: never = payload;
      return <pre className="text-xs">{JSON.stringify(unhandled)}</pre>;
    }
  }
}
