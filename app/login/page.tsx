import Image from "next/image";
import Link from "next/link";
import { syncoreBrand } from "@/lib/brand";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    loggedOut?: string;
    next?: string;
    reset?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = params?.next ?? "/";

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-brand">
          <Image
            src={syncoreBrand.logo.wordmark}
            alt={syncoreBrand.shortName}
            width={260}
            height={80}
            priority
          />
        </div>

        <div className="auth-copy">
          <h1>Sign in</h1>
        </div>

        {params?.error ? <p className="form-alert danger">{params.error}</p> : null}
        {params?.loggedOut ? <p className="form-alert success">You have been signed out.</p> : null}
        {params?.reset ? <p className="form-alert success">Password updated. Sign in with your new password.</p> : null}

        <form action="/auth/login" method="post" className="auth-form" autoComplete="off">
          <input type="hidden" name="next" value={next} />
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="off" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="new-password" required />
          </div>
          <button className="button primary" type="submit">
            Sign in
          </button>
        </form>

        <div className="auth-links">
          <Link href="/reset-password">Reset password</Link>
        </div>
      </section>
    </main>
  );
}
