import { checkClearance } from './viewmodelClearance.helpers.ts';

/**
 * The knife never passes through the hand on screen: the fixed blades held in the fist, which spin
 * on the index finger by their spines.
 */
checkClearance(['kitchen', 'm9', 'bayonet', 'huntsman']);
