import { describe, expect, it } from 'vitest';
import { STATIONS } from '@world/shared';
import { dishes, lore, site, stations, type LoreItem } from './content.ts';

/** Every piece of text on the site, so a failure names the line at fault. */
function texts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  if (value && typeof value === 'object') return Object.values(value).flatMap(texts);
  return [];
}
const everything = texts({ site, lore, stations, dishes });

function noneMatch(pattern: RegExp): void {
  expect(everything.filter((text) => pattern.test(text))).toEqual([]);
}

describe('content', () => {
  it('never publishes the graduation date or the phone number', () => {
    noneMatch(/\bgraduat|\bexpected|\bclass of|['\u2019]\d\d\b/i);
    // No year after this one: the only future date on the resume is the graduation.
    noneMatch(/\b20(2[7-9]|[3-9]\d)\b/);
    noneMatch(/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
  });

  it('has no placeholder text left', () => {
    noneMatch(/example\.com|placeholder|Project Two|Role, Organization/i);
  });

  it('uses no em dashes', () => {
    noneMatch(/\u2014/);
  });

  it('names the station and what it holds on every station', () => {
    const titles = new Set<string>();
    for (const { id } of STATIONS) {
      const entry = stations[id];
      expect(entry.station, id).toBeTruthy();
      expect(entry.kicker.startsWith(`${entry.station} · `), id).toBe(true);
      expect(entry.title, id).not.toBe(entry.station);
      titles.add(entry.title);
    }
    expect(titles.size, 'every station holds something different').toBe(STATIONS.length);
  });

  it('names no French station in the panels, only the sections', () => {
    const french =
      /\b(le passe|saucier|poissonnier|r[oô]tisseur|entremetier|garde.manger|p[aâ]tisserie|plonge)\b/i;
    const panels = [...Object.values(stations), ...Object.values(dishes)].flatMap((entry) =>
      texts({ title: entry.title, paragraphs: entry.paragraphs, items: entry.items }),
    );
    expect(panels.filter((text) => french.test(text))).toEqual([]);
  });

  it('puts everything the stations hold on the portfolio page too', () => {
    const onPage = new Set<LoreItem>(lore.flatMap((entry) => entry.items ?? []));
    const pageTags = new Set(lore.flatMap((entry) => entry.tags ?? []));
    const pageLinks = new Set(lore.flatMap((entry) => entry.links ?? []).map((l) => l.href));
    for (const { id } of STATIONS) {
      // The pass lists the dishes on it, which have panels of their own.
      if (id === 'passe') continue;
      const entry = stations[id];
      for (const item of entry.items ?? []) expect(onPage.has(item), item.title).toBe(true);
      for (const tag of entry.tags ?? []) expect(pageTags.has(tag), tag).toBe(true);
      for (const link of entry.links ?? []) expect(pageLinks.has(link.href), link.href).toBe(true);
    }
  });

  it('links to Daniel by email, LinkedIn and GitHub', () => {
    expect(site.links.map((l) => l.href)).toEqual([
      'mailto:dkim927@uchicago.edu',
      'https://www.linkedin.com/in/doyoondanielkim',
      'https://github.com/danielk927',
    ]);
  });
});
