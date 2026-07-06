export const THEME_COOKIE = "syncore_theme";

export type ThemePref = "light" | "dark" | "system";

export function isThemePref(value: unknown): value is ThemePref {
  return value === "light" || value === "dark" || value === "system";
}

type CookieReader = { get(name: string): { value: string } | undefined };

/** Server-side read of the theme preference (defaults to light). */
export function readThemePref(cookieStore: CookieReader): ThemePref {
  const raw = cookieStore.get(THEME_COOKIE)?.value;
  return isThemePref(raw) ? raw : "light";
}

/**
 * Runs before first paint (first element in <body>) so a "system" preference —
 * which the server cannot resolve — never flashes the wrong theme. For explicit
 * light/dark the server already rendered the right <html> class and this is a
 * no-op.
 */
export const THEME_SCRIPT = `(function(){try{
var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(dark|light|system)/);
var t=m?m[1]:"light";
var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.classList.toggle("dark",d);
}catch(e){}})()`;
