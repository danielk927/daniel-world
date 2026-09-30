import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector2,
} from 'three';
import { FOUNTAIN, LORE_SLOTS, PLAZA_RADIUS, createRandom, terrainHeight } from '@world/shared';
import { glowTexture } from './textures.ts';
import { worldTime } from './wind.ts';

const STONES = ['#e3d2b4', '#d8c5a5', '#cfba98', '#e8dbc1', '#cbb28f'].map((c) => new Color(c));

/** Concentric rings of hand-laid stone tiles, with grass showing in the grout lines. */
function createTiles(): Mesh {
  const random = createRandom(5);
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new Color();
  const innerStart = FOUNTAIN.basinRadius + 0.2;
  const ringWidth = (PLAZA_RADIUS - innerStart) / 7;
  const gap = 0.045;
  const arcSteps = 3;

  const pushTile = (inner: number, outer: number, a0: number, a1: number, y: number): void => {
    for (let s = 0; s < arcSteps; s++) {
      const t0 = a0 + ((a1 - a0) * s) / arcSteps;
      const t1 = a0 + ((a1 - a0) * (s + 1)) / arcSteps;
      const corners = [
        [Math.sin(t0) * inner, -Math.cos(t0) * inner],
        [Math.sin(t1) * inner, -Math.cos(t1) * inner],
        [Math.sin(t0) * outer, -Math.cos(t0) * outer],
        [Math.sin(t1) * outer, -Math.cos(t1) * outer],
      ] as const;
      const [p0, p1, p2, p3] = corners;
      // Two up-facing triangles per arc step.
      positions.push(p0[0], y, p0[1], p1[0], y, p1[1], p2[0], y, p2[1]);
      positions.push(p1[0], y, p1[1], p3[0], y, p3[1], p2[0], y, p2[1]);
      for (let i = 0; i < 6; i++) colors.push(color.r, color.g, color.b);
    }
  };

  for (let ring = 0; ring < 7; ring++) {
    const inner = innerStart + ring * ringWidth + gap / 2;
    const outer = inner + ringWidth - gap;
    const mid = (inner + outer) / 2;
    const count = Math.round((Math.PI * 2 * mid) / 1.2);
    const offset = random() * Math.PI;
    for (let i = 0; i < count; i++) {
      const a0 = offset + (i / count) * Math.PI * 2 + gap / 2 / mid;
      const a1 = offset + ((i + 1) / count) * Math.PI * 2 - gap / 2 / mid;
      color
        .copy(STONES[Math.floor(random() * STONES.length)]!)
        .offsetHSL(0, 0, (random() - 0.5) * 0.05);
      pushTile(inner, outer, a0, a1, 0.035 + random() * 0.012);
    }
  }

  // Darker curb around the plaza edge.
  const curbCount = 64;
  for (let i = 0; i < curbCount; i++) {
    const a0 = (i / curbCount) * Math.PI * 2 + 0.004;
    const a1 = ((i + 1) / curbCount) * Math.PI * 2 - 0.004;
    color.set('#a99377').offsetHSL(0, 0, (random() - 0.5) * 0.05);
    pushTile(PLAZA_RADIUS + 0.02, PLAZA_RADIUS + 0.38, a0, a1, 0.08);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new Mesh(
    geometry,
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
  );
  mesh.receiveShadow = true;
  mesh.name = 'plaza-tiles';

  // Mossy grout that shows between the tiles.
  const grout = new Mesh(
    new CircleGeometry(PLAZA_RADIUS + 0.4, 64),
    new MeshStandardMaterial({ color: '#8d8a62', roughness: 1 }),
  );
  grout.rotation.x = -Math.PI / 2;
  grout.position.y = 0.02;
  grout.receiveShadow = true;
  mesh.add(grout);
  return mesh;
}

/** Stepping stones leading from the plaza out to each lore pedestal. */
function createSteppingStones(): InstancedMesh {
  const random = createRandom(9);
  const distances = [PLAZA_RADIUS + 1.0, PLAZA_RADIUS + 2.0];
  const mesh = new InstancedMesh(
    new CylinderGeometry(0.42, 0.48, 0.14, 7),
    new MeshStandardMaterial({ color: '#d5c3a4', roughness: 0.9, flatShading: true }),
    LORE_SLOTS.length * distances.length,
  );
  const dummy = new Object3D();
  let i = 0;
  for (const slot of LORE_SLOTS) {
    const length = Math.hypot(slot.x, slot.z);
    for (const d of distances) {
      const x = (slot.x / length) * d + (random() - 0.5) * 0.25;
      const z = (slot.z / length) * d + (random() - 0.5) * 0.25;
      dummy.position.set(x, terrainHeight(x, z) + 0.02, z);
      dummy.rotation.set(0, random() * Math.PI, 0);
      const s = 0.85 + random() * 0.3;
      dummy.scale.set(s, 1, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i++, dummy.matrix);
    }
  }
  mesh.receiveShadow = true;
  return mesh;
}

function createWater(): Mesh {
  const material = new ShaderMaterial({
    transparent: true,
    uniforms: { uTime: worldTime },
    vertexShader: /* glsl */ `
      varying vec2 vPos;
      void main() {
        vPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vPos;
      void main() {
        float r = length(vPos);
        float ripple = sin(r * 9.0 - uTime * 2.2) * 0.5 + 0.5;
        float cross = sin((vPos.x + vPos.y) * 5.0 + uTime * 1.3) * 0.5 + 0.5;
        vec3 deep = vec3(0.05, 0.28, 0.36);
        vec3 shallow = vec3(0.32, 0.72, 0.74);
        vec3 color = mix(deep, shallow, smoothstep(0.4, 2.4, r) * 0.55 + ripple * 0.18 + cross * 0.1);
        color = mix(color, vec3(1.0, 0.72, 0.5), 0.12 * ripple);
        float sparkle = pow(max(0.0, sin(vPos.x * 23.0 + uTime * 3.0) * sin(vPos.y * 19.0 - uTime * 2.1)), 20.0);
        color += sparkle * 0.9;
        gl_FragColor = vec4(color, 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const water = new Mesh(new CircleGeometry(2.43, 48), material);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.44;
  return water;
}

export interface Fountain {
  readonly group: Group;
  update(time: number): void;
}

/** Fountain with a floating crystal, the landmark at the center of the island. */
function createFountain(): Fountain {
  const group = new Group();
  const stone = new MeshStandardMaterial({ color: '#dccbac', roughness: 0.8, flatShading: true });
  // Lathe profiles run outside-bottom to inside so the normals face out of the stone.
  const basinProfile = [
    [3.02, 0.0],
    [2.9, 0.1],
    [2.9, 0.52],
    [2.84, 0.6],
    [2.5, 0.6],
    [2.42, 0.5],
    [2.42, 0.1],
  ].map(([x, y]) => new Vector2(x, y));
  const basin = new Mesh(new LatheGeometry(basinProfile, 40), stone);
  const columnProfile = [
    [0.001, 0.1],
    [0.72, 0.1],
    [0.72, 0.28],
    [0.52, 0.4],
    [0.4, 0.55],
    [0.36, 1.75],
    [0.5, 1.9],
    [0.92, 2.14],
    [0.98, 2.32],
    [0.8, 2.4],
    [0.001, 2.4],
  ].map(([x, y]) => new Vector2(x, y));
  const column = new Mesh(new LatheGeometry(columnProfile, 24), stone);
  for (const mesh of [basin, column]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }

  const crystalMaterial = new MeshStandardMaterial({
    color: '#ffe3a1',
    emissive: '#ffb347',
    emissiveIntensity: 0.9,
    roughness: 0.25,
    metalness: 0.1,
    flatShading: true,
  });
  const crystal = new Mesh(new OctahedronGeometry(0.5, 0), crystalMaterial);
  crystal.scale.set(1, 1.7, 1);
  crystal.castShadow = true;

  const ringMaterial = new MeshStandardMaterial({
    color: '#fff0c8',
    emissive: '#ffc46b',
    emissiveIntensity: 0.7,
    roughness: 0.3,
  });
  const ringA = new Mesh(new TorusGeometry(1.0, 0.03, 6, 64), ringMaterial);
  const ringB = new Mesh(new TorusGeometry(1.25, 0.022, 6, 64), ringMaterial);

  const halo = new Sprite(
    new SpriteMaterial({
      map: glowTexture(),
      color: '#ffc46b',
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.32,
    }),
  );
  halo.scale.setScalar(3.6);

  const floating = new Group();
  floating.position.y = FOUNTAIN.crystalY;
  floating.add(crystal, ringA, ringB, halo);
  group.add(basin, column, createWater(), floating);
  group.name = 'fountain';

  return {
    group,
    update(time) {
      floating.position.y = FOUNTAIN.crystalY + Math.sin(time * 1.1) * 0.12;
      crystal.rotation.y = time * 0.6;
      ringA.rotation.set(Math.PI / 2 + Math.sin(time * 0.7) * 0.4, time * 0.5, 0);
      ringB.rotation.set(Math.PI / 2 + Math.cos(time * 0.5) * 0.5, -time * 0.35, 0.3);
      crystalMaterial.emissiveIntensity = 0.85 + Math.sin(time * 2.1) * 0.15;
    },
  };
}

export interface Plaza {
  readonly group: Group;
  update(time: number): void;
}

export function createPlaza(): Plaza {
  const group = new Group();
  const fountain = createFountain();
  group.add(createTiles(), createSteppingStones(), fountain.group);
  group.name = 'plaza';
  return { group, update: (time) => fountain.update(time) };
}
