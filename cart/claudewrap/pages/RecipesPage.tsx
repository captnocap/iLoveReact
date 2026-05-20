// RecipesPage — live useIFTTT bindings editor.
//
// Each row in `state.rules` is one real useIFTTT(trigger, action)
// binding. Toggling/editing here updates the store; App.tsx mounts
// one <RuleBinding> per rule and the changes apply immediately.
//
// Trigger and action are real DSL strings — same surface a recipe
// scaffold uses (cart/app/recipes/<slug>.ts).

import * as React from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView, TextInput } from '../../../runtime/primitives';
import { palette } from '../ui/palette';
import { SuggestField } from '../ui/SuggestField';
import { getTriggerSuggestions, getActionSuggestions } from '../ifttt/suggestions';
import { useSettings, updateRule, addRule, removeRule } from '../state';
import type { RecipeRule } from '../types';

export function RecipesPage() {
  const { rules } = useSettings();

  const onAdd = React.useCallback(() => {
    addRule({
      id: `rule-${Date.now()}`,
      label: 'custom rule',
      trigger: 'permission:any',
      action: '',
      enabled: false,
      source: 'live',
    });
  }, []);

  return (
    <ScrollView style={{ flexGrow: 1 }}>
      <Col style={{ gap: 1 }}>
        <Text style={{ color: palette.accent, fontWeight: 'bold' }}>recipes</Text>
        <Text style={{ color: palette.dim }}>
          each row is one live useIFTTT(trigger, action) binding — real DSL, no translation layer
        </Text>
        <Text> </Text>
        {rules.map(r => <RuleRow key={r.id} rule={r} />)}
        <Text> </Text>
        <Pressable onPress={onAdd}>
          <Text style={{ color: palette.accent, fontWeight: 'bold' }}>[+ add rule]</Text>
        </Pressable>
        <Text> </Text>
        <Text style={{ color: palette.dim, fontWeight: 'bold' }}>triggers</Text>
        <Text style={{ color: palette.dim }}>
          permission:any · permission:&lt;tool&gt; · system:claude:&lt;tool&gt; · turn:end · match:&lt;chan&gt;::&lt;pat&gt;
        </Text>
        <Text style={{ color: palette.dim, fontWeight: 'bold' }}>actions</Text>
        <Text style={{ color: palette.dim }}>
          permission:approve · approve-if-target-ext:.md,.txt · approve-if-tool:Read · deny-if-tool:Bash
        </Text>
        <Text style={{ color: palette.dim }}>
          flag-pathology:&lt;id&gt; · halt-run · kick-to-supervisor · notify-user:&lt;msg&gt;
        </Text>
      </Col>
    </ScrollView>
  );
}

function RuleRow({ rule }: { rule: RecipeRule }) {
  // Only one of trigger/action's suggestion list opens at a time —
  // keeps the page compact.
  const [showSuggest, setShowSuggest] = React.useState<'trigger' | 'action' | null>(null);
  return (
    <Col style={{ gap: 0, paddingBottom: 1 }}>
      <Row style={{ gap: 1 }}>
        <Pressable onPress={() => updateRule(rule.id, { enabled: !rule.enabled })}>
          <Text style={{
            color: rule.enabled ? palette.good : palette.dim,
            fontWeight: 'bold',
          }}>
            {rule.enabled ? '[on] ' : '[off]'}
          </Text>
        </Pressable>
        <Box style={{ flexGrow: 1 }}>
          <TextInput
            value={rule.label}
            placeholder="label"
            onChangeText={(v: string) => updateRule(rule.id, { label: v })}
          />
        </Box>
        {rule.source !== 'live' && (
          <Text style={{ color: palette.dim }}>·{rule.source}</Text>
        )}
        <Pressable onPress={() => removeRule(rule.id)}>
          <Text style={{ color: palette.dim }}>[x]</Text>
        </Pressable>
      </Row>
      <SuggestField
        label="trigger"
        value={rule.trigger}
        placeholder="permission:any"
        suggestions={getTriggerSuggestions()}
        open={showSuggest === 'trigger'}
        onToggleSuggest={() => setShowSuggest(showSuggest === 'trigger' ? null : 'trigger')}
        onChange={(v: string) => updateRule(rule.id, { trigger: v })}
      />
      <SuggestField
        label="action"
        value={rule.action}
        placeholder="approve-if-target-ext:.md,.txt"
        suggestions={getActionSuggestions()}
        open={showSuggest === 'action'}
        onToggleSuggest={() => setShowSuggest(showSuggest === 'action' ? null : 'action')}
        onChange={(v: string) => updateRule(rule.id, { action: v })}
      />
    </Col>
  );
}
