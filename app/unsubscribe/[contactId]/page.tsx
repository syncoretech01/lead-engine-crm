import Image from "next/image";
import { syncoreBrand } from "@/lib/brand";
import { verifyShortUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/phase1/unsubscribe-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UnsubscribePageProps = {
  params: Promise<{ contactId: string }>;
  searchParams?: Promise<{ t?: string; s?: string; done?: string }>;
};

export default async function UnsubscribePage({ params, searchParams }: UnsubscribePageProps) {
  const { contactId } = await params;
  const query = await searchParams;
  const legacyToken = query?.t ?? "";
  const shortToken = query?.s ?? "";
  const legacy = legacyToken ? verifyUnsubscribeToken(legacyToken) : { ok: false as const };
  const valid = legacy.ok
    ? legacy.contactId === contactId
    : verifyShortUnsubscribeToken(contactId, shortToken);
  const done = query?.done === "1";
  const action = legacy.ok
    ? `/api/unsubscribe?t=${encodeURIComponent(legacyToken)}`
    : `/api/unsubscribe?c=${encodeURIComponent(contactId)}&s=${encodeURIComponent(shortToken)}`;
  const title = done ? "You're unsubscribed" : valid ? "Confirm unsubscribe" : "Invalid unsubscribe link";
  const description = done
    ? "You will no longer receive outreach emails from Syncore at this contact address."
    : valid
      ? "Confirm that you no longer want to receive outreach emails from Syncore. This will suppress this contact from future sends."
      : "This link is expired, incomplete, or no longer valid.";

  return (
    <main className="unsubscribe-page">
      <section className="unsubscribe-card" aria-labelledby="unsubscribe-title">
        <div className="unsubscribe-brand">
          <Image src={syncoreBrand.logo.wordmark} alt="Syncore" width={170} height={52} priority />
        </div>

        <div className={`unsubscribe-icon ${done ? "success" : valid ? "neutral" : "danger"}`} aria-hidden="true">
          {done ? "OK" : valid ? "!" : "x"}
        </div>

        <div className="unsubscribe-copy">
          <p className="unsubscribe-eyebrow">Email preferences</p>
          <h1 id="unsubscribe-title">{title}</h1>
          <p>{description}</p>
        </div>

        {valid && !done ? (
          <form method="post" action={action} className="unsubscribe-actions">
            <input type="hidden" name="redirect" value="1" />
            <button className="unsubscribe-button" type="submit">
              Unsubscribe me
            </button>
          </form>
        ) : null}

        {done ? <p className="unsubscribe-note">Your preference has been saved.</p> : null}
      </section>
    </main>
  );
}
