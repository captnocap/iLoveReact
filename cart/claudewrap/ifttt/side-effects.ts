// Single side-effect import point for every IFTTT primitive the cart
// needs registered at module load. Pulling them in here makes the
// full DSL surface available to RecipesPage autocomplete + lets carts
// use them via real useIFTTT() calls.
//
// runtime/package.json's sideEffects list keeps these from being
// tree-shaken away when only the side-effect import is present.

import '../../../runtime/hooks/ifttt/permission';
import '../../../runtime/hooks/ifttt/match';
import '../../../runtime/hooks/ifttt/count';
import '../../../runtime/hooks/ifttt/firsthit';
import '../../../runtime/hooks/ifttt/repeat';
import '../../../runtime/hooks/ifttt/turn-tracker';
import '../../../runtime/hooks/ifttt/supervisor';
import '../../../runtime/hooks/ifttt/vm';
