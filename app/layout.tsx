import type { Metadata } from "next";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { syncoreBrand } from "@/lib/brand";
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
  const session = await getSession();

  return (
    <html lang="en">
      <body>
        <AppShell session={session}>{children}</AppShell>
      </body>
    </html>
  );
}
