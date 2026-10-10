type Child = Node | string | null | undefined | false;

interface ElementOptions {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
}

/** Tiny element builder. Text always goes through textContent, never innerHTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) node.setAttribute(name, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

/** Whether a node is on screen. Safari before 17.4 has no checkVisibility: then, whether it has boxes. */
function shows(node: HTMLElement): boolean {
  if (typeof node.checkVisibility === 'function') {
    return node.checkVisibility({ visibilityProperty: true });
  }
  return node.getClientRects().length > 0;
}

/**
 * What Tab stops on inside `container`, in order: not what is disabled, not what only the arrow keys
 * or a script focus (a tabindex below 0, like the tabs and radios not chosen), and not what does not
 * show (in a hidden tab panel, say).
 */
export function tabStops(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.tabIndex >= 0 && !node.matches(':disabled') && shows(node),
  );
}

/** Keep Tab focus inside a dialog while it is open. Returns a function that removes the trap. */
export function trapFocus(container: HTMLElement): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const focusable = tabStops(container);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    // From the container itself (a click on its text), Shift+Tab wraps round too.
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === container)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', onKeyDown);
  return () => container.removeEventListener('keydown', onKeyDown);
}
