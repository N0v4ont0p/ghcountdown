import { useEffect, useState } from 'react';
import { useKV } from '@github/spark/hooks';

type Theme = 'light' | 'dark' | 'system';

export function useTheme() {
  const [theme, setThemeKV] = useKV<Theme>('app-theme', 'system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = window.document.documentElement;
    
    const updateTheme = () => {
      let actualTheme: 'light' | 'dark' = 'light';
      
      const currentTheme = theme || 'system';
      
      if (currentTheme === 'system') {
        actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } else {
        actualTheme = currentTheme;
      }
      
      root.classList.remove('light', 'dark');
      root.classList.add(actualTheme);
      setResolvedTheme(actualTheme);
    };

    updateTheme();

    const currentTheme = theme || 'system';
    if (currentTheme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => updateTheme();
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [theme]);

  return {
    theme: theme || 'system',
    setTheme: setThemeKV,
    resolvedTheme,
  };
}
