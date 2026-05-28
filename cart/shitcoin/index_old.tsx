import { memo, useState } from 'react';
import { Box, Graph, Pressable, ScrollView, Text } from '@reactjit/runtime/primitives';
import { Route, Router, useNavigate, useRoute } from '../../runtime/router';
import { ThemeProvider } from '../../runtime/classifier';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';
import { sim, useAllLatest, useGameTime, useLatestPrice, useMarket, usePlayerAddress, usePriceHistory, useTape, useTrades, useWallet, type PriceSample } from './sim';
import { Desktop } from './components';

const CHART_W = 540;
const CHART_H = 200;

function fmt(n: number, d: number = 4): string {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1) return n.toFixed(d);
  if (Math.abs(n) >= 0.001) return n.toFixed(d + 2);
  return n.toExponential(2);
}
function pct(n: number): string {
  return (n * 100).toFixed(2) + '%';
}
function patColor(pat: string, rug: boolean): string {
  if (rug) return '#f87171';
  if (pat === 'pump' || pat === 'organic_up') return '#4ade80';
  if (pat === 'dump' || pat === 'organic_down') return '#fb923c';
  if (pat === 'volatile') return '#c084fc';
  return '#60a5fa';
}

function PriceChart({ tokenId, color }: { tokenId: number; color?: string }) {
  const samples = usePriceHistory(tokenId);
  if (samples.length < 2) {
    return <C.AppSubtle>warming up… ({samples.length} samples)</C.AppSubtle>;
  }
  let lo = Infinity, hi = -Infinity;
  for (const s of samples) { if (s.p < lo) lo = s.p; if (s.p > hi) hi = s.p; }
  const pad = (hi - lo) * 0.1 || hi * 0.02 || 0.001;
  lo -= pad; hi += pad;
  const span = hi - lo;
  const pts: number[] = new Array(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const x = (i / (samples.length - 1)) * CHART_W;
    const y = CHART_H - ((samples[i].p - lo) / span) * CHART_H;
    pts[i * 2] = x;
    pts[i * 2 + 1] = y;
  }
  const last = samples[samples.length - 1];
  const stroke = color ?? patColor(last.pat, last.rug);
  return (
    <Graph style={{ width: CHART_W, height: CHART_H }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
      <Graph.Polyline points={pts} stroke={stroke} strokeWidth={2} />
    </Graph>
  );
}

function TokenRow({ tokenId, selected, onSelect }: { tokenId: number; selected: boolean; onSelect: () => void }) {
  const s = useLatestPrice(tokenId);
  const samples = usePriceHistory(tokenId);
  if (!s) return null;
  const ago = samples.length >= 2 ? samples[Math.max(0, samples.length - 20)].p : s.p;
  const change = s.p / ago - 1;
  const changeColor = change >= 0 ? '#4ade80' : '#f87171';
  const bg = selected ? 'rgba(96,165,250,0.10)' : 'transparent';
  const border = selected ? '#60a5fa' : 'rgba(255,255,255,0.06)';
  return (
    <Pressable
      onPress={onSelect}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10,
        borderRadius: 8,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        gap: 12,
      }}
    >
      <Box style={{ flexDirection: 'column', gap: 2, flexGrow: 1 }}>
        <Text style={{ fontSize: 14, color: '#d7dde8', fontWeight: 'bold' }}>
          {s.sym}{s.rug ? ' · RUGGED' : ''}
        </Text>
        <Text style={{ fontSize: 11, color: '#8a93a6' }}>{s.pat}</Text>
      </Box>
      <Box style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ fontSize: 14, color: '#d7dde8', fontWeight: 'bold' }}>${fmt(s.p, 4)}</Text>
        <Text style={{ fontSize: 11, color: changeColor }}>{change >= 0 ? '+' : ''}{pct(change)}</Text>
      </Box>
    </Pressable>
  );
}

function TokenList({ selected, onSelect }: { selected: number; onSelect: (id: number) => void }) {
  const all = useAllLatest();
  return (
    <Box style={{ flexDirection: 'column', gap: 6 }}>
      {all.map((s) => (
        <TokenRow key={s.id} tokenId={s.id} selected={s.id === selected} onSelect={() => onSelect(s.id)} />
      ))}
    </Box>
  );
}

function MarketPanel() {
  const m = useMarket();
  if (!m) return <C.AppPanel><C.AppPanelTitle>Market</C.AppPanelTitle><C.AppSubtle>waiting…</C.AppSubtle></C.AppPanel>;
  const trendColor = m.trend === 'bull' ? '#4ade80' : m.trend === 'bear' ? '#f87171' : '#8a93a6';
  return (
    <C.AppPanel>
      <C.AppPanelTitle>Market</C.AppPanelTitle>
      <Box style={{ flexDirection: 'row', gap: 16, alignItems: 'baseline' }}>
        <Text style={{ fontSize: 22, color: trendColor, fontWeight: 'bold' }}>{m.trend.toUpperCase()}</Text>
        <C.AppSubtle>vol {pct(m.vol)} · F/G {m.fg.toFixed(0)} · age {m.trendAge}t</C.AppSubtle>
      </Box>
    </C.AppPanel>
  );
}

function WalletPanel({ tokenId }: { tokenId: number }) {
  const w = useWallet();
  const [usdInput, setUsdInput] = useState('10');
  const [sellInput, setSellInput] = useState('100');
  if (!w) return <C.AppPanel><C.AppPanelTitle>Wallet</C.AppPanelTitle><C.AppSubtle>waiting…</C.AppSubtle></C.AppPanel>;
  const pnl = w.totalUsd - w.start;
  const pnlColor = pnl >= 0 ? '#4ade80' : '#f87171';
  const holding = w.holdings.find((h) => h.id === tokenId);
  const usd = parseFloat(usdInput) || 0;
  const amt = parseFloat(sellInput) || 0;
  return (
    <C.AppPanel>
      <C.AppPanelTitle>Wallet</C.AppPanelTitle>
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 22, color: '#d7dde8', fontWeight: 'bold' }}>${fmt(w.totalUsd, 2)}</Text>
        <Text style={{ fontSize: 14, color: pnlColor, fontWeight: 'bold' }}>{pnl >= 0 ? '+' : ''}${fmt(pnl, 2)} ({pct(pnl / w.start)})</Text>
      </Box>
      <C.AppSubtle>cash ${fmt(w.usd, 2)} · {w.trades} trades</C.AppSubtle>

      <Box style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Text style={{ fontSize: 12, color: '#8a93a6', width: 40 }}>USD</Text>
        <C.AppTextInput style={{ flexGrow: 1 }} value={usdInput} onChangeText={(v: string) => setUsdInput(v)} />
        <Pressable
          onPress={() => sim.buy(tokenId, usd)}
          style={{
            paddingLeft: 14, paddingRight: 14, paddingTop: 8, paddingBottom: 8,
            backgroundColor: '#4ade80', borderRadius: 6,
          }}
        >
          <Text style={{ fontSize: 13, color: '#0b0d10', fontWeight: 'bold' }}>BUY</Text>
        </Pressable>
      </Box>
      <Box style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Text style={{ fontSize: 12, color: '#8a93a6', width: 40 }}>QTY</Text>
        <C.AppTextInput style={{ flexGrow: 1 }} value={sellInput} onChangeText={(v: string) => setSellInput(v)} />
        <Pressable
          onPress={() => sim.sell(tokenId, amt)}
          style={{
            paddingLeft: 14, paddingRight: 14, paddingTop: 8, paddingBottom: 8,
            backgroundColor: '#f87171', borderRadius: 6,
          }}
        >
          <Text style={{ fontSize: 13, color: '#0b0d10', fontWeight: 'bold' }}>SELL</Text>
        </Pressable>
      </Box>

      {holding && holding.amt > 0 && (
        <Box style={{ marginTop: 6, padding: 8, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.04)' }}>
          <Text style={{ fontSize: 12, color: '#d7dde8' }}>
            {holding.sym}: {fmt(holding.amt, 4)} · avg ${fmt(holding.avg, 6)} · uPnL {holding.upnl >= 0 ? '+' : ''}${fmt(holding.upnl, 2)}
          </Text>
        </Box>
      )}
    </C.AppPanel>
  );
}

// StressPage — all 5 charts + live tape + interactivity probe on one
// view. Stress test for the steady-state cost: many simultaneous live
// subscribers, large polyline UPDATEs every notify, tape rows scrolling.
const MINI_W = 320;
const MINI_H = 120;

// Visible samples per MiniChart. The history buffer holds up to 200; at
// 320px wide that's <2px per sample — invisible. Subsample to a stride
// that gives ~40 visible points, cutting polyline UPDATE payload ~5×.
const MINI_VISIBLE_SAMPLES = 40;

function MiniChart({ tokenId }: { tokenId: number }) {
  const samples = usePriceHistory(tokenId);
  const s = useLatestPrice(tokenId);
  if (samples.length < 2) {
    return (
      <Box style={{ width: MINI_W, height: MINI_H + 40 }}>
        <C.AppSubtle>{s?.sym ?? `#${tokenId}`} — warming…</C.AppSubtle>
      </Box>
    );
  }
  // Subsample by stride. Always include the most recent sample (so the
  // chart's right edge reflects the latest tick) and walk backward.
  const stride = Math.max(1, Math.floor(samples.length / MINI_VISIBLE_SAMPLES));
  const visible: PriceSample[] = [];
  for (let i = samples.length - 1; i >= 0; i -= stride) visible.push(samples[i]);
  visible.reverse();
  let lo = Infinity, hi = -Infinity;
  for (const x of visible) { if (x.p < lo) lo = x.p; if (x.p > hi) hi = x.p; }
  const pad = (hi - lo) * 0.1 || hi * 0.02 || 0.001;
  lo -= pad; hi += pad;
  const span = hi - lo;
  const pts: number[] = new Array(visible.length * 2);
  for (let i = 0; i < visible.length; i++) {
    pts[i * 2] = (i / (visible.length - 1)) * MINI_W;
    pts[i * 2 + 1] = MINI_H - ((visible[i].p - lo) / span) * MINI_H;
  }
  const last = samples[samples.length - 1];
  return (
    <Box style={{ flexDirection: 'column', gap: 2, width: MINI_W }}>
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ fontSize: 13, color: '#d7dde8', fontWeight: 'bold' }}>{s?.sym ?? `#${tokenId}`}</Text>
        <Text style={{ fontSize: 13, color: '#d7dde8' }}>${fmt(last.p, 6)}</Text>
      </Box>
      <Text style={{ fontSize: 10, color: '#5a6275' }}>{last.pat}{last.rug ? ' · RUGGED' : ''}</Text>
      <Graph style={{ width: MINI_W, height: MINI_H }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
        <Graph.Polyline points={pts} stroke={patColor(last.pat, last.rug)} strokeWidth={1.5} />
      </Graph>
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 10, color: '#8a93a6' }}>MC {compactUsd(s?.marketCapUsd ?? 0)}</Text>
        <Text style={{ fontSize: 10, color: '#8a93a6' }}>Vol {compactUsd(s?.volumeUsd ?? 0)}</Text>
        <Text style={{ fontSize: 10, color: '#5a6275' }}>Liq {compactUsd(s?.liquidityUsd ?? 0)}</Text>
      </Box>
    </Box>
  );
}

// Compact $X.Yk / $X.YM / $X.YB formatter for cramped UI cells.
function compactUsd(v: number): string {
  if (!isFinite(v) || v <= 0) return '$0';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k';
  return '$' + v.toFixed(0);
}

function StressPage() {
  const [clicks, setClicks] = useState(0);
  const all = useAllLatest();
  const tape = useTape();
  return (
    <C.AppBody>
      <C.AppPanel>
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Pressable
            onPress={() => setClicks((c) => c + 1)}
            style={{
              paddingLeft: 18, paddingRight: 18, paddingTop: 10, paddingBottom: 10,
              borderRadius: 8, backgroundColor: '#60a5fa',
            }}
          >
            <Text style={{ fontSize: 14, color: '#0b0d10', fontWeight: 'bold' }}>SMASH</Text>
          </Pressable>
          <Text style={{ fontSize: 22, color: '#d7dde8', fontWeight: 'bold' }}>{clicks}</Text>
          <Pressable
            onPress={() => sim.addRandomToken()}
            style={{
              paddingLeft: 14, paddingRight: 14, paddingTop: 10, paddingBottom: 10,
              borderRadius: 8, backgroundColor: '#c084fc',
            }}
          >
            <Text style={{ fontSize: 14, color: '#0b0d10', fontWeight: 'bold' }}>+1 TOKEN</Text>
          </Pressable>
          <Text style={{ fontSize: 14, color: '#8a93a6' }}>tokens: {all.length}</Text>
          <MarketPanelInline />
        </Box>
      </C.AppPanel>

      <C.AppRow>
        <C.AppPanel>
          <C.AppPanelTitle>Charts ({all.length})</C.AppPanelTitle>
          <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            {all.map((s) => (<MiniChart key={s.id} tokenId={s.id} />))}
          </Box>
        </C.AppPanel>

        <C.AppPanel style={{ flexGrow: 0, flexBasis: 380, height: 600 }}>
          <C.AppPanelTitle>Tape</C.AppPanelTitle>
          <ScrollView style={{ flexGrow: 1, flexBasis: 0 }}>
            <Box style={{ flexDirection: 'column' }}>
              {tape.slice(0, 80).map((e) => {
                const side = e.kind === 'buy' ? '#4ade80' : '#f87171';
                return (
                  <Box key={e.seq} style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingTop: 3, paddingBottom: 3, paddingLeft: 6, paddingRight: 6,
                    borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.03)',
                  }}>
                    <Text style={{ fontSize: 11, color: side, width: 38, fontWeight: 'bold' }}>{e.kind.toUpperCase()}</Text>
                    <Text style={{ fontSize: 11, color: '#d7dde8', width: 60 }}>{e.sym}</Text>
                    <Text style={{ fontSize: 11, color: '#d7dde8', flexGrow: 1, textAlign: 'right' }}>${fmt(e.price, 6)}</Text>
                    <Text style={{ fontSize: 11, color: '#8a93a6', width: 70, textAlign: 'right' }}>${fmt(e.usd, 0)}</Text>
                  </Box>
                );
              })}
            </Box>
          </ScrollView>
          <Pressable
            onPress={() => {}}
            style={{
              paddingLeft: 14, paddingRight: 14, paddingTop: 10, paddingBottom: 10,
              borderRadius: 8, backgroundColor: '#ef4444', alignSelf: 'center',
            }}
          >
            <Text style={{ fontSize: 14, color: '#ffffff', fontWeight: 'bold' }}>I SHOULD BE VISIBLE</Text>
          </Pressable>
        </C.AppPanel>
      </C.AppRow>
    </C.AppBody>
  );
}

function MarketPanelInline() {
  const m = useMarket();
  if (!m) return <C.AppSubtle>—</C.AppSubtle>;
  const c = m.trend === 'bull' ? '#4ade80' : m.trend === 'bear' ? '#f87171' : '#8a93a6';
  return (
    <Box style={{ flexDirection: 'row', gap: 12, alignItems: 'baseline' }}>
      <Text style={{ fontSize: 16, color: c, fontWeight: 'bold' }}>{m.trend.toUpperCase()}</Text>
      <C.AppSubtle>vol {pct(m.vol)} · F/G {m.fg.toFixed(0)}</C.AppSubtle>
    </Box>
  );
}

function TradePage() {
  const [selected, setSelected] = useState(0);
  const sample = useLatestPrice(selected);
  return (
    <C.AppBody>
      <MarketPanel />
      <C.AppRow>
        <C.AppPanel style={{ flexGrow: 0, flexBasis: 260 }}>
          <C.AppPanelTitle>Tokens</C.AppPanelTitle>
          <TokenList selected={selected} onSelect={setSelected} />
        </C.AppPanel>
        <C.AppPanel>
          <Box style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <C.AppPanelTitle>{sample?.sym ?? `#${selected}`}/USD</C.AppPanelTitle>
            <Text style={{ fontSize: 24, color: '#d7dde8', fontWeight: 'bold' }}>${fmt(sample?.p ?? 0, 6)}</Text>
          </Box>
          <C.AppSubtle>
            {sample ? `${sample.pat}${sample.rug ? ' · RUGGED' : ''} · ATH $${fmt(sample.ath, 6)} · ATL $${fmt(sample.atl, 6)}` : '—'}
          </C.AppSubtle>
          <PriceChart tokenId={selected} />
          <WalletPanel tokenId={selected} />
        </C.AppPanel>
      </C.AppRow>
    </C.AppBody>
  );
}

function PortfolioPage() {
  const w = useWallet();
  const all = useAllLatest();
  if (!w) return <C.AppBody><C.AppPanel><C.AppSubtle>waiting…</C.AppSubtle></C.AppPanel></C.AppBody>;
  const pnl = w.totalUsd - w.start;
  const pnlColor = pnl >= 0 ? '#4ade80' : '#f87171';
  return (
    <C.AppBody>
      <C.AppPanel>
        <C.AppPanelTitle>Portfolio</C.AppPanelTitle>
        <Box style={{ flexDirection: 'row', gap: 24, alignItems: 'baseline' }}>
          <Text style={{ fontSize: 32, color: '#d7dde8', fontWeight: 'bold' }}>${fmt(w.totalUsd, 2)}</Text>
          <Text style={{ fontSize: 18, color: pnlColor, fontWeight: 'bold' }}>
            {pnl >= 0 ? '+' : ''}${fmt(pnl, 2)} ({pct(pnl / w.start)})
          </Text>
        </Box>
        <C.AppSubtle>cash ${fmt(w.usd, 2)} · {w.trades} trades · start ${fmt(w.start, 2)}</C.AppSubtle>
      </C.AppPanel>
      <C.AppPanel>
        <C.AppPanelTitle>Holdings</C.AppPanelTitle>
        {w.holdings.filter((h) => h.amt > 0.0000001).length === 0 ? (
          <C.AppSubtle>No holdings yet. Switch to TRADE and buy some shitcoins.</C.AppSubtle>
        ) : (
          w.holdings.filter((h) => h.amt > 0.0000001).map((h) => {
            const live = all.find((a) => a.id === h.id);
            const upnlColor = h.upnl >= 0 ? '#4ade80' : '#f87171';
            return (
              <Box key={h.id} style={{
                flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                paddingTop: 8, paddingBottom: 8,
                borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
              }}>
                <Box style={{ flexDirection: 'column', gap: 2 }}>
                  <Text style={{ fontSize: 14, color: '#d7dde8', fontWeight: 'bold' }}>{h.sym}</Text>
                  <Text style={{ fontSize: 11, color: '#8a93a6' }}>{fmt(h.amt, 4)} @ avg ${fmt(h.avg, 6)}</Text>
                </Box>
                <Box style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <Text style={{ fontSize: 14, color: '#d7dde8' }}>${fmt((live?.p ?? 0) * h.amt, 2)}</Text>
                  <Text style={{ fontSize: 11, color: upnlColor }}>{h.upnl >= 0 ? '+' : ''}${fmt(h.upnl, 2)}</Text>
                </Box>
              </Box>
            );
          })
        )}
      </C.AppPanel>
    </C.AppBody>
  );
}

function relTime(realMsNow: number, realMsThen: number): string {
  const dt = Math.max(0, realMsNow - realMsThen);
  if (dt < 1000) return `${dt | 0}ms ago`;
  const s = dt / 1000;
  if (s < 60) return `${s.toFixed(1)}s ago`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)}m ago`;
  return `${(m / 60).toFixed(1)}h ago`;
}

// Memoized row — entries in `_tape` are immutable after creation (we
// only push at the front and drop off the back), so React.memo's default
// shallow comparison hits `prevProps.entry === nextProps.entry` for every
// row that isn't the newcomer. Old rows skip their render function
// entirely; only the new row at the top does any JSX work per commit.
const TapeRowMemo = memo(function TapeRowMemo({ entry: e }: { entry: import('./sim').TapeEntry }) {
  const Side = e.kind === 'buy' ? C.TapeSideBuy : C.TapeSideSell;
  const Row = e.usd > 1000 ? C.TapeRowHot : C.TapeRow;
  return (
    <Row>
      <Side>{e.kind.toUpperCase()}</Side>
      <C.TapeCellToken>{e.sym}</C.TapeCellToken>
      <C.TapeCellFlexDim>{fmt(e.base, 4)}</C.TapeCellFlexDim>
      <C.TapeCellFlex>${fmt(e.price, 6)}</C.TapeCellFlex>
      <C.TapeCellFlex>${fmt(e.usd, 2)}</C.TapeCellFlex>
      <C.TapeCellW70Dim>{pct(e.impact)}</C.TapeCellW70Dim>
      <C.TapeCellW60Dim>{e.t}</C.TapeCellW60Dim>
    </Row>
  );
});

function TapePage() {
  const [filterId, setFilterId] = useState<number | null>(null);
  const [clicks, setClicks] = useState(0);
  const all = useAllLatest();
  const tape = useTape(filterId ?? undefined);
  const totalBuyUsd = tape.reduce((a, e) => a + (e.kind === 'buy' ? e.usd : 0), 0);
  const totalSellUsd = tape.reduce((a, e) => a + (e.kind === 'sell' ? e.usd : 0), 0);
  const net = totalBuyUsd - totalSellUsd;
  const netColor = net >= 0 ? '#4ade80' : '#f87171';
  return (
    <C.AppBody>
      {/* Interactivity probe — click should respond instantly if the engine
          frame loop isn't blocked. If clicks lag, the loop is stalled. */}
      <C.AppPanel>
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Pressable
            onPress={() => setClicks((c) => c + 1)}
            style={{
              paddingLeft: 18, paddingRight: 18, paddingTop: 12, paddingBottom: 12,
              borderRadius: 8, backgroundColor: '#60a5fa',
            }}
          >
            <Text style={{ fontSize: 16, color: '#0b0d10', fontWeight: 'bold' }}>SMASH</Text>
          </Pressable>
          <Text style={{ fontSize: 28, color: '#d7dde8', fontWeight: 'bold' }}>
            {clicks}
          </Text>
          <Text style={{ fontSize: 13, color: '#8a93a6' }}>
            clicks should land instantly — any lag = engine frame loop is blocked
          </Text>
        </Box>
      </C.AppPanel>

      <C.AppPanel>
        <C.AppPanelTitle>Order flow</C.AppPanelTitle>
        <Box style={{ flexDirection: 'row', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Text style={{ fontSize: 13, color: '#8a93a6' }}>
            {tape.length} prints · buy ${fmt(totalBuyUsd, 0)} · sell ${fmt(totalSellUsd, 0)}
          </Text>
          <Text style={{ fontSize: 13, color: netColor, fontWeight: 'bold' }}>
            net {net >= 0 ? '+' : ''}${fmt(net, 0)}
          </Text>
        </Box>
        <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Pressable
            onPress={() => setFilterId(null)}
            style={{
              paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5,
              borderRadius: 4, borderWidth: 1,
              backgroundColor: filterId == null ? '#1f242e' : 'transparent',
              borderColor: filterId == null ? '#60a5fa' : 'rgba(255,255,255,0.08)',
            }}
          >
            <Text style={{ fontSize: 11, color: '#d7dde8', fontWeight: 'bold' }}>ALL</Text>
          </Pressable>
          {all.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => setFilterId(s.id)}
              style={{
                paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5,
                borderRadius: 4, borderWidth: 1,
                backgroundColor: filterId === s.id ? '#1f242e' : 'transparent',
                borderColor: filterId === s.id ? '#60a5fa' : 'rgba(255,255,255,0.08)',
              }}
            >
              <Text style={{ fontSize: 11, color: '#d7dde8' }}>{s.sym}</Text>
            </Pressable>
          ))}
        </Box>
        <Box style={{ flexDirection: 'column' }}>
          <C.TapeHeaderRow>
            <C.TapeHeaderCellSide>SIDE</C.TapeHeaderCellSide>
            <C.TapeHeaderCellToken>TOKEN</C.TapeHeaderCellToken>
            <C.TapeHeaderCellFlex>BASE</C.TapeHeaderCellFlex>
            <C.TapeHeaderCellFlex>PRICE</C.TapeHeaderCellFlex>
            <C.TapeHeaderCellFlex>USD</C.TapeHeaderCellFlex>
            <C.TapeHeaderCellW70>IMPACT</C.TapeHeaderCellW70>
            <C.TapeHeaderCellW60>TICK</C.TapeHeaderCellW60>
          </C.TapeHeaderRow>
          {tape.length === 0 ? (
            <C.AppSubtle>warming up… first prints land in a few ticks.</C.AppSubtle>
          ) : tape.slice(0, 200).map((e) => (
            <TapeRowMemo key={e.seq} entry={e} />
          ))}
        </Box>
      </C.AppPanel>
    </C.AppBody>
  );
}

function TradesPage() {
  const trades = useTrades();
  const nowMs = sim.realTimeMs();
  return (
    <C.AppBody>
      <C.AppPanel>
        <C.AppPanelTitle>My trades</C.AppPanelTitle>
        <C.AppSubtle>{trades.length} trade{trades.length === 1 ? '' : 's'} · newest first · cap 256</C.AppSubtle>
        {trades.length === 0 ? (
          <C.AppSubtle>No trades yet. Hit BUY on the TRADE page.</C.AppSubtle>
        ) : (
          <Box style={{ flexDirection: 'column' }}>
            <Box style={{
              flexDirection: 'row',
              paddingTop: 6, paddingBottom: 6, paddingLeft: 8, paddingRight: 8,
              borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
            }}>
              <Text style={{ fontSize: 10, color: '#5a6275', width: 40, fontWeight: 'bold' }}>#</Text>
              <Text style={{ fontSize: 10, color: '#5a6275', width: 50, fontWeight: 'bold' }}>SIDE</Text>
              <Text style={{ fontSize: 10, color: '#5a6275', width: 80, fontWeight: 'bold' }}>TOKEN</Text>
              <Text style={{ fontSize: 10, color: '#5a6275', flexGrow: 1, textAlign: 'right', fontWeight: 'bold' }}>AMOUNT</Text>
              <Text style={{ fontSize: 10, color: '#5a6275', flexGrow: 1, textAlign: 'right', fontWeight: 'bold' }}>PRICE</Text>
              <Text style={{ fontSize: 10, color: '#5a6275', flexGrow: 1, textAlign: 'right', fontWeight: 'bold' }}>USD</Text>
              <Text style={{ fontSize: 10, color: '#5a6275', width: 70, textAlign: 'right', fontWeight: 'bold' }}>FEE</Text>
              <Text style={{ fontSize: 10, color: '#5a6275', width: 70, textAlign: 'right', fontWeight: 'bold' }}>IMPACT</Text>
              <Text style={{ fontSize: 10, color: '#5a6275', width: 90, textAlign: 'right', fontWeight: 'bold' }}>AGE</Text>
            </Box>
            {trades.map((tx) => {
              const sideColor = tx.kind === 'buy' ? '#4ade80' : '#f87171';
              return (
                <Box key={tx.seq} style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingTop: 5, paddingBottom: 5, paddingLeft: 8, paddingRight: 8,
                  borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.04)',
                }}>
                  <Text style={{ fontSize: 11, color: '#5a6275', width: 40 }}>{tx.seq}</Text>
                  <Text style={{ fontSize: 11, color: sideColor, width: 50, fontWeight: 'bold' }}>{tx.kind.toUpperCase()}</Text>
                  <Text style={{ fontSize: 11, color: '#d7dde8', width: 80 }}>{tx.sym}</Text>
                  <Text style={{ fontSize: 11, color: '#d7dde8', flexGrow: 1, textAlign: 'right' }}>{fmt(tx.base, 4)}</Text>
                  <Text style={{ fontSize: 11, color: '#d7dde8', flexGrow: 1, textAlign: 'right' }}>${fmt(tx.price, 6)}</Text>
                  <Text style={{ fontSize: 11, color: '#d7dde8', flexGrow: 1, textAlign: 'right' }}>${fmt(tx.usd, 2)}</Text>
                  <Text style={{ fontSize: 11, color: '#8a93a6', width: 70, textAlign: 'right' }}>${fmt(tx.fee, 3)}</Text>
                  <Text style={{ fontSize: 11, color: '#8a93a6', width: 70, textAlign: 'right' }}>{pct(tx.impact)}</Text>
                  <Text style={{ fontSize: 11, color: '#5a6275', width: 90, textAlign: 'right' }}>{relTime(nowMs, tx.realMs)}</Text>
                </Box>
              );
            })}
          </Box>
        )}
      </C.AppPanel>
    </C.AppBody>
  );
}

function NavItem({ to, label }: { to: string; label: string }) {
  const nav = useNavigate();
  const { path } = useRoute();
  const active = path === to;
  return (
    <Pressable
      onPress={() => nav.push(to)}
      style={{
        paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7,
        borderRadius: 6,
        backgroundColor: active ? '#1f242e' : 'transparent',
        borderWidth: 1,
        borderColor: active ? '#60a5fa' : 'rgba(255,255,255,0.06)',
      }}
    >
      <Text style={{ fontSize: 13, color: active ? '#d7dde8' : '#8a93a6' }}>{label}</Text>
    </Pressable>
  );
}

function shortAddr(addr: string | null): string {
  if (!addr) return '0x…';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

function Shell() {
  const playerAddr = usePlayerAddress();
  const gt = useGameTime();
  return (
    <C.AppRoot>
      <C.AppShell>
        <C.AppHeader>
          <C.AppTitleBlock>
            <C.AppKicker>SHITCOIN</C.AppKicker>
            <C.AppTitle>degen sim</C.AppTitle>
            <C.AppSubtle>
              {gt ? `Day ${gt.day} · ${pad2(gt.hour)}:00 · ` : ''}
              wallet {shortAddr(playerAddr)}
            </C.AppSubtle>
          </C.AppTitleBlock>
          <C.AppNav>
            <NavItem to="/os" label="OS" />
            <NavItem to="/" label="TRADE" />
            <NavItem to="/stress" label="STRESS" />
            <NavItem to="/portfolio" label="PORTFOLIO" />
            <NavItem to="/tape" label="TAPE" />
            <NavItem to="/trades" label="MY TRADES" />
            <Pressable
              onPress={() => sim.reset()}
              style={{
                paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7,
                borderRadius: 6, backgroundColor: 'transparent',
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
              }}
            >
              <Text style={{ fontSize: 13, color: '#8a93a6' }}>RESET</Text>
            </Pressable>
          </C.AppNav>
        </C.AppHeader>
        <Route path="/os"><Desktop /></Route>
        <Route path="/"><TradePage /></Route>
        <Route path="/stress"><StressPage /></Route>
        <Route path="/portfolio"><PortfolioPage /></Route>
        <Route path="/tape"><TapePage /></Route>
        <Route path="/trades"><TradesPage /></Route>
        <Route fallback>
          <C.AppPanel><C.AppPanelTitle>Not found</C.AppPanelTitle></C.AppPanel>
        </Route>
      </C.AppShell>
    </C.AppRoot>
  );
}

export default function App() {
  return (
    <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}>
      <Router initialPath="/">
        <Shell />
      </Router>
    </ThemeProvider>
  );
}
