import {
  AdditiveBlending,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  TorusKnotGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Ray,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LORE_SLOTS, PEDESTAL_HEIGHT, PEDESTAL_RADIUS, terrainHeight } from '@world/shared';
import type { LoreEntry, LoreShape } from '../content.ts';
import { glowTexture } from './textures.ts';

const FLOAT_HEIGHT = 1.35;
const PICK_RADIUS = 0.95;
/** Objects can be clicked from up to this far away. */
export const PICK_DISTANCE = 10;

function shapeGeometry(shape: LoreShape): BufferGeometry {
  switch (shape) {
    case 'icosahedron':
      return new IcosahedronGeometry(0.55, 0);
    case 'torusKnot':
      return new TorusKnotGeometry(0.34, 0.12, 96, 12);
    case 'octahedron':
      return new OctahedronGeometry(0.6, 0);
    case 'dodecahedron':
      return new DodecahedronGeometry(0.55, 0);
    case 'torus':
      return new TorusGeometry(0.4, 0.15, 12, 36);
    case 'cube':
      return new RoundedBoxGeometry(0.7, 0.7, 0.7, 2, 0.08);
    case 'cone':
      return new ConeGeometry(0.48, 0.9, 6);
    case 'capsule':
      return new CapsuleGeometry(0.28, 0.5, 6, 12);
  }
}

interface LoreObject {
  readonly entry: LoreEntry;
  readonly root: Group;
  readonly mesh: Mesh;
  readonly material: MeshStandardMaterial;
  readonly halo: Sprite;
  readonly haloMaterial: SpriteMaterial;
  readonly center: Vector3;
  readonly baseY: number;
  readonly color: Color;
  highlight: number;
}

export class LoreObjects {
  readonly group = new Group();
  private readonly objects: LoreObject[] = [];
  private readonly runes: InstancedMesh;
  private readonly runeColor = new Color();
  private hovered = -1;
  private readonly toCenter = new Vector3();

  constructor(entries: readonly LoreEntry[]) {
    this.group.name = 'lore';
    const count = Math.min(entries.length, LORE_SLOTS.length);

    const profile = [
      [PEDESTAL_RADIUS + 0.15, 0],
      [PEDESTAL_RADIUS + 0.15, 0.16],
      [PEDESTAL_RADIUS - 0.12, 0.26],
      [PEDESTAL_RADIUS - 0.22, PEDESTAL_HEIGHT - 0.2],
      [PEDESTAL_RADIUS, PEDESTAL_HEIGHT - 0.1],
      [PEDESTAL_RADIUS, PEDESTAL_HEIGHT],
      [0.001, PEDESTAL_HEIGHT],
    ].map(([x, y]) => new Vector2(x, y));
    const pedestals = new InstancedMesh(
      new LatheGeometry(profile, 10),
      new MeshStandardMaterial({ color: '#d8c7a8', roughness: 0.8, flatShading: true }),
      count,
    );
    pedestals.castShadow = true;
    pedestals.receiveShadow = true;

    const runeGeometry = new TorusGeometry(PEDESTAL_RADIUS - 0.12, 0.03, 4, 40);
    runeGeometry.rotateX(Math.PI / 2);
    this.runes = new InstancedMesh(
      runeGeometry,
      new MeshBasicMaterial({ toneMapped: false }),
      count,
    );

    const dummy = new Object3D();
    const glow = glowTexture();
    for (let i = 0; i < count; i++) {
      const entry = entries[i]!;
      const slot = LORE_SLOTS[i]!;
      const groundY = terrainHeight(slot.x, slot.z);
      // The pedestal collider top is pedestalTop; sink the mesh base a little into the ground.
      dummy.position.set(slot.x, slot.pedestalTop - PEDESTAL_HEIGHT - 0.02, slot.z);
      dummy.rotation.set(0, slot.facing, 0);
      dummy.scale.set(1, (slot.pedestalTop - groundY + 0.02) / PEDESTAL_HEIGHT, 1);
      dummy.updateMatrix();
      pedestals.setMatrixAt(i, dummy.matrix);
      dummy.position.y = slot.pedestalTop + 0.005;
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      this.runes.setMatrixAt(i, dummy.matrix);

      const color = new Color(entry.color);
      this.runes.setColorAt(i, this.runeColor.copy(color).multiplyScalar(0.7));

      const material = new MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.35,
        roughness: 0.35,
        metalness: 0.1,
        flatShading: entry.shape !== 'torusKnot' && entry.shape !== 'capsule',
      });
      const mesh = new Mesh(shapeGeometry(entry.shape), material);
      mesh.castShadow = true;
      const haloMaterial = new SpriteMaterial({
        map: glow,
        color,
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.35,
      });
      const halo = new Sprite(haloMaterial);
      halo.scale.setScalar(2.6);
      const root = new Group();
      const baseY = slot.pedestalTop + FLOAT_HEIGHT;
      root.position.set(slot.x, baseY, slot.z);
      root.add(halo, mesh);
      this.group.add(root);
      this.objects.push({
        entry,
        root,
        mesh,
        material,
        halo,
        haloMaterial,
        center: root.position,
        baseY,
        color,
        highlight: 0,
      });
    }
    this.group.add(pedestals, this.runes);
  }

  get hoveredEntry(): LoreEntry | null {
    return this.objects[this.hovered]?.entry ?? null;
  }

  /** World position of each object's floating center, for labels. */
  anchor(index: number): Vector3 | null {
    return this.objects[index]?.center ?? null;
  }

  get entries(): readonly LoreEntry[] {
    return this.objects.map((o) => o.entry);
  }

  /** Find the object under the crosshair, if any is close enough. Allocation free. */
  pick(ray: Ray): number {
    let best = -1;
    let bestDistance = PICK_DISTANCE;
    for (let i = 0; i < this.objects.length; i++) {
      const center = this.objects[i]!.center;
      this.toCenter.subVectors(center, ray.origin);
      const along = this.toCenter.dot(ray.direction);
      if (along < 0 || along > bestDistance) continue;
      const perpendicular2 = this.toCenter.lengthSq() - along * along;
      if (perpendicular2 <= PICK_RADIUS * PICK_RADIUS) {
        best = i;
        bestDistance = along;
      }
    }
    return best;
  }

  setHovered(index: number): void {
    if (index === this.hovered) return;
    this.hovered = index;
    for (let i = 0; i < this.objects.length; i++) {
      const o = this.objects[i]!;
      this.runeColor.copy(o.color).multiplyScalar(i === index ? 1.6 : 0.7);
      this.runes.setColorAt(i, this.runeColor);
    }
    if (this.runes.instanceColor) this.runes.instanceColor.needsUpdate = true;
  }

  update(time: number, dt: number): void {
    const ease = 1 - Math.exp(-dt * 10);
    for (let i = 0; i < this.objects.length; i++) {
      const o = this.objects[i]!;
      o.highlight += ((i === this.hovered ? 1 : 0) - o.highlight) * ease;
      o.root.position.y = o.baseY + Math.sin(time * 1.2 + i * 0.9) * 0.12;
      o.mesh.rotation.y = time * 0.5 + i;
      o.mesh.rotation.x = Math.sin(time * 0.4 + i) * 0.3;
      o.mesh.scale.setScalar(1 + o.highlight * 0.18);
      o.material.emissiveIntensity = 0.35 + o.highlight * 0.4;
      o.haloMaterial.opacity = 0.3 + o.highlight * 0.25 + Math.sin(time * 2 + i) * 0.05;
      o.halo.scale.setScalar(2.6 + o.highlight * 0.9);
    }
  }
}
