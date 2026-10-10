import { checkClearance } from './viewmodelClearance.helpers.ts';

/**
 * The knife never passes through the hand on screen: the knives that fold, the butterfly with its
 * free handle, the flip knife and the stiletto.
 */
checkClearance(['butterfly', 'flip', 'stiletto']);
