import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATIONS } from '@world/shared';
import { dishes, site, stations } from './content.ts';

/** Every piece of text on the site, so a failure names the line at fault. */
function texts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  if (value && typeof value === 'object') return Object.values(value).flatMap(texts);
  return [];
}
const everything = texts({ site, stations, dishes });

function noneMatch(pattern: RegExp): void {
  expect(everything.filter((text) => pattern.test(text))).toEqual([]);
}

/** A lossy WebP's size in pixels, from its VP8 frame header. */
function webpSize(file: Buffer): { width: number; height: number } {
  expect(file.toString('latin1', 12, 16), 'a lossy WebP').toBe('VP8 ');
  return { width: file.readUInt16LE(26) & 0x3fff, height: file.readUInt16LE(28) & 0x3fff };
}

describe('content', () => {
  it('never publishes the graduation date or the phone number', () => {
    // "Graduated" is allowed: it is about high school, done; the date kept back is the next one.
    noneMatch(/\bgraduat(e|es|ing|ion)\b|\bexpected|\bclass of|['\u2019]\d\d\b/i);
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

  it('gives every station a section of its own', () => {
    const titles = new Set<string>();
    for (const { id } of STATIONS) {
      expect(stations[id].id, id).toBe(id);
      titles.add(stations[id].title);
    }
    expect(titles.size, 'every station holds something different').toBe(STATIONS.length);
  });

  it('says where every dish is from', () => {
    for (const dish of Object.values(dishes)) expect(dish.place, dish.id).toBeTruthy();
  });

  it("gives every photo its file's own size, so the panel shows it whole in its own shape", () => {
    for (const { id, image } of Object.values(dishes)) {
      if (!image) continue;
      // The import is the file's path from the client's root.
      const file = readFileSync(new URL(`..${image.src}`, import.meta.url));
      expect({ width: image.width, height: image.height }, id).toEqual(webpSize(file));
    }
  });

  it('names no French station in the panels, only the sections', () => {
    const french =
      /\b(le passe|saucier|poissonnier|r[oô]tisseur|entremetier|garde.manger|p[aâ]tisserie|plonge)\b/i;
    const panels = [...Object.values(stations), ...Object.values(dishes)].flatMap((entry) =>
      texts({ title: entry.title, paragraphs: entry.paragraphs, items: entry.items }),
    );
    expect(panels.filter((text) => french.test(text))).toEqual([]);
  });

  it('links to Daniel by email, LinkedIn and GitHub', () => {
    expect((stations.plonge.links ?? []).map((l) => l.href)).toEqual([
      'mailto:dkim927@uchicago.edu',
      'https://www.linkedin.com/in/doyoondanielkim',
      'https://github.com/danielk927',
    ]);
  });
});
