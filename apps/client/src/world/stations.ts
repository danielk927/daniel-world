import { Color, Group, PointLight, Vector3, type Ray } from 'three';
import { PASS_DISHES, STATIONS } from '@world/shared';
import type { DishContent, LoreEntry, StationContent } from '../content.ts';

/** Stations can be clicked from up to this far away. */
export const PICK_DISTANCE = 10;
/** The hovered station is lit by a small light of its own color, just above the centerpiece. */
const LIGHT_INTENSITY = 1.1;
const LIGHT_HEIGHT = 0.55;

interface StationObject {
  readonly entry: LoreEntry;
  readonly center: Vector3;
  readonly radius: number;
  readonly color: Color;
  /** The station a dish sits in (its index), or -1. A dish under the crosshair wins over it. */
  readonly parent: number;
}

/**
 * The clickable stations, and the dishes on the pass. Their models are part of the static kitchen;
 * this class only knows where they are, which one is under the crosshair, and fades a colored light
 * onto the hovered one. Stations come first, so their indices match `STATIONS`; dishes follow.
 */
export class Stations {
  readonly group = new Group();
  private readonly objects: StationObject[];
  private readonly stationCount: number;
  /** Scratch for `pick`: whether a dish inside each object was hit this time. */
  private readonly childHit: Uint8Array;
  /** One light, moved to whichever station is hovered, so the cost never grows with stations. */
  private readonly light = new PointLight('#ffffff', 0, 1.5, 1.5);
  private lit = -1;
  private highlight = 0;
  private hovered = -1;
  private readonly toCenter = new Vector3();

  /** `lit` adds the hover light; software renderers go without it and rely on the label alone. */
  constructor(content: StationContent, dishes: DishContent, lit: boolean) {
    this.group.name = 'stations';
    const object = (
      entry: LoreEntry,
      at: { x: number; y: number; z: number; radius: number },
      parent: number,
    ): StationObject => ({
      entry,
      center: new Vector3(at.x, at.y, at.z),
      radius: at.radius,
      color: new Color(entry.color),
      parent,
    });
    const pass = STATIONS.findIndex((station) => station.id === 'passe');
    this.objects = [
      ...STATIONS.map((station) => object(content[station.id], station, -1)),
      ...PASS_DISHES.map((dish) => object(dishes[dish.id], dish, pass)),
    ];
    this.stationCount = STATIONS.length;
    this.childHit = new Uint8Array(this.objects.length);
    if (lit) this.group.add(this.light);
  }

  get hoveredEntry(): LoreEntry | null {
    return this.entryAt(this.hovered);
  }

  /** The entry of a station or dish by the index `pick` returns. */
  entryAt(index: number): LoreEntry | null {
    return this.objects[index]?.entry ?? null;
  }

  /** World position of each station's centerpiece, for labels. */
  anchor(index: number): Vector3 | null {
    return this.objects[index]?.center ?? null;
  }

  /** The stations only, in layout order: what the labels and the minimap show. */
  get entries(): readonly LoreEntry[] {
    return this.objects.slice(0, this.stationCount).map((o) => o.entry);
  }

  /**
   * Find the station or dish under the crosshair, if any is close enough. A dish beats the station
   * it sits in; otherwise the nearest wins. Allocation free.
   */
  pick(ray: Ray): number {
    this.childHit.fill(0);
    for (let i = this.stationCount; i < this.objects.length; i++) {
      const o = this.objects[i]!;
      if (o.parent >= 0 && this.hits(ray, o, PICK_DISTANCE) >= 0) this.childHit[o.parent] = 1;
    }
    let best = -1;
    let bestDistance = PICK_DISTANCE;
    for (let i = 0; i < this.objects.length; i++) {
      if (this.childHit[i]) continue;
      const along = this.hits(ray, this.objects[i]!, bestDistance);
      if (along >= 0) {
        best = i;
        bestDistance = along;
      }
    }
    return best;
  }

  /** How far along the ray it passes the object's center, if within its radius and reach; else -1. */
  private hits(ray: Ray, o: StationObject, reach: number): number {
    this.toCenter.subVectors(o.center, ray.origin);
    const along = this.toCenter.dot(ray.direction);
    if (along < 0 || along > reach) return -1;
    const perpendicular2 = this.toCenter.lengthSq() - along * along;
    return perpendicular2 <= o.radius * o.radius ? along : -1;
  }

  setHovered(index: number): void {
    this.hovered = index;
  }

  update(dt: number): void {
    const ease = 1 - Math.exp(-dt * 12);
    // Fade out before moving to a newly hovered station, then fade in there.
    if (this.hovered !== this.lit && this.highlight < 0.02 && this.hovered >= 0) {
      const o = this.objects[this.hovered]!;
      this.lit = this.hovered;
      this.light.color.copy(o.color);
      this.light.position.copy(o.center).y += LIGHT_HEIGHT;
    }
    const target = this.hovered >= 0 && this.hovered === this.lit ? 1 : 0;
    this.highlight += (target - this.highlight) * ease;
    if (Math.abs(target - this.highlight) < 1e-3) this.highlight = target;
    this.light.intensity = this.highlight * LIGHT_INTENSITY;
  }
}
