import './styles/portfolio.css';
import { lore, site } from './content.ts';
import { el } from './ui/dom.ts';
import { link, renderLoreBody } from './ui/loreContent.ts';

function render(): void {
  const root = document.getElementById('portfolio')!;
  document.title = `${site.name} - Portfolio`;

  const header = el('header', { class: 'pf-header' }, [
    el('p', { class: 'pf-eyebrow', text: site.worldName }),
    el('h1', { class: 'pf-title', text: site.name }),
    el('p', { class: 'pf-tagline', text: site.tagline }),
    el('p', { class: 'pf-intro', text: site.intro }),
    el('div', { class: 'pf-actions' }, [
      el('a', { class: 'pf-button', text: 'Enter the 3D world', attrs: { href: '/' } }),
      el(
        'div',
        { class: 'pf-links' },
        site.links.map((l) => link(l.label, l.href, 'pf-button pf-button-secondary')),
      ),
    ]),
    el(
      'nav',
      { class: 'pf-nav', attrs: { 'aria-label': 'Sections' } },
      lore.map((entry) => {
        const link = el('a', {
          class: 'pf-nav-link',
          text: entry.title,
          attrs: { href: `#${entry.id}` },
        });
        link.style.setProperty('--accent-entry', entry.color);
        return link;
      }),
    ),
  ]);

  const sections = lore.map((entry) => {
    const section = el(
      'section',
      { class: 'pf-section', attrs: { id: entry.id, 'aria-labelledby': `${entry.id}-title` } },
      [
        el('div', { class: 'pf-section-head' }, [
          el('p', { class: 'pf-kicker', text: entry.kicker }),
          el('h2', {
            class: 'pf-section-title',
            text: entry.title,
            attrs: { id: `${entry.id}-title` },
          }),
        ]),
        renderLoreBody(entry),
      ],
    );
    section.style.setProperty('--accent-entry', entry.color);
    return section;
  });

  const footer = el('footer', { class: 'pf-footer' }, [
    el('p', { text: `© ${new Date().getFullYear()} ${site.name}` }),
    el('a', { class: 'pf-footer-link', text: 'Back to the world', attrs: { href: '/' } }),
  ]);

  root.replaceChildren(header, el('div', { class: 'pf-sections' }, sections), footer);
}

render();
