import Image from "next/image";
import Link from "next/link";
import { requestPasswordResetAction } from "@/app/auth/actions";
import { syncoreBrand } from "@/lib/brand";

export const dynamic = "force-dynamic";

type ResetPasswordPageProps = {
  searchParams?: Promise<{ sent?: string; reset?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-brand">
          <Image src={syncoreBrand.logo.wordmark} alt={syncoreBrand.shortName} width={260} height={80} priority />
          <p>Password recovery</p>
        </div>
        <div className="auth-copy">
          <h1>Reset password</h1>
          <p>Request a reset link for a verified Syncore account.</p>
        </div>

        {params?.sent ? <p className="form-alert success">If the account exists, a reset link has been created.</p> : null}
        {params?.reset ? (
          <p className="form-alert info">
            Local reset link: <Link href={params.reset}>{params.reset}</Link>
          </p>
        ) : null}

        <form action={requestPasswordResetAction} className="auth-form">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required />
          </div>
          <button className="button primary" type="submit">
            Create reset link
          </button>
        </form>

        <div className="auth-links">
          <Link href="/login">Back to sign in</Link>
        </div>
      </section>
    </main>
  );
}
