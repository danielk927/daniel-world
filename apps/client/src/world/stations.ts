import { Color, Group, PointLight, Vector3, type Ray } from 'three';
import { STATIONS } from '@world/shared';
import type { LoreEntry, StationContent } from '../content.ts';

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
}

/**
 * The clickable stations. Their centerpieces are part of the static kitchen; this class only knows
 * where they are, which one is under the crosshair, and fades a colored light onto the hovered one.
 */
export class Stations {
  readonly group = new Group();
  private readonly objects: StationObject[];
  /** One light, moved to whichever station is hovered, so the cost never grows with stations. */
  private readonly light = new PointLight('#ffffff', 0, 1.5, 1.5);
  private lit = -1;
  private highlight = 0;
  private hovered = -1;
  private readonly toCenter = new Vector3();

  /** `lit` adds the hover light; software renderers go without it and rely on the label alone. */
  constructor(content: StationContent, lit: boolean) {
    this.group.name = 'stations';
    this.objects = STATIONS.map((station) => {
      const entry = content[station.id];
      const center = new Vector3(station.x, station.y, station.z);
      return { entry, center, radius: station.radius, color: new Color(entry.color) };
    });
    if (lit) this.group.add(this.light);
  }

  get hoveredEntry(): LoreEntry | null {
    return this.objects[this.hovered]?.entry ?? null;
  }

  /** World position of each station's centerpiece, for labels. */
  anchor(index: number): Vector3 | null {
    return this.objects[index]?.center ?? null;
  }

  get entries(): readonly LoreEntry[] {
    return this.objects.map((o) => o.entry);
  }

  /** Find the station under the crosshair, if any is close enough. Allocation free. */
  pick(ray: Ray): number {
    let best = -1;
    let bestDistance = PICK_DISTANCE;
    for (let i = 0; i < this.objects.length; i++) {
      const o = this.objects[i]!;
      this.toCenter.subVectors(o.center, ray.origin);
      const along = this.toCenter.dot(ray.direction);
      if (along < 0 || along > bestDistance) continue;
      const perpendicular2 = this.toCenter.lengthSq() - along * along;
      if (perpendicular2 <= o.radius * o.radius) {
        best = i;
        bestDistance = along;
      }
    }
    return best;
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
