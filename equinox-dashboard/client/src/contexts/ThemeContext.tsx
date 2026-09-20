import { createContext, useContext, useEffect, type ReactNode } from "react";

// Tema tetap (gelap) tanpa next-themes: kelas `dark` dipasang di <html> agar varian Tailwind `dark:` aktif.
type Theme = "light" | "dark";

const ThemeContext = createContext<{ theme: Theme }>({ theme: "dark" });

export function ThemeProvider({ children, defaultTheme = "dark" }: { children: ReactNode; defaultTheme?: Theme }) {
  useEffect(() => {
    document.documentElement.classList.toggle("dark", defaultTheme === "dark");
  }, [defaultTheme]);

  return <ThemeContext.Provider value={{ theme: defaultTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
