/**
 * Messages between the main thread (computer.ts) and the machine's worker (worker.ts).
 * Frames travel as bare Uint8ClampedArrays (320 x 200 RGBA) whose buffers are transferred,
 * one way with a picture in it and back empty, so neither side allocates per frame.
 */

import type { Engine } from './machine.ts';

export type ToWorker =
  | { type: 'boot'; programUrl: string; diskUrl: string; args: string }
  | { type: 'run' }
  | { type: 'pause' }
  | { type: 'key'; key: number; typed: number; down: boolean }
  /** Mouse counts moved right since the last message, and the buttons held (machine.h). */
  | { type: 'mouse'; dx: number; buttons: number }
  | Uint8ClampedArray<ArrayBuffer>;

export type FromWorker =
  | { type: 'running'; engine: Engine }
  | { type: 'failed'; message: string }
  | { type: 'console'; line: string }
  | Uint8ClampedArray<ArrayBuffer>;
