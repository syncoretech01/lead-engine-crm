import Image from "next/image";
import { syncoreBrand } from "@/lib/brand";

export const dynamic = "force-dynamic";

type ResetPasswordTokenPageProps = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ error?: string }>;
};

export default async function ResetPasswordTokenPage({ params, searchParams }: ResetPasswordTokenPageProps) {
  const { token } = await params;
  const query = await searchParams;

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-brand">
          <Image src={syncoreBrand.logo.wordmark} alt={syncoreBrand.shortName} width={260} height={80} priority />
          <p>Password recovery</p>
        </div>
        <div className="auth-copy">
          <h1>Set new password</h1>
          <p>Choose a new password. Existing sessions for this account will be revoked.</p>
        </div>

        {query?.error ? <p className="form-alert danger">{query.error}</p> : null}

        <form action="/auth/reset-password" method="post" className="auth-form">
          <input type="hidden" name="token" value={token} />
          <div className="field">
            <label htmlFor="password">New password</label>
            <input id="password" name="password" type="password" minLength={10} required />
          </div>
          <button className="button primary" type="submit">
            Update password
          </button>
        </form>
      </section>
    </main>
  );
}
