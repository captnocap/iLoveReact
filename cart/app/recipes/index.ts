// Recipe corpus — single flat list. Every entry satisfies the strict
// RecipeDocument shape (prose + scaffold, both halves always present).
// The canvas picker reads from ALL_RECIPES via useCRUD('recipe') after
// the seedRecipes() routine upserts these into the user-sweatshop DB
// on first run.
//
// Add a new recipe? Drop a file in this directory matching the
// RecipeDocument schema, then add it to the import + array below.

import type { RecipeDocument } from "./recipe-document";

// ── Canvas-native scaffolds (full scaffold + tight prose) ───────────
import { recipe as starter }              from "./starter";
import { recipe as pathologyHalt }        from "./pathology-halt";
import { recipe as budgetWarn }           from "./budget-warn";
import { recipe as findingPromote }       from "./finding-promote";
import { recipe as mergeCelebrate }       from "./merge-celebrate";
import { recipe as mountLog }             from "./mount-log";
import { recipe as fsWatchRebuild }       from "./fs-watch-rebuild";
import { recipe as tickHeartbeat }        from "./tick-heartbeat";
import { recipe as kickOnError }          from "./kick-on-error";
import { recipe as hitlConfirm }          from "./hitl-confirm";
import { recipe as manifestAsTruth }      from "./manifest-as-truth";
import { recipe as apologyLoop }          from "./apology-loop";
import { recipe as deferralVocab }        from "./deferral-vocab";
import { recipe as performativeAck }      from "./performative-ack";
import { recipe as preExistingDeflection } from "./pre-existing-deflection";
import { recipe as lossNarrative }        from "./loss-narrative";
import { recipe as prematureStop }        from "./premature-stop";
import { recipe as causalWithoutTrace }   from "./causal-without-trace";
import { recipe as stuckLoop }            from "./stuck-loop";
import { recipe as constraintGate }       from "./constraint-gate";

// ── Long-form ports (full prose + sentinel scaffold pending authoring) ──
// Each ships a `// TODO: author scaffold` body. Find them with:
//   grep -rn "TODO: author scaffold" cart/app/recipes/
import { recipe as buildAgentsMemory }    from "./build-agents-that-remember-your-users";
import { recipe as characterCreator }     from "./character-creator";
import { recipe as contextLongRunning }   from "./context-management-for-long-running-agents";
import { recipe as context200k }          from "./context-management-on-a-200k-token-window";
import { recipe as frontendAesthetics }   from "./frontend-aesthetics-prompting-guide";
import { recipe as gemmaLineGate }        from "./gemma-line-gate-for-claude-edits";
import { recipe as cropTool }             from "./giving-claude-a-crop-tool-for-better-image-analysis";
import { recipe as knowledgeGraph }       from "./knowledge-graph-construction-with-claude";
import { recipe as localRag }             from "./local-rag-claude-logs";
import { recipe as onboarding }           from "./onboarding-first-impression";
import { recipe as personalityQuiz }      from "./personality-quiz-engine";
import { recipe as sreIncidentResponse }  from "./sre-incident-response-agent";

export const ALL_RECIPES: RecipeDocument[] = [
  // Canvas-native scaffolds
  starter, pathologyHalt, budgetWarn, findingPromote, mergeCelebrate,
  mountLog, fsWatchRebuild, tickHeartbeat, kickOnError, hitlConfirm,
  manifestAsTruth, apologyLoop, deferralVocab, performativeAck,
  preExistingDeflection, lossNarrative, prematureStop, causalWithoutTrace,
  stuckLoop, constraintGate,

  // Long-form ports
  buildAgentsMemory, characterCreator, contextLongRunning, context200k,
  frontendAesthetics, gemmaLineGate, cropTool, knowledgeGraph, localRag,
  onboarding, personalityQuiz, sreIncidentResponse,
];

export type { RecipeDocument, RecipeSection, RecipeScaffold } from "./recipe-document";
export { wrapScaffold } from "./recipe-document";
