import Image from "next/image";
import type { ReactNode } from "react";

import { syncoreBrand } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * Flexio-styled shell for the public auth pages (login, reset, invite). These
 * render outside the app shell, so this provides the centered card + brand.
 */
export function AuthCard({
  kicker,
  title,
  subtitle,
  children
}: {
  kicker?: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-[var(--bg-subtle)] px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-1.5">
        {/* The wordmark PNG is a 512x512 square with the logo in the middle band
            and large transparent padding; crop to the logo with object-cover. */}
        <div className="relative h-16 w-56 overflow-hidden">
          <Image
            src={syncoreBrand.logo.wordmark}
            alt={syncoreBrand.shortName}
            fill
            priority
            sizes="224px"
            className="object-cover object-center"
          />
        </div>
        {kicker ? (
          <p className="text-xs font-medium tracking-wide text-muted-foreground">{kicker}</p>
        ) : null}
      </div>
      <section className="bg-card w-full max-w-sm rounded-xl border p-6 shadow-sm sm:p-7">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {children}
      </section>
    </main>
  );
}

const alertToneClasses = {
  danger: "bg-[#fdecec] text-[var(--ui-destructive)]",
  success: "bg-[var(--teal-50)] text-[var(--teal-700)]",
  info: "bg-[var(--blue-50)] text-[var(--syn-primary)]"
} as const;

export function AuthAlert({
  tone = "info",
  children
}: {
  tone?: keyof typeof alertToneClasses;
  children: ReactNode;
}) {
  return <p className={cn("mb-4 rounded-md px-3 py-2 text-sm", alertToneClasses[tone])}>{children}</p>;
}
