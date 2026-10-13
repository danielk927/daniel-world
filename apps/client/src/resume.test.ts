import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RESUME_LABEL, RESUME_URL, resumeAttrs } from './resume.ts';

const clientFile = (path: string): URL => new URL(`../${path}`, import.meta.url);
const repoFile = (path: string): URL => new URL(`../../../${path}`, import.meta.url);

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

  it('is called a PDF by every link to it, and not "Resume" alone, read as back to the game', () => {
    expect(RESUME_LABEL).toMatch(/\(PDF\)$/);
    expect(RESUME_LABEL).not.toBe('Resume');
  });

  it('opens in a tab of its own that cannot reach back, or in place, as the page asks', () => {
    expect(resumeAttrs(true)).toEqual({ href: RESUME_URL, target: '_blank', rel: 'noopener' });
    expect(resumeAttrs(false)).toEqual({ href: RESUME_URL });
  });

  it('is the link the page without JavaScript has, in the same words', () => {
    const page = readFileSync(clientFile('index.html'), 'utf8');
    // The noscript block that holds the landing, not the one in the head that only hides the loading bar.
    const noscript = [...page.matchAll(/<noscript>[\s\S]*?<\/noscript>/g)].find((block) =>
      block[0].includes('<a'),
    );
    expect(noscript, 'the no-JavaScript landing').toBeDefined();
    const link = /<a\s[^>]*href="([^"]*)"[^>]*>\s*([^<]*?)\s*<\/a>/.exec(noscript![0]);
    expect(link?.[1]).toBe(RESUME_URL);
    expect(link?.[2]).toBe(RESUME_LABEL);
  });

  it('is where a link saved to the old portfolio page goes, on Vercel as on AWS', () => {
    const { redirects } = JSON.parse(readFileSync(repoFile('vercel.json'), 'utf8')) as {
      redirects?: { source: string; destination: string; permanent?: boolean }[];
    };
    // Permanent (a 308), to the PDF, for that one path.
    expect(redirects).toEqual([
      { source: '/portfolio.html', destination: RESUME_URL, permanent: true },
    ]);
  });
});
