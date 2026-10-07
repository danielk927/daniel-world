import type { KnifeSkin } from '@world/shared';
import { knifeSilhouette } from '../world/knifeModel.ts';
import { knifeIcon } from './icons.ts';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * A knife's icon, side on and tip to the left, in the text color: drawn from its model's outline,
 * except the chef's knife, which keeps its hand-drawn icon. `align` places a knife of another
 * shape in the icon's box: `end` puts its handle against the right edge, like the loadout's rail.
 */
export function skinIcon(skin: KnifeSkin, align: 'center' | 'end' = 'center'): SVGSVGElement {
  if (skin === 'kitchen' && align === 'end') return knifeIcon();
  const { viewBox, paths } = knifeSilhouette(skin);
  const root = document.createElementNS(SVG, 'svg');
  root.setAttribute('viewBox', viewBox);
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('preserveAspectRatio', align === 'end' ? 'xMaxYMid meet' : 'xMidYMid meet');
  for (const d of paths) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill-rule', 'evenodd');
    root.append(path);
  }
  return root;
}
