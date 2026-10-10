import { checkClearance } from './viewmodelClearance.helpers.ts';

/**
 * The knife never passes through the hand on screen: the falchion and the gut knife, whose handles
 * curve and hook.
 */
checkClearance(['falchion', 'gut']);
