import { checkClearance } from './viewmodelClearance.helpers.ts';

/**
 * The knife never passes through the hand on screen: the knives with a ring at the butt, the
 * karambit's on the index finger.
 */
checkClearance(['karambit', 'talon', 'skeleton']);
