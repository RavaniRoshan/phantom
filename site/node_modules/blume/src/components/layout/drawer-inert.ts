/**
 * The mobile nav drawer's accessibility. The header's click script opens and
 * closes the drawer by toggling `data-blume-nav-open` on `<html>`; everything
 * here follows that attribute, only below `lg` (64rem) — at `lg` and up the same
 * element is the static sidebar (RootLayout) or display-hidden (PageLayout):
 *
 * - Closed, the drawer is only translated off-canvas, so its links would stay
 *   focusable on every page: it's `inert`/`aria-hidden` instead.
 * - Open, it's a modal panel over the page: the page behind it (everything but
 *   the header, which holds the toggle, and the overlay button) goes `inert`,
 *   so Tab can't wander into content the overlay covers, and the header's
 *   toggle reports `aria-expanded`.
 * - Escape closes it, and closing it with focus inside (or on the overlay's
 *   close button, which disappears) returns focus to the toggle.
 *
 * Shared by both layouts' bundled scripts, which run once per real page load;
 * the drawer and the page behind it are rebuilt by every client-router swap, so
 * `sync` re-queries them each time and re-runs on `astro:after-swap`.
 */

const OPEN_ATTRIBUTE = "data-blume-nav-open";

/**
 * Marks what `sync` made inert behind the open drawer, so closing it restores
 * only those — never an element something else made inert.
 */
const BACKDROP_ATTRIBUTE = "data-blume-drawer-backdrop";

/** What stays live beside the open drawer: the header and the overlay. */
const KEEP_LIVE =
  "[data-blume-header], [data-blume-nav-toggle], script, style, template";

const drawerElement = (): HTMLElement | null =>
  document.querySelector<HTMLElement>("[data-blume-nav-drawer]");

const headerToggle = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    "[data-blume-header] [data-blume-nav-toggle]"
  );

/**
 * The page behind the drawer: every sibling along the drawer's path up to
 * `<body>`, minus what stays live.
 */
const backdropOf = (drawer: Element): Element[] => {
  const backdrop: Element[] = [];
  let node = drawer;
  while (node !== document.body && node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node && !sibling.matches(KEEP_LIVE)) {
        backdrop.push(sibling);
      }
    }
    node = node.parentElement;
  }
  return backdrop;
};

const restoreBackdrop = (): void => {
  for (const element of document.querySelectorAll(`[${BACKDROP_ATTRIBUTE}]`)) {
    element.removeAttribute("inert");
    element.removeAttribute(BACKDROP_ATTRIBUTE);
  }
};

const inertBackdrop = (drawer: Element): void => {
  for (const element of backdropOf(drawer)) {
    // Already inert for another reason: leave it, and leave it unmarked.
    if (!element.hasAttribute("inert")) {
      element.setAttribute("inert", "");
      element.setAttribute(BACKDROP_ATTRIBUTE, "");
    }
  }
};

export const syncDrawerInert = (): void => {
  const desktop = window.matchMedia("(min-width: 64rem)");
  const isOpen = () =>
    !desktop.matches && document.documentElement.hasAttribute(OPEN_ATTRIBUTE);
  let wasOpen = false;

  const sync = () => {
    const open = isOpen();
    headerToggle()?.setAttribute("aria-expanded", open ? "true" : "false");
    const drawer = drawerElement();
    if (!drawer) {
      restoreBackdrop();
      wasOpen = open;
      return;
    }
    const hidden = !(desktop.matches || open);
    drawer.inert = hidden;
    if (hidden) {
      drawer.setAttribute("aria-hidden", "true");
    } else {
      drawer.removeAttribute("aria-hidden");
    }
    if (open) {
      inertBackdrop(drawer);
    } else {
      restoreBackdrop();
      const active = document.activeElement;
      if (
        wasOpen &&
        !desktop.matches &&
        active &&
        (drawer.contains(active) || active.matches("[data-blume-nav-toggle]"))
      ) {
        headerToggle()?.focus();
      }
    }
    wasOpen = open;
  };

  sync();
  desktop.addEventListener("change", sync);
  new MutationObserver(sync).observe(document.documentElement, {
    attributeFilter: [OPEN_ATTRIBUTE],
  });
  document.addEventListener("astro:after-swap", sync);
  document.addEventListener("keydown", (event) => {
    // An open dialog (search, the assistant) closes itself on Escape first.
    if (
      event.key !== "Escape" ||
      !isOpen() ||
      document.querySelector("dialog[open]")
    ) {
      return;
    }
    document.documentElement.removeAttribute(OPEN_ATTRIBUTE);
    sync();
    headerToggle()?.focus();
  });
};
