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

/** Keep Tab focus inside a dialog while it is open. Returns a function that removes the trap. */
export function trapFocus(container: HTMLElement): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    // Only what Tab can reach: not tabs a tab list has taken out of the order, nor hidden pages.
    const focusable = [
      ...container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]',
      ),
    ].filter((element) => element.tabIndex >= 0 && element.checkVisibility());
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
