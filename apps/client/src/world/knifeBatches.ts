import { Group, InstancedMesh, type Matrix4 } from 'three';
import {
  DEFAULT_LOOK,
  KNIFE_FINISHES,
  KNIFE_SKINS,
  type KnifeFinish,
  type KnifeLook,
  type KnifeSkin,
} from '@world/shared';
import { knifeGeometry, knifeMaterial } from './knifeModel.ts';

const SKIN_INDEX = Object.fromEntries(KNIFE_SKINS.map((skin, i) => [skin, i])) as Record<
  KnifeSkin,
  number
>;
const FINISH_INDEX = Object.fromEntries(KNIFE_FINISHES.map((finish, i) => [finish, i])) as Record<
  KnifeFinish,
  number
>;

/** A small number per look, for indexing without building strings. */
export function lookIndex(look: KnifeLook): number {
  return SKIN_INDEX[look.skin] * KNIFE_FINISHES.length + FINISH_INDEX[look.finish];
}

interface Batch {
  readonly look: KnifeLook;
  readonly mesh: InstancedMesh;
  count: number;
}

/**
 * Knives of every look, drawn instanced: one InstancedMesh per look in use, made the first time a
 * knife of that look appears, so a room of chef's knives is still one draw call and every karambit
 * in it one more. Fill it with `begin`, `add` per knife, `end`; nothing allocates once each look's
 * mesh exists.
 */
export class KnifeBatches {
  readonly group = new Group();
  private readonly capacity: number;
  private readonly byLook: (Batch | undefined)[] = [];
  private readonly batches: Batch[] = [];

  /**
   * `capacity` is the most knives of any one look drawn at once. The chef's knife's mesh is made at
   * once, and shown until the first `end`, so compiling the scene up front compiles the knife shader
   * every look shares, and the first knife thrown does not hitch.
   */
  constructor(capacity: number, name = 'knives') {
    this.capacity = capacity;
    this.group.name = name;
    this.batch(DEFAULT_LOOK).mesh.visible = true;
  }

  begin(): void {
    for (const batch of this.batches) batch.count = 0;
  }

  add(look: KnifeLook, matrix: Matrix4): void {
    const batch = this.batch(look);
    if (batch.count < this.capacity) batch.mesh.setMatrixAt(batch.count++, matrix);
  }

  end(): void {
    for (const batch of this.batches) {
      batch.mesh.count = batch.count;
      // A look nobody is drawing costs nothing, not even an empty draw call.
      batch.mesh.visible = batch.count > 0;
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Knives drawn, of every look. */
  get count(): number {
    let n = 0;
    for (const batch of this.batches) n += batch.count;
    return n;
  }

  /** Knives drawn of each look in use, keyed `skin/finish`, for tests and debugging. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const batch of this.batches) {
      if (batch.count > 0) out[`${batch.look.skin}/${batch.look.finish}`] = batch.count;
    }
    return out;
  }

  private batch(look: KnifeLook): Batch {
    const index = lookIndex(look);
    let batch = this.byLook[index];
    if (!batch) {
      const mesh = new InstancedMesh(knifeGeometry(look), knifeMaterial(), this.capacity);
      mesh.name = `${this.group.name}:${look.skin}/${look.finish}`;
      // Knives are spread across the whole room; one bounding volume would only be wrong.
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      batch = { look: { skin: look.skin, finish: look.finish }, mesh, count: 0 };
      this.byLook[index] = batch;
      this.batches.push(batch);
      this.group.add(mesh);
    }
    return batch;
  }
}
