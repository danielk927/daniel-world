/**
 * The resume, compiled fresh from Daniel's Overleaf project: a Lambda function URL, which CloudFront
 * answers RESUME_PATH from (lib/world-stack.ts), caching it for RESUME_CACHE_SECONDS. Overleaf has no
 * public address for a project's PDF, so this does what its viewer link does in a browser: open the
 * project with the link's token, compile it, and download the PDF. Any failure is a 502, on which
 * CloudFront serves the copy in the site's bucket instead (apps/client/public, as last deployed).
 */

const OVERLEAF = 'https://www.overleaf.com';

/** How long CloudFront keeps a compiled copy before asking Overleaf again. */
export const RESUME_CACHE_SECONDS = 600;

/** The project and token in a viewer link, `https://www.overleaf.com/project/<id>/share#<token>`. */
export function parseShareLink(link: string): { project: string; token: string } {
  const match = /^https:\/\/www\.overleaf\.com\/project\/([0-9a-f]{24})\/share#([0-9a-f]+)$/.exec(
    link,
  );
  if (!match) throw new Error('Not an Overleaf viewer link');
  return { project: match[1]!, token: match[2]! };
}

interface CompileResult {
  status?: string;
  outputFiles?: { path: string; url: string }[];
  pdfDownloadDomain?: string;
  compileGroup?: string;
  clsiServerId?: string;
}

/** The PDF Overleaf compiles now from the project behind the viewer link. */
export async function fetchResume(
  link: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const { project, token } = parseShareLink(link);
  // The session the token is checked into, kept as a browser would; only Overleaf's own pages get it.
  const cookies = new Map<string, string>();
  const call = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (url.startsWith(OVERLEAF) && cookies.size > 0) {
      headers.set('cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    const response = await fetchImpl(url, { ...init, headers, redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0]!;
      const equals = pair.indexOf('=');
      cookies.set(pair.slice(0, equals).trim(), pair.slice(equals + 1).trim());
    }
    if (response.status !== 200)
      throw new Error(`${init.method ?? 'GET'} ${url}: ${response.status}`);
    return response;
  };
  const csrfOf = async (page: Response): Promise<string> => {
    const csrf = /<meta name="ol-csrfToken" content="([^"]+)"/.exec(await page.text())?.[1];
    if (!csrf) throw new Error('No CSRF token on the page');
    return csrf;
  };
  const post = async (url: string, csrf: string, body: unknown): Promise<unknown> => {
    const response = await call(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify(body),
    });
    return response.json();
  };

  const projectUrl = `${OVERLEAF}/project/${project}`;
  const access = (await post(
    `${projectUrl}/share/validate`,
    await csrfOf(await call(`${projectUrl}/share`)),
    {
      token,
    },
  )) as { valid?: boolean };
  if (!access.valid) throw new Error('The viewer link is not valid any more');
  const compile = (await post(
    `${projectUrl}/compile?auto_compile=true`,
    await csrfOf(await call(projectUrl)),
    {
      check: 'silent',
      draft: false,
      incrementalCompilesEnabled: true,
      rootDoc_id: null,
      stopOnFirstError: false,
    },
  )) as CompileResult;
  const pdf = compile.outputFiles?.find((file) => file.path === 'output.pdf');
  if (compile.status !== 'success' || !pdf) {
    throw new Error(`The compile made no PDF (${compile.status ?? 'no status'})`);
  }
  const download = new URL(`${compile.pdfDownloadDomain ?? OVERLEAF}${pdf.url}`);
  if (compile.compileGroup) download.searchParams.set('compileGroup', compile.compileGroup);
  if (compile.clsiServerId) download.searchParams.set('clsiserverid', compile.clsiServerId);
  const bytes = new Uint8Array(await (await call(download.href)).arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('The download is not a PDF');
  }
  return bytes;
}

/** What a function URL answers with. */
interface FunctionUrlResult {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
}

export async function handler(): Promise<FunctionUrlResult> {
  try {
    const pdf = await fetchResume(process.env.OVERLEAF_SHARE_LINK ?? '');
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/pdf',
        // CloudFront keeps it a while; a browser asks again on every visit, as for the bucket's copy.
        'cache-control': `public, max-age=0, s-maxage=${RESUME_CACHE_SECONDS}`,
      },
      body: Buffer.from(pdf).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error('The resume did not come from Overleaf:', error);
    return { statusCode: 502 };
  }
}
