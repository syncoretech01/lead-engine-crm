"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/use-theme";
import type { ThemePref } from "@/lib/theme";

export const THEME_OPTIONS: ReadonlyArray<{
  pref: ThemePref;
  label: string;
  icon: typeof Sun;
}> = [
  { pref: "light", label: "Light", icon: Sun },
  { pref: "dark", label: "Dark", icon: Moon },
  { pref: "system", label: "System", icon: Monitor }
];

export function ThemeMenuItems() {
  const { pref, setTheme } = useTheme();

  return (
    <>
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        return (
          <DropdownMenuItem key={option.pref} onSelect={() => setTheme(option.pref)}>
            <Icon aria-hidden="true" />
            {option.label}
            {pref === option.pref ? <Check aria-hidden="true" className="ml-auto" /> : null}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
