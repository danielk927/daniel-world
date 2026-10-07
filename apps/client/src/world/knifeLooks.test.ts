import { Matrix4, type InstancedMesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, launchKnife, type StuckKnife } from '@world/shared';
import { Avatars } from './avatars.ts';
import { KnifeBatches, lookIndex } from './knifeBatches.ts';
import { knifeGeometry } from './knifeModel.ts';
import { Knives } from './knives.ts';

const DOWN = -Math.PI / 2 + 0.01;
const intoFloor = (x = 0) => launchKnife(x, 1.6, 2.6, 0, DOWN);
const stuck = (id: number, look: Partial<StuckKnife> = {}): StuckKnife => ({
  id,
  x: id * 0.1,
  y: -0.04,
  z: 2.6,
  dx: 0,
  dy: -1,
  dz: 0,
  ...look,
});

function run(knives: Knives, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) knives.update(1 / 60, []);
}

/** The meshes under `root` that are drawn, with how many instances each. */
function drawn(root: Object3D): Record<string, number> {
  const out: Record<string, number> = {};
  for (const child of root.children) {
    const mesh = child as InstancedMesh;
    if (mesh.visible && mesh.count > 0) out[mesh.name] = mesh.count;
  }
  return out;
}

describe('knives of every look', () => {
  it('each go to the instanced mesh of their own look, one per look', () => {
    const knives = new Knives();
    knives.throwOwn(0, 1, intoFloor(0), false, undefined, { skin: 'karambit', finish: 'fade' });
    knives.throwOwn(1, 1, intoFloor(0.4), false, undefined, { skin: 'karambit', finish: 'fade' });
    knives.launch(7, 2, 0, intoFloor(0.8), false, 0, { skin: 'butterfly', finish: 'web' });
    knives.launch(8, 3, 0, intoFloor(1.2), false, 0);
    run(knives, 1 / 30);
    expect(knives.drawnLooks()).toEqual({
      'karambit/fade': 2,
      'butterfly/web': 1,
      'kitchen/stock': 1,
    });
    expect(drawn(knives.group)).toEqual({
      'knives:karambit/fade': 2,
      'knives:butterfly/web': 1,
      'knives:kitchen/stock': 1,
    });
  });

  it('stick as they were thrown, and the server’s stuck knives keep their look', () => {
    const knives = new Knives();
    knives.throwOwn(0, 1, intoFloor(), false, undefined, { skin: 'gut', finish: 'case' });
    run(knives, 0.5);
    expect(knives.stuckCount).toBe(1);
    expect(knives.drawnLooks()).toEqual({ 'gut/case': 1 });
    knives.reset([
      stuck(1, { skin: 'm9', finish: 'tiger' }),
      stuck(2),
      // A look from a newer version, or nonsense: the chef's knife.
      stuck(3, { skin: 'lightsaber' as never, finish: 'fade' }),
      // A finish the knife does not come in: its own first.
      stuck(4, { skin: 'talon', finish: 'damascus' }),
    ]);
    run(knives, 1 / 30);
    expect(knives.drawnLooks()).toEqual({
      'm9/tiger': 1,
      'kitchen/stock': 2,
      'talon/marble': 1,
    });
  });

  it('take a flight’s look from the server’s verdict when it lands', () => {
    const knives = new Knives();
    knives.launch(5, 2, 0, intoFloor(), false, 0, { skin: 'flip', finish: 'doppler' });
    knives.resolve(5, {
      kind: 'stuck',
      knife: stuck(5, { skin: 'flip', finish: 'doppler' }),
      at: 0.1,
    });
    run(knives, 0.5);
    expect(knives.flyingCount).toBe(0);
    expect(knives.drawnLooks()).toEqual({ 'flip/doppler': 1 });
  });

  it('cost no draw call for a look nobody is drawing', () => {
    const knives = new Knives();
    knives.throwOwn(0, 1, intoFloor(), false, undefined, { skin: 'skeleton', finish: 'web' });
    run(knives, 1 / 30);
    knives.reset([]);
    run(knives, 1 / 30);
    expect(drawn(knives.group)).toEqual({});
    expect(knives.group.children.every((c) => !c.visible)).toBe(true);
  });
});

describe('KnifeBatches', () => {
  it('shows the chef’s knife until the first frame, so its shader is compiled while loading', () => {
    const batches = new KnifeBatches(4);
    expect(batches.group.children).toHaveLength(1);
    expect(batches.group.children[0]!.visible).toBe(true);
    batches.begin();
    batches.end();
    expect(batches.group.children[0]!.visible).toBe(false);
  });

  it('shares one geometry per look with everything else that draws it', () => {
    const batches = new KnifeBatches(4);
    const look = { skin: 'huntsman', finish: 'tiger' } as const;
    batches.begin();
    batches.add(look, new Matrix4());
    batches.end();
    const mesh = batches.group.children.find((c) => c.name.endsWith('huntsman/tiger')) as
      InstancedMesh | undefined;
    expect(mesh?.geometry).toBe(knifeGeometry(look));
  });

  it('numbers every look apart', () => {
    const seen = new Set<number>();
    for (const look of [
      DEFAULT_LOOK,
      { skin: 'kitchen', finish: 'damascus' },
      { skin: 'karambit', finish: 'doppler' },
      { skin: 'stiletto', finish: 'vanilla' },
    ] as const) {
      seen.add(lookIndex(look));
    }
    expect(seen.size).toBe(4);
  });
});

describe('a cook’s knife in their hand', () => {
  const pose = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    grounded: true,
    dead: false,
    armed: true,
    speed: 0,
  };

  it('is drawn in the look they carry, and moves when they change it', () => {
    const avatars = new Avatars(4);
    avatars.add(1, '#ff0000');
    avatars.add(2, '#00ff00');
    avatars.setLook(2, { skin: 'karambit', finish: 'doppler' });
    avatars.update(1, pose, 10, 1 / 60);
    avatars.update(2, pose, 10, 1 / 60);
    const visible = () =>
      avatars.group.children
        .filter((c) => c.visible && c.name.startsWith('hand knives:'))
        .map((c) => c.name)
        .sort();
    expect(visible()).toEqual(['hand knives:karambit/doppler', 'hand knives:kitchen/stock']);
    expect(avatars.lookOf(2)).toEqual({ skin: 'karambit', finish: 'doppler' });
    // Both change to the butterfly: the others are no longer drawn at all.
    avatars.setLook(1, { skin: 'butterfly', finish: 'fade' });
    avatars.setLook(2, { skin: 'butterfly', finish: 'fade' });
    expect(visible()).toEqual(['hand knives:butterfly/fade']);
    avatars.remove(1);
    avatars.remove(2);
    expect(visible()).toEqual([]);
  });
});
