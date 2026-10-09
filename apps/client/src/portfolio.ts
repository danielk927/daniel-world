import './styles/portfolio.css';
import { lore, site } from './content.ts';
import { el } from './ui/dom.ts';
import { link, renderLoreBody } from './ui/loreContent.ts';

interface Section {
  readonly id: string;
  readonly title: string;
  readonly body: HTMLElement;
}

/** The brass mark under a title. Decoration only, so screen readers skip it. */
function bar(): HTMLElement {
  return el('span', { class: 'bar', attrs: { 'aria-hidden': 'true' } });
}

/** The line under the name, once `content.ts` has one. */
function headline(): string | undefined {
  return 'headline' in site && typeof site.headline === 'string' ? site.headline : undefined;
}

/** The page's sections in order: the resume as `lore` has it. */
function sections(): Section[] {
  return lore.map((entry) => ({
    id: entry.id,
    title: entry.title,
    body: renderLoreBody(entry),
  }));
}

/**
 * Puts the bar under the section being read in the list of sections, as the pause menu does under
 * its tab: the last section whose title has passed the top third of the screen, or the last one at
 * the bottom of the page. The last few sections are too short to reach the top, so a section picked
 * from the list stays marked until the reader scrolls again.
 */
function followReading(
  links: ReadonlyMap<string, HTMLAnchorElement>,
  all: readonly HTMLElement[],
): void {
  let current: HTMLAnchorElement | undefined;
  let queued = false;
  let picked = false;
  let settle = 0;

  const mark = (next: HTMLAnchorElement | undefined): void => {
    if (next === current) return;
    current?.removeAttribute('aria-current');
    next?.setAttribute('aria-current', 'true');
    current = next;
  };
  const update = (): void => {
    queued = false;
    const page = document.documentElement;
    const atBottom = window.scrollY + window.innerHeight >= page.scrollHeight - 2;
    const line = window.innerHeight / 3;
    let reading: HTMLElement | undefined;
    for (const section of all) {
      if (atBottom || section.getBoundingClientRect().top <= line) reading = section;
      else break;
    }
    mark(reading && links.get(reading.id));
  };
  // A pick holds until the scroll it started has stopped for a moment.
  const holdPick = (): void => {
    window.clearTimeout(settle);
    settle = window.setTimeout(() => (picked = false), 150);
  };

  for (const a of links.values()) {
    a.addEventListener('click', () => {
      mark(a);
      picked = true;
      holdPick();
    });
  }
  const queue = (): void => {
    if (picked) holdPick();
    else if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  update();
}

function render(): void {
  const root = document.getElementById('portfolio')!;
  document.title = `${site.name} - Portfolio`;
  const line = headline();
  const list = sections();

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

  const links = new Map(
    list.map(({ id, title }) => [
      id,
      el('a', { class: 'button pf-nav-link', text: title, attrs: { href: `#${id}` } }),
    ]),
  );
  const nav = el('nav', { class: 'pf-nav', attrs: { 'aria-label': 'Sections' } }, [
    el(
      'ul',
      {},
      [...links.values()].map((a) => el('li', {}, [a])),
    ),
  ]);

  const sectionElements = list.map(({ id, title, body }) =>
    el('section', { class: 'pf-section', attrs: { id, 'aria-labelledby': `${id}-title` } }, [
      el('h2', { class: 'title pf-section-title', text: title, attrs: { id: `${id}-title` } }),
      bar(),
      body,
    ]),
  );

  const footer = el('footer', { class: 'pf-footer' }, [
    el('p', { text: `© ${new Date().getFullYear()} ${site.name}` }),
    el('a', { class: 'text-link', text: 'Enter the 3D kitchen', attrs: { href: '/' } }),
  ]);

  root.replaceChildren(header, nav, el('main', { class: 'pf-main' }, sectionElements), footer);
  followReading(links, sectionElements);
}

render();
