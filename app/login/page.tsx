import Link from "next/link";

import { AuthAlert, AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { fieldClass, fieldLabelClass } from "@/components/ui/field";

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
    <AuthCard title="Sign in">
      {params?.error ? <AuthAlert tone="danger">{params.error}</AuthAlert> : null}
      {params?.loggedOut ? <AuthAlert tone="success">You have been signed out.</AuthAlert> : null}
      {params?.reset ? (
        <AuthAlert tone="success">Password updated. Sign in with your new password.</AuthAlert>
      ) : null}

      <form action="/auth/login" method="post" className="flex flex-col gap-4" autoComplete="off">
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className={fieldLabelClass}>
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="off" required className={fieldClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className={fieldLabelClass}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            className={fieldClass}
          />
        </div>
        <Button type="submit" className="mt-1 w-full">
          Sign in
        </Button>
      </form>

      <div className="mt-4 text-center text-sm">
        <Link href="/reset-password" className="font-medium hover:underline" style={{ color: "var(--syn-primary)" }}>
          Reset password
        </Link>
      </div>
    </AuthCard>
  );
}
