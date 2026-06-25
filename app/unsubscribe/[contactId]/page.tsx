import { verifyUnsubscribeToken } from "@/lib/phase1/unsubscribe-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UnsubscribePageProps = {
  params: Promise<{ contactId: string }>;
  searchParams?: Promise<{ t?: string; done?: string }>;
};

export default async function UnsubscribePage({ params, searchParams }: UnsubscribePageProps) {
  const { contactId } = await params;
  const query = await searchParams;
  const token = query?.t ?? "";
  const verified = verifyUnsubscribeToken(token);
  const valid = verified.ok && verified.contactId === contactId;
  const done = query?.done === "1";

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="panel-title-wrap">
          <h1 className="section-title">Email preferences</h1>
          <p className="section-subtitle">
            {done
              ? "You've been unsubscribed."
              : valid
                ? "Confirm that you no longer want to receive outreach emails from Syncore."
                : "This link is invalid."}
          </p>
        </div>

        {valid && !done ? (
          <form method="post" action={`/api/unsubscribe?t=${encodeURIComponent(token)}`} className="form-grid">
            <input type="hidden" name="redirect" value="1" />
            <button className="button primary" type="submit">
              Unsubscribe me
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
