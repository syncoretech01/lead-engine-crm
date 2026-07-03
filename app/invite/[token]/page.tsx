import { AuthAlert, AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { fieldClass, fieldLabelClass } from "@/components/ui/field";

export const dynamic = "force-dynamic";

type InvitePageProps = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ error?: string }>;
};

export default async function InvitePage({ params, searchParams }: InvitePageProps) {
  const { token } = await params;
  const query = await searchParams;

  return (
    <AuthCard
      kicker="Workspace invitation"
      title="Accept invite"
      subtitle="Create your verified Syncore login and join the workspace with the role assigned by the owner."
    >
      {query?.error ? <AuthAlert tone="danger">{query.error}</AuthAlert> : null}

      <form action="/auth/accept-invite" method="post" className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className={fieldLabelClass}>
            Name
          </label>
          <input id="name" name="name" required className={fieldClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className={fieldLabelClass}>
            Password
          </label>
          <input id="password" name="password" type="password" minLength={10} required className={fieldClass} />
        </div>
        <Button type="submit" className="mt-1 w-full">
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
