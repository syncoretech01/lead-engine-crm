import Link from "next/link";

import { AuthAlert, AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { fieldClass, fieldLabelClass } from "@/components/ui/field";

export const dynamic = "force-dynamic";

type ResetPasswordPageProps = {
  searchParams?: Promise<{ sent?: string; reset?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;

  return (
    <AuthCard
      kicker="Password recovery"
      title="Reset password"
      subtitle="Request a reset link for a verified Syncore account."
    >
      {params?.sent ? (
        <AuthAlert tone="success">If the account exists, a reset link has been created.</AuthAlert>
      ) : null}
      {params?.reset ? (
        <AuthAlert tone="info">
          Local reset link:{" "}
          <Link href={params.reset} className="underline">
            {params.reset}
          </Link>
        </AuthAlert>
      ) : null}

      <form action="/auth/request-password-reset" method="post" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className={fieldLabelClass}>
            Email
          </label>
          <input id="email" name="email" type="email" required className={fieldClass} />
        </div>
        <Button type="submit" className="mt-1 w-full">
          Create reset link
        </Button>
      </form>

      <div className="mt-4 text-center text-sm">
        <Link href="/login" className="font-medium hover:underline" style={{ color: "var(--syn-primary)" }}>
          Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}
