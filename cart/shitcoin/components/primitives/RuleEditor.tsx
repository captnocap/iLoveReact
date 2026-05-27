// RuleEditor — trigger spec + action spec form.
//
// Caller passes:
//   - trigger templates (label + spec template string) from the script app
//   - action templates (label + spec template string)
//   - the persisted `rule` value
//   - a setter for the rule
// The editor renders a label + spec dropdown + free-text override + the
// enable/disable toggle. Templates may reference $args (e.g.
// 'trade:buy:$tokenId:$usd:max-impact:$pct'); the editor surfaces those
// as numeric input fields below the spec preview.

import { useMemo } from 'react';
import { Text } from '@reactjit/runtime/primitives';
import { classifiers as C } from '../../../../runtime/classifier';
import { Form, Field, FormSlots } from './Form';
import { List, ListSlots } from './List';
import './RuleEditor.cls';

export interface RuleSpecTemplate {
  /** Human label shown in the picker. */
  label: string;
  /** Spec template; may contain `$name` placeholders that become editor args. */
  spec: string;
}

export interface RuleValue {
  label: string;
  enabled: boolean;
  triggerSpec: string;
  actionSpec: string;
  args: Record<string, string | number | boolean>;
}

export interface RuleEditorProps {
  rule: RuleValue;
  triggerTemplates: RuleSpecTemplate[];
  actionTemplates: RuleSpecTemplate[];
  onChange: (next: RuleValue) => void;
  onDelete?: () => void;
}

/** Pull `$name` placeholders out of a spec template. */
function placeholders(spec: string): string[] {
  const out: string[] = [];
  const re = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(spec)) != null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Resolve placeholders against `args` to render a preview. */
function resolveSpec(spec: string, args: Record<string, any>): string {
  return spec.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    const v = args[name];
    return v == null ? `$${name}` : String(v);
  });
}

export function RuleEditor({
  rule, triggerTemplates, actionTemplates, onChange, onDelete,
}: RuleEditorProps) {
  const triggerArgs = useMemo(() => placeholders(rule.triggerSpec), [rule.triggerSpec]);
  const actionArgs = useMemo(() => placeholders(rule.actionSpec), [rule.actionSpec]);
  const triggerPreview = resolveSpec(rule.triggerSpec, rule.args);
  const actionPreview = resolveSpec(rule.actionSpec, rule.args);
  const allArgs = Array.from(new Set([...triggerArgs, ...actionArgs]));

  const setArg = (k: string, v: string) =>
    onChange({ ...rule, args: { ...rule.args, [k]: v } });

  return (
    <C.RuleEditorRoot>
      <C.RuleEditorRow>
        <FormSlots.Input
          value={rule.label}
          onChangeText={(v: string) => onChange({ ...rule, label: v })}
          style={{ flexGrow: 1, flexBasis: 0 }}
        />
        <Toggle on={rule.enabled} onToggle={() => onChange({ ...rule, enabled: !rule.enabled })} />
      </C.RuleEditorRow>

      <C.RuleEditorLabel>Trigger</C.RuleEditorLabel>
      <TemplatePicker
        templates={triggerTemplates}
        selected={rule.triggerSpec}
        onPick={(spec) => onChange({ ...rule, triggerSpec: spec })}
      />
      <C.RuleEditorSpec>
        <C.RuleEditorSpecCode>{triggerPreview}</C.RuleEditorSpecCode>
      </C.RuleEditorSpec>

      <C.RuleEditorLabel>Action</C.RuleEditorLabel>
      <TemplatePicker
        templates={actionTemplates}
        selected={rule.actionSpec}
        onPick={(spec) => onChange({ ...rule, actionSpec: spec })}
      />
      <C.RuleEditorSpec>
        <C.RuleEditorSpecCode>{actionPreview}</C.RuleEditorSpecCode>
      </C.RuleEditorSpec>

      {allArgs.length > 0 ? (
        <Form>
          {allArgs.map((name) => (
            <Field key={name} label={name}>
              <FormSlots.Input
                value={String(rule.args[name] ?? '')}
                onChangeText={(v: string) => setArg(name, v)}
              />
            </Field>
          ))}
        </Form>
      ) : null}
    </C.RuleEditorRoot>
  );
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const T = on ? C.RuleEditorToggleOn : C.RuleEditorToggle;
  return (
    <T onPress={onToggle}>
      <Text style={{ fontSize: 9, color: '#fff', textAlign: on ? 'right' : 'left', paddingLeft: 4, paddingRight: 4 }}>
        {on ? 'ON' : 'off'}
      </Text>
    </T>
  );
}

function TemplatePicker({
  templates, selected, onPick,
}: { templates: RuleSpecTemplate[]; selected: string; onPick: (s: string) => void }) {
  return (
    <List
      items={templates.map((t, i) => ({ key: i, ...t }))}
      selectedKey={templates.findIndex((t) => t.spec === selected)}
      onSelect={(t) => onPick(t.spec)}
      renderRow={(t) => (
        <>
          <ListSlots.Label>{t.label}</ListSlots.Label>
          <ListSlots.Trailing>{t.spec}</ListSlots.Trailing>
        </>
      )}
    />
  );
}
