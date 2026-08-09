# Model Recovery Surface — Phase 4 Decomposition Map

This phase decomposes every high/critical unit from the inventory. Names are local to each
owner; overlap is intentional and is resolved only in `REUSE_MAP.md`.

## A. `indexed_edit_mesh.zig` — authored topology and operation truth

### `fromSoupInternal` / `buildFaceFromBucket`

1. `bucketRenderTrianglesByAuthoredGroup`
2. `validateBucketMetadataUniformity`
3. `countUndirectedBucketEdges`
4. `walkDirectedBucketBoundary`
5. `classifyBoundaryFailure`
6. `recordDegradedSourceGroup`
7. `appendDegradedTriangleFaces`
8. `recoverQuadPhysicalDiagonal`
9. `publishFaceBuildIssues`

### New complete face-facts read

1. `resolveAliveFace`
2. `readOrderedLogicalLoop`
3. `measureAuthoredPolygonArea`
4. `measurePerimeterAndEdgeExtrema`
5. `measurePlanarityDeviation`
6. `classifyConvexity`
7. `classifyDegeneracy`
8. `computeDocumentedAspectRatio`
9. `invokeFacePolygonFramePredicate`
10. `attachBuildProvenance`
11. `returnFaceFactsWithoutMutation`

### Loop-cut diagnostic adapter

1. `constructFaceSelectionMask`
2. `resolveLoopSeedUsingExistingSeedInfo`
3. `invokeExistingLoopCutCandidate`
4. `captureStructuredLoopCutRefusal`
5. `returnAllowedBlockedOrNotAnalyzed`

### Bevel / Face→N-gon diagnostic adapter

1. `resolveExistingBevelTarget`
2. `invokeExistingBevelLimit`
3. `invokeExistingFacePolygonFrame`
4. `mapCanonicalPredicateStageToCode`
5. `returnAllowedBlockedOrNotAnalyzed`

### Merge/extrude/solidify adapters

Each owner must separately decompose:

1. `defineNonMutatingEligibilityInput`
2. `extractCurrentMutationPredicate`
3. `invokePredicateFromMutationAndDiagnosticPaths`
4. `returnStructuredReasonData`
5. `proveMutationAndDiagnosticReceiptsAgree`

Until all five exist for an operation, its face-table cell remains `not_analyzed`.

## B. `mesh_audit.zig` / audit orchestration

1. `allocateIntersectionAndReachabilityMarks`
2. `runAuditOnceForDocument`
3. `preserveAuditComputedState`
4. `aggregateTriangleMarksByFaceId`
5. `countMarkedMembersPerAuthoredFace`
6. `discardMarksAfterTableSnapshot`

## C. `3d.zig` — live session coordinator

### Resident snapshot acquisition

1. `resolveExpectedSessionToken`
2. `rejectEmptyOrStaleSession`
3. `composeVisibleAndHiddenRecoveryBlocks`
4. `recordEveryRecoveredChannelInFixedSlotsAndSemanticJson`
5. `copyOwnedRecoverySnapshotAcrossModuleABI`
6. `returnTokenGenerationFingerprintNamespaceAndDegradations`

### Resident face-table coordinator

1. `resolveExpectedSessionToken`
2. `requirePublishedStableRangeObjectIds`
3. `ensureIndexedEditMeshForRead`
4. `copyBoundedImmutablePlaneInputOnOwnerThread`
5. `returnTypedAnalysisPendingReceipt`
6. `runFaceFactsAuditAndEligibilityOnBoundedWorker`
7. `adoptOnlyMatchingFullPlaneIdentity`
8. `emitMainThreadAnalysisReadyEvent`
9. `sortFilterAndPageCompletedSnapshot`
10. `serializeVersionedFaceTable`

### Face-table selection

1. `resolveExpectedSessionAndGeneration`
2. `resolveObjectAndAuthoredGroup`
3. `replaceNativeFaceSelection`
4. `frameSelectionWithExistingOrbitAuthority`
5. `emitCompactSelectionAddressEvent`
6. `seekContainingPageByAddressAndQuery`
7. `returnExactSelectedTriangleCount`

### Historical RJMD resident adoption

1. `decodeValidatedHistoricalDocument`
2. `captureCurrentJournalSnapshot`
3. `installEveryRJMDChannel`
4. `restoreObjectRangesAndSemanticTable`
5. `restoreSelectionOrSelectNone`
6. `commitOneHistoricalRestoreJournalEntry`
7. `emitNewMeshKeyGenerationAndFingerprint`
8. `rollbackSnapshotOnAnyInstallFailure`

### Isolated RJMD preview

1. `consumeOpaqueLoreCapabilityOrConfinedSavedBytes`
2. `decodeAndOwnReadOnlySpecimen`
3. `returnOpaqueScenePreviewToken`
4. `routeShadedRenderAndPickingToPreview`
5. `stashPreviewFaceAddressMap`
6. `selectPreviewFaceWithoutTouchingResident`
7. `restoreRenderAndPickingToParkedResident`
8. `releaseSceneTokenAndLoreCapabilityAsPair`

### Full saved/resident comparison

1. `receiveVerifiedSavedBytesInsideLiveModule`
2. `encodeCurrentResidentAndRetainTransientDenseMap`
3. `resolveExactArtifactOrEncodeReceiptCorrespondence`
4. `resolveUniqueIncidenceCorrespondenceForOlderArtifacts`
5. `markAmbiguousFieldsIncomparable`
6. `compareEveryDurableFieldWithoutGeometryJSON`
7. `sortFilterPageCompactDiffRows`

## D. `meshdoc_format.zig` — saved/candidate document

### Saved-plane analysis

1. `decodeVersionedDocument`
2. `validateLogicalAndRangeChannels`
3. `composeIsolatedIndexedDocument`
4. `retainBuildIssuesAndObjectIds`
5. `invokeFaceTableService`
6. `returnArtifactSHAFormatAndRows`

### Guarded field candidate

1. `validateEditableFieldPath`
2. `copyDecodedDocument`
3. `applyTypedFieldValue`
4. `encodeCurrentV5Candidate`
5. `decodeCandidateReadback`
6. `compareChangedField`
7. `compareUnchangedFingerprints`
8. `returnOwnedCandidateBytes`

## E. `framework/vcs/snapshot.zig` — revision policy

### `snapshotJson`

1. `parsePublicPanicOrInternalReceiptBackedRequest`
2. `rejectPublicTransactionEventKindsAndReplayedReceipts`
3. `acceptOwnedSnapshotFromScene3DABIOrNativeTransaction`
4. `crossValidateFixedDegradationsAgainstRJMDProvenance`
5. `computeCanonicalBrowseFacts`
6. `allocateSortableImmutableSnapshotId`
7. `commitImmutableResidentAndEvent`
8. `rereadCommittedBytesAndResolveIntroducingRevision`
9. `commitRebuildableHistoryIndexHint`
10. `returnIndexedFalseWhenOnlyIndexCommitFails`
11. `releaseMutationLock`
12. `optionallyPushAndRefreshRemoteWatermark`
13. `returnPushedLocalOrUnknownOutcome`

### `historyJson`

1. `parseHistoryPageRequest`
2. `enforceImmediateSixtyDayCeiling`
3. `repairIndexFromEventPathsAndFileHistory`
4. `readCanonicalCommittedEvents`
5. `joinPinRegistryAndRemoteAncestryTruth`
6. `returnTypedPagedRows`

### `pruneExpiredJson`

1. `repairIndexAndPartitionAtHardSixtyDayAge`
2. `commitPruningTombstonesAndRemovePins`
3. `hideTombstonesFromBrowseAndRestore`
4. `obliteratePathsAndRecordPartialOutcomes`
5. `queryStageAndCommitLoreDeletes`
6. `pushRewrittenAncestryForKnownRemoteEntries`
7. `verifyRemoteRevisionAbsenceOrRetainRemotePending`
8. `compactCompletedTombstones`
9. `runRepositoryGarbageCollectionBestEffort`
10. `persistLogicalAndPhysicalFactsOutsideRepository`
11. `leaveVerifiedSnapshotOutcomeIndependent`

### Legacy shared-path cutover

1. `detectAndEnumerateEveryLegacyEventAddress`
2. `classifyByOriginalTimestampBeforeAnyObliteration`
3. `dumpAndHashVerifyEachHealthyUnexpiredPair`
4. `allocateIdempotentImmutableIdAndPreserveMetadata`
5. `commitVerifyAndRecordOldToNewMapping`
6. `surfaceUnexpiredCorruptOrUnmigratedDiagnostic`
7. `retainSharedPathsWhileAnyUnexpiredBlockerExists`
8. `obliterateOnlyAfterMigrationOrAgeOut`
9. `completeRemoteAncestryCleanupAndPersistCutoverState`

### `previewJson`

1. `resolveSnapshotIdAndValidateRevisionShaGuards`
2. `dumpVerifyAndRetainOwnedRJMDBytes`
3. `allocateOpaqueLorePreviewCapability`
4. `returnCapabilityAndFingerprintWithoutPath`
5. `releaseCapabilityIdempotently`

### `restoreJson`

1. `resolveSnapshotIdAndValidateRevisionShaAgeAndTargetSHA`
2. `retainDecodedCandidateBehindOpaqueCapability`
3. `returnValidatedCapabilityToEditorCoordinator`
4. `avoidHiddenResidentOrManifestMutation`

### `serverStatusJson` / status monitor

1. `probeLibraryAndLocalRepository`
2. `probeHTTPAndUnitOffRenderThread`
3. `readJournalTailAndRestoreCommands`
4. `measureLocalAndServerStores`
5. `cacheImmutableStatus`
6. `enqueueOwnedMaterialTransitionOnBoundedQueue`
7. `drainOnMainThreadThroughV8Binding`
8. `emitThroughFfiChannel`

## F. `v8_bindings_lore.zig` / modular ABI

1. `parseExpectedSessionIdentity`
2. `callScene3DModuleSnapshotABI`
3. `ownSnapshotMemoryInColdHost`
4. `callSnapshotService`
5. `freeOwnedSnapshotAcrossDefiningAllocatorBoundary`
6. `registerTypedLoreDoors`
7. `drainStatusQueueOnOwnerThread`

The current direct `@import("gpu/3d.zig")` snapshot path is not retained.

## G. `runtime/vcs/lore.ts` — typed declarative contract

1. `importSharedRecoveryDegradationSchema`
2. `definePublicPanicRequestAndResponse`
3. `keepVerifiedSaveReceiptCapturePackageInternal`
4. `omitNativeTransactionAppendFromPublicExports`
5. `defineHistoryPageAndEntry`
6. `definePreviewResponse`
7. `definePinResponse`
8. `defineRestoreCandidateResponse`
9. `defineServerStatusResponse`
10. `parseAndValidateHostResponse`
11. `preserveNativeErrorCodesDetailsAndDegradations`

## H. `Inspector.tsx` / `ModelView.tsx`

### Persistent model/recovery layout

1. `retainSingleKeyedModelView`
2. `renderBlobExplorerThroughRightPaneWithoutRemount`
3. `publishResidentSessionTokenAndGeneration`
4. `routeCompactSelectionEvents`
5. `routeHistoricalPreviewMeshKey`
6. `adoptHistoricalRestoreReceiptWithoutRemount`

### ModelFocus bridge additions

1. `readFaceTablePage`
2. `selectAndFrameFaceAddress`
3. `seekPageContainingFaceAddress`
4. `readSelectedFaceAddresses`
5. `openAndReleaseRevisionPreview`
6. `dispatchExistingVerbForSelectedRow`
7. `acquireAndReleaseOperationBoundLease`

## I. `BlobExplorerSurface.tsx` — visible workspace

### Shell/layout

1. `renderFacesVersionsServiceTabs`
2. `reuseSingleCenterViewport`
3. `selectCompactWideOrCollapsedPreset`
4. `persistPanelPresetInEditorState`
5. `renderLoadingEmptyErrorStaleStates`

### Faces tab

1. `requestFaceTablePageOnGenerationChange`
2. `renderSortableColumnHeaders`
3. `renderExplicitFilterChips`
4. `virtualizeOrPageAuthoredRows`
5. `expandTriangleMembers`
6. `selectRowThroughNativeBridge`
7. `followNativeSelectionAddress`
8. `renderDerivedUnknownVsBlockedVsReady`
9. `renderExactPlaneDiffFields`

### Versions tab

1. `requestHistoryPage`
2. `renderRevisionFacts`
3. `capturePanicLabelAndNote`
4. `togglePinThroughLore`
5. `previewRevisionWithoutCheckout`
6. `confirmRestore`
7. `displayPreRestoreAndRestoreReceipts`
8. `expandRecoveryDegradationRows`

### Service tab

1. `subscribeToNativeStatusCache`
2. `renderHealthRepositoryAndStoreFacts`
3. `renderJournalTailAndRestoreCommands`
4. `renderPushedLocalUnknownAndRemotePruneState`
5. `renderLegacyMigrationBlockersAndCutoverState`

## J. `AppFrame.tsx` — editor policy coordinator

1. `providePersistentRecoverySnapshotCallbackToInspector`
2. `resolveActiveModelSessionIdentity`
3. `routePanicSnapshotWithoutOrdinarySave`
4. `openCloseRecoveryWorkspace`
5. `coordinatePreRestoreSnapshot`
6. `consumeOneUseVerifiedSaveReceiptForNormalEvent`
7. `coordinateNativeResidentAdoption`
8. `coordinateTransactionalPackagePersistence`
9. `routeRollbackOnPersistenceFailure`
10. `publishStatusWithoutFlatteningNativeErrors`

## K. `seatApi.ts` / `tools/seat`

1. `parseFaceTableSortAndFilterCLI`
2. `routeFaceTableToCanonicalHostDoor`
3. `preserveGenerationAndPagination`
4. `printSameRowsAsUIContract`
5. `selectFaceAddressWithGenerationGuard`
6. `classifyLoreOperationReadOrMutation`
7. `requireNativeLeaseForNewMutationActions`
8. `documentUnknownOperationEligibility`

## L. Package persistence and guarded edits

1. `acquireNativeModelWriteLease`
2. `requireZeroFullPlaneDiffAndExpectedSHAs`
3. `createVerifiedLoreAndPackagePredecessors`
4. `requestNativeTypedCandidateEncoding`
5. `decodeAndValidateOwnedCandidate`
6. `adoptCandidateIntoResidentJournal`
7. `writeCandidateToSiblingTemporaryArtifact`
8. `atomicallyInstallAndRereadArtifact`
9. `requireResidentCandidateSavedSHAAndZeroDiff`
10. `rollbackDiskAndResidentReceiptsOnFailure`
11. `releaseLeaseThenAppendBestEffortFieldEditEvent`

## M. High-fragility verification decompositions

1. `buildMalformedBoundaryFixtureInMemory`
2. `buildTwoMillimetreSliverFixtureInMemory`
3. `proveAreaAscendingFirstRow`
4. `proveRowAndViewportSelectSameAuthoredFace`
5. `proveSavedResidentSemanticAndRangeDiff`
6. `bootModularEditorHostWithResidentModel`
7. `proveLorePreviewSHAEqualsVisibleResident`
8. `provePreviewDoesNotMutateSession`
9. `proveRestoreOneJournalEntryAndUndoRedo`
10. `proveNoOriginalImportFallback`
11. `proveNoPerFrameStatusOrTablePolling`
12. `proveRealModularPaneKeepsSessionIdentity`
13. `proveImmediateExpiryAndRemotePruneAncestry`
14. `proveIdenticalContentSurvivesSiblingObliteration`
15. `proveEveryRecoveryFallbackIsPersistedAndVisible`
16. `proveLegacyUnexpiredHistoryMigratesBeforeObliteration`
17. `provePublicCallerCannotForgeTransactionEvents`
