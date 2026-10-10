import type { LoreItem, LoreSection } from '../content.ts';
import { h, type Markup } from './markup.ts';

function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

/** A link; external ones open in a new tab. */
export function link(label: string, href: string, className: string): Markup {
  return h('a', {
    class: className,
    text: label,
    attrs: isExternal(href) ? { href, target: '_blank', rel: 'noopener noreferrer' } : { href },
  });
}

function renderItem(item: LoreItem): Markup {
  const title = item.href ? link(item.title, item.href, 'lore-item-link') : item.title;
  // Only a name and a line beside it, like a dish and where it was eaten: a row of a menu.
  const brief = !item.subtitle && !item.description && !item.points?.length && !item.tags?.length;
  return h('li', { class: brief ? 'lore-item lore-item-brief' : 'lore-item' }, [
    h('div', { class: 'lore-item-head' }, [
      h('h3', { class: 'lore-item-title' }, [title]),
      item.meta ? h('span', { class: 'lore-item-meta', text: item.meta }) : null,
    ]),
    item.subtitle ? h('p', { class: 'lore-item-subtitle', text: item.subtitle }) : null,
    item.description ? h('p', { class: 'lore-item-desc', text: item.description }) : null,
    item.points?.length
      ? h(
          'ul',
          { class: 'lore-item-points' },
          item.points.map((p) => h('li', { text: p })),
        )
      : null,
    item.tags?.length
      ? h(
          'ul',
          { class: 'tag-list', attrs: { 'aria-label': 'Tags' } },
          item.tags.map((t) => h('li', { class: 'tag', text: t })),
        )
      : null,
  ]);
}

/**
 * The body of a lore entry, shared by the station panel and the portfolio page. Its links (Email,
 * GitHub...) are text links, as the house style has them.
 */
export function renderLoreBody(entry: LoreSection): Markup {
  return h('div', { class: 'lore-body' }, [
    entry.image
      ? h('figure', { class: 'lore-photo' }, [
          h('img', { attrs: { src: entry.image.src, alt: entry.image.alt, decoding: 'async' } }),
        ])
      : null,
    ...(entry.paragraphs ?? []).map((p) => h('p', { class: 'lore-paragraph', text: p })),
    entry.items?.length ? h('ul', { class: 'lore-items' }, entry.items.map(renderItem)) : null,
    entry.tags?.length
      ? h(
          'ul',
          { class: 'tag-list tag-list-large', attrs: { 'aria-label': 'Tags' } },
          entry.tags.map((t) => h('li', { class: 'tag', text: t })),
        )
      : null,
    entry.links?.length
      ? h(
          'div',
          { class: 'lore-links' },
          entry.links.map((l) => link(l.label, l.href, 'text-link')),
        )
      : null,
  ]);
}
