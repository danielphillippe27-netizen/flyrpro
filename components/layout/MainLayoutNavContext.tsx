'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type MainLayoutNavContextValue = {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  openMobileNav: () => void;
};

const MainLayoutNavContext = createContext<MainLayoutNavContextValue | null>(null);

export function MainLayoutNavProvider({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const value = useMemo(
    () => ({
      mobileNavOpen,
      setMobileNavOpen,
      openMobileNav: () => setMobileNavOpen(true),
    }),
    [mobileNavOpen]
  );
  return <MainLayoutNavContext.Provider value={value}>{children}</MainLayoutNavContext.Provider>;
}

export function useMainLayoutNav() {
  return useContext(MainLayoutNavContext);
}
