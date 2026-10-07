import { describe, expect, it } from 'vitest';
import { KNIFE_SKINS, SKIN_FINISHES, type KnifeSkin } from '@world/shared';
import {
  CHANNELS,
  LOWERED,
  SPENT,
  SWITCH,
  THROW,
  knifeMoves,
  sample,
  type ArmPose,
  type Channel,
  type Clip,
} from './knifeMoves.ts';
import { knifeGeometry, knifeModel, knifeSilhouette } from './knifeModel.ts';
import { Viewmodel } from './viewmodel.ts';

const blank = (): ArmPose => ({
  x: 0,
  y: 0,
  z: 0,
  rx: 0,
  ry: 0,
  rz: 0,
  knife: true,
  spin: 0,
  flip: 0,
  a: 0,
  b: 0,
  hang: 0,
});
const ARM: readonly Channel[] = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
const TURNS: readonly Channel[] = ['spin', 'flip', 'a', 'b'];
/** How far an angle is from a whole number of turns. */
const offTurn = (angle: number): number =>
  Math.abs(angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2)));

/** The biggest change in any channel between two samples 1/6000 s apart; a whole turn is none. */
function largestJump(c: Clip, channels: readonly Channel[]): number {
  let worst = 0;
  const step = 1 / 6000;
  for (let t = 0; t < c.duration; t += step) {
    const a = sample(c, t, blank());
    const b = sample(c, t + step, blank());
    for (const k of channels) {
      const d = b[k] - a[k];
      worst = Math.max(worst, TURNS.includes(k) ? offTurn(d) : Math.abs(d));
    }
  }
  return worst;
}

function atRest(pose: ArmPose): void {
  for (const k of ARM) expect(pose[k]).toBeCloseTo(0, 6);
  for (const k of TURNS) expect(offTurn(pose[k])).toBeCloseTo(0, 6);
}

describe.each(KNIFE_SKINS.map((skin) => [skin]))('the %s', (skin: KnifeSkin) => {
  const model = knifeModel(skin);
  const moves = knifeMoves(skin);

  it('has a model with a blade, its tip at the origin', () => {
    expect(model.name.length).toBeGreaterThan(0);
    expect(model.parts.some((p) => p.kind === 'blade')).toBe(true);
    let tipZ = Infinity;
    for (const part of model.parts) {
      const position = part.geometry.getAttribute('position');
      expect(position.count).toBeGreaterThan(0);
      expect(part.geometry.getAttribute('normal').count).toBe(position.count);
      for (let i = 0; i < position.count; i++) tipZ = Math.min(tipZ, position.getZ(i));
    }
    // Nothing reaches past the tip, so a stuck knife is stuck by its point.
    expect(tipZ).toBeGreaterThan(-0.004);
    for (const [z, y] of [model.grip, model.center, model.pivot]) {
      expect(Number.isFinite(z) && Number.isFinite(y)).toBe(true);
      expect(z).toBeGreaterThan(0);
    }
  });

  it('is about as long as the chef’s knife, so it reads in the hand and across the room', () => {
    let zMax = 0;
    for (const part of model.parts) {
      const position = part.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) zMax = Math.max(zMax, position.getZ(i));
    }
    expect(zMax).toBeGreaterThan(0.27);
    expect(zMax).toBeLessThan(0.36);
  });

  it('hinges its moving parts on parts that exist', () => {
    for (const part of model.parts) {
      if (!part.joint?.parent) continue;
      const parent = model.parts.find((p) => p.name === part.joint!.parent);
      expect(parent?.joint, `${part.name} hangs off a moving part`).toBeDefined();
    }
  });

  it('is painted in every finish it comes in, ready to draw', () => {
    for (const finish of SKIN_FINISHES[skin]) {
      const geometry = knifeGeometry({ skin, finish });
      const count = geometry.getAttribute('position').count;
      expect(geometry.getAttribute('uv').count).toBe(count);
      expect(geometry.getAttribute('color').count).toBe(count);
      for (const value of geometry.getAttribute('uv').array) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('has a silhouette for its icon', () => {
    const { viewBox, paths } = knifeSilhouette(skin);
    expect(viewBox.split(' ').map(Number).every(Number.isFinite)).toBe(true);
    expect(paths.length).toBe(model.parts.length);
    for (const d of paths) expect(d).toMatch(/^M[-\d.]+ [-\d.]+(L[-\d.]+ [-\d.]+)+Z/);
  });

  it('draws up from below the screen to rest', () => {
    const start = sample(moves.draw, 0, blank());
    expect(start.y).toBeCloseTo(LOWERED.y, 6);
    expect(start.rx).toBeCloseTo(LOWERED.rx, 6);
    atRest(sample(moves.draw, moves.draw.duration, blank()));
    expect(moves.draw.duration).toBeGreaterThanOrEqual(SWITCH.raise - SWITCH.lower - 1e-9);
    expect(moves.draw.duration).toBeLessThan(1);
  });

  it('draws a fresh knife after a throw in time for the next', () => {
    expect(moves.redraw.duration).toBeCloseTo(THROW.drawTo - THROW.drawFrom, 6);
    const start = sample(moves.redraw, 0, blank());
    for (const k of ARM) expect(start[k]).toBeCloseTo(SPENT[k as keyof typeof SPENT], 6);
    atRest(sample(moves.redraw, moves.redraw.duration, blank()));
  });

  it('inspects from rest to rest, with the knife in hand throughout', () => {
    expect(moves.inspect.duration).toBeGreaterThan(2);
    expect(moves.inspect.duration).toBeLessThan(4.5);
    atRest(sample(moves.inspect, 0, blank()));
    atRest(sample(moves.inspect, moves.inspect.duration, blank()));
    for (let t = 0; t <= moves.inspect.duration; t += 0.05) {
      expect(sample(moves.inspect, t, blank()).knife).toBe(true);
    }
  });

  it('idles in a loop that starts and ends at rest', () => {
    if (skin === 'kitchen') {
      // The chef's knife rests still, as it always has.
      expect(moves.idle.duration).toBe(0);
      return;
    }
    expect(moves.idle.duration).toBeGreaterThan(2);
    atRest(sample(moves.idle, 0, blank()));
    atRest(sample(moves.idle, moves.idle.duration, blank()));
  });

  it('moves smoothly: the arm never jumps, and the knife only turns as fast as a flick', () => {
    for (const c of [moves.draw, moves.inspect, moves.idle]) {
      if (c.duration === 0) continue;
      expect(largestJump(c, ARM)).toBeLessThan(0.006);
      // Spun in the fingers at no more than 9 turns a second...
      expect(largestJump(c, ['spin', 'flip'])).toBeLessThan(0.0095);
      // ...and a folding blade flicked open in no less than about a twentieth of a second.
      expect(largestJump(c, ['a', 'b'])).toBeLessThan(0.025);
    }
    // The redraw is squeezed into a third of a second, so it is quicker.
    expect(largestJump(moves.redraw, ARM)).toBeLessThan(0.012);
    expect(largestJump(moves.redraw, TURNS)).toBeLessThan(0.04);
  });

  it('keys only the channels a pose has', () => {
    expect(moves.inspect.values.length % CHANNELS.length).toBe(0);
  });

  it('is drawn, thrown and inspected in the hand on screen', () => {
    const camera = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
    const step = (vm: Viewmodel, seconds: number): void => {
      for (let t = 0; t < seconds; t += 1 / 60) vm.update(1 / 60, camera as never, 0, 0, 0, true);
    };
    const vm = new Viewmodel();
    vm.setLook({ skin, finish: SKIN_FINISHES[skin][0]! });
    vm.setShown(true);
    expect(vm.look.skin).toBe(skin);
    expect(vm.canThrow).toBe(false);
    step(vm, SWITCH.raise);
    // Up in time to throw, even if its flourish is still playing out.
    expect(vm.canThrow).toBe(true);
    expect(vm.startThrow()).toBe(true);
    step(vm, THROW.drawTo + 0.05);
    expect(vm.canThrow).toBe(true);
    expect(vm.startInspect()).toBe(true);
    step(vm, moves.inspect.duration / 2);
    expect(vm.inspecting).toBe(true);
    // A throw cuts it short.
    expect(vm.startThrow()).toBe(true);
    expect(vm.inspecting).toBe(false);
  });
});
