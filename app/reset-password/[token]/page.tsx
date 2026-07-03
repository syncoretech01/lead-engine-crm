import { AuthAlert, AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { fieldClass, fieldLabelClass } from "@/components/ui/field";

export const dynamic = "force-dynamic";

type ResetPasswordTokenPageProps = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ error?: string }>;
};

export default async function ResetPasswordTokenPage({ params, searchParams }: ResetPasswordTokenPageProps) {
  const { token } = await params;
  const query = await searchParams;

  return (
    <AuthCard
      kicker="Password recovery"
      title="Set new password"
      subtitle="Choose a new password. Existing sessions for this account will be revoked."
    >
      {query?.error ? <AuthAlert tone="danger">{query.error}</AuthAlert> : null}

      <form action="/auth/reset-password" method="post" className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className={fieldLabelClass}>
            New password
          </label>
          <input id="password" name="password" type="password" minLength={10} required className={fieldClass} />
        </div>
        <Button type="submit" className="mt-1 w-full">
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
