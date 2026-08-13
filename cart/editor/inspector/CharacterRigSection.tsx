// Character Rig Inspect / Bind controls. The viewport and native session
// own all resident geometry, deformation, picking, heatmaps, and gizmos; this
// component renders compact snapshots and sends revision-checked intents.

import * as React from 'react';
import { Slider } from '../../../runtime/primitives';
import {
  HUMANOID_RIG_TUNING,
  type CharacterRigApi,
  type CharacterRigCommand,
  type CharacterRigSelectionInspection,
  type CharacterRigSnapshot,
  type CharacterRigTestPoseName,
  type HumanoidSemanticMembership,
  type Transform,
} from '../../../runtime/skeleton';
import { C, accentFor } from '../workspace.cls';
import {
  HUMANOID_SEMANTIC_ROLE_CHOICES,
  humanoidSemanticRoleKey,
  type HumanoidSemanticRoleChoice,
} from '../skeleton/humanoidSemanticAssignment';
import { exists, listDir } from '../../../runtime/hooks/fs';
import { MOTION_LIBRARY_DIR } from '../skeleton/motionDocuments';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const POSITION_STEP_METERS = 0.01;
const FRAME_ROTATION_STEP_DEG = 1;
const CONSTRAINT_STEP_DEG = 1;

function normalizedQuaternion(value: [number, number, number, number]): [number, number, number, number] {
  const length = Math.hypot(...value);
  if (!Number.isFinite(length) || length < 1e-9) return [0, 0, 0, 1];
  return value.map((component) => component / length) as [number, number, number, number];
}

/** Post-multiply so X/Y/Z are the selected bone's local frame axes. */
function rotateLocalFrame(transform: Required<Transform>, axis: 0 | 1 | 2, degrees: number): Transform {
  const half = degrees * DEG_TO_RAD * 0.5;
  const delta: [number, number, number, number] = [0, 0, 0, Math.cos(half)];
  delta[axis] = Math.sin(half);
  const [ax, ay, az, aw] = transform.rot;
  const [bx, by, bz, bw] = delta;
  return {
    ...transform,
    rot: normalizedQuaternion([
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    ]),
  };
}

function frameEulerDegrees(rotation: [number, number, number, number]): [number, number, number] {
  const [x, y, z, w] = normalizedQuaternion(rotation);
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
  return [
    Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * RAD_TO_DEG,
    pitch * RAD_TO_DEG,
    Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * RAD_TO_DEG,
  ];
}

function dispatch(
  api: CharacterRigApi | null,
  command: CharacterRigCommand,
  onSnapshot: (snapshot: CharacterRigSnapshot) => void,
  onStatus: (message: string) => void,
  onMutated: () => void,
): boolean {
  if (!api?.available()) {
    onStatus('character rig host is unavailable — restart into the rebuilt editor');
    return false;
  }
  try {
    onSnapshot(api.command(command));
    if (command.kind === 'undo' || command.kind === 'redo' ||
        command.kind === 'fitSkeleton' || command.kind === 'setJointTransform' ||
        command.kind === 'setJointConstraint' || command.kind === 'setJointLock' ||
        command.kind === 'setSemanticBinding' ||
        command.kind === 'setObjectBinding' || command.kind === 'autoBind') {
      onMutated();
    }
    return true;
  } catch (error) {
    onStatus(error instanceof Error ? error.message : String(error));
    return false;
  }
}

export function guidedBonePrompt(choice: HumanoidSemanticRoleChoice): string {
  const side = choice.side === 'left' ? 'anatomical left' : choice.side === 'right' ? 'anatomical right' : '';
  switch (choice.role) {
    case 'pelvis': return 'Select the central hip joint where the spine and both upper legs branch.';
    case 'abdomen': return 'Select the first center-spine joint immediately above the pelvis.';
    case 'chest': return 'Select the upper-torso center joint below the neck where the shoulder chains originate.';
    case 'head': return 'Select the main joint centered at the base of the head, not an eye, jaw, or facial tip.';
    case 'upper_arm': return `Select the ${side} shoulder joint at the start of the upper arm, after any clavicle joint.`;
    case 'lower_arm': return `Select the ${side} elbow joint at the start of the forearm.`;
    case 'hand': return `Select the ${side} wrist/palm root—the joint from which the finger chains branch.`;
    case 'upper_leg': return `Select the ${side} hip-side joint at the top of the thigh.`;
    case 'lower_leg': return `Select the ${side} knee joint at the start of the lower leg.`;
    case 'foot': return `Select the ${side} ankle/foot root, before any toe joint.`;
    case 'neck': return 'Select the center joint between the chest and head.';
    case 'clavicle': return `Select the ${side} shoulder-girdle joint between the chest and upper arm.`;
    case 'fingers': return `Select the ${side} shared finger root or primary finger control.`;
    case 'toes': return `Select the ${side} toe root after the foot joint.`;
  }
}

function sectionHead(title: string, tone: 'warning' | 'active' | 'success' = 'active', detail?: string) {
  return (
    <C.HW_SectionHead>
      <C.HW_AccentBar style={{ backgroundColor: accentFor(tone) }} />
      <C.HW_SectionTitle style={{ color: accentFor(tone) }}>{title}</C.HW_SectionTitle>
      <C.HW_Spacer />
      {detail ? <C.HW_KeyText>{detail}</C.HW_KeyText> : null}
    </C.HW_SectionHead>
  );
}

function Toggle(props: {
  label: string;
  value: boolean;
  onPress: () => void;
  disabled?: boolean;
  tooltip?: string;
}) {
  const Button = props.value ? C.HW_OvToggleOn : C.HW_OvToggle;
  const Text = props.value ? C.HW_OvToggleTextOn : C.HW_OvToggleText;
  return (
    <Button
      tooltip={props.tooltip ?? `show ${props.label}`}
      style={props.disabled ? { opacity: 0.4 } : undefined}
      onPress={props.disabled ? undefined : props.onPress}>
      <Text>{props.label}</Text>
    </Button>
  );
}

/** The built-in clip documents the native exercise mounts by `clip:<id>`. */
const EXERCISE_CLIPS = ['idle', 'walk', 'jump', 'sit', 'lay'] as const;

function listMotionLibrary(): string[] {
  try {
    if (!exists(MOTION_LIBRARY_DIR)) return [];
    return listDir(MOTION_LIBRARY_DIR).filter((name) => name.endsWith('.rjan')).sort();
  } catch {
    return [];
  }
}

const BIND_DEPENDENT_READINESS = new Set([
  'current_topology_hash',
  'current_semantic_hash',
  'current_object_binding_hash',
]);

function readinessPresentation(
  row: CharacterRigSnapshot['readiness'][number],
  hasCurrentWeights: boolean,
): { label: string; detail: string; tone: 'warning' | 'success' | 'active' } {
  if (row.status === 'ready') return {
    label: 'READY',
    detail: row.detail ?? row.id.replace(/_/g, ' '),
    tone: 'success',
  };
  if (row.status === 'waiting' && BIND_DEPENDENT_READINESS.has(row.id)) return {
    label: 'WAITING',
    detail: 'checked after Bind creates a current skin',
    tone: 'active',
  };
  if (row.status === 'waiting' && !hasCurrentWeights && row.id === 'saved_four_influence_weights') return {
    label: 'UNBOUND',
    detail: row.detail ?? 'no current four-influence logical binding',
    tone: 'warning',
  };
  if (row.status === 'waiting' && row.id === 'saved_four_influence_weights') return {
    label: 'UNSAVED',
    detail: row.detail ?? 'resident weights are current but have not crossed the manifest cutover',
    tone: 'active',
  };
  if (row.status === 'stale') return {
    label: 'STALE',
    detail: row.detail ?? 'resident binding differs from current rig data',
    tone: 'warning',
  };
  return {
    label: 'BLOCKED',
    detail: row.detail ?? row.id.replace(/_/g, ' '),
    tone: 'warning',
  };
}

function jointRangeDeg(snapshot: CharacterRigSnapshot): { min: number; max: number } {
  const bone = snapshot.bones.find((row) => row.id === snapshot.selectedBoneId);
  const joint = bone?.joint;
  if (!joint || joint.kind === 'fixed') return { min: 0, max: 0 };
  if (joint.kind === 'ball') return { min: joint.swingX.min * RAD_TO_DEG, max: joint.swingX.max * RAD_TO_DEG };
  if (joint.kind === 'hinge') return {
    min: (joint.limits?.min ?? -Math.PI) * RAD_TO_DEG,
    max: (joint.limits?.max ?? Math.PI) * RAD_TO_DEG,
  };
  return { min: -180, max: 180 };
}

function treeDepth(snapshot: CharacterRigSnapshot, boneId: string): number {
  const byId = new Map(snapshot.bones.map((bone) => [bone.id, bone]));
  let row = byId.get(boneId);
  let depth = 0;
  const seen = new Set<string>();
  while (row?.parent && !seen.has(row.parent)) {
    seen.add(row.parent);
    depth += 1;
    row = byId.get(row.parent);
  }
  return depth;
}

export default function CharacterRigSection(props: {
  api: CharacterRigApi | null;
  snapshot: CharacterRigSnapshot | null;
  onSnapshot: (snapshot: CharacterRigSnapshot) => void;
  onStatus: (message: string) => void;
  onMutated: () => void;
  /** Routes compact native face ids through the resident ModelToolApi. */
  onSelectDetachedFaces?: (indices: readonly number[]) => number;
  /** Exact role keys currently carried by resident semantic regions. */
  semanticRoleKeys?: readonly string[];
  /** Assigns the current face selection without interpreting its display name. */
  onAssignSemanticRole?: (membership: HumanoidSemanticMembership) => void;
}) {
  const {
    api, snapshot, onSnapshot, onStatus, onMutated,
    semanticRoleKeys = [], onAssignSemanticRole,
  } = props;
  if (!snapshot) {
    const openFault = api?.currentOpenFault?.() ?? null;
    const retryOpen = () => {
      if (!api?.retryOpen) {
        onStatus('character rig open cannot be retried — reopen the model document');
        return;
      }
      try {
        onSnapshot(api.retryOpen());
        onStatus('character rig session opened');
      } catch (error) {
        onStatus(error instanceof Error ? error.message : String(error));
      }
    };
    return (
      <C.HW_Section>
        {sectionHead('CHARACTER RIG', 'warning', openFault ? 'failed' : api?.available() ? 'opening' : 'host unavailable')}
        {openFault ? (
          <C.HW_RigNotice>
            <C.HW_RigNoticeLabel>SESSION OPEN FAILED</C.HW_RigNoticeLabel>
            <C.HW_RigWrapText>{openFault}</C.HW_RigWrapText>
          </C.HW_RigNotice>
        ) : (
          <C.HW_ReadRow>
            <C.HW_ReadValue>{api?.available()
              ? 'Opening the native bind session…'
              : 'The character rig host is unavailable.'}</C.HW_ReadValue>
          </C.HW_ReadRow>
        )}
        {openFault ? (
          <C.HW_ButtonRow>
            <C.HW_VerbPrimary tooltip="retry this exact resident model and stable-object request" onPress={retryOpen}>
              <C.HW_VerbText>Retry Open</C.HW_VerbText>
            </C.HW_VerbPrimary>
          </C.HW_ButtonRow>
        ) : null}
      </C.HW_Section>
    );
  }
  const send = (command: CharacterRigCommand) => dispatch(api, command, onSnapshot, onStatus, onMutated);
  const selected = snapshot.bones.find((bone) => bone.id === snapshot.selectedBoneId) ?? null;
  const hasCurrentWeights = snapshot.readiness
    .filter((row) => BIND_DEPENDENT_READINESS.has(row.id))
    .every((row) => row.status === 'ready');
  const readyCount = snapshot.readiness.filter((row) => row.ready).length;
  const prerequisiteIds = snapshot.externalProvenance
    ? (['canonical_skeleton'] as const)
    : (['connected_body', 'required_semantics', 'canonical_skeleton'] as const);
  const prerequisiteChecks = prerequisiteIds.map((id) => snapshot.readiness.find((row) => row.id === id) ?? ({
    id,
    ready: false,
    detail: `${id.replace(/_/g, ' ')} readiness check is unavailable`,
  }));
  const prerequisiteBlockers = prerequisiteChecks.filter((row) => !row.ready);
  const rigControlsReady = prerequisiteBlockers.length === 0;
  const connectedBodyReady = prerequisiteChecks.find((row) => row.id === 'connected_body')?.ready === true;
  const bodyTopology = snapshot.bodyTopology;
  const detachedSelectionReady = !connectedBodyReady && bodyTopology !== null &&
    bodyTopology.detachedTriangleCount > 0 && api?.available() === true;
  const semanticCoverage = snapshot.semanticCoverage;
  const uncoveredSelectionReady = semanticCoverage !== null &&
    semanticCoverage.uncoveredBodyFaceCount > 0 && api?.available() === true;
  const gateDetail = !connectedBodyReady && bodyTopology
    ? `BODY HAS ${bodyTopology.componentCount} COMPONENTS · main ${bodyTopology.mainTriangleCount} triangle${bodyTopology.mainTriangleCount === 1 ? '' : 's'} · detached ${bodyTopology.detachedTriangleCount} triangle${bodyTopology.detachedTriangleCount === 1 ? '' : 's'}`
    : (prerequisiteBlockers[0]?.detail ?? prerequisiteBlockers[0]?.id.replace(/_/g, ' ') ?? '').toUpperCase();
  const gateTooltip = rigControlsReady
    ? ''
    : `locked until readiness passes: ${prerequisiteBlockers.map((row) => row.detail ?? row.id.replace(/_/g, ' ')).join('; ')}`;
  const disabledControlStyle = rigControlsReady ? undefined : { opacity: 0.4 };
  const externalBoneNaming = snapshot.externalProvenance !== null;
  const assignedSemanticRoles = new Set(externalBoneNaming
    ? (snapshot.semanticBindings ?? []).map(humanoidSemanticRoleKey)
    : semanticRoleKeys);
  const requiredSemanticChoices = HUMANOID_SEMANTIC_ROLE_CHOICES.filter((choice) => choice.required);
  const missingSemanticChoices = requiredSemanticChoices.filter((choice) =>
    !assignedSemanticRoles.has(humanoidSemanticRoleKey(choice)));
  const guidedChoice = externalBoneNaming ? missingSemanticChoices[0] ?? null : null;
  const selectedSemanticBinding = selected
    ? (snapshot.semanticBindings ?? []).find((binding) => binding.boneId === selected.id) ?? null
    : null;
  const guidedSelectionReady = selected !== null && selectedSemanticBinding === null;
  const confirmGuidedChoice = () => {
    if (!guidedChoice || !selected || !guidedSelectionReady) return;
    const succeeded = send({
      kind: 'setSemanticBinding',
      boneId: selected.id,
      role: guidedChoice.role,
      ...(guidedChoice.side ? { side: guidedChoice.side } : {}),
    });
    if (!succeeded) return;
    const next = missingSemanticChoices[1];
    onStatus(next
      ? `${guidedChoice.label} confirmed. Select the joint for ${next.label}.`
      : 'All 16 required bone roles are named. Save the model to persist the completed rig descriptor.');
  };
  const anatomyRows: { label: string; choices: HumanoidSemanticRoleChoice[] }[] = [];
  for (const required of [true, false]) {
    const choices = HUMANOID_SEMANTIC_ROLE_CHOICES.filter((choice) => choice.required === required);
    const center = choices.filter((choice) => !choice.side);
    if (center.length > 0) anatomyRows.push({ label: `CENTER · ${required ? 'REQUIRED' : 'OPTIONAL'}`, choices: [...center] });
    const pairedRoles = [...new Set(choices.filter((choice) => choice.side).map((choice) => choice.role))];
    for (const role of pairedRoles) anatomyRows.push({
      label: `${role.replace(/_/g, ' ').toUpperCase()} · ${required ? 'REQUIRED' : 'OPTIONAL'}`,
      choices: choices.filter((choice) => choice.role === role),
    });
  }
  const selectedRange = jointRangeDeg(snapshot);
  const selectedAngle = snapshot.testPose.name === 'selected_joint' ? snapshot.testPose.angleDeg ?? 0 : 0;
  const frameAngles = selected ? frameEulerDegrees(selected.transform.rot) : [0, 0, 0];
  const selectAuditFaces = (kind: 'selectDetached' | 'selectUncovered', label: string) => {
    if (!api?.available()) return;
    try {
      onSnapshot(api.command({ kind: 'setViewportActive', active: false }));
      const selected = api.inspect<CharacterRigSelectionInspection>({ kind });
      onStatus(selected.selectedFaces === selected.expectedFaces
        ? `Selected all ${selected.selectedFaces} ${label} face${selected.selectedFaces === 1 ? '' : 's'} in Face mode.`
        : `${label} selection refused: native selected ${selected.selectedFaces} of ${selected.expectedFaces} faces.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const setTranslation = (axis: 0 | 1 | 2, delta: number) => {
    if (!selected || !rigControlsReady) return;
    const pos = [...selected.transform.pos] as [number, number, number];
    pos[axis] += delta;
    // A numeric origin nudge edits one field of the authored local frame. Keep
    // the existing rotation/scale instead of letting a partial Transform reset
    // the joint frame to identity in the native parser.
    const transform: Transform = { ...selected.transform, pos };
    send({
      kind: 'setJointTransform',
      boneId: selected.id,
      transform,
      preserveChildren: selected.parent !== null,
    });
  };
  const presetRows: [string, CharacterRigTestPoseName, number][] = [
    ['shoulder', 'shoulder_abduction', HUMANOID_RIG_TUNING.bendPresetsDeg.shoulderAbduction],
    ['elbow', 'elbow_flex', HUMANOID_RIG_TUNING.bendPresetsDeg.elbowFlex],
    ['wrist', 'wrist_flex', HUMANOID_RIG_TUNING.bendPresetsDeg.wristFlex],
    ['hip', 'hip_flex', HUMANOID_RIG_TUNING.bendPresetsDeg.hipFlex],
    ['knee', 'knee_flex', HUMANOID_RIG_TUNING.bendPresetsDeg.kneeFlex],
  ];
  const setConstraintRange = (
    key: 'limits' | 'swingX' | 'swingZ' | 'twistY',
    edge: 'min' | 'max',
    deltaDeg: number,
  ) => {
    if (!rigControlsReady || !selected?.joint || selected.joint.kind === 'fixed') return;
    const joint = selected.joint;
    if (key === 'limits') {
      if (joint.kind === 'ball' || !joint.limits) return;
      const next = { ...joint.limits, [edge]: joint.limits[edge] + deltaDeg * DEG_TO_RAD };
      if (next.min > next.max) return;
      send({ kind: 'setJointConstraint', boneId: selected.id, joint: { ...joint, limits: next } });
      return;
    }
    if (joint.kind !== 'ball') return;
    const next = { ...joint[key], [edge]: joint[key][edge] + deltaDeg * DEG_TO_RAD };
    if (next.min > next.max) return;
    send({ kind: 'setJointConstraint', boneId: selected.id, joint: { ...joint, [key]: next } });
  };
  return (
    <C.HW_RigWorkspace>
      <C.HW_RigColumn showScrollbar>
        <C.HW_RigSection>
          {sectionHead('CHARACTER RIG', snapshot.state === 'bound' ? 'success' : 'warning', `${snapshot.state} · r${snapshot.revision}`)}
          {!rigControlsReady ? (
            <C.HW_RigNotice>
              <C.HW_RigNoticeLabel>{gateDetail || 'RIG PREREQUISITES BLOCKED'}</C.HW_RigNoticeLabel>
              <C.HW_RigWrapText>{`Rig fitting, binding, joint editing, and bend tests are locked before work begins. ${prerequisiteBlockers.map((row) => row.detail ?? row.id.replace(/_/g, ' ')).join(' · ')}`}</C.HW_RigWrapText>
              {!connectedBodyReady && bodyTopology ? (
                <C.HW_ButtonRow style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 4 }}>
                  <C.HW_VerbPrimary
                    tooltip={detachedSelectionReady
                      ? `select all ${bodyTopology.detachedTriangleCount} detached body face${bodyTopology.detachedTriangleCount === 1 ? '' : 's'} from the same native audit that counted them`
                      : 'detached-face selection is unavailable in this model viewport'}
                    style={detachedSelectionReady ? undefined : { opacity: 0.4 }}
                    onPress={detachedSelectionReady
                      ? () => selectAuditFaces('selectDetached', 'detached BODY')
                      : undefined}>
                    <C.HW_VerbText>Select Detached</C.HW_VerbText>
                  </C.HW_VerbPrimary>
                </C.HW_ButtonRow>
              ) : null}
              {semanticCoverage && semanticCoverage.uncoveredBodyFaceCount > 0 ? (
                <C.HW_ButtonRow style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 4 }}>
                  <C.HW_VerbPrimary
                    tooltip={uncoveredSelectionReady
                      ? `select all ${semanticCoverage.uncoveredBodyFaceCount} BODY faces with no stable anatomy role from the same native coverage audit`
                      : 'uncovered BODY face selection is unavailable in this model viewport'}
                    style={uncoveredSelectionReady ? undefined : { opacity: 0.4 }}
                    onPress={uncoveredSelectionReady
                      ? () => selectAuditFaces('selectUncovered', 'uncovered BODY')
                      : undefined}>
                    <C.HW_VerbText>Select Uncovered</C.HW_VerbText>
                  </C.HW_VerbPrimary>
                </C.HW_ButtonRow>
              ) : null}
            </C.HW_RigNotice>
          ) : null}
          {!snapshot.viewportActive ? (
            <C.HW_RigNotice>
              <C.HW_RigNoticeLabel>RIG VIEWPORT PAUSED</C.HW_RigNoticeLabel>
              <C.HW_RigWrapText>Vertex, edge, face, paint, and path tools keep ownership of the mesh. Return to View selection while this Rig pane is open to manipulate joints.</C.HW_RigWrapText>
            </C.HW_RigNotice>
          ) : null}
          {snapshot.fitNeedsReview ? (
            <C.HW_RigNotice>
              <C.HW_RigNoticeLabel>FIT REVIEW</C.HW_RigNoticeLabel>
              <C.HW_RigWrapText>Mesh positions differ from the last accepted fit, or inferred joints remain low-confidence.</C.HW_RigWrapText>
            </C.HW_RigNotice>
          ) : null}
          {snapshot.bindNeedsReview ? (
            <C.HW_RigNotice>
              <C.HW_RigNoticeLabel>BIND REVIEW</C.HW_RigNoticeLabel>
              <C.HW_RigWrapText>Joint or binding edits need a saved bind-frame review.</C.HW_RigWrapText>
            </C.HW_RigNotice>
          ) : null}
          {!hasCurrentWeights ? (
            <C.HW_RigNotice>
              <C.HW_RigNoticeLabel>NO SKIN WEIGHTS</C.HW_RigNoticeLabel>
              <C.HW_RigWrapText>{prerequisiteBlockers.length > 0
                ? `Bind has not produced weights. Resolve the ${prerequisiteBlockers.length} setup blocker${prerequisiteBlockers.length === 1 ? '' : 's'} in Readiness, then press Bind. Vertex influences and the heatmap are unavailable until that succeeds.`
                : 'The mesh and skeleton are ready, but no current skin weights exist. Press Bind to solve vertex influences and unlock the heatmap.'}</C.HW_RigWrapText>
            </C.HW_RigNotice>
          ) : null}
          <C.HW_ButtonRow>
            <C.HW_VerbPrimary
              tooltip={snapshot.history.canUndo ? `undo the previous rig edit (${snapshot.history.undoDepth} available)` : 'no character rig edit to undo'}
              style={snapshot.history.canUndo ? undefined : { opacity: 0.4 }}
              onPress={snapshot.history.canUndo ? () => send({ kind: 'undo' }) : undefined}>
              <C.HW_VerbText>{`Undo · ${snapshot.history.undoDepth}`}</C.HW_VerbText>
            </C.HW_VerbPrimary>
            <C.HW_VerbPrimary
              tooltip={snapshot.history.canRedo ? `redo the next rig edit (${snapshot.history.redoDepth} available)` : 'no character rig edit to redo'}
              style={snapshot.history.canRedo ? undefined : { opacity: 0.4 }}
              onPress={snapshot.history.canRedo ? () => send({ kind: 'redo' }) : undefined}>
              <C.HW_VerbText>{`Redo · ${snapshot.history.redoDepth}`}</C.HW_VerbText>
            </C.HW_VerbPrimary>
          </C.HW_ButtonRow>
          <C.HW_ButtonRow>
            <C.HW_VerbPrimary
              tooltip={rigControlsReady ? 'fit every unlocked joint from semantic boundary loops' : gateTooltip}
              style={disabledControlStyle}
              onPress={rigControlsReady ? () => send({ kind: 'fitSkeleton' }) : undefined}>
              <C.HW_VerbText>Fit Skeleton</C.HW_VerbText>
            </C.HW_VerbPrimary>
            <C.HW_VerbPrimary
              tooltip={rigControlsReady ? 'solve and retain four f32 influences per logical vertex' : gateTooltip}
              style={disabledControlStyle}
              onPress={rigControlsReady ? () => send({ kind: 'autoBind' }) : undefined}>
              <C.HW_VerbText>Bind</C.HW_VerbText>
            </C.HW_VerbPrimary>
          </C.HW_ButtonRow>
        </C.HW_RigSection>

        <C.HW_RigSection>
          {sectionHead('OVERLAYS', 'active')}
          <C.HW_ChipRow style={{ paddingLeft: 12, paddingRight: 12, paddingBottom: 5 }}>
            {([
              ['bind', 'bindMesh'], ['deformed', 'deformedMesh'], ['axes', 'axes'], ['names', 'names'], ['heatmap', 'heatmap'],
            ] as const).map(([label, key]) => (
              <Toggle key={key} label={label} value={snapshot.overlay[key]}
                disabled={key === 'heatmap' && !hasCurrentWeights}
                tooltip={key === 'heatmap' && !hasCurrentWeights
                  ? 'Bind must create current skin weights before the heatmap can display influences'
                  : undefined}
                onPress={() => send({ kind: 'setOverlay', overlay: { [key]: !snapshot.overlay[key] } })} />
            ))}
          </C.HW_ChipRow>
        </C.HW_RigSection>

        <C.HW_RigSection>
          {sectionHead(
            'EXERCISE',
            snapshot.exercise ? 'success' : 'active',
            snapshot.exercise ? (snapshot.exercise.playing ? 'playing' : 'parked') : 'motion on the working body',
          )}
          {snapshot.exercise ? (
            <>
              <C.HW_RigNotice>
                <C.HW_RigNoticeLabel>{snapshot.exercise.name.toUpperCase()}</C.HW_RigNoticeLabel>
                <C.HW_RigWrapText>{`${snapshot.exercise.durationSeconds.toFixed(2)}s · ${snapshot.exercise.looping ? 'looping' : 'one-shot'} · answers ${snapshot.exercise.matchedChannelCount}/${snapshot.exercise.channelCount} channels · playhead ${snapshot.exercise.playheadSeconds.toFixed(2)}s`}</C.HW_RigWrapText>
              </C.HW_RigNotice>
              <C.HW_RigSliderRow>
                <C.HW_FormLabel>park at</C.HW_FormLabel>
                <Slider
                  value={Math.min(snapshot.exercise.playheadSeconds, snapshot.exercise.durationSeconds)}
                  min={0}
                  max={snapshot.exercise.durationSeconds}
                  step={0.01}
                  onCommit={(seconds: number) => send({ kind: 'parkExercise', seconds })}
                  style={{ flexGrow: 1, minWidth: 0, height: 20 }} />
                <C.HW_RigSliderValue>{`${snapshot.exercise.playheadSeconds.toFixed(2)}s`}</C.HW_RigSliderValue>
              </C.HW_RigSliderRow>
              <C.HW_ButtonRow>
                {snapshot.exercise.playing ? (
                  <C.HW_VerbPrimary tooltip="freeze the motion exactly where the native clock stands"
                    onPress={() => send({ kind: 'parkExercise', seconds: -1 })}>
                    <C.HW_VerbText>Park Here</C.HW_VerbText>
                  </C.HW_VerbPrimary>
                ) : (
                  <C.HW_VerbPrimary tooltip="release the parked motion back into playback"
                    onPress={() => send({ kind: 'resumeExercise' })}>
                    <C.HW_VerbText>Resume</C.HW_VerbText>
                  </C.HW_VerbPrimary>
                )}
                <C.HW_VerbPrimary tooltip="unmount the motion; the test pose answers again"
                  onPress={() => send({ kind: 'clearExercise' })}>
                  <C.HW_VerbText>Stop</C.HW_VerbText>
                </C.HW_VerbPrimary>
              </C.HW_ButtonRow>
            </>
          ) : (
            <C.HW_RigNotice>
              <C.HW_RigWrapText>Mount a motion on the working body: the specimens play it through the same role channels and joint clamps the game mixer uses, and every rig edit re-evaluates against the parked frame. Bend-test poses stop it.</C.HW_RigWrapText>
            </C.HW_RigNotice>
          )}
          <C.HW_RigPoseCard>
            <C.HW_RigPoseLabel>BUILT-IN CLIPS</C.HW_RigPoseLabel>
            <C.HW_RigModeRow>
              {EXERCISE_CLIPS.map((clip) => {
                const source = `clip:${clip}`;
                const active = snapshot.exercise?.source === source;
                const Button = active ? C.HW_RigModeButtonOn : C.HW_RigModeButton;
                const Label = active ? C.HW_RigModeTextOn : C.HW_RigModeText;
                return (
                  <Button key={clip} tooltip={`play the built-in ${clip} clip on the working body`}
                    onPress={() => send({ kind: 'mountExercise', source })}>
                    <Label>{clip.toUpperCase()}</Label>
                  </Button>
                );
              })}
            </C.HW_RigModeRow>
          </C.HW_RigPoseCard>
          {(() => {
            const library = listMotionLibrary();
            if (library.length === 0) return null;
            return (
              <C.HW_RigPoseCard>
                <C.HW_RigPoseLabel>{`MOTION LIBRARY · ${library.length}`}</C.HW_RigPoseLabel>
                {library.map((filename) => {
                  const source = `${MOTION_LIBRARY_DIR}/${filename}`;
                  const active = snapshot.exercise?.source === source;
                  const Row = active ? C.HW_RigBoneRowOn : C.HW_RigBoneRow;
                  const Label = active ? C.HW_RigBoneTitleOn : C.HW_RigBoneTitle;
                  return (
                    <Row key={filename}
                      tooltip={`play ${filename} on the working body`}
                      onPress={() => send({ kind: 'mountExercise', source })}>
                      <Label>{filename}</Label>
                    </Row>
                  );
                })}
              </C.HW_RigPoseCard>
            );
          })()}
        </C.HW_RigSection>

        <C.HW_RigSection>
          {sectionHead(
            externalBoneNaming ? 'BONE ROLES' : 'ANATOMY ROLES',
            missingSemanticChoices.length === 0 ? 'success' : 'warning',
            `${requiredSemanticChoices.length - missingSemanticChoices.length}/${requiredSemanticChoices.length}`,
          )}
          {guidedChoice ? (
            <C.HW_RigNotice>
              <C.HW_RigNoticeLabel>{`STEP ${requiredSemanticChoices.length - missingSemanticChoices.length + 1} OF ${requiredSemanticChoices.length} · SELECT ${guidedChoice.label.toUpperCase()}`}</C.HW_RigNoticeLabel>
              <C.HW_RigWrapText>{guidedBonePrompt(guidedChoice)}</C.HW_RigWrapText>
              <C.HW_RigWrapText>{selected
                ? selectedSemanticBinding
                  ? `Selected: ${selected.displayName} (${selected.id}) — already named ${humanoidSemanticRoleKey(selectedSemanticBinding)}. Select an unassigned joint.`
                  : `Selected: ${selected.displayName} (${selected.id}). Confirm only if it matches the instruction above.`
                : 'No joint selected. Pick one in the rig viewport or bone tree.'}</C.HW_RigWrapText>
              <C.HW_ButtonRow style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 5 }}>
                <C.HW_VerbPrimary
                  tooltip={guidedSelectionReady
                    ? `persist ${guidedChoice.label} on ${selected!.id} and advance to the next required role`
                    : selectedSemanticBinding
                      ? 'the selected joint already owns a role; select an unassigned joint'
                      : `select the ${guidedChoice.label} joint first`}
                  style={guidedSelectionReady ? undefined : { opacity: 0.4 }}
                  onPress={guidedSelectionReady ? confirmGuidedChoice : undefined}>
                  <C.HW_VerbText>{`Confirm ${guidedChoice.label}`}</C.HW_VerbText>
                </C.HW_VerbPrimary>
              </C.HW_ButtonRow>
            </C.HW_RigNotice>
          ) : <C.HW_RigNotice>
            <C.HW_RigNoticeLabel>{missingSemanticChoices.length === 0
              ? 'REQUIRED ANATOMY COMPLETE'
              : `${missingSemanticChoices.length} REQUIRED ROLE${missingSemanticChoices.length === 1 ? '' : 'S'} MISSING`}</C.HW_RigNoticeLabel>
            <C.HW_RigWrapText>{missingSemanticChoices.length === 0
              ? externalBoneNaming
                ? 'All required generated bones have stable humanoid names. Optional roles can label neck, clavicles, fingers, and toes.'
                : 'All required stable roles are present. Optional roles can improve fitting when those regions exist.'
              : `Missing: ${missingSemanticChoices.map((choice) => choice.label).join(', ')}`}</C.HW_RigWrapText>
            <C.HW_RigWrapText>{externalBoneNaming
              ? 'Select a generated bone in the rig viewport or tree, then choose its role below. The stable external_joint ID remains unchanged while its display name and retarget role are persisted.'
              : 'Pause the rig viewport with Face selection, select one anatomical surface region, then choose its role below. Display names stay unchanged and are never treated as anatomy.'}</C.HW_RigWrapText>
          </C.HW_RigNotice>}
          {!guidedChoice ? anatomyRows.map((row) => (
            <C.HW_RigPoseCard key={row.label}>
              <C.HW_RigPoseLabel>{row.label}</C.HW_RigPoseLabel>
              <C.HW_RigModeRow>
                {row.choices.map((choice) => {
                  const key = humanoidSemanticRoleKey(choice);
                  const active = assignedSemanticRoles.has(key);
                  const assignmentAvailable = externalBoneNaming ? selected !== null : onAssignSemanticRole !== undefined;
                  const Button = active ? C.HW_RigModeButtonOn : C.HW_RigModeButton;
                  const Label = active ? C.HW_RigModeTextOn : C.HW_RigModeText;
                  return (
                    <Button key={key}
                      tooltip={assignmentAvailable
                        ? externalBoneNaming
                          ? `name ${selected?.id ?? 'the selected bone'} as stable role ${key}`
                          : `assign the selected faces to stable role ${key}; display name remains independent`
                        : externalBoneNaming
                          ? 'select a generated bone in the rig viewport or tree first'
                          : 'anatomy assignment is unavailable in this model viewport'}
                      style={assignmentAvailable ? undefined : { opacity: 0.4 }}
                      onPress={!assignmentAvailable ? undefined : externalBoneNaming ? () => send({
                        kind: 'setSemanticBinding',
                        boneId: selected!.id,
                        role: choice.role,
                        ...(choice.side ? { side: choice.side } : {}),
                      }) : () => onAssignSemanticRole!({
                        role: choice.role,
                        ...(choice.side ? { side: choice.side } : {}),
                      })}>
                      <Label>{choice.side ? choice.side.toUpperCase() : choice.label.toUpperCase()}</Label>
                    </Button>
                  );
                })}
              </C.HW_RigModeRow>
            </C.HW_RigPoseCard>
          )) : null}
        </C.HW_RigSection>

        <C.HW_RigSection>
          {sectionHead('BONES', 'active', `${snapshot.bones.length}`)}
          {snapshot.bones.map((bone) => {
            const active = bone.id === snapshot.selectedBoneId;
            const Row = active ? C.HW_RigBoneRowOn : C.HW_RigBoneRow;
            const Label = active ? C.HW_RigBoneTitleOn : C.HW_RigBoneTitle;
            const Meta = active ? C.HW_RigBoneMetaOn : C.HW_RigBoneMeta;
            return (
              <Row key={bone.id}
                style={{ paddingLeft: 7 + Math.min(42, treeDepth(snapshot, bone.id) * 6) }}
                onPress={() => send({ kind: 'selectBone', boneId: bone.id })}>
                <Label>{bone.displayName}</Label>
                <Meta>{`${bone.id} · ${bone.fit.source}${bone.fit.locked ? ' · LOCKED' : ''} · ${Math.round(bone.fit.confidence * 100)}%`}</Meta>
              </Row>
            );
          })}
        </C.HW_RigSection>

        <C.HW_RigSection>
          {sectionHead('OBJECT BINDINGS', 'active', `${snapshot.objectBindings.length}`)}
          {snapshot.objectBindings.map((binding) => {
            const bindingSummary = binding.mode === 'rigid'
              ? `rigid → ${binding.boneId}`
              : binding.mode;
            const RigidButton = binding.mode === 'rigid' ? C.HW_RigModeButtonOn : C.HW_RigModeButton;
            const RigidLabel = binding.mode === 'rigid' ? C.HW_RigModeTextOn : C.HW_RigModeText;
            return (
              <C.HW_RigBindingCard key={binding.objectId}>
                <C.HW_RigBindingName>{binding.objectId}</C.HW_RigBindingName>
                <C.HW_RigBindingSummary>{`current: ${bindingSummary}`}</C.HW_RigBindingSummary>
                <C.HW_RigModeRow>
                  {(['body', 'deformable'] as const).map((mode) => {
                    const Button = binding.mode === mode ? C.HW_RigModeButtonOn : C.HW_RigModeButton;
                    const Label = binding.mode === mode ? C.HW_RigModeTextOn : C.HW_RigModeText;
                    return (
                      <Button key={mode} tooltip={`bind ${binding.objectId} as ${mode}`}
                        onPress={() => send({ kind: 'setObjectBinding', binding: { objectId: binding.objectId, mode } })}>
                        <Label>{mode === 'body' ? 'BODY' : 'DEFORMABLE'}</Label>
                      </Button>
                    );
                  })}
                  <RigidButton tooltip={selected
                    ? `bind ${binding.objectId} rigidly to ${selected.id}`
                    : 'select a bone before assigning a rigid object'}
                    style={selected ? undefined : { opacity: 0.45 }}
                    onPress={() => {
                      if (selected) send({
                        kind: 'setObjectBinding',
                        binding: { objectId: binding.objectId, mode: 'rigid', boneId: selected.id },
                      });
                    }}>
                    <RigidLabel>RIGID</RigidLabel>
                  </RigidButton>
                </C.HW_RigModeRow>
              </C.HW_RigBindingCard>
            );
          })}
        </C.HW_RigSection>
      </C.HW_RigColumn>

      <C.HW_RigColumn showScrollbar>
        <C.HW_RigSection>
          {selected ? (
            <>
              {sectionHead('SELECTED JOINT', selected.fit.source === 'manual' ? 'warning' : 'active', selected.id)}
              <C.HW_ReadRow>
                <C.HW_FormLabel>lock</C.HW_FormLabel><C.HW_Spacer />
                <Toggle label={selected.fit.locked ? 'locked' : 'unlocked'} value={selected.fit.locked}
                  disabled={!rigControlsReady}
                  tooltip={rigControlsReady ? undefined : gateTooltip}
                  onPress={() => send({ kind: 'setJointLock', boneId: selected.id, locked: !selected.fit.locked })} />
                <C.HW_OvResetIdle />
              </C.HW_ReadRow>
              {(['X', 'Y', 'Z'] as const).map((label, axis) => (
                <C.HW_ReadRow key={label}>
                  <C.HW_FormLabel>{`origin ${label}`}</C.HW_FormLabel><C.HW_Spacer />
                  <C.HW_OvBtn tooltip={rigControlsReady ? undefined : gateTooltip} style={disabledControlStyle}
                    onPress={rigControlsReady ? () => setTranslation(axis as 0 | 1 | 2, -POSITION_STEP_METERS) : undefined}><C.HW_OvBtnText>−</C.HW_OvBtnText></C.HW_OvBtn>
                  <C.HW_OvVal>{selected.transform.pos[axis]!.toFixed(3)}</C.HW_OvVal>
                  <C.HW_OvBtn tooltip={rigControlsReady ? undefined : gateTooltip} style={disabledControlStyle}
                    onPress={rigControlsReady ? () => setTranslation(axis as 0 | 1 | 2, POSITION_STEP_METERS) : undefined}><C.HW_OvBtnText>+</C.HW_OvBtnText></C.HW_OvBtn>
                  <C.HW_OvResetIdle />
                </C.HW_ReadRow>
              ))}
              {(['X', 'Y', 'Z'] as const).map((label, axis) => (
                <C.HW_ReadRow key={`frame-${label}`}>
                  <C.HW_FormLabel>{`frame ${label}`}</C.HW_FormLabel><C.HW_Spacer />
                  <C.HW_OvBtn tooltip={rigControlsReady ? undefined : gateTooltip} style={disabledControlStyle}
                    onPress={rigControlsReady ? () => send({ kind: 'setJointTransform', boneId: selected.id, transform: rotateLocalFrame(selected.transform, axis as 0 | 1 | 2, -FRAME_ROTATION_STEP_DEG) }) : undefined}><C.HW_OvBtnText>−</C.HW_OvBtnText></C.HW_OvBtn>
                  <C.HW_OvVal>{`${frameAngles[axis]!.toFixed(1)}°`}</C.HW_OvVal>
                  <C.HW_OvBtn tooltip={rigControlsReady ? undefined : gateTooltip} style={disabledControlStyle}
                    onPress={rigControlsReady ? () => send({ kind: 'setJointTransform', boneId: selected.id, transform: rotateLocalFrame(selected.transform, axis as 0 | 1 | 2, FRAME_ROTATION_STEP_DEG) }) : undefined}><C.HW_OvBtnText>+</C.HW_OvBtnText></C.HW_OvBtn>
                  <C.HW_OvResetIdle />
                </C.HW_ReadRow>
              ))}
              <C.HW_RigSliderRow>
                <C.HW_FormLabel>joint angle</C.HW_FormLabel>
                {/* Commit-only: the host owns the thumb and repaints throughout
                    the drag; the native rig receives one pose command on release. */}
                <Slider value={selectedAngle}
                  min={rigControlsReady ? selectedRange.min : selectedAngle}
                  max={rigControlsReady ? selectedRange.max : selectedAngle}
                  step={0.25}
                  onCommit={rigControlsReady
                    ? (angleDeg: number) => send({ kind: 'setTestPose', pose: { name: 'selected_joint', angleDeg } })
                    : undefined}
                  style={{ flexGrow: 1, minWidth: 0, height: 20, opacity: rigControlsReady ? 1 : 0.4, pointerEvents: rigControlsReady ? 'auto' : 'none' }} />
                <C.HW_RigSliderValue>{`${selectedAngle.toFixed(1)}°`}</C.HW_RigSliderValue>
              </C.HW_RigSliderRow>
            </>
          ) : (
            <>
              {sectionHead('SELECTED JOINT', 'warning')}
              <C.HW_RigNotice>
                <C.HW_RigWrapText>Select a bone in the tree or native rig viewport to inspect its authored frame and constraint.</C.HW_RigWrapText>
              </C.HW_RigNotice>
            </>
          )}
        </C.HW_RigSection>

        {selected?.joint && selected.joint.kind !== 'fixed' ? (
          <C.HW_RigSection>
            {sectionHead('JOINT LIMITS', 'active', selected.joint.kind)}
            {(selected.joint.kind === 'ball'
              ? ([['swing X', 'swingX'], ['twist Y', 'twistY'], ['swing Z', 'swingZ']] as const)
              : ([['angle', 'limits']] as const)
            ).map(([label, key]) => {
              const range = key === 'limits'
                ? (selected.joint!.kind === 'ball' ? null : selected.joint!.limits)
                : (selected.joint!.kind === 'ball' ? selected.joint![key] : null);
              if (!range) return null;
              return (
                <C.HW_RigLimitCard key={key}>
                  <C.HW_RigLimitTitle>{label}</C.HW_RigLimitTitle>
                  {(['min', 'max'] as const).map((edge) => (
                    <C.HW_RigLimitEdgeRow key={edge}>
                      <C.HW_RigLimitEdgeLabel>{edge === 'min' ? 'minimum' : 'maximum'}</C.HW_RigLimitEdgeLabel>
                      <C.HW_Spacer />
                      <C.HW_OvBtn tooltip={rigControlsReady ? `decrease ${edge}` : gateTooltip} style={disabledControlStyle}
                        onPress={rigControlsReady ? () => setConstraintRange(key, edge, -CONSTRAINT_STEP_DEG) : undefined}><C.HW_OvBtnText>−</C.HW_OvBtnText></C.HW_OvBtn>
                      <C.HW_OvVal>{`${(range[edge] * RAD_TO_DEG).toFixed(0)}°`}</C.HW_OvVal>
                      <C.HW_OvBtn tooltip={rigControlsReady ? `increase ${edge}` : gateTooltip} style={disabledControlStyle}
                        onPress={rigControlsReady ? () => setConstraintRange(key, edge, CONSTRAINT_STEP_DEG) : undefined}><C.HW_OvBtnText>+</C.HW_OvBtnText></C.HW_OvBtn>
                    </C.HW_RigLimitEdgeRow>
                  ))}
                </C.HW_RigLimitCard>
              );
            })}
          </C.HW_RigSection>
        ) : null}

        <C.HW_RigSection>
          {sectionHead('BEND TESTS', 'active')}
          <C.HW_ButtonRow style={{ paddingBottom: 6 }}>
            <C.HW_VerbPrimary tooltip={rigControlsReady ? 'return the right specimen to bind pose' : gateTooltip}
              style={disabledControlStyle}
              onPress={rigControlsReady ? () => send({ kind: 'setTestPose', pose: { name: 'bind' } }) : undefined}>
              <C.HW_VerbText>Bind pose</C.HW_VerbText>
            </C.HW_VerbPrimary>
          </C.HW_ButtonRow>
          {presetRows.map(([label, name, angleDeg]) => (
            <C.HW_RigPoseCard key={name}>
              <C.HW_RigPoseLabel>{`${label} · ${angleDeg}°`}</C.HW_RigPoseLabel>
              <C.HW_RigModeRow>
                {(['left', 'right', 'both'] as const).map((side) => (
                  <C.HW_RigSideButton key={side} tooltip={rigControlsReady ? `${label} ${side}` : gateTooltip}
                    style={disabledControlStyle}
                    onPress={rigControlsReady ? () => send({ kind: 'setTestPose', pose: { name, side } }) : undefined}>
                    <C.HW_RigSideButtonText>{side.toUpperCase()}</C.HW_RigSideButtonText>
                  </C.HW_RigSideButton>
                ))}
              </C.HW_RigModeRow>
            </C.HW_RigPoseCard>
          ))}
        </C.HW_RigSection>

        <C.HW_RigSection>
          {sectionHead('VERTEX PROBE', 'active')}
          {snapshot.selectedVertex ? (
            <>
              <C.HW_RigWrapRow>
                <C.HW_RigReadinessLabel>logical</C.HW_RigReadinessLabel>
                <C.HW_RigWrapText>{`v${snapshot.selectedVertex.logicalVertexId} · ${snapshot.selectedVertex.renderDuplicateCount} render corners`}</C.HW_RigWrapText>
              </C.HW_RigWrapRow>
              <C.HW_RigWrapRow>
                <C.HW_RigReadinessLabel>position</C.HW_RigReadinessLabel>
                <C.HW_RigWrapText>{snapshot.selectedVertex.modelPosition.map((value) => value.toFixed(6)).join(', ')}</C.HW_RigWrapText>
              </C.HW_RigWrapRow>
              {hasCurrentWeights ? snapshot.selectedVertex.influences.map((influence, index) => (
                  <C.HW_RigWrapRow key={`${influence.boneId ?? 'unused'}:${index}`}>
                    <C.HW_RigWrapText>{influence.boneId ?? 'unused'}</C.HW_RigWrapText>
                    <C.HW_Spacer />
                    <C.HW_RigSliderValue>{influence.weight.toFixed(7)}</C.HW_RigSliderValue>
                  </C.HW_RigWrapRow>
                )) : (
                  <C.HW_RigNotice>
                    <C.HW_RigNoticeLabel>UNBOUND VERTEX</C.HW_RigNoticeLabel>
                    <C.HW_RigWrapText>This pick has a logical ID and position, but it has no skin influences because Bind has not succeeded.</C.HW_RigWrapText>
                  </C.HW_RigNotice>
                )}
            </>
          ) : (
            <C.HW_RigWrapRow><C.HW_RigWrapText>{hasCurrentWeights
              ? 'Click a vertex in the native rig viewport to inspect its logical ID and exact f32 influences.'
              : 'Click a vertex to inspect its logical ID and position. Exact f32 influences appear after Bind succeeds.'}</C.HW_RigWrapText></C.HW_RigWrapRow>
          )}
        </C.HW_RigSection>

        <C.HW_RigSection>
          {sectionHead('READINESS', snapshot.readiness.every((row) => row.ready) ? 'success' : 'warning', `${readyCount}/${snapshot.readiness.length}`)}
          {snapshot.readiness.map((row) => {
            const presentation = readinessPresentation(row, hasCurrentWeights);
            return (
              <C.HW_RigWrapRow key={row.id}>
                <C.HW_RigReadinessLabel style={{ color: accentFor(presentation.tone) }}>
                  {presentation.label}
                </C.HW_RigReadinessLabel>
                <C.HW_RigWrapText>{presentation.detail}</C.HW_RigWrapText>
              </C.HW_RigWrapRow>
            );
          })}
        </C.HW_RigSection>
      </C.HW_RigColumn>
    </C.HW_RigWorkspace>
  );
}
