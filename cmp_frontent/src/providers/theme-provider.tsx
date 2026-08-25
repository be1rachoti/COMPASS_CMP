/**
 * Theme.
 *
 * Three states, not two: light, dark, and *system*. Forcing a binary choice
 * means someone whose OS switches at sunset has to switch the app by hand as
 * well, so "system" is the default and it stays live - the media query listener
 * is what makes the switch happen without a reload.
 *
 * The class is applied before first paint by the inline script in the root
 * layout; this provider keeps it in sync afterwards.
 */
"use client";

import * as React from "react";

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "cmp-theme";

interface ThemeContextValue {
  theme: ThemeChoice;
  /** What is actually on screen right now, with `system` resolved. */
  resolved: "light" | "dark";
  setTheme: (theme: ThemeChoice) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

function readStoredTheme(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Private browsing, or storage blocked by policy. System default is fine.
    return "system";
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Lazy initialiser rather than an effect. On the server there is no
  // localStorage, so this returns "system"; on the client the first render
  // already has the right value, which avoids the extra render an effect causes.
  //
  // Hydration-safe because nothing theme-dependent is rendered as markup - the
  // class is on <html>, applied by the inline script in the root layout before
  // first paint.
  const [theme, setThemeState] = React.useState<ThemeChoice>(readStoredTheme);
  const [resolved, setResolved] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      setResolved(dark ? "dark" : "light");
    };

    apply();

    // Only follow the OS while the user has chosen to. If they picked light
    // explicitly, sunset should not override them.
    if (theme === "system") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
  }, [theme]);

  const setTheme = React.useCallback((next: ThemeChoice) => {
    setThemeState(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-fatal: the choice simply will not survive a reload.
    }
  }, []);

  const value = React.useMemo(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
