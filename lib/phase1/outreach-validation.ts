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

// http(s) URLs, protocol-relative URLs, and www. forms. Naked domains
// ("syncore.com") are deliberately NOT matched — too false-positive-prone
// against ordinary prose. Protocol-relative IS matched: "//book.acme.test/demo"
// renders as a live anchor in every mail client, so excluding it left a link
// shape that passes the rule while behaving exactly like the links it forbids.
const LINK_PATTERN = /(https?:\/\/[^\s<>")]+|(?<![:\w])\/\/[a-z0-9-]+\.[a-z]{2,}[^\s<>")]*|\bwww\.[a-z0-9-]+\.[a-z]{2,}[^\s<>")]*)/gi;

/**
 * Sentence punctuation that a writer puts AFTER a URL, not inside it.
 *
 * LINK_PATTERN's negated class excludes `)`, `>`, `"` and whitespace but not
 * these, so "visit {{unsubscribe_url}}." matched the URL WITH the full stop —
 * which then did not equal the exempt string, and blocked an entirely
 * legitimate cold touch while telling the operator to remove the unsubscribe
 * link the same message said did not count. Trimmed before the comparison, so
 * the exemption survives ordinary prose. This cannot re-open the userinfo
 * bypass: that one ends in a path segment, not punctuation.
 */
const TRAILING_SENTENCE_PUNCTUATION = /[.,;:!?'*\]]+$/;

/**
 * Links found in a cold touch 1, with the compliance links exempt.
 *
 * @param exemptUrls literal URLs to ignore — pass the RENDERED unsubscribe links
 *   when scanning rendered output, since by then the {{unsubscribe_url}} token
 *   has already been substituted and the token strip below cannot see it.
 */
export function findColdTouchLinks(template: string, exemptUrls: string[] = []): string[] {
  const scanned = template.replaceAll("{{unsubscribe_url}}", " ").replaceAll("{{physical_address}}", " ");
  const exempt = new Set(exemptUrls.filter(Boolean));
  // Exempt by WHOLE-LINK equality, never by stripping the URL out of the text.
  // The exempt URL is itself a valid URL prefix, so a substring strip let a
  // template append to it: "{{unsubscribe_url}}@evil.test/pwn" renders one link
  // whose authority is evil.test (everything before the "@" is userinfo), and
  // removing the exempt prefix left "@evil.test/pwn", which matches nothing.
  // Matching first and comparing whole links means an appended-to unsubscribe
  // URL is a different link, and gets reported.
  return [
    ...new Set(
      (scanned.match(LINK_PATTERN) ?? [])
        .map((link) => link.replace(TRAILING_SENTENCE_PUNCTUATION, ""))
        .filter((link) => link && !exempt.has(link))
    )
  ];
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
