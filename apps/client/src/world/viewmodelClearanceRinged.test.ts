import { checkClearance } from './viewmodelClearance.helpers.ts';

/**
 * The knife never passes through the hand on screen: the knives spun on the index finger through a
 * ring.
 */
checkClearance(['karambit', 'talon', 'skeleton']);
