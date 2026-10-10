/**
 * Markup built without a document, so one piece of code can draw a station's panel in the browser
 * and write the portfolio page at build time (see `portfolioPage.ts`): `toElement` makes the
 * elements, `toHtml` the text of the page. Words are always text, never markup: elements get them
 * as text nodes, and HTML gets them escaped.
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

/** Elements that have no end tag and hold nothing. */
const VOID = new Set(['area', 'br', 'col', 'hr', 'img', 'input', 'link', 'meta', 'source', 'wbr']);

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/** Text made safe for HTML, between tags or in a quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ENTITIES[c]!);
}

/** The markup as HTML. */
export function toHtml(markup: Markup | string): string {
  if (typeof markup === 'string') return escapeHtml(markup);
  const attrs = Object.entries(markup.attrs)
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('');
  if (VOID.has(markup.tag)) {
    if (markup.children.length) throw new Error(`<${markup.tag}> cannot hold anything`);
    return `<${markup.tag}${attrs}>`;
  }
  return `<${markup.tag}${attrs}>${markup.children.map(toHtml).join('')}</${markup.tag}>`;
}
