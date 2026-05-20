// Shared cart-wide types. Each surface (pages/, window/, bridge/) folds
// in its own typed module under its directory; this file holds names
// referenced by more than one surface.

export type TabId = 'main' | 'ifttt' | 'recipes' | 'help';

/** One live useIFTTT(trigger, action) binding, edited in RecipesPage. */
export interface RecipeRule {
  id: string;
  label: string;
  /** Real IFTTT DSL trigger string (e.g. 'permission:any'). */
  trigger: string;
  /** Real IFTTT DSL action string (e.g. 'approve-if-target-ext:.md,.txt'). */
  action: string;
  enabled: boolean;
  /** Where this rule came from — for provenance in the UI. */
  source: 'live' | 'library' | 'sweatshop';
}

/** One row in the IFTTT activity feed (claude-ss log + bus events). */
export interface IftttEvent {
  event: string;
  ts: number;
  payload: any;
  raw: string;
}
