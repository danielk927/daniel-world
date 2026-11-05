/**
 * Refresh the resume PDF in apps/client/public from Overleaf. The site serves Overleaf's latest
 * through CloudFront (infra/resume); this copy is what it falls back to, and what local builds and
 * the tests serve. OVERLEAF_SHARE_LINK is the project's viewer link (kept out of the repo).
 *
 *   OVERLEAF_SHARE_LINK='https://www.overleaf.com/project/<id>/share#<token>' node scripts/resume-from-overleaf.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RESUME_URL } from '../apps/client/src/resume.ts';
import { fetchResume } from '../infra/resume/index.ts';

const link = process.env.OVERLEAF_SHARE_LINK;
if (!link) throw new Error('Set OVERLEAF_SHARE_LINK to the Overleaf viewer link');
const pdf = await fetchResume(link);
const file = resolve(import.meta.dirname, '../apps/client/public', RESUME_URL.slice(1));
writeFileSync(file, pdf);
console.log(`Wrote ${pdf.length} bytes to ${file}`);
