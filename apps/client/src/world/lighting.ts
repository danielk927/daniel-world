import {
  BackSide,
  BoxGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  RectAreaLight,
  Scene,
  SpotLight,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { KITCHEN, PASS_DISHES, ROOM_HALF_X, ROOM_HALF_Z, ROOM_HEIGHT } from '@world/shared';
import { createLightCones } from './effects.ts';
import { PENDANTS } from './kitchen.ts';
import type { Quality } from '../util/capabilities.ts';

/**
 * Evening service, lit after Sharon Calahan's Gusteau's kitchen in Ratatouille, where the human
 * world is warm and the world outside is cool. The blue hour shows through the windows and
 * skylights; inside, the light comes from the kitchen itself, in pools: the heat lamps on the pass
 * and the downlights over the two islands are spots with soft edges, the hood is a warm lit stage
 * over the stoves, and a weak overhead light grounds everything with shadow. The fill is low and
 * cool, so the pools read as pools, and the grade keeps the shadows warm rather than grey.
 */

/** Tungsten warm, for every light the kitchen makes. */
const HOOD = '#ffcf98';
const OVERHEAD = '#ffe4c8';
/** The light strips where the vault springs from the long walls, washing the arch above. */
const COVE = '#ffdcb2';
const DOWNLIGHT = '#ffd6a6';
const HEAT_LAMP = '#ff9447';
const FIRE = '#ff9a5c';
/** The blue hour outside: what comes in through the windows and skylights. */
const DUSK = '#7f9dc9';
const SKY = '#5f7aa0';
/** The low tier's fill, from above: warm-neutral, since it has no warm lamps to balance cool. */
const LOW_FILL = '#d6cdc3';
/** Light bounced off the warm-lit floor and counters. */
const BOUNCE = '#6f5a4b';
/** Haze in the air, lit by the lamps. */
const HAZE = '#5e5049';

export interface Lighting {
  /** Flicker the fire. */
  update(time: number): void;
}

/**
 * A small room for reflections, so steel and copper show the kitchen: warm dark walls, the lit
 * hood and downlights overhead, and a strip of blue-hour window to the north.
 */
function environmentScene(): Scene {
  const scene = new Scene();
  const room = new Mesh(
    new BoxGeometry(20, 8, 16),
    new MeshBasicMaterial({ color: '#3a2f2a', side: BackSide }),
  );
  room.position.y = 3;
  const panel = (color: string, intensity: number, w: number, h: number) =>
    new Mesh(
      new PlaneGeometry(w, h),
      new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity) }),
    );
  const window = panel(DUSK, 2.2, 14, 1.6);
  window.position.set(0, 2, -7.9);
  const hood = panel(HOOD, 5, 10, 3);
  hood.position.set(0, 2.7, 0);
  hood.rotation.x = Math.PI / 2;
  const downlights = [-3.2, 3.2].map((x) => {
    const p = panel(DOWNLIGHT, 4, 1.2, 1.2);
    p.position.set(x, 3.5, -4.2);
    p.rotation.x = Math.PI / 2;
    return p;
  });
  const floor = panel('#7a6658', 0.5, 20, 16);
  floor.rotation.x = -Math.PI / 2;
  scene.add(room, window, hood, ...downlights, floor);
  return scene;
}

export function createLighting(scene: Scene, renderer: WebGLRenderer, quality: Quality): Lighting {
  const high = quality === 'high';

  // Without shadows, occlusion or the warm practical lights to balance it, the low tier gets a
  // brighter, warm-neutral fill instead of the cool evening one, or the whole room goes blue.
  const fill = high
    ? new HemisphereLight(SKY, BOUNCE, 0.26)
    : new HemisphereLight(LOW_FILL, BOUNCE, 1.5);

  // The kitchen's general light: warm white from the ceiling, a little toward the dining room, so
  // the faces a new player looks at are lit, not only the tops. It casts the grounding shadows.
  const overhead = new DirectionalLight(OVERHEAD, high ? 0.25 : 1.8);
  overhead.position.set(3, 13, 7);
  if (high) {
    overhead.castShadow = true;
    overhead.shadow.mapSize.set(2048, 2048);
    const c = overhead.shadow.camera;
    const reach = Math.hypot(ROOM_HALF_X, ROOM_HALF_Z) + 0.5;
    c.left = -reach;
    c.right = reach;
    c.top = reach;
    c.bottom = -reach;
    c.near = 4;
    c.far = 32;
    overhead.shadow.bias = -0.0004;
    overhead.shadow.normalBias = 0.03;
    overhead.shadow.radius = 4;
  }

  // Blue hour through the garden windows: a cool wash on everything that faces north.
  const dusk = new DirectionalLight(DUSK, high ? 0.45 : 0.2);
  dusk.position.set(-2, 4, -14);
  scene.add(fill, overhead, overhead.target, dusk, dusk.target);

  let fire: PointLight | null = null;
  // Every extra light costs every lit pixel, so software renderers go without the practicals.
  // The area lights need RectAreaLightUniformsLib, which WorldScene.compile loads before the first
  // frame, so its lookup tables only download for the high tier.
  if (high) {
    const h = KITCHEN.hood;
    const hood = new RectAreaLight(HOOD, 1.8, h.maxX - h.minX - 0.6, h.maxZ - h.minZ - 0.6);
    hood.position.set(0, h.bottom - 0.02, 0);
    hood.lookAt(0, 0, 0);

    const spot = (
      color: string,
      intensity: number,
      x: number,
      y: number,
      z: number,
      reach: number,
      angle: number,
      surface: number,
    ): SpotLight => {
      const light = new SpotLight(color, intensity, reach, angle, 0.65, 2);
      light.position.set(x, y, z);
      light.target.position.set(x, surface, z);
      scene.add(light.target);
      return light;
    };
    const pass = KITCHEN.pass;
    const passZ = (pass.minZ + pass.maxZ) / 2;
    // The heat lamps: amber pools on the plates, short enough not to wash the walls orange.
    const heat = [-3, 0, 3].map((x) => spot(HEAT_LAMP, 17, x, 2.05, passZ, 3.2, 0.5, 0));
    // One light for each pair of pendants, between them, wide enough to cover the island.
    const islands = [KITCHEN.pastryIsland, KITCHEN.gardeManger].map((f) =>
      spot(DOWNLIGHT, 22, (f.minX + f.maxX) / 2, 2.98, (f.minZ + f.maxZ) / 2, 5, 0.78, 0),
    );
    fire = new PointLight(FIRE, 0.9, 2.6, 2);
    fire.position.set(0, 1.05, 0);
    // Cove light: each strip along a long wall throws a warm wash up into the vault, so the
    // ceiling glows from its edges instead of falling into black.
    const coves = [-1, 1].map((side) => {
      const cove = new RectAreaLight(COVE, 5, ROOM_HALF_X * 2 - 0.4, 0.12);
      cove.position.set(0, ROOM_HEIGHT - 0.05, side * (ROOM_HALF_Z - 0.08));
      cove.lookAt(0, ROOM_HEIGHT + 4, side * (ROOM_HALF_Z - 3));
      return cove;
    });
    // Beams in the air under each heat lamp and pendant.
    const beams = createLightCones([
      ...PASS_DISHES.map((d) => ({
        apex: new Vector3(d.x, 2.02, passZ),
        height: 1.05,
        radius: 0.36,
        color: HEAT_LAMP,
      })),
      ...PENDANTS.map((p) => ({ apex: p.clone(), height: 1.95, radius: 0.85, color: DOWNLIGHT })),
    ]);
    scene.add(hood, ...heat, ...islands, fire, ...coves, beams);

    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(environmentScene(), 0.04).texture;
    pmrem.dispose();
    // Reflections only, barely any light: an environment bright enough to light the painted
    // surfaces lights them from every side at once and flattens the room. Metals and glass turn
    // theirs up per material.
    scene.environmentIntensity = 0.05;
  }

  // A little haze, so the far end of the room sits back into the evening.
  scene.fog = new FogExp2(HAZE, high ? 0.012 : 0.008);

  return {
    update(time: number): void {
      if (fire) fire.intensity = 0.9 + Math.sin(time * 13) * 0.07 + Math.sin(time * 7.3) * 0.05;
    },
  };
}
