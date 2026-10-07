/** The few icons, drawn as inline SVG so they take the text color and need no requests. */

const SVG = 'http://www.w3.org/2000/svg';

export function svg(
  viewBox: string,
  shapes: readonly (readonly [string, Record<string, string>])[],
) {
  const root = document.createElementNS(SVG, 'svg');
  root.setAttribute('viewBox', viewBox);
  root.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attrs)) shape.setAttribute(name, value);
    root.append(shape);
  }
  return root;
}

/** A chef's knife side on, tip to the left: the blade's belly curving up to the tip, two rivets. */
export function knifeIcon(): SVGSVGElement {
  return svg('0 0 76 20', [
    ['path', { d: 'M1 8.2 L47 4 V15.6 C31 15.6 12 13.6 1 8.2 Z' }],
    ['rect', { x: '47', y: '3.4', width: '3.2', height: '12.8', rx: '0.8' }],
    ['rect', { x: '50.2', y: '5.6', width: '25', height: '8.4', rx: '3' }],
    ['circle', { class: 'loadout-rivet', cx: '58', cy: '9.8', r: '1.25' }],
    ['circle', { class: 'loadout-rivet', cx: '67', cy: '9.8', r: '1.25' }],
  ]);
}

/** A clenched fist from the front: four knuckles over the palm, the thumb folded across. */
export function fistIcon(): SVGSVGElement {
  return svg('0 0 30 26', [
    ['rect', { x: '4', y: '9', width: '24', height: '16', rx: '5' }],
    ['rect', { class: 'loadout-cut', x: '4', y: '2', width: '6.5', height: '11', rx: '3.2' }],
    ['rect', { class: 'loadout-cut', x: '9.8', y: '1', width: '6.5', height: '12', rx: '3.2' }],
    [
      'rect',
      { class: 'loadout-cut', x: '15.6', y: '1.5', width: '6.5', height: '11.5', rx: '3.2' },
    ],
    ['rect', { class: 'loadout-cut', x: '21.4', y: '3', width: '6.5', height: '10', rx: '3.2' }],
    ['rect', { class: 'loadout-cut', x: '1', y: '12.5', width: '17', height: '6.5', rx: '3.2' }],
  ]);
}
