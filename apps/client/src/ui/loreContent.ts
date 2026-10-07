import type { LoreEntry, LoreItem } from '../content.ts';
import { el } from './dom.ts';

function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

/** A link; external ones open in a new tab. */
export function link(label: string, href: string, className: string): HTMLAnchorElement {
  const a = el('a', { class: className, text: label, attrs: { href } });
  if (isExternal(href)) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  return a;
}

function renderItem(item: LoreItem): HTMLElement {
  const title = item.href ? link(item.title, item.href, 'lore-item-link') : item.title;
  return el('li', { class: 'lore-item' }, [
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

/** The body of a lore entry. Shared by the in-world info panel and the static portfolio page. */
export function renderLoreBody(entry: LoreEntry): HTMLElement {
  return el('div', { class: 'lore-body' }, [
    entry.image
      ? el('figure', { class: 'lore-photo' }, [
          el('img', {
            attrs: { src: entry.image.src, alt: entry.image.alt, decoding: 'async' },
          }),
        ])
      : null,
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
          entry.links.map((l) => link(l.label, l.href, 'button button-secondary')),
        )
      : null,
  ]);
}
