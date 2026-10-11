import { checkClearance } from './viewmodelClearance.helpers.ts';

/**
 * The knife never passes through the hand on screen: the fixed blades held in the fist, which the
 * wrist shows from every side.
 */
checkClearance(['kitchen', 'm9', 'bayonet', 'huntsman']);
