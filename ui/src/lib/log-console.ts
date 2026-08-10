import { createContext, useContext } from 'react';

// — shared log console (single dock at the bottom, one stream at a time) —
// Lives in its own module so any page (Console.tsx, Compute.tsx, …) can open
// the dock without creating import cycles.

export interface LogTarget {
  instance: string;
  service: string;
  label: string;
}

export interface LogConsoleApi {
  open: (target: LogTarget) => void;
  close: () => void;
  target: LogTarget | null;
}

export const LogConsoleContext = createContext<LogConsoleApi>({
  open: () => {},
  close: () => {},
  target: null,
});

export function useLogConsole(): LogConsoleApi {
  return useContext(LogConsoleContext);
}
