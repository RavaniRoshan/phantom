/**
 * Coalesce a high-frequency event handler (resize, scroll) into at most one
 * call per animation frame — the toc-element scroll pattern, shared. Calls
 * landing while a frame is pending are dropped; the handler runs once on the
 * next frame with the latest state. Layout reads inside `fn` then happen once
 * per frame instead of once per event, without the settle lag a debounce
 * would add to position-tracking handlers.
 */
export const rafThrottle = (fn: () => void): (() => void) => {
  let ticking = false;
  return () => {
    if (ticking) {
      return;
    }
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      fn();
    });
  };
};
