import { useSyncExternalStore } from "react";

/**
 * True/false mirror of a CSS media query, kept in sync via matchMedia.
 * Used by AppShell to decide which layout to MOUNT — not just which one to
 * show with CSS. Rendering both the desktop and mobile layout at once (and
 * hiding one with `hidden`/`md:hidden`) was creating two <canvas id="canvas">
 * elements and two ViewportCanvas/WASM-bridge instances simultaneously.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}
