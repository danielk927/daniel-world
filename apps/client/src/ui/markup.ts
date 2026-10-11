/**
 * Markup built without a document, which `toElement` turns into elements for the page it is in
 * (the station panel). Words are always text, never markup: elements get them as text nodes.
 */
export interface Markup {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly (Markup | string)[];
}

type Child = Markup | string | null | undefined | false;

interface MarkupOptions {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
}

/** An element, as `el` in `dom.ts` takes it: a class, its text, other attributes and children. */
export function h(
  tag: string,
  options: MarkupOptions = {},
  children: readonly Child[] = [],
): Markup {
  const attrs: Record<string, string> = {};
  if (options.class) attrs.class = options.class;
  Object.assign(attrs, options.attrs);
  const content: (Markup | string)[] = options.text === undefined ? [] : [options.text];
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) content.push(child);
  }
  return { tag, attrs, children: content };
}

/** The markup as elements, for the page it is in. */
export function toElement(markup: Markup): HTMLElement {
  const node = document.createElement(markup.tag);
  for (const [name, value] of Object.entries(markup.attrs)) node.setAttribute(name, value);
  for (const child of markup.children) {
    node.append(typeof child === 'string' ? child : toElement(child));
  }
  return node;
}
