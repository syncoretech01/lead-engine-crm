import type { Metadata } from "next";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "./globals.css";
import { cookies, headers } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { syncoreBrand } from "@/lib/brand";
import { isPublicAuthPath, isPublicUnsubscribePath } from "@/lib/phase1/auth-routes";
import { getSession } from "@/lib/phase1/store";

export const metadata: Metadata = {
  title: syncoreBrand.productName,
  description: "Modern SaaS workspace for lead acquisition, data quality, and CRM execution.",
  icons: {
    icon: "/icon.png"
  }
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const pathname = headerStore.get("x-syncore-pathname") ?? "";

  if (isPublicAuthPath(pathname) || isPublicUnsubscribePath(pathname)) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  const session = await getSession();
  // Restore the sidebar collapsed/expanded state from the cookie shadcn sets,
  // so the first server render matches the user's last choice (no flash).
  const cookieStore = await cookies();
  const defaultSidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <html lang="en">
      <body>
        <AppShell session={session} defaultSidebarOpen={defaultSidebarOpen}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
