export function outreachMailingAddress(env = process.env): string {
  return env.SYNCORE_MAILING_ADDRESS?.trim() || "Syncore Tech, 1500 N Grant St, Denver, CO 80203, USA";
}

export function outreachFrom(env = process.env): string {
  return env.SYNCORE_OUTREACH_FROM?.trim() || "Bobby Jones <bobby@syncoretech.com>";
}

export function outreachReplyTo(env = process.env): string {
  return env.SYNCORE_OUTREACH_REPLY_TO?.trim() || "replies@syncoretech.com";
}

export function outreachBatchSize(env = process.env): number {
  const n = Number(env.SYNCORE_OUTREACH_BATCH_SIZE);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50;
}
