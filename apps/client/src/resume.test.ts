import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RESUME_LABEL, RESUME_URL, resumeAttrs } from './resume.ts';

const clientFile = (path: string): URL => new URL(`../${path}`, import.meta.url);

describe('the resume', () => {
  it('is a PDF in public/, which the build copies to the site root under the same name', () => {
    const file = readFileSync(clientFile(`public${RESUME_URL}`));
    expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // A whole file: its last line is the end marker, not a download cut short.
    expect(file.subarray(-1024).toString('latin1')).toContain('%%EOF');
  });

  it('has a name that is the same in a URL and in a downloaded copy', () => {
    expect(RESUME_URL).toMatch(/^\/[A-Za-z0-9]+(-[A-Za-z0-9]+)*\.pdf$/);
  });

  it('is called a PDF by every link to it, and not "Resume" alone, which puts the game back', () => {
    expect(RESUME_LABEL).toMatch(/\(PDF\)$/);
    expect(RESUME_LABEL).not.toBe('Resume');
  });

  it('opens in a tab of its own that cannot reach back, or in place, as the page asks', () => {
    expect(resumeAttrs(true)).toEqual({ href: RESUME_URL, target: '_blank', rel: 'noopener' });
    expect(resumeAttrs(false)).toEqual({ href: RESUME_URL });
  });

  it('is the link the page without JavaScript has, in the same words', () => {
    const page = readFileSync(clientFile('index.html'), 'utf8');
    const noscript = /<noscript>\s*<!--[\s\S]*?-->\s*<section[\s\S]*?<\/noscript>/.exec(page)?.[0];
    expect(noscript, 'the no-JavaScript landing').toBeDefined();
    const link = /<a\s[^>]*href="([^"]*)"[^>]*>\s*([^<]*?)\s*<\/a>/.exec(noscript!);
    expect(link?.[1]).toBe(RESUME_URL);
    expect(link?.[2]).toBe(RESUME_LABEL);
  });
});
