import { useSyncExternalStore } from "react";

// below Tailwind's md breakpoint, the same point where AppLayout swaps the sidebar for the drawer
const MOBILE_QUERY = "(max-width: 767px)";

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

const getSnapshot = () => window.matchMedia(MOBILE_QUERY).matches;

// true on phone-sized viewports; re-renders when the width crosses the breakpoint
// (rotating the phone, resizing the window)
export const useMobile = () => useSyncExternalStore(subscribe, getSnapshot, () => false);
