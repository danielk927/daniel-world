import './styles/portfolio.css';
import { lore, site } from './content.ts';
import { el } from './ui/dom.ts';
import { link, renderLoreBody } from './ui/loreContent.ts';

/** The brass mark under a title. Decoration only, so screen readers skip it. */
function bar(): HTMLElement {
  return el('span', { class: 'bar', attrs: { 'aria-hidden': 'true' } });
}

/** The line under the name, once `content.ts` has one. */
function headline(): string | undefined {
  return 'headline' in site && typeof site.headline === 'string' ? site.headline : undefined;
}

function render(): void {
  const root = document.getElementById('portfolio')!;
  document.title = `${site.name} - Portfolio`;
  const line = headline();

  const header = el('header', { class: 'pf-header' }, [
    el('h1', { class: 'title pf-name', text: site.name }),
    bar(),
    line ? el('p', { class: 'pf-headline', text: line }) : null,
    el('p', { class: 'pf-intro', text: site.intro }),
    el('div', { class: 'pf-actions' }, [
      el('a', {
        class: 'button button-primary',
        text: 'Enter the 3D kitchen',
        attrs: { href: '/' },
      }),
      el(
        'ul',
        { class: 'pf-contact', attrs: { 'aria-label': 'Contact' } },
        site.links.map((l) => el('li', {}, [link(l.label, l.href, 'button')])),
      ),
    ]),
  ]);

  const sections = lore.map((entry) =>
    el(
      'section',
      { class: 'pf-section', attrs: { id: entry.id, 'aria-labelledby': `${entry.id}-title` } },
      [
        el('h2', {
          class: 'title pf-section-title',
          text: entry.title,
          attrs: { id: `${entry.id}-title` },
        }),
        bar(),
        renderLoreBody(entry),
      ],
    ),
  );

  const footer = el('footer', { class: 'pf-footer' }, [
    el('p', { text: `© ${new Date().getFullYear()} ${site.name}` }),
    el('a', { class: 'text-link', text: 'Enter the 3D kitchen', attrs: { href: '/' } }),
  ]);

  root.replaceChildren(header, el('main', { class: 'pf-main' }, sections), footer);
}

render();
