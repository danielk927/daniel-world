import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESUME_CACHE_SECONDS, fetchResume, handler, parseShareLink } from '../resume/index.ts';

const PROJECT = '68bf24e6e8b55c9934a55fb8';
const TOKEN = '2c37f48c39f227ff';
const LINK = `https://www.overleaf.com/project/${PROJECT}/share#${TOKEN}`;
const PDF = new TextEncoder().encode('%PDF-1.5 a resume');

/**
 * Overleaf, as the viewer link meets it in a browser: the invite page sets a session and a CSRF
 * token, the token is checked into that session, the project page has a new CSRF token, the compile
 * names its PDF, and the PDF is downloaded from another host. Records every request it got.
 */
function fakeOverleaf(): {
  fetch: typeof fetch;
  requests: { url: string; cookie: string | null }[];
} {
  const requests: { url: string; cookie: string | null }[] = [];
  const page = (csrf: string, cookie?: string): Response =>
    new Response(`<meta name="ol-csrfToken" content="${csrf}">`, {
      headers: cookie ? { 'set-cookie': `${cookie}; Path=/; HttpOnly` } : {},
    });
  const respond = (input: string | URL | Request, init?: RequestInit): Response => {
    const url = input instanceof Request ? input.url : input.toString();
    const headers = new Headers(init?.headers);
    requests.push({ url, cookie: headers.get('cookie') });
    const project = `https://www.overleaf.com/project/${PROJECT}`;
    if (url === `${project}/share`) return page('invite', 'session=a');
    if (url === `${project}/share/validate`) {
      expect(headers.get('x-csrf-token')).toBe('invite');
      expect(JSON.parse(init?.body as string)).toEqual({ token: TOKEN });
      return Response.json({ valid: true, redirect: true });
    }
    if (url === project) return page('editor');
    if (url === `${project}/compile?auto_compile=true`) {
      expect(headers.get('x-csrf-token')).toBe('editor');
      return Response.json({
        status: 'success',
        outputFiles: [{ path: 'output.pdf', url: `/project/${PROJECT}/build/1/output/output.pdf` }],
        pdfDownloadDomain: 'https://compiles.example',
        compileGroup: 'standard',
        clsiServerId: 'clsi-1',
      });
    }
    if (url.startsWith('https://compiles.example/')) return new Response(PDF);
    return new Response('not found', { status: 404 });
  };
  const fake: typeof fetch = (input, init) => Promise.resolve(respond(input, init));
  return { fetch: fake, requests };
}

describe('the resume from Overleaf', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('takes the project and the token from a viewer link, and nothing else', () => {
    expect(parseShareLink(LINK)).toEqual({ project: PROJECT, token: TOKEN });
    expect(() => parseShareLink(`https://www.overleaf.com/read/${TOKEN}`)).toThrow();
  });

  it('opens the project with the token, compiles it, and downloads the PDF', async () => {
    const overleaf = fakeOverleaf();
    expect(await fetchResume(LINK, overleaf.fetch)).toEqual(PDF);
    // The session goes to Overleaf's own pages once it has one, never to the host of the download.
    expect(overleaf.requests.map((r) => r.cookie)).toEqual([
      null,
      'session=a',
      'session=a',
      'session=a',
      null,
    ]);
    expect(overleaf.requests.at(-1)!.url).toBe(
      `https://compiles.example/project/${PROJECT}/build/1/output/output.pdf?compileGroup=standard&clsiserverid=clsi-1`,
    );
  });

  it('answers with the PDF for CloudFront to keep a while, or a 502 for it to serve its own copy', async () => {
    vi.stubGlobal('fetch', fakeOverleaf().fetch);
    vi.stubEnv('OVERLEAF_SHARE_LINK', LINK);
    const served = await handler();
    expect(served).toMatchObject({
      statusCode: 200,
      headers: {
        'content-type': 'application/pdf',
        'cache-control': `public, max-age=0, s-maxage=${RESUME_CACHE_SECONDS}`,
      },
      isBase64Encoded: true,
    });
    expect(Buffer.from(served.body!, 'base64')).toEqual(Buffer.from(PDF));

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('busy', { status: 503 })));
    expect(await handler()).toEqual({ statusCode: 502 });
  });
});
