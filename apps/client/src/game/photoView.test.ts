import { describe, expect, it } from 'vitest';
import { photoView } from './photoView.ts';

describe('photoView', () => {
  it('reads a position and a look from the address', () => {
    expect(photoView('?quality=high&view=1.5,1.62,-3,0.4,-0.1')).toEqual({
      x: 1.5,
      y: 1.62,
      z: -3,
      yaw: 0.4,
      pitch: -0.1,
    });
  });

  it('asks for nothing without a view, or with a malformed one', () => {
    expect(photoView('?quality=high')).toBeNull();
    expect(photoView('?view=1,2,3')).toBeNull();
    expect(photoView('?view=1,2,3,a,0')).toBeNull();
    expect(photoView('?view=')).toBeNull();
  });
});
