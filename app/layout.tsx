import type { Metadata } from "next";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "./globals.css";
import { headers } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { syncoreBrand } from "@/lib/brand";
import { isPublicAuthPath } from "@/lib/phase1/auth-routes";
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

  if (isPublicAuthPath(pathname)) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  const session = await getSession();

  return (
    <html lang="en">
      <body>
        <AppShell session={session}>{children}</AppShell>
      </body>
    </html>
  );
}
