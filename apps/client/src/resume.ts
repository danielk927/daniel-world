/**
 * The resume: a PDF kept in `public/`, so the build copies it to the site's root as it is. It is
 * the plain way to read about Daniel without the 3D world, and every way into it (the landing, the
 * pause menu, the phone and no-WebGL paths, the no-JavaScript page in `index.html`) points here.
 */

/**
 * Where it is served. The name is the one a visitor's downloaded copy gets, so it says whose resume
 * it is, with nothing in it that a URL would have to escape. A new resume replaces the file under
 * the same name: it is revalidated on every visit, never cached for good like `assets/`.
 */
export const RESUME_URL = '/Doyoon-Kim-resume.pdf';

/**
 * What every link to it says: a document, and which kind, so nobody is surprised by a PDF viewer.
 * A verb leads, since the pause menu's own "Resume" puts the game back, and this does not.
 */
export const RESUME_LABEL = 'View the resume (PDF)';

/**
 * The link's attributes. A page with something to keep, a world and the cook in it, opens the PDF
 * in a tab of its own, `noopener` so the tab it opens cannot reach back. Where the PDF is the way
 * in (no WebGL, no JavaScript, a failed load, or a phone, where the kitchen has no touch controls)
 * there is nothing to come back to, so it goes there in place, and Back returns.
 */
export function resumeAttrs(newTab: boolean): Record<string, string> {
  return newTab ? { href: RESUME_URL, target: '_blank', rel: 'noopener' } : { href: RESUME_URL };
}
