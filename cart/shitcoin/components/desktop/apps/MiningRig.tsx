// MiningRig — rig list + per-rig wear + total mined display.
// SHAPE PASS stub: read-only view + a debug "install" button so the
// rig vertical can be exercised without the upgrade purchase flow.

import { Box, Text, Pressable } from '@reactjit/runtime/primitives';
import { useMiningRigs, useAllLatest, sim } from '../../../sim';
import { Page } from '../../primitives/Page';
import { Table } from '../../primitives/Table';

function fmt(n: number, dec = 4): string {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toFixed(dec);
}

export function MiningRig() {
  const rigs = useMiningRigs();
  const tokens = useAllLatest();
  const firstToken = tokens[0]?.id ?? 0;

  return (
    <Page heroTitle="Mining Rigs" heroSubtitle="GPUs mint tokens to your wallet every tick. Power costs come straight out of cash.">
      <Box style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          onPress={() => sim.installMiningRig(1, firstToken)}
          style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 8, paddingBottom: 8, borderRadius: 6, backgroundColor: 'theme:primary' as any }}
        >
          <Text style={{ fontSize: 13, color: '#0b0d10', fontWeight: 'bold' }}>+ Tier 1 Rig (debug)</Text>
        </Pressable>
        <Pressable
          onPress={() => sim.installMiningRig(3, firstToken)}
          style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 8, paddingBottom: 8, borderRadius: 6, backgroundColor: 'theme:bgElevated' as any, borderWidth: 1, borderColor: 'theme:border' as any }}
        >
          <Text style={{ fontSize: 13, color: 'theme:text' as any, fontWeight: 'bold' }}>+ Tier 3 Rig (debug)</Text>
        </Pressable>
      </Box>

      <Table
        columns={[
          { key: 'id', label: '#', width: 32 },
          { key: 'tier', label: 'Tier', width: 50 },
          { key: 'target', label: 'Target', width: 80, render: (r: any) => (tokens.find((t) => t.id === r.targetTokenId)?.sym ?? '—') },
          { key: 'rate', label: '/sec', width: 80, align: 'right', render: (r: any) => fmt(r.ratePerSec) },
          { key: 'power', label: '$/hr', width: 70, align: 'right', render: (r: any) => '$' + fmt(r.powerCostPerHr, 2) },
          { key: 'mined', label: 'Mined', width: 90, align: 'right', render: (r: any) => fmt(r.totalMined) },
          { key: 'wear', label: 'Wear', width: 80, align: 'right', render: (r: any) => (r.wear * 100).toFixed(1) + '%', tint: (r: any) => r.wear > 0.7 ? 'neg' : null },
        ]}
        rows={rigs.map((r) => ({ ...r, key: r.id }))}
      />

      {rigs.length === 0 ? (
        <Text style={{ fontSize: 12, color: 'theme:textDim' as any, paddingTop: 12 }}>
          No rigs yet. Install one above to start minting.
        </Text>
      ) : null}
    </Page>
  );
}
