import { PointLight, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { STATIONS } from '@world/shared';
import { stations } from '../content.ts';
import { PICK_DISTANCE, Stations } from './stations.ts';

function rayAt(from: Vector3, to: Vector3): Ray {
  return new Ray(from, to.clone().sub(from).normalize());
}

function station(id: string): Vector3 {
  const s = STATIONS.find((st) => st.id === id)!;
  return new Vector3(s.x, s.y, s.z);
}

describe('Stations', () => {
  it('has content for every station, in layout order', () => {
    const s = new Stations(stations, false);
    expect(s.entries.map((e) => e.id)).toEqual(STATIONS.map((st) => st.id));
  });

  it('picks the station under the crosshair, nearest first', () => {
    const s = new Stations(stations, false);
    // Standing at the entremetier, looking straight across the piano at the saucier behind it.
    const eye = new Vector3(-2.6, 1.62, 1.8);
    const ray = rayAt(eye, new Vector3(-2.6, 1.4, -2));
    expect(s.entries[s.pick(ray)]!.id).toBe('entremetier');
    expect(s.pick(rayAt(eye, new Vector3(-2.6, 5, 1.8)))).toBe(-1);
  });

  it('does not pick stations beyond reach', () => {
    const s = new Stations(stations, false);
    const target = station('plonge');
    const far = target.clone().add(new Vector3(0, 0, PICK_DISTANCE + 1));
    expect(s.pick(rayAt(far, target))).toBe(-1);
    const near = target.clone().add(new Vector3(0, 0, PICK_DISTANCE - 1));
    expect(s.entries[s.pick(rayAt(near, target))]!.id).toBe('plonge');
  });

  it('fades its light out before moving it to a newly hovered station', () => {
    const s = new Stations(stations, true);
    const light = s.group.children.find((c): c is PointLight => c instanceof PointLight)!;
    s.setHovered(0);
    for (let i = 0; i < 60; i++) s.update(1 / 60);
    expect(light.intensity).toBeGreaterThan(1);
    expect(light.position.x).toBeCloseTo(STATIONS[0]!.x);

    s.setHovered(1);
    s.update(1 / 60);
    // Still at the old station while it dims.
    expect(light.position.x).toBeCloseTo(STATIONS[0]!.x);
    for (let i = 0; i < 120; i++) s.update(1 / 60);
    expect(light.position.x).toBeCloseTo(STATIONS[1]!.x);
    expect(light.color.getHexString()).toBe(stations[STATIONS[1]!.id].color.slice(1));

    s.setHovered(-1);
    for (let i = 0; i < 120; i++) s.update(1 / 60);
    expect(light.intensity).toBe(0);
  });

  it('adds no light on renderers that skip it', () => {
    const s = new Stations(stations, false);
    expect(s.group.children.some((c) => c instanceof PointLight)).toBe(false);
  });
});
