import type { LoreImage, LoreItem, LoreSection } from '../content.ts';
import { el } from './dom.ts';

function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

/** A link; external ones open in a new tab. */
function link(label: string, href: string, className: string): HTMLAnchorElement {
  return el('a', {
    class: className,
    text: label,
    attrs: isExternal(href) ? { href, target: '_blank', rel: 'noopener noreferrer' } : { href },
  });
}

function renderItem(item: LoreItem): HTMLLIElement {
  const title = item.href ? link(item.title, item.href, 'lore-item-link') : item.title;
  // Only a name and a line beside it, like a dish and where it was eaten: a row of a menu.
  const brief = !item.subtitle && !item.description && !item.points?.length && !item.tags?.length;
  return el('li', { class: brief ? 'lore-item lore-item-brief' : 'lore-item' }, [
    el('div', { class: 'lore-item-head' }, [
      el('h3', { class: 'lore-item-title' }, [title]),
      item.meta ? el('span', { class: 'lore-item-meta', text: item.meta }) : null,
    ]),
    item.subtitle ? el('p', { class: 'lore-item-subtitle', text: item.subtitle }) : null,
    item.description ? el('p', { class: 'lore-item-desc', text: item.description }) : null,
    item.points?.length
      ? el(
          'ul',
          { class: 'lore-item-points' },
          item.points.map((p) => el('li', { text: p })),
        )
      : null,
    item.tags?.length
      ? el(
          'ul',
          { class: 'tag-list', attrs: { 'aria-label': 'Tags' } },
          item.tags.map((t) => el('li', { class: 'tag', text: t })),
        )
      : null,
  ]);
}

/** A photo, whole: its own width and height keep its shape before it loads (panel.css sizes it). */
function renderPhoto({ src, alt, width, height }: LoreImage): HTMLElement {
  const img = el('img', {
    attrs: { src, alt, width: String(width), height: String(height), decoding: 'async' },
  });
  img.style.setProperty('--photo-ratio', String(width / height));
  return el('figure', { class: 'lore-photo' }, [img]);
}

/**
 * The body of a lore entry, as the station panel shows it. Its links (Email, GitHub...) are text
 * links, as the house style has them.
 */
export function renderLoreBody(entry: LoreSection): HTMLElement {
  return el('div', { class: 'lore-body' }, [
    entry.image ? renderPhoto(entry.image) : null,
    ...(entry.paragraphs ?? []).map((p) => el('p', { class: 'lore-paragraph', text: p })),
    entry.items?.length ? el('ul', { class: 'lore-items' }, entry.items.map(renderItem)) : null,
    entry.tags?.length
      ? el(
          'ul',
          { class: 'tag-list tag-list-large', attrs: { 'aria-label': 'Tags' } },
          entry.tags.map((t) => el('li', { class: 'tag', text: t })),
        )
      : null,
    entry.links?.length
      ? el(
          'div',
          { class: 'lore-links' },
          entry.links.map((l) => link(l.label, l.href, 'text-link')),
        )
      : null,
  ]);
}
