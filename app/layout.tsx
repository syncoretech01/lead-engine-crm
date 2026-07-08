import type { Metadata } from "next";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "./globals.css";
import { cookies, headers } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { CallProvider } from "@/components/call/call-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { syncoreBrand } from "@/lib/brand";
import { isPublicAuthPath, isPublicUnsubscribePath } from "@/lib/phase1/auth-routes";
import { getSession } from "@/lib/phase1/store";
import { readThemePref, THEME_SCRIPT } from "@/lib/theme";

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

  // Theme preference is a cookie (like sidebar_state) so the first server
  // render is already themed; the inline script only resolves "system".
  // suppressHydrationWarning: for "system" the pre-paint script may add the
  // dark class before React hydrates the <html> element.
  const cookieStore = await cookies();
  const themePref = readThemePref(cookieStore);
  const htmlClassName = themePref === "dark" ? "dark" : undefined;

  if (isPublicAuthPath(pathname) || isPublicUnsubscribePath(pathname)) {
    return (
      <html lang="en" className={htmlClassName} suppressHydrationWarning>
        <body>
          <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
          <ThemeProvider initialPref={themePref}>
            {children}
            <Toaster richColors closeButton position="bottom-right" />
          </ThemeProvider>
        </body>
      </html>
    );
  }

  const session = await getSession();
  // Restore the sidebar collapsed/expanded state from the cookie shadcn sets,
  // so the first server render matches the user's last choice (no flash).
  const defaultSidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <html lang="en" className={htmlClassName} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <ThemeProvider initialPref={themePref}>
          <CallProvider>
            <AppShell session={session} defaultSidebarOpen={defaultSidebarOpen}>
              {children}
            </AppShell>
          </CallProvider>
          <Toaster richColors closeButton position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
