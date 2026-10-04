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
import { KNIFE_COOLDOWN_MS, MAX_PLAYERS_PER_ROOM } from '@world/shared';
import type { Pose } from '../net/interpolation.ts';
import { GRIP, knifeGeometry, knifeMaterial } from './knifeModel.ts';

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
/** A throw: wind up, then whip the knife hand forward. */
const THROW_DURATION = 0.32;
/** The knife leaves the hand this far into the throw. */
const RELEASE = 0.55;
/** A punch: the right fist jabs straight out in front of the face and comes back. */
const PUNCH_DURATION = 0.36;
/** The held knife points forward and a little up. */
const KNIFE_TILT = 0.5;

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
  /** World time the last throw started, or -Infinity. */
  throwStart: number;
  /** World time the last punch started, or -Infinity. */
  punchStart: number;
  /** 0 standing, 1 knocked out flat on their back. */
  fallAmount: number;
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
  /** The knife in each cook's right hand. */
  private readonly knives: InstancedMesh;
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
    this.knives = new InstancedMesh(knifeGeometry(), knifeMaterial(), capacity);
    for (const mesh of [this.bodies, this.heads, this.hands, this.eyes, this.hats, this.knives]) {
      mesh.frustumCulled = false;
      mesh.castShadow = mesh !== this.eyes && mesh !== this.knives;
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
      throwStart: -Infinity,
      punchStart: -Infinity,
      fallAmount: 0,
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

  /** Swing the knife hand: this cook just threw. */
  playThrow(id: number, time: number): void {
    const avatar = this.avatars.get(id);
    if (avatar) avatar.throwStart = time;
  }

  /** Jab the right fist: this cook just punched. */
  playPunch(id: number, time: number): void {
    const avatar = this.avatars.get(id);
    if (avatar) avatar.punchStart = time;
  }

  private hideSlot(slot: number): void {
    this.knives.setMatrixAt(slot, this.hidden);
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
    this.knives.instanceMatrix.needsUpdate = true;
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

    // Root: position and facing.
    const bob = Math.abs(Math.sin(avatar.walkPhase)) * 0.07 * avatar.walkAmount;
    const idleBreath = Math.sin(time * 2 + slot) * 0.012;
    // Knocked out: topple backward onto the floor, raised by the body's thickness so it lies on it.
    avatar.fallAmount += ((pose.dead ? 1 : 0) - avatar.fallAmount) * Math.min(1, dt * 7);
    const fall = avatar.fallAmount;
    const topple = fall * fall * (Math.PI / 2);
    this.q.setFromEuler(this.euler.set(topple, pose.yaw, 0, 'YXZ'));
    this.root.compose(
      this.p.set(pose.x, pose.y + fall * BODY_RADIUS * 0.9, pose.z),
      this.q,
      this.s.set(1, 1, 1),
    );

    // Body: squash while running, stretch in the air.
    const stretch = 1 + avatar.airAmount * 0.08 - avatar.walkAmount * 0.03;
    const lean = avatar.walkAmount * 0.12;
    this.setPart(
      0,
      BODY_Y + bob + idleBreath,
      0,
      -lean,
      0,
      0,
      1 / Math.sqrt(stretch),
      stretch,
      1 / Math.sqrt(stretch),
    );
    this.place(this.bodies, slot);

    // Head follows look pitch (softened) and bobs with the body.
    const headY = HEAD_Y + bob * 1.2 + idleBreath * 1.5 + avatar.airAmount * 0.05;
    const headPitch = -pose.pitch * 0.45 - lean * 0.5;
    this.setPart(0, headY, -lean * 0.4, headPitch, 0, 0);
    this.place(this.heads, slot);

    // The toque sits on top of the head and tips with it.
    const crown = HEAD_RADIUS * 0.72;
    this.setPart(
      0,
      headY + Math.cos(headPitch) * crown,
      -lean * 0.4 + Math.sin(headPitch) * crown,
      headPitch,
      0,
      0,
    );
    this.place(this.hats, slot);

    // Eyes sit on the front of the head and follow its pitch.
    const cosP = Math.cos(headPitch);
    const sinP = Math.sin(headPitch);
    for (let k = 0; k < 2; k++) {
      const ex = (k === 0 ? -1 : 1) * 0.105;
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

    // A throw in progress, as a fraction of its swing, or -1.
    let throwT = (time - avatar.throwStart) / THROW_DURATION;
    if (throwT >= 1) throwT = -1;
    // A punch in progress, likewise.
    let punchT = (time - avatar.punchStart) / PUNCH_DURATION;
    if (punchT < 0 || punchT >= 1) punchT = -1;

    // Hands: swing when walking, up in the air when jumping.
    const swing = Math.sin(avatar.walkPhase) * 0.22 * avatar.walkAmount;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      let hx = side * 0.47;
      let hy = 0.72 + bob + avatar.airAmount * 0.35;
      let hz = side * swing;
      if (side === 1 && throwT >= 0) {
        // Wind up behind the shoulder, then whip forward past the face.
        const whip = throwT < RELEASE ? 0 : (throwT - RELEASE) / (1 - RELEASE);
        const windUp = Math.min(1, throwT / RELEASE);
        hx = 0.42;
        hy = 1.2 + windUp * 0.35 - whip * 0.45;
        hz = 0.22 * windUp - whip * 0.75;
      } else if (side === 1 && punchT >= 0) {
        // Out fast, back slower: the fist reaches full stretch a third of the way in.
        const reach =
          punchT < 0.3 ? Math.sin((punchT / 0.3) * (Math.PI / 2)) : 1 - (punchT - 0.3) / 0.7;
        const out = reach * reach * (3 - 2 * reach);
        hx += (0.22 - hx) * out;
        hy += (1.22 - hy) * out;
        hz += (-0.72 - hz) * out;
      }
      this.setPart(hx, hy, hz, 0, 0, 0);
      this.place(this.hands, slot * 2 + k);
      if (side === 1) {
        // The knife in the right hand, gripped by its handle, unless it is in flight or they are down.
        const reloaded = time - avatar.throwStart > KNIFE_COOLDOWN_MS / 1000;
        const inHand = pose.armed && fall < 0.05 && (throwT < 0 ? reloaded : throwT < RELEASE);
        if (inHand) {
          const tilt = throwT >= 0 ? KNIFE_TILT + Math.min(1, throwT / RELEASE) * 1.4 : KNIFE_TILT;
          this.setPart(hx, hy + Math.sin(tilt) * GRIP, hz - Math.cos(tilt) * GRIP, tilt, 0, 0);
          this.place(this.knives, slot);
        } else {
          this.knives.setMatrixAt(slot, this.hidden);
        }
      }
    }

    // The name tag floats over the head, wherever it is: standing, or on the floor after a fall.
    this.p.set(0, headY, 0).applyMatrix4(this.root);
    const above = (HEAD_RADIUS + HAT_HEIGHT) * (1 - fall) + HEAD_RADIUS * fall + 0.12;
    avatar.tagAnchor.set(this.p.x, this.p.y + above, this.p.z);
    this.markDirty();
  }
}
