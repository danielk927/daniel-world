import {
  CapsuleGeometry,
  Color,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  IcosahedronGeometry,
  Vector2,
  Vector3,
  Euler,
} from 'three';
import { EMOTE_DURATION, MAX_PLAYERS_PER_ROOM, type Emote } from '@world/shared';
import type { Pose } from '../net/interpolation.ts';

/** Local-space layout of an avatar. Feet at y = 0, facing -Z. */
const BODY_RADIUS = 0.34;
const BODY_LENGTH = 0.5;
const BODY_Y = BODY_RADIUS + BODY_LENGTH / 2 + 0.06;
const HEAD_RADIUS = 0.29;
const HEAD_Y = 1.42;
const HAND_RADIUS = 0.11;
const EYE_RADIUS = 0.05;
/** The chef's toque: a pleated band with a puffed crown, sitting on the head. */
const HAT_HEIGHT = 0.36;

function toqueGeometry(): LatheGeometry {
  // Outside profile from the band's bottom edge up to the center of the crown.
  const profile = [
    [0.2, 0],
    [0.205, 0.14],
    [0.23, 0.18],
    [0.27, 0.24],
    [0.27, 0.3],
    [0.23, 0.345],
    [0.12, HAT_HEIGHT],
    [0.001, HAT_HEIGHT],
  ].map(([x, y]) => new Vector2(x, y));
  return new LatheGeometry(profile, 10);
}

export interface AvatarPose extends Pose {
  /** Horizontal speed in m/s, drives the walk cycle. */
  speed: number;
}

interface Avatar {
  slot: number;
  walkPhase: number;
  walkAmount: number;
  airAmount: number;
  emote: Emote | null;
  emoteStart: number;
  /** Where the name tag should sit, updated every frame. */
  readonly tagAnchor: Vector3;
}

const tmpColor = new Color();
const white = new Color('#ffffff');

/**
 * Every remote player, drawn with five instanced meshes in total (body, head, hands, eyes, and a
 * chef's toque; the ground shadow comes from the shadow map). Per-frame updates only write instance matrices.
 */
export class Avatars {
  readonly group = new Group();
  private readonly bodies: InstancedMesh;
  private readonly heads: InstancedMesh;
  private readonly hands: InstancedMesh;
  private readonly eyes: InstancedMesh;
  private readonly hats: InstancedMesh;
  private readonly avatars = new Map<number, Avatar>();
  private readonly freeSlots: number[] = [];

  // Scratch objects so updates never allocate.
  private readonly root = new Matrix4();
  private readonly part = new Matrix4();
  private readonly out = new Matrix4();
  private readonly q = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly p = new Vector3();
  private readonly s = new Vector3(1, 1, 1);
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);

  constructor(capacity: number = MAX_PLAYERS_PER_ROOM) {
    // Faceted like the kitchen around them: flat shading on low-poly shapes.
    const skin = new MeshStandardMaterial({ roughness: 0.7, flatShading: true });
    this.bodies = new InstancedMesh(
      new CapsuleGeometry(BODY_RADIUS, BODY_LENGTH, 2, 8),
      skin,
      capacity,
    );
    this.heads = new InstancedMesh(new IcosahedronGeometry(HEAD_RADIUS, 1), skin, capacity);
    this.hands = new InstancedMesh(new IcosahedronGeometry(HAND_RADIUS, 0), skin, capacity * 2);
    this.eyes = new InstancedMesh(
      new IcosahedronGeometry(EYE_RADIUS, 0),
      new MeshBasicMaterial({ color: '#2a1f2d' }),
      capacity * 2,
    );
    this.hats = new InstancedMesh(
      toqueGeometry(),
      new MeshStandardMaterial({ color: '#fbfaf7', roughness: 0.85, flatShading: true }),
      capacity,
    );
    for (const mesh of [this.bodies, this.heads, this.hands, this.eyes, this.hats]) {
      mesh.frustumCulled = false;
      mesh.castShadow = mesh !== this.eyes;
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, this.hidden);
      this.group.add(mesh);
    }
    for (let i = capacity - 1; i >= 0; i--) this.freeSlots.push(i);
    // Instance colors must exist before the first render.
    for (let i = 0; i < capacity; i++) {
      this.bodies.setColorAt(i, white);
      this.heads.setColorAt(i, white);
      this.hands.setColorAt(i * 2, white);
      this.hands.setColorAt(i * 2 + 1, white);
    }
    this.group.name = 'avatars';
  }

  add(id: number, color: string): Vector3 | null {
    if (this.avatars.has(id)) return this.avatars.get(id)!.tagAnchor;
    const slot = this.freeSlots.pop();
    if (slot === undefined) return null;
    tmpColor.set(color);
    this.bodies.setColorAt(slot, tmpColor);
    this.hands.setColorAt(slot * 2, tmpColor);
    this.hands.setColorAt(slot * 2 + 1, tmpColor);
    tmpColor.offsetHSL(0, 0.05, 0.12);
    this.heads.setColorAt(slot, tmpColor);
    for (const mesh of [this.bodies, this.heads, this.hands]) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    const avatar: Avatar = {
      slot,
      walkPhase: Math.random() * Math.PI * 2,
      walkAmount: 0,
      airAmount: 0,
      emote: null,
      emoteStart: 0,
      tagAnchor: new Vector3(0, -1000, 0),
    };
    this.avatars.set(id, avatar);
    return avatar.tagAnchor;
  }

  remove(id: number): void {
    const avatar = this.avatars.get(id);
    if (!avatar) return;
    this.avatars.delete(id);
    this.freeSlots.push(avatar.slot);
    this.hideSlot(avatar.slot);
  }

  playEmote(id: number, emote: Emote, time: number): void {
    const avatar = this.avatars.get(id);
    if (!avatar) return;
    avatar.emote = emote;
    avatar.emoteStart = time;
  }

  private hideSlot(slot: number): void {
    this.bodies.setMatrixAt(slot, this.hidden);
    this.heads.setMatrixAt(slot, this.hidden);
    this.hats.setMatrixAt(slot, this.hidden);
    for (let k = 0; k < 2; k++) {
      this.hands.setMatrixAt(slot * 2 + k, this.hidden);
      this.eyes.setMatrixAt(slot * 2 + k, this.hidden);
    }
    this.markDirty();
  }

  private markDirty(): void {
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    this.hands.instanceMatrix.needsUpdate = true;
    this.eyes.instanceMatrix.needsUpdate = true;
    this.hats.instanceMatrix.needsUpdate = true;
  }

  /** Write the current part matrix (relative to the avatar root) into `mesh` at `index`. */
  private place(mesh: InstancedMesh, index: number): void {
    this.out.multiplyMatrices(this.root, this.part);
    mesh.setMatrixAt(index, this.out);
  }

  private setPart(
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    sx = 1,
    sy = 1,
    sz = 1,
  ): void {
    this.q.setFromEuler(this.euler.set(rx, ry, rz, 'YXZ'));
    this.part.compose(this.p.set(x, y, z), this.q, this.s.set(sx, sy, sz));
  }

  /** Pose one avatar for this frame. */
  update(id: number, pose: AvatarPose, time: number, dt: number): void {
    const avatar = this.avatars.get(id);
    if (!avatar) return;
    const slot = avatar.slot;

    const walking = pose.grounded && pose.speed > 0.4 ? Math.min(1, pose.speed / 5) : 0;
    avatar.walkAmount += (walking - avatar.walkAmount) * Math.min(1, dt * 10);
    avatar.airAmount += ((pose.grounded ? 0 : 1) - avatar.airAmount) * Math.min(1, dt * 12);
    avatar.walkPhase += dt * (5 + pose.speed * 1.4) * (walking > 0 ? 1 : 0.2);

    let emoteT = -1;
    if (avatar.emote) {
      emoteT = (time - avatar.emoteStart) / EMOTE_DURATION;
      if (emoteT >= 1) {
        avatar.emote = null;
        emoteT = -1;
      }
    }

    // Root: position and facing, plus whole-body motion from emotes.
    let lift = 0;
    let spin = 0;
    let sway = 0;
    if (avatar.emote === 'jump') {
      // Two happy hops, the second with a full spin.
      const hop = (emoteT * 2) % 1;
      lift = Math.sin(hop * Math.PI) * 0.8;
      if (emoteT > 0.5) spin = hop * Math.PI * 2;
    } else if (avatar.emote === 'dance') {
      sway = Math.sin(time * 9) * 0.22;
      spin = Math.sin(time * 3) * 0.6;
      lift = Math.abs(Math.sin(time * 9)) * 0.12;
    }
    const bob = Math.abs(Math.sin(avatar.walkPhase)) * 0.07 * avatar.walkAmount;
    const idleBreath = Math.sin(time * 2 + slot) * 0.012;
    this.q.setFromEuler(this.euler.set(0, pose.yaw + spin, sway * 0.5, 'YXZ'));
    this.root.compose(this.p.set(pose.x, pose.y + lift, pose.z), this.q, this.s.set(1, 1, 1));

    // Body: squash while running, stretch in the air.
    const stretch = 1 + avatar.airAmount * 0.08 - avatar.walkAmount * 0.03;
    const lean = avatar.walkAmount * 0.12;
    this.setPart(
      sway * 0.3,
      BODY_Y + bob + idleBreath,
      0,
      -lean,
      0,
      sway,
      1 / Math.sqrt(stretch),
      stretch,
      1 / Math.sqrt(stretch),
    );
    this.place(this.bodies, slot);

    // Head follows look pitch (softened) and bobs with the body.
    const headY = HEAD_Y + bob * 1.2 + idleBreath * 1.5 + avatar.airAmount * 0.05;
    const headPitch = -pose.pitch * 0.45 - lean * 0.5;
    this.setPart(sway * 0.6, headY, -lean * 0.4, headPitch, 0, sway * 1.2);
    this.place(this.heads, slot);

    // The toque sits on top of the head and tips with it.
    const crown = HEAD_RADIUS * 0.72;
    this.setPart(
      sway * 0.6 - Math.sin(sway * 1.2) * crown,
      headY + Math.cos(headPitch) * crown,
      -lean * 0.4 + Math.sin(headPitch) * crown,
      headPitch,
      0,
      sway * 1.2,
    );
    this.place(this.hats, slot);

    // Eyes sit on the front of the head and follow its pitch.
    const cosP = Math.cos(headPitch);
    const sinP = Math.sin(headPitch);
    for (let k = 0; k < 2; k++) {
      const ex = (k === 0 ? -1 : 1) * 0.105 + sway * 0.6;
      const localY = 0.06;
      const localZ = -HEAD_RADIUS + 0.035;
      this.setPart(
        ex,
        headY + localY * cosP - localZ * sinP,
        -lean * 0.4 + localY * sinP + localZ * cosP,
        headPitch,
        0,
        0,
        1,
        1.35,
        0.6,
      );
      this.place(this.eyes, slot * 2 + k);
    }

    // Hands: swing when walking, up in the air when jumping, waving or dancing.
    const swing = Math.sin(avatar.walkPhase) * 0.22 * avatar.walkAmount;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      let hx = side * 0.47;
      let hy = 0.72 + bob + avatar.airAmount * 0.35;
      let hz = side * swing;
      if (avatar.emote === 'wave' && side === 1) {
        hx = 0.5 + Math.sin(time * 14) * 0.12;
        hy = 1.62;
        hz = -0.05;
      } else if (avatar.emote === 'dance') {
        const beat = Math.sin(time * 9 + (side === 1 ? Math.PI : 0));
        hx = side * (0.5 + beat * 0.08);
        hy = 1.1 + beat * 0.45;
        hz = -0.1;
      } else if (avatar.emote === 'jump') {
        hx = side * 0.52;
        hy = 1.55;
        hz = 0;
      }
      this.setPart(hx + sway * 0.3, hy, hz, 0, 0, 0);
      this.place(this.hands, slot * 2 + k);
    }

    avatar.tagAnchor.set(pose.x, pose.y + lift + headY + HEAD_RADIUS + HAT_HEIGHT + 0.12, pose.z);
    this.markDirty();
  }
}
