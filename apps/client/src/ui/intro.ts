import { resumeAttrs } from '../resume.ts';

/**
 * The first screen, which is in index.html so it shows before any script runs: Daniel's name,
 * what he studies and what he has done, the resume, and the game, which is built behind it while
 * the visitor reads (main.ts). Without scripts it is all the site shows, the resume opening in place.
 */
export class Intro {
  private readonly root: HTMLElement;
  private readonly resume: HTMLAnchorElement;
  private readonly play: HTMLButtonElement;
  private readonly note: HTMLElement;

  constructor(root: HTMLElement, onPlay: () => void) {
    this.root = root;
    this.resume = root.querySelector('.intro-resume')!;
    this.play = root.querySelector('.intro-play')!;
    this.note = root.querySelector('.intro-note')!;
    // Hidden in the page, since it does nothing without scripts.
    this.play.hidden = false;
    this.play.addEventListener('click', onPlay);
    root.addEventListener('transitionend', (event) => {
      if (event.target === root && root.classList.contains('is-done')) root.hidden = true;
    });
  }

  /** The kitchen loads behind the intro: the resume opens in a tab of its own, leaving it be. */
  keepForResume(): void {
    for (const [name, value] of Object.entries(resumeAttrs(true))) {
      this.resume.setAttribute(name, value);
    }
  }

  /**
   * A phone or tablet: the resume is the main action, the game a quiet second choice for a tablet
   * with a keyboard.
   */
  suggestResume(message: string): void {
    this.setNote(message);
    this.makeResumeTheWayIn();
  }

  /** The kitchen cannot run here, or did not load: the resume is the way in, saying why. */
  unavailable(message: string): void {
    this.setNote(message);
    this.play.hidden = true;
    this.makeResumeTheWayIn();
  }

  show(): void {
    this.root.classList.remove('is-done');
    this.root.hidden = false;
  }

  /** Fade out, over the kitchen and the landing coming in. */
  hide(): void {
    this.root.classList.add('is-done');
  }

  private setNote(message: string): void {
    this.note.textContent = message;
    this.note.hidden = false;
  }

  /**
   * With nothing to come back to, the resume opens in place, and Back returns; it takes the bar
   * and the focus, so Enter goes there.
   */
  private makeResumeTheWayIn(): void {
    this.resume.removeAttribute('target');
    this.resume.removeAttribute('rel');
    this.resume.classList.add('button-primary');
    this.resume.focus({ preventScroll: true, focusVisible: false });
  }
}
