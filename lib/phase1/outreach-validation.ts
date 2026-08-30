/**
 * Launch-blocking validators for automated cold email — golden rules 8 and 13.
 *
 * Rule 13: never cold-send from syncoretech.com. The primary domain carries the
 * transactional/warm/system mail; burning its reputation with cold volume is
 * unrecoverable. Cold sends go out from lookalike domains only, which means the
 * operator must have set SYNCORE_OUTREACH_FROM deliberately — an unset env var
 * must fail the send, not fall back to the founder's primary-domain mailbox.
 *
 * Rule 8: no link in automated cold touch 1. Links are the strongest spam-filter
 * signal a cold first touch can carry. The legally required unsubscribe URL is
 * appended by the renderer and is exempt — this validates the TEMPLATE the
 * operator wrote, with the {{unsubscribe_url}} token stripped first.
 *
 * Shared here (not inline in the send path) so the CRM-6 Growth campaign launch
 * gate enforces the same rules from the same code.
 */

const PROTECTED_COLD_SEND_DOMAIN = "syncoretech.com";

function mailboxDomain(value: string): string {
  const email = (value.match(/<([^<>]+)>/)?.[1] ?? value).trim();
  return email.split("@")[1]?.trim().toLowerCase() ?? "";
}

/**
 * Why this From/Reply-To pair is barred from a LIVE cold send, or null.
 *
 * Split out from the campaign check below because there are TWO live cold-send
 * paths and only one of them reads SYNCORE_OUTREACH_FROM. The SDR bulk sender
 * builds its From from the rep's own identity, so it needs the domain half of
 * rule 13 without the env-var half — and shipping the env check alone left that
 * path sending cold mail from the primary domain with the rule believed enforced.
 */
export function coldSendDomainBlockReason(input: { from: string; replyTo: string }): string | null {
  for (const [label, mailbox] of [["From", input.from], ["Reply-To", input.replyTo]] as const) {
    const domain = mailboxDomain(mailbox);
    if (domain === PROTECTED_COLD_SEND_DOMAIN || domain.endsWith(`.${PROTECTED_COLD_SEND_DOMAIN}`)) {
      return (
        `${label} "${mailbox}" is on ${PROTECTED_COLD_SEND_DOMAIN}. Cold email never goes out ` +
        "from the primary domain (golden rule 13) — use a lookalike domain."
      );
    }
  }
  return null;
}

/** Why this From/Reply-To pair may not be used for a LIVE cold send, or null. */
export function coldSendMailboxBlockReason(input: {
  fromEnv: string | undefined;
  from: string;
  replyTo: string;
}): string | null {
  if (!input.fromEnv?.trim()) {
    return (
      "SYNCORE_OUTREACH_FROM is not set. Live cold email must be sent from a deliberately " +
      "configured lookalike-domain mailbox — never the built-in default."
    );
  }
  return coldSendDomainBlockReason(input);
}

// http(s) URLs and www. forms. Deliberately NOT matching protocol-relative or
// naked domains ("syncore.com") — too false-positive-prone against ordinary
// prose, and spam filters key on resolvable anchors/URLs, which these catch.
const LINK_PATTERN = /(https?:\/\/[^\s<>")]+|\bwww\.[a-z0-9-]+\.[a-z]{2,}[^\s<>")]*)/gi;

/** Links found in a cold touch-1 template, with the unsubscribe token exempt. */
export function findColdTouchLinks(template: string): string[] {
  const withoutComplianceTokens = template
    .replaceAll("{{unsubscribe_url}}", " ")
    .replaceAll("{{physical_address}}", " ");
  return [...new Set(withoutComplianceTokens.match(LINK_PATTERN) ?? [])];
}

/** Throws when a cold touch-1 subject/body template carries a link (rule 8). */
export function assertNoLinksInColdTouchOne(subjectTemplate: string, bodyTemplate: string) {
  const links = [...findColdTouchLinks(subjectTemplate), ...findColdTouchLinks(bodyTemplate)];
  if (links.length > 0) {
    throw new Error(
      `Cold touch 1 must not contain links (golden rule 8) — remove: ${links.join(", ")}. ` +
        "The unsubscribe link is added automatically and does not count."
    );
  }
}
