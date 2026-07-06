"use client";

import * as React from "react";

import { THEME_COOKIE, type ThemePref } from "@/lib/theme";

type ThemeContextValue = {
  pref: ThemePref;
  resolved: "light" | "dark";
  setTheme: (pref: ThemePref) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeSystemDark(onChange: () => void): () => void {
  const mql = window.matchMedia(SYSTEM_DARK_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * Client half of the theme system. The server reads the cookie and passes the
 * preference down (see app/layout.tsx), so the first render is already themed;
 * this provider only handles toggling and the live "system" media query.
 */
export function ThemeProvider({
  initialPref,
  children
}: {
  initialPref: ThemePref;
  children: React.ReactNode;
}) {
  const [pref, setPref] = React.useState<ThemePref>(initialPref);

  // useSyncExternalStore is the idiomatic way to subscribe to an external store
  // (matchMedia) without setState-in-effect; server snapshot is light.
  const systemDark = React.useSyncExternalStore(
    subscribeSystemDark,
    () => window.matchMedia(SYSTEM_DARK_QUERY).matches,
    () => false
  );

  const resolved: "light" | "dark" = pref === "system" ? (systemDark ? "dark" : "light") : pref;

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const setTheme = React.useCallback((next: ThemePref) => {
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setPref(next);
  }, []);

  const value = React.useMemo(() => ({ pref, resolved, setTheme }), [pref, resolved, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
