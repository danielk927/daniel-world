import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dishes, lore, site } from './content.ts';
import { PORTFOLIO_TITLE, renderPortfolio } from './portfolioPage.ts';
import { escapeHtml } from './ui/markup.ts';

const template = readFileSync(new URL('../portfolio.html', import.meta.url), 'utf8');
const page = renderPortfolio(template);

describe('the portfolio page as the build writes it', () => {
  it('is titled with the name the site goes by', () => {
    expect(PORTFOLIO_TITLE).toBe(`${site.name} - Portfolio`);
    expect(page).toContain(`<title>${escapeHtml(PORTFOLIO_TITLE)}</title>`);
    expect(page).toMatch(/<meta name="description" content="[^"]+"/);
    expect(page.match(/<title>/g)).toHaveLength(1);
  });

  it('has every section, with its words, before any script runs', () => {
    for (const entry of lore) {
      expect(page, entry.id).toContain(`id="${entry.id}"`);
      expect(page, entry.id).toContain(`>${escapeHtml(entry.title)}</h2>`);
      for (const paragraph of entry.paragraphs ?? []) {
        expect(page, entry.id).toContain(escapeHtml(paragraph));
      }
      for (const item of entry.items ?? []) {
        expect(page, item.title).toContain(escapeHtml(item.title));
      }
    }
  });

  it('has every dish with its photo', () => {
    for (const dish of Object.values(dishes)) {
      expect(page, dish.id).toContain(escapeHtml(dish.title));
      expect(page, dish.id).toContain(`src="${dish.image!.src}"`);
      expect(page, dish.id).toContain(`alt="${escapeHtml(dish.image!.alt)}"`);
    }
  });

  it('says on paper where each link off the page goes', () => {
    expect(page).toContain('data-print="dkim927@uchicago.edu"');
    expect(page).toContain('data-print="github.com/danielk927"');
  });

  it('keeps the rest of the page as it was, and asks for its markers', () => {
    expect(page).not.toContain('portfolio:head');
    expect(page).not.toContain('portfolio:body');
    expect(page).toContain('<script type="module" src="/src/portfolio.ts"></script>');
    expect(() => renderPortfolio('<html></html>')).toThrow(/portfolio:head/);
  });
});
