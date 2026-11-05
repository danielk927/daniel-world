/**
 * Controls the loading screen in index.html. It shows only if the visitor asks for the game before
 * the kitchen behind the intro is ready.
 */
export const loading = {
  show(): void {
    const root = document.getElementById('loading');
    if (root) root.hidden = false;
  },
  setText(text: string): void {
    const node = document.querySelector('#loading .loading-text');
    if (node) node.textContent = text;
  },
  setProgress(fraction: number): void {
    const fill = document.querySelector<HTMLElement>('#loading .loading-bar-fill');
    if (fill) fill.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
  },
  hide(): void {
    const root = document.getElementById('loading');
    if (!root) return;
    root.classList.add('is-done');
    root.addEventListener('transitionend', () => root.remove(), { once: true });
    // In case transitions are disabled (reduced motion).
    setTimeout(() => root.remove(), 1200);
  },
};
