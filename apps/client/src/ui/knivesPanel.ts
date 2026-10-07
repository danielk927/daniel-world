import {
  KNIFE_SKINS,
  SKIN_FINISHES,
  knifeLook,
  sameLook,
  type KnifeFinish,
  type KnifeLook,
  type KnifeSkin,
} from '@world/shared';
import type { Settings } from '../game/settings.ts';
import { FINISHES, finishSwatch } from '../world/knifeFinishes.ts';
import { knifeModel } from '../world/knifeModel.ts';
import { el } from './dom.ts';
import { skinIcon } from './knifeIcon.ts';
import { KnifePreview } from './knifePreview.ts';

/** Knives across the grid; arrow keys move this far up and down. */
const COLUMNS = 4;

/** Names short enough for a tile; the full name heads the preview. */
const TILE_NAMES: Readonly<Record<KnifeSkin, string>> = {
  kitchen: 'Chef’s',
  karambit: 'Karambit',
  butterfly: 'Butterfly',
  m9: 'M9 Bayonet',
  bayonet: 'Bayonet',
  flip: 'Flip',
  huntsman: 'Huntsman',
  falchion: 'Falchion',
  gut: 'Gut',
  talon: 'Talon',
  skeleton: 'Skeleton',
  stiletto: 'Stiletto',
};

/** A strip of a finish, as it is painted along a blade, tip on the left. */
function swatch(finish: KnifeFinish): HTMLCanvasElement {
  const { data, width, height } = finishSwatch(finish);
  const canvas = el('canvas', {
    class: 'finish-swatch',
    attrs: { width: String(width), height: String(height), 'aria-hidden': 'true' },
  });
  const context = canvas.getContext('2d');
  if (context) context.putImageData(new ImageData(data as never, width, height), 0, 0);
  return canvas;
}

/**
 * The Knives tab of the pause menu: every knife in a grid, a live look at the one chosen, its
 * finishes, and Equip, which carries it from the next time the knife is drawn (as the menu closes),
 * for everyone in the room to see.
 */
export class KnivesPanel {
  readonly element: HTMLElement;
  private readonly settings: Settings;
  private readonly preview = new KnifePreview();
  private readonly tiles = new Map<KnifeSkin, HTMLButtonElement>();
  private readonly name = el('h3', { class: 'knives-name' });
  private readonly finishName = el('p', { class: 'knives-finish' });
  private readonly finishes = el('div', {
    class: 'finish-list',
    attrs: { role: 'radiogroup', 'aria-label': 'Finish' },
  });
  private readonly equip = el('button', {
    class: 'button button-primary knives-equip',
    attrs: { type: 'button' },
  });
  private readonly status = el('p', { class: 'knives-status', attrs: { role: 'status' } });
  private readonly swatches = new Map<KnifeFinish, HTMLCanvasElement>();
  /** The knife and finish on show, which Equip would carry. */
  private selected: KnifeLook;
  private active = false;

  constructor(settings: Settings) {
    this.settings = settings;
    this.selected = settings.values.knife;
    const grid = el('div', {
      class: 'knife-grid',
      attrs: { role: 'radiogroup', 'aria-label': 'Knife' },
    });
    KNIFE_SKINS.forEach((skin, i) => {
      const tile = el(
        'button',
        { class: 'knife-tile', attrs: { type: 'button', role: 'radio', 'data-skin': skin } },
        [
          skinIcon(skin),
          el('span', { class: 'knife-tile-name', text: TILE_NAMES[skin] }),
          el('span', { class: 'visually-hidden knife-tile-equipped', text: ', equipped' }),
        ],
      );
      tile.setAttribute('aria-label', knifeModel(skin).name);
      tile.addEventListener('click', () => this.choose(skin));
      tile.addEventListener('keydown', (event) => this.moveInGrid(event, i));
      this.tiles.set(skin, tile);
      grid.append(tile);
    });
    this.equip.addEventListener('click', () => this.equipSelected());
    this.element = el('div', { class: 'pause-panel knives' }, [
      el('div', { class: 'knives-top' }, [
        this.preview.element,
        el('div', { class: 'knives-details' }, [
          el('div', {}, [this.name, this.finishName]),
          this.finishes,
          el('div', { class: 'knives-actions' }, [this.equip, this.status]),
        ]),
      ]),
      grid,
    ]);
    this.render();
  }

  /** The tab is showing (or not): the preview runs only while it is. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      // Back on the page: start from what is equipped.
      this.selected = this.settings.values.knife;
      this.status.textContent = '';
      this.render();
    } else {
      this.preview.stop();
    }
  }

  /** The look on show, for tests. */
  get showing(): KnifeLook {
    return this.selected;
  }

  private choose(skin: KnifeSkin, finish?: KnifeFinish): void {
    const equipped = this.settings.values.knife;
    // A knife comes up in the finish it is equipped in, or its own first.
    const next = knifeLook(skin, finish ?? (equipped.skin === skin ? equipped.finish : undefined));
    if (sameLook(next, this.selected)) return;
    this.selected = next;
    this.status.textContent = '';
    this.render();
  }

  private equipSelected(): void {
    if (sameLook(this.selected, this.settings.values.knife)) return;
    this.settings.set('knife', this.selected);
    this.status.textContent = `${knifeModel(this.selected.skin).name} equipped. It is drawn as you go back in.`;
    this.render();
  }

  /** Arrow keys move through the grid, choosing as they go, like any radio group. */
  private moveInGrid(event: KeyboardEvent, index: number): void {
    const count = KNIFE_SKINS.length;
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      ArrowDown: index + COLUMNS,
      ArrowUp: index - COLUMNS,
      Home: 0,
      End: count - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = KNIFE_SKINS[(target + count) % count]!;
    this.choose(next);
    this.tiles.get(next)?.focus();
  }

  private moveInFinishes(
    event: KeyboardEvent,
    finishes: readonly KnifeFinish[],
    index: number,
  ): void {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = finishes[(index + step + finishes.length) % finishes.length]!;
    this.choose(this.selected.skin, next);
    (this.finishes.children[finishes.indexOf(next)] as HTMLElement | undefined)?.focus();
  }

  private swatchFor(finish: KnifeFinish): HTMLCanvasElement {
    let canvas = this.swatches.get(finish);
    if (!canvas) {
      canvas = swatch(finish);
      this.swatches.set(finish, canvas);
    }
    return canvas;
  }

  private render(): void {
    const { skin, finish } = this.selected;
    const equipped = this.settings.values.knife;
    for (const [tileSkin, tile] of this.tiles) {
      const chosen = tileSkin === skin;
      tile.setAttribute('aria-checked', String(chosen));
      tile.tabIndex = chosen ? 0 : -1;
      const isEquipped = tileSkin === equipped.skin;
      tile.classList.toggle('is-equipped', isEquipped);
      (tile.querySelector('.knife-tile-equipped') as HTMLElement).hidden = !isEquipped;
    }
    this.name.textContent = knifeModel(skin).name;
    this.finishName.textContent = FINISHES[finish].name;

    const finishes = SKIN_FINISHES[skin];
    const focused = this.finishes.contains(document.activeElement);
    this.finishes.replaceChildren(
      ...finishes.map((option, i) => {
        const chosen = option === finish;
        const button = el(
          'button',
          {
            class: 'finish',
            attrs: { type: 'button', role: 'radio', 'aria-checked': String(chosen) },
          },
          [this.swatchFor(option), el('span', { text: FINISHES[option].name })],
        );
        button.tabIndex = chosen ? 0 : -1;
        button.addEventListener('click', () => this.choose(skin, option));
        button.addEventListener('keydown', (event) => this.moveInFinishes(event, finishes, i));
        return button;
      }),
    );
    if (focused) (this.finishes.children[finishes.indexOf(finish)] as HTMLElement).focus();

    const isEquipped = sameLook(this.selected, equipped);
    this.equip.textContent = isEquipped ? 'Equipped' : 'Equip';
    this.equip.setAttribute('aria-disabled', String(isEquipped));

    if (this.active) {
      const still = document.documentElement.classList.contains('reduce-motion');
      this.preview.show(this.selected, still);
    }
  }
}
