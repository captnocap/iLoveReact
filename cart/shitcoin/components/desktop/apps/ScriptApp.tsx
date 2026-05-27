// ScriptApp — generic shell for every script-style app (sniper, arb,
// DCA, stop-loss, trailing-stop, rebalance, …).
//
// Caller declares its app id + trigger/action template set; ScriptApp
// owns the rule editor + persistence + IFTTT binding for enabled
// rules. Adding a new script app type = a 20-line file calling
// <ScriptApp appId="…" triggerTemplates={…} actionTemplates={…} />.
//
// Per-rule binding lives in <RuleRunner>, which mounts useIFTTT with
// a wrapper that records fires into the audit log before delegating
// to the registered IFTTT action verb. Each rule is its own mounted
// component, so enabling/disabling rules just toggles whether their
// runner is mounted.

import { useEffect, useState } from 'react';
import { Box, Text, Pressable } from '@reactjit/runtime/primitives';
import { useIFTTT } from '../../../../../runtime/hooks/useIFTTT';
import { dispatchAction } from '../../../../../runtime/hooks/ifttt/registry';
import { Page } from '../../primitives/Page';
import { Card } from '../../primitives/Card';
import { RuleEditor, type RuleSpecTemplate } from '../../primitives/RuleEditor';
import { AuditLog, type AuditEntry } from '../../primitives/AuditLog';
import {
  setActivePlayer, useScriptRules, addRule, updateRule, removeRule, recordFire,
  resolveSpec, type ScriptRule,
} from '../../../useScriptRules';
import { usePlayerAddress } from '../../../sim';

export interface ScriptAppProps {
  appId: string;
  title: string;
  subtitle?: string;
  triggerTemplates: RuleSpecTemplate[];
  actionTemplates: RuleSpecTemplate[];
}

export function ScriptApp({ appId, title, subtitle, triggerTemplates, actionTemplates }: ScriptAppProps) {
  const addr = usePlayerAddress();
  useEffect(() => { setActivePlayer(addr ?? null); }, [addr]);
  const rules = useScriptRules(appId);

  const onAdd = () => {
    addRule(appId, {
      label: 'New rule',
      enabled: false,
      triggerSpec: triggerTemplates[0]?.spec ?? '',
      actionSpec: actionTemplates[0]?.spec ?? '',
      args: {},
    });
  };

  return (
    <Page heroTitle={title} heroSubtitle={subtitle}>
      <Box style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          onPress={onAdd}
          style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 8, paddingBottom: 8, borderRadius: 6, backgroundColor: 'theme:primary' as any }}
        >
          <Text style={{ fontSize: 13, color: '#0b0d10', fontWeight: 'bold' }}>+ New Rule</Text>
        </Pressable>
        <Text style={{ fontSize: 11, color: 'theme:textDim' as any, alignSelf: 'center' }}>
          {rules.filter((r) => r.enabled).length} of {rules.length} enabled
        </Text>
      </Box>

      {rules.map((rule) => (
        <Box key={rule.id} style={{ flexDirection: 'column', gap: 8 }}>
          <RuleEditor
            rule={{
              label: rule.label,
              enabled: rule.enabled,
              triggerSpec: rule.triggerSpec,
              actionSpec: rule.actionSpec,
              args: rule.args,
            }}
            triggerTemplates={triggerTemplates}
            actionTemplates={actionTemplates}
            onChange={(next) => updateRule(appId, rule.id, next)}
            onDelete={() => removeRule(appId, rule.id)}
          />
          {rule.enabled ? (
            <RuleRunner appId={appId} rule={rule} />
          ) : null}
        </Box>
      ))}

      {rules.length === 0 ? (
        <Card title="No rules yet">
          <Text style={{ fontSize: 12, color: 'theme:textDim' as any }}>
            Click "New Rule" to wire a trigger to an action. Rules persist across runs.
          </Text>
        </Card>
      ) : null}

      <Card title="Recent fires">
        <AuditLog
          entries={collectFires(appId, rules)}
          nowMs={Date.now()}
        />
      </Card>
    </Page>
  );
}

function collectFires(appId: string, rules: ScriptRule[]): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (const r of rules) {
    for (const ms of r.recentFires) {
      out.push({
        key: `${r.id}-${ms}`,
        realMs: ms,
        message: `${r.label} fired`,
        status: 'ok',
      });
    }
  }
  out.sort((a, b) => b.realMs - a.realMs);
  return out.slice(0, 40);
}

// ── Per-rule IFTTT binding ────────────────────────────────────────────

interface RuleRunnerProps {
  appId: string;
  rule: ScriptRule;
}

/** Mounts a single useIFTTT(trigger, action) binding for one rule.
 *  Lives as its own component so React mount/unmount lifecycle handles
 *  enable/disable without manually managing subscribe/unsubscribe. */
function RuleRunner({ appId, rule }: RuleRunnerProps) {
  const triggerSpec = resolveSpec(rule.triggerSpec, rule.args);
  const actionSpec = resolveSpec(rule.actionSpec, rule.args);
  useIFTTT(triggerSpec, (payload: any) => {
    // Log the fire into the rule's audit ring first so a panicking
    // action handler still leaves a trace.
    recordFire(appId, rule.id, Date.now());
    // Then dispatch through the registry, which calls into sim.* or
    // any other registered verb (notify:, ach:emit:, etc.).
    dispatchAction(actionSpec, payload);
  });
  return null;
}
