import './styles/portfolio.css';

/*
 * The portfolio page is written into portfolio.html at build time (`portfolioPage.ts`), so it is
 * whole without JavaScript. Here it only follows the reading in the list of sections.
 */

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

const links = new Map(
  [...document.querySelectorAll<HTMLAnchorElement>('.pf-nav a[href^="#"]')].map((a) => [
    a.hash.slice(1),
    a,
  ]),
);
followReading(links, [...document.querySelectorAll<HTMLElement>('.pf-section')]);
