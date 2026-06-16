# Provider Waterfall

Updated: 2026-06-16

This waterfall describes production routing intent. The current codebase only includes typed interfaces and no-op adapters.

## B2B Contact Waterfall

1. Apollo for company and contact discovery.
2. Hunter for missing or uncertain email addresses.
3. People Data Labs for person/company enrichment gaps.
4. Lusha for fallback phone or email data when the prior sources are incomplete.
5. ZeroBounce for final email verification before export or outreach.
6. Twilio Lookup for phone validation before phone-ready exports, SMS, or calls.
7. RingCentral for SMS/call execution only after suppression and validation gates pass.

## Local Business Waterfall

1. Google Places for local business discovery.
2. Company website/domain normalization from discovered URLs.
3. Apollo or People Data Labs for owner/manager/contact enrichment when available.
4. Hunter for email discovery.
5. ZeroBounce for email verification.
6. Twilio Lookup for phone validation.
7. Lusha fallback for missing phone/contact details.
8. RingCentral for SMS/call execution only after compliance gates pass.

## Niche And Apify Waterfall

1. Confirm sanctioned source, scope, robots/legal constraints, and extraction reason.
2. Apify controlled extraction with strict rate, page, and field limits.
3. Normalize extracted company/contact records into the canonical staging schema.
4. Deduplicate against existing company/contact records.
5. Hunter or Apollo for missing emails.
6. ZeroBounce for email verification.
7. People Data Labs or Lusha for enrichment gaps.

## Email Verification Waterfall

1. Check suppression list, existing customer list, and recent verification cache.
2. ZeroBounce for primary verification.
3. Hunter verifier as secondary confirmation or fallback.
4. Apply Syncore grade rules: valid direct emails can become A/B, risky/catch-all becomes C, invalid/missing becomes D, suppressed becomes S.
5. Store provider, raw response reference, timestamp, TTL, grade, and reason codes.

## Phone Validation Waterfall

1. Normalize phone number locally.
2. Check DNC/SMS opt-out suppression.
3. Twilio Lookup for validity, line type, and carrier where permitted.
4. Lusha fallback if no phone exists and the record is high value.
5. Mark RingCentral readiness only after the number is validated and not suppressed.
6. Store provider, normalized number, validation status, line type, timestamp, TTL, and compliance flags.

## Enrichment Waterfall

1. Reuse fresh local fields and provider cache.
2. Apollo for core B2B company/contact fields.
3. People Data Labs for company/person enrichment gaps.
4. Google Places for local business attributes.
5. Lusha for missing high-value phone/email fields.
6. Stop when required field coverage is met or budget/attempt limits are reached.
7. Store field-level provenance and confidence.

## Sending And Outreach Sync Waterfall

1. Export or sync only records that pass suppression, consent/lawful basis, verification, and segment gates.
2. Smartlead handles cold outbound campaign sending and reply/bounce/unsubscribe sync.
3. RingCentral handles SMS, voice, call recording metadata, delivery/reply/failure, and STOP webhooks.
4. Amazon SES handles transactional product email only.
5. Provider webhook events enter Syncore through signed routes.
6. Events update outreach history, suppression records, campaign metrics, SDR activity, and audit logs.
7. Positive replies can be classified before opportunity creation once automation guardrails are in place.
