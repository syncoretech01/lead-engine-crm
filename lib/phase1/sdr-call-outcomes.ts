/**
 * The call wrap-up outcomes an SDR can actually record.
 *
 * One list, because there were several. The Focus dock defines the buttons, the
 * wrap-up action accepted a bare unvalidated string, and
 * applyWrapupOutcomeToTrackedCall branched on string literals — so an outcome
 * could be added to the UI and silently fall through the mapper into whatever
 * its final `else` happened to do. It did exactly that: four of these eleven
 * reached a branch that minted a "Interested" disposition nobody recorded.
 *
 * The dock's buttons are asserted equal to this list in
 * tests/unit/sdr-call-outcomes.test.ts, so adding a button without deciding what
 * it means for the call record fails CI rather than defaulting to something
 * flattering.
 */
export const SDR_CALL_OUTCOMES = [
  "Connected",
  "No answer",
  "Voicemail",
  "Busy",
  "Hang Up",
  "Wrong number",
  "Not interested",
  "Follow-up required",
  "Qualified",
  "Meeting booked",
  "Do not contact"
] as const;

export type SdrCallOutcome = (typeof SDR_CALL_OUTCOMES)[number];

export function isSdrCallOutcome(value: string): value is SdrCallOutcome {
  return (SDR_CALL_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Throws on anything the wrap-up mapper cannot classify.
 *
 * Deliberately a throw rather than a coercion to a default: every value here
 * comes from our own dock, so an unrecognised one is a bug or a tampered
 * request, and silently substituting a disposition is precisely the failure this
 * module exists to stop.
 */
export function assertSdrCallOutcome(value: string): SdrCallOutcome {
  if (!isSdrCallOutcome(value)) {
    throw new Error(
      `Unknown call outcome "${value}". Add it to SDR_CALL_OUTCOMES and give it a branch in ` +
        "applyWrapupOutcomeToTrackedCall before the UI can send it."
    );
  }
  return value;
}
