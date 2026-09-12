import { useEffect, useState, useCallback } from 'react';

// Theme hook: persists 'dark' | 'light' in localStorage and reflects it on
// <html data-theme>. Defaults to dark.
export function useTheme() {
  const [theme, setThemeState] = useState(() => localStorage.getItem('dl-theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dl-theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggle, setTheme: setThemeState };
}
