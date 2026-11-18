/**
 * Keep a header selector's dropdown panel inside the viewport. The panel is
 * absolutely positioned against its trigger (`end-0` for the version
 * selector), which is right on desktop, where the trigger sits at the header's
 * trailing edge — but on a phone the trigger lands mid-header, so a 14rem
 * panel anchored to its end runs off the leading edge (and, mirrored, off the
 * trailing edge in a right-to-left locale). When a panel opens, it is measured
 * and nudged back inside with `translate`, which leaves the anchoring classes
 * — and the desktop layout — untouched.
 *
 * One capture-phase `toggle` listener on `document` (the event doesn't bubble)
 * serves every opted-in dropdown, installed once per real page load: the
 * client router rebuilds the header markup on each swap, and delegation needs
 * no re-binding.
 */

/** Gap kept between a clamped panel and the viewport edge, in pixels. */
const MARGIN = 8;

/** The panel an opted-in `<details>` dropdown clamps. */
export const CLAMPED_PANEL = "[data-blume-dropdown-panel]";

/**
 * The horizontal shift that brings a panel spanning `left`…`right` inside a
 * viewport `width` wide, keeping `margin` at each edge. A panel wider than the
 * room available pins its leading edge (the one reading starts from) to the
 * margin.
 */
export const clampShift = (
  left: number,
  right: number,
  width: number,
  rtl: boolean,
  margin = MARGIN
): number => {
  const tooWide = right - left > width - 2 * margin;
  if (tooWide) {
    return rtl ? width - margin - right : margin - left;
  }
  if (left < margin) {
    return margin - left;
  }
  if (right > width - margin) {
    return width - margin - right;
  }
  return 0;
};

/** The slice of a panel element the clamp measures and moves. */
export interface PanelBox {
  getBoundingClientRect: () => { left: number; right: number };
  style: { translate: string };
}

/** Measure `panel` in place and shift it back inside the viewport. */
export const clampPanel = (panel: PanelBox): void => {
  panel.style.translate = "";
  const { left, right } = panel.getBoundingClientRect();
  const root = document.documentElement;
  const shift = clampShift(
    left,
    right,
    root.clientWidth,
    root.getAttribute("dir") === "rtl"
  );
  if (shift !== 0) {
    panel.style.translate = `${shift}px 0`;
  }
};

/** The clamped panel of the dropdown a `toggle` event opened, if any. */
const openedPanel = (target: EventTarget | null): HTMLElement | null =>
  target instanceof HTMLDetailsElement && target.open
    ? target.querySelector<HTMLElement>(CLAMPED_PANEL)
    : null;

/** Clamp every open panel again, after the viewport changed size. */
const reclampOpen = (): void => {
  for (const panel of document.querySelectorAll<HTMLElement>(
    `details[open] > ${CLAMPED_PANEL}`
  )) {
    clampPanel(panel);
  }
};

let installed = false;

/** Clamp opted-in dropdown panels on open (and on resize while open). */
export const installDropdownClamp = (): void => {
  if (installed) {
    return;
  }
  installed = true;
  document.addEventListener(
    "toggle",
    (event) => {
      const panel = openedPanel(event.target);
      if (panel) {
        clampPanel(panel);
      }
    },
    true
  );
  window.addEventListener("resize", reclampOpen);
};
