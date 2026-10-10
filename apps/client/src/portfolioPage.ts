import { dishes, lore, site } from './content.ts';
import { link, renderLoreBody } from './ui/loreContent.ts';
import { escapeHtml, h, toHtml, type Markup } from './ui/markup.ts';

/**
 * The plain portfolio page, written into `portfolio.html` by the build (`vite.config.ts`) from
 * `content.ts`, so it reads with JavaScript off and search engines and link previews see all of it.
 * In the browser `portfolio.ts` only follows the reading in the list of sections.
 */

/** The page's title, and what search results and link previews say under it. */
export const PORTFOLIO_TITLE = `${site.name} - Portfolio`;
export const PORTFOLIO_DESCRIPTION = `${site.name}'s portfolio: ${site.headline}, with his experience, projects, research and skills.`;

/** Where the build writes the head's title and description, and the page. */
const HEAD_MARK = '<!-- portfolio:head -->';
const BODY_MARK = '<!-- portfolio:body -->';

interface Section {
  readonly id: string;
  readonly title: string;
  readonly body: Markup;
}

/** The brass mark under a title. Decoration only, so screen readers skip it. */
function bar(): Markup {
  return h('span', { class: 'bar', attrs: { 'aria-hidden': 'true' } });
}

/** The five dishes on the pass, each with its photo, which in the kitchen have panels of their own. */
function renderDishes(): Markup {
  return h(
    'ul',
    { class: 'lore-body pf-dishes' },
    Object.values(dishes).map((dish) =>
      h('li', { class: 'pf-dish' }, [
        dish.image
          ? h('figure', { class: 'lore-photo pf-dish-photo' }, [
              h('img', {
                attrs: {
                  src: dish.image.src,
                  alt: dish.image.alt,
                  loading: 'lazy',
                  decoding: 'async',
                },
              }),
            ])
          : null,
        h('div', { class: 'pf-dish-text' }, [
          h('h3', { class: 'lore-item-title', text: dish.title }),
          dish.place ? h('p', { class: 'lore-item-subtitle', text: dish.place }) : null,
          ...(dish.paragraphs ?? []).map((p) => h('p', { class: 'lore-paragraph', text: p })),
        ]),
      ]),
    ),
  );
}

/** The page's sections in order: the resume as `lore` has it, and the dishes. */
function sections(): Section[] {
  const list: Section[] = lore.map((entry) => ({
    id: entry.id,
    title: entry.title,
    body: renderLoreBody(entry),
  }));
  // After the interests, whose words point at them.
  const interests = list.findIndex((section) => section.id === 'interests');
  list.splice(interests < 0 ? list.length : interests + 1, 0, {
    id: 'dishes',
    title: 'Favorite dishes',
    body: renderDishes(),
  });
  return list;
}

/** On paper a link is only its words, so each one going off the page says where, for print. */
function labelForPrint(markup: Markup): Markup {
  const { href } = markup.attrs;
  const attrs =
    markup.tag === 'a' && href && /^(https?:|mailto:)/.test(href)
      ? {
          ...markup.attrs,
          'data-print': href.replace(/^mailto:|^https?:\/\/(www\.)?/, '').replace(/\/$/, ''),
        }
      : markup.attrs;
  return {
    tag: markup.tag,
    attrs,
    children: markup.children.map((child) =>
      typeof child === 'string' ? child : labelForPrint(child),
    ),
  };
}

/** The page: the name and the ways in, the list of sections, the sections and the footer. */
export function portfolioPage(year = new Date().getFullYear()): Markup[] {
  const list = sections();

  const header = h('header', { class: 'pf-header' }, [
    h('h1', { class: 'title pf-name', text: site.name }),
    bar(),
    h('p', { class: 'pf-headline', text: site.headline }),
    h('p', { class: 'pf-intro', text: site.intro }),
    h('div', { class: 'pf-actions' }, [
      h('a', {
        class: 'button button-primary pf-world',
        text: 'Enter the 3D kitchen',
        attrs: { href: '/' },
      }),
      h(
        'ul',
        { class: 'pf-contact', attrs: { 'aria-label': 'Contact' } },
        site.links.map((l) => h('li', {}, [link(l.label, l.href, 'text-link')])),
      ),
    ]),
  ]);

  const nav = h('nav', { class: 'pf-nav', attrs: { 'aria-label': 'Sections' } }, [
    h(
      'ul',
      {},
      list.map(({ id, title }) =>
        h('li', {}, [
          h('a', { class: 'button pf-nav-link', text: title, attrs: { href: `#${id}` } }),
        ]),
      ),
    ),
  ]);

  const main = h(
    'main',
    { class: 'pf-main' },
    list.map(({ id, title, body }) =>
      h('section', { class: 'pf-section', attrs: { id, 'aria-labelledby': `${id}-title` } }, [
        h('h2', { class: 'title pf-section-title', text: title, attrs: { id: `${id}-title` } }),
        bar(),
        body,
      ]),
    ),
  );

  const footer = h('footer', { class: 'pf-footer' }, [
    h('p', { text: `© ${year} ${site.name}` }),
    h('a', { class: 'text-link pf-world', text: 'Enter the 3D kitchen', attrs: { href: '/' } }),
  ]);

  return [header, nav, main, footer].map(labelForPrint);
}

/** `portfolio.html` with its title, description and page written in. */
export function renderPortfolio(template: string): string {
  if (!template.includes(HEAD_MARK) || !template.includes(BODY_MARK)) {
    throw new Error(`portfolio.html needs ${HEAD_MARK} in its head and ${BODY_MARK} in its body`);
  }
  const head = [
    `<title>${escapeHtml(PORTFOLIO_TITLE)}</title>`,
    `<meta name="description" content="${escapeHtml(PORTFOLIO_DESCRIPTION)}" />`,
  ].join('\n    ');
  const body = portfolioPage().map(toHtml).join('\n');
  // Replaced through functions, so a "$" in the content is only a dollar sign.
  return template.replace(HEAD_MARK, () => head).replace(BODY_MARK, () => body);
}
