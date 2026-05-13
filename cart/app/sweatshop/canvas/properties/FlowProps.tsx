// Flow-node inspector — full property surface for nodes coming out of
// the sweatshop FlowEditor.
//
// What it shows:
//
//   - Identity      — node id (read), kind (read), label (edit).
//   - Channel       — the IFTTT prefix the node is wired to. If the
//                     prefix ends in ':' (e.g. `key:`, `fs:any:`,
//                     `state:set:`) the suffix is editable — that's the
//                     concrete channel the trigger fires on or the
//                     verb arg the action carries.
//   - Description   — pulled from the atom registry; tells the user
//                     (and the model) what this node does.
//   - Properties    — per-atom defaults (e.g. research.{type, sources,
//                     whitelist, blacklist, topic, keywords}; variable.
//                     {id, name, value, type, ...}). Rendered with
//                     types we can infer from the default value.
//   - Position      — x/y in graph coords.
//   - Runtime       — state + stripe (read).
//   - Ports         — port roster with kind-colored dots.
//
// Edits emit a `FlowPatch` whose `data` field carries the merged
// payload. The host folds it into the live FlowNode (see canvas/
// page.tsx::onPropsPatch).

import { Box, Col, Row, Text, TextInput } from '@reactjit/runtime/primitives';
import { Section, ReadOnlyRow, TextField, NumberField } from './Field';
import type { FlowNode, FlowPort } from '../../../gallery/components/flow-editor/types';
import type { FlowPatch } from './types';
import { atomById } from '../atoms';

interface FlowData {
  kind?: string;
  role?: string;
  state?: string;
  stripe?: string;
  ports?: FlowPort[];
  /** Full IFTTT prefix the spawning atom carried (e.g. `key:`,
   *  `event:goal.reframed`, `halt-run`). Read-only at the node level;
   *  the user edits the SUFFIX when the prefix ends in `:`. */
  prefix?: string;
  /** Live channel string. Equals `prefix + suffix` for prefix-style
   *  atoms, or just `prefix` for concrete ones. */
  channel?: string;
  /** Per-atom property bag. Stamped from the atom's `defaults` on
   *  spawn; edited live via the Properties panel. */
  defaults?: Record<string, any>;
  /** id of the source atom — lets us look up its description for the
   *  hint section. Stamped at spawn time. */
  atomId?: string;
}

export function FlowProps({ node, onPatch }: {
  node: FlowNode;
  onPatch: (patch: FlowPatch) => void;
}) {
  const data = (node.data ?? {}) as FlowData;
  const atom = data.atomId ? atomById(data.atomId) : null;
  const ports = data.ports ?? [];
  const ins = ports.filter((p) => p.side === 'in');
  const outs = ports.filter((p) => p.side === 'out');

  const prefix = data.prefix ?? '';
  const isPrefixStyle = prefix.endsWith(':');
  const channel = data.channel ?? prefix;
  // For prefix-style atoms (e.g. `key:` → `key:ctrl+s`), the suffix
  // is what the user fills in. Split conservatively — channel starts
  // with prefix and the rest is the suffix.
  const suffix = isPrefixStyle && channel.startsWith(prefix)
    ? channel.slice(prefix.length)
    : '';

  const patchData = (next: Partial<FlowData>) => {
    onPatch({ data: { ...data, ...next } as any });
  };
  const patchDefaults = (key: string, value: any) => {
    patchData({ defaults: { ...(data.defaults ?? {}), [key]: value } });
  };
  const setSuffix = (s: string) => {
    patchData({ channel: prefix + s });
  };

  return (
    <Col style={{ gap: 8 }}>
      <Section label="Identity">
        <ReadOnlyRow label="id" value={node.id} />
        <ReadOnlyRow label="kind" value={data.kind ?? '—'} />
        {data.role ? <ReadOnlyRow label="role" value={data.role} /> : null}
        <TextField
          label="name"
          value={node.label}
          placeholder={atom?.label ?? 'unnamed'}
          onChange={(label) => onPatch({ label })}
        />
      </Section>

      <Section label="Channel">
        {isPrefixStyle ? (
          <>
            <ReadOnlyRow label="prefix" value={prefix} />
            <TextField
              label="suffix"
              value={suffix}
              placeholder="…"
              onChange={setSuffix}
            />
            <ReadOnlyRow label="resolved" value={channel || '—'} />
          </>
        ) : (
          <ReadOnlyRow label="channel" value={channel || '—'} />
        )}
      </Section>

      {atom?.description ? (
        <Section label="What it does">
          <Text size={10} color="theme:inkDim" style={{ lineHeight: 14 }}>
            {atom.description}
          </Text>
        </Section>
      ) : null}

      {data.defaults && Object.keys(data.defaults).length > 0 ? (
        <Section label="Properties">
          <Col style={{ gap: 4 }}>
            {Object.entries(data.defaults).map(([key, value]) => (
              <DefaultField key={key} field={key} value={value}
                onChange={(v) => patchDefaults(key, v)} />
            ))}
          </Col>
        </Section>
      ) : null}

      <Section label="Position">
        <NumberField label="x" value={node.x} onChange={(x) => onPatch({ x: x ?? 0 })} />
        <NumberField label="y" value={node.y} onChange={(y) => onPatch({ y: y ?? 0 })} />
      </Section>

      <Section label="Runtime">
        <ReadOnlyRow label="state" value={data.state ?? 'idle'} />
        {data.stripe ? <ReadOnlyRow label="stripe" value={data.stripe} /> : null}
      </Section>

      <Section label="Ports">
        {ports.length === 0 ? (
          <Text size={9} color="theme:inkDim">no ports</Text>
        ) : (
          <Col style={{ gap: 2 }}>
            {ins.length > 0 ? (
              <PortGroup heading={`in (${ins.length})`} ports={ins} />
            ) : null}
            {outs.length > 0 ? (
              <PortGroup heading={`out (${outs.length})`} ports={outs} />
            ) : null}
          </Col>
        )}
      </Section>
    </Col>
  );
}

// ── DefaultField — single property row, type-aware ───────────────────
// We infer the editor from the default value's runtime type. Strings
// get a text input; numbers a number input; booleans a toggle; arrays
// a comma-separated list; objects collapse to JSON. Good enough for
// the bag's atom defaults; gets specialized per-shape when the user
// asks (e.g. a real keycap-picker for `key:` suffixes).

function DefaultField({ field, value, onChange }: {
  field: string;
  value: any;
  onChange: (next: any) => void;
}) {
  if (typeof value === 'boolean') {
    return (
      <Row style={{ gap: 6, alignItems: 'center' }}>
        <Box style={{ width: 80 }}>
          <Text size={9} color="theme:inkDim">{field}</Text>
        </Box>
        <BooleanToggle value={value} onChange={onChange} />
      </Row>
    );
  }
  if (typeof value === 'number') {
    return (
      <NumberField
        label={field}
        value={value}
        onChange={(n) => onChange(n ?? 0)}
      />
    );
  }
  if (Array.isArray(value)) {
    // Comma-separated string list. Simple v0 — gets a tags-row UI
    // later if the surface needs it (whitelist / blacklist / keywords).
    return (
      <TextField
        label={field}
        value={value.join(', ')}
        placeholder="comma, separated, list"
        onChange={(s) => onChange(s.split(',').map((t) => t.trim()).filter(Boolean))}
      />
    );
  }
  if (value !== null && typeof value === 'object') {
    return (
      <Row style={{ gap: 6, alignItems: 'flex-start' }}>
        <Box style={{ width: 80, paddingTop: 4 }}>
          <Text size={9} color="theme:inkDim">{field}</Text>
        </Box>
        <Box style={{ flexGrow: 1, minWidth: 0 }}>
          <TextInput
            value={safeStringify(value)}
            onChange={(s: string) => {
              try { onChange(JSON.parse(s)); } catch { /* ignore mid-edit */ }
            }}
            style={{
              paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3,
              borderWidth: 1, borderColor: 'theme:rule',
              backgroundColor: 'theme:bg2',
              color: 'theme:ink',
              fontSize: 10,
              fontFamily: 'theme:fontMono' as any,
            }}
          />
        </Box>
      </Row>
    );
  }
  // string | null | undefined
  return (
    <TextField
      label={field}
      value={value == null ? '' : String(value)}
      onChange={(s) => onChange(s)}
    />
  );
}

function BooleanToggle({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  return (
    <Row style={{ gap: 4 }}>
      <Toggle label="on"  active={value}  onPress={() => onChange(true)} />
      <Toggle label="off" active={!value} onPress={() => onChange(false)} />
    </Row>
  );
}

function Toggle({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { Pressable } = require('@reactjit/runtime/primitives');
  return (
    <Pressable onPress={onPress} style={{
      paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2,
      borderWidth: 1, borderColor: active ? 'theme:accent' : 'theme:rule',
      backgroundColor: active ? 'theme:bg2' : 'transparent',
    }}>
      <Text size={9} color={active ? 'theme:accent' : 'theme:inkDim'}>{label}</Text>
    </Pressable>
  );
}

function safeStringify(v: any): string {
  try { return JSON.stringify(v); } catch { return ''; }
}

function PortGroup({ heading, ports }: { heading: string; ports: FlowPort[] }) {
  return (
    <Col style={{ gap: 2 }}>
      <Text size={8} color="theme:inkDim">{heading}</Text>
      {ports.map((p) => (
        <Row key={p.id} style={{ gap: 6, alignItems: 'center' }}>
          <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: portColor(p.kind) }} />
          <Text size={10} color="theme:ink">{p.label || p.id}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text size={8} color="theme:inkDim">{p.kind}</Text>
        </Row>
      ))}
    </Col>
  );
}

function portColor(kind: string): string {
  switch (kind) {
    case 'flow':       return '#7aa2f7';
    case 'data':       return '#9ece6a';
    case 'tool':       return '#bb9af7';
    case 'cond-true':  return '#9ece6a';
    case 'cond-false': return '#f7768e';
    case 'error':      return '#f7768e';
    case 'ctx':        return '#e0af68';
    case 'loop':       return '#7dcfff';
    default:           return 'theme:rule';
  }
}
