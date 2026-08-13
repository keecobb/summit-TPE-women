"use client";

import { useEffect, useState } from "react";

// Applies/reads the data-theme attribute set on <html> by the inline
// no-flash script in layout.tsx (see THEME_INIT_SCRIPT there). Persists
// the choice in localStorage -- this is a real deployed site (not a
// Claude.ai artifact), so localStorage is the right tool here.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem("summit-tpe-theme", next);
    } catch {
      // storage unavailable (private browsing, etc.) -- toggle still works for this page view
    }
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? "☀" : "☽"}
    </button>
  );
}
