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

  it('is the link the intro has in the page, for visitors without JavaScript too, in the same words', () => {
    const page = readFileSync(clientFile('index.html'), 'utf8');
    const link = /<a\s[^>]*class="[^"]*\bintro-resume\b[^"]*"[^>]*>\s*([^<]*?)\s*<\/a>/.exec(page);
    expect(link, 'the resume link on the intro').not.toBeNull();
    expect(/href="([^"]*)"/.exec(link![0])?.[1]).toBe(RESUME_URL);
    expect(link![1]).toBe(RESUME_LABEL);
  });

  it('is where a link saved to the old portfolio page goes, and Vercel sends it to the live copy', () => {
    const { redirects } = JSON.parse(readFileSync(repoFile('vercel.json'), 'utf8')) as {
      redirects?: { source: string; destination: string; permanent?: boolean }[];
    };
    // The old page: permanent (a 308), to the PDF, for that one path. The PDF itself: to the AWS
    // site, whose copy is compiled from Overleaf, where Vercel would serve the one in the repo;
    // temporary, as it is only where the live copy is for now.
    expect(redirects).toHaveLength(2);
    expect(redirects![0]).toEqual({
      source: '/portfolio.html',
      destination: RESUME_URL,
      permanent: true,
    });
    expect(redirects![1]).toMatchObject({ source: RESUME_URL, permanent: false });
    expect(redirects![1]!.destination).toMatch(
      new RegExp(`^https://[a-z0-9]+\\.cloudfront\\.net${RESUME_URL}$`),
    );
  });
});
