import Image from "next/image";
import { acceptInviteAction } from "@/app/auth/actions";
import { syncoreBrand } from "@/lib/brand";

export const dynamic = "force-dynamic";

type InvitePageProps = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ error?: string }>;
};

export default async function InvitePage({ params, searchParams }: InvitePageProps) {
  const { token } = await params;
  const query = await searchParams;

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-brand">
          <Image src={syncoreBrand.logo.wordmark} alt={syncoreBrand.shortName} width={260} height={80} priority />
          <p>Workspace invitation</p>
        </div>
        <div className="auth-copy">
          <h1>Accept invite</h1>
          <p>Create your verified Syncore login and join the workspace with the role assigned by the owner.</p>
        </div>

        {query?.error ? <p className="form-alert danger">{query.error}</p> : null}

        <form action={acceptInviteAction} className="auth-form">
          <input type="hidden" name="token" value={token} />
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" minLength={10} required />
          </div>
          <button className="button primary" type="submit">
            Create account
          </button>
        </form>
      </section>
    </main>
  );
}
