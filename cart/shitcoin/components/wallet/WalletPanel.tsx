// WalletPanel — address + balance + holdings + recent PnL. Stateful
// data comes from sim hooks; visuals come from the classifier variants.

import { classifiers as C } from '../../../../runtime/classifier';
import { useWallet, usePlayerAddress } from '../../sim';
import './WalletPanel.cls';

export interface WalletPanelProps {
  /** When false, hide the holdings list (compact summary mode). */
  showHoldings?: boolean;
  /** Custom title to use instead of "Account 1". */
  title?: string;
}

function shortAddr(addr: string | null): string {
  if (!addr) return '0x…';
  if (addr.length <= 10) return addr;
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function fmt(n: number, d: number = 2): string {
  if (!isFinite(n)) return '—';
  return n.toFixed(d);
}

function pct(n: number): string {
  return (n * 100).toFixed(2) + '%';
}

export function WalletPanel({ showHoldings = true, title = 'Account 1' }: WalletPanelProps) {
  const w = useWallet();
  const addr = usePlayerAddress();
  if (!w) {
    return (
      <C.WalletPanelRoot>
        <C.WalletPanelAccountLabel>{title}</C.WalletPanelAccountLabel>
        <C.WalletPanelEmpty>waiting…</C.WalletPanelEmpty>
      </C.WalletPanelRoot>
    );
  }
  const pnl = w.totalUsd - w.start;
  const pnlPct = w.start > 0 ? pnl / w.start : 0;
  const PnlCls = pnl >= 0 ? C.WalletPanelPnlPos : C.WalletPanelPnlNeg;

  return (
    <C.WalletPanelRoot>
      <C.WalletPanelHeader>
        <C.WalletPanelAccountLabel>{title}</C.WalletPanelAccountLabel>
        <C.WalletPanelAddress>{shortAddr(addr)}</C.WalletPanelAddress>
      </C.WalletPanelHeader>

      <C.WalletPanelBalanceBlock>
        <C.WalletPanelBalanceBig>${fmt(w.totalUsd)}</C.WalletPanelBalanceBig>
        <C.WalletPanelBalanceSub>cash ${fmt(w.usd)} · {w.trades} trades</C.WalletPanelBalanceSub>
        <PnlCls>{pnl >= 0 ? '+' : ''}${fmt(pnl)} ({pct(pnlPct)})</PnlCls>
      </C.WalletPanelBalanceBlock>

      {showHoldings ? (
        <>
          <C.WalletPanelSectionLabel>Holdings</C.WalletPanelSectionLabel>
          {w.holdings.length === 0 ? (
            <C.WalletPanelEmpty>No tokens yet — buy something.</C.WalletPanelEmpty>
          ) : (
            <C.WalletPanelHoldingsList>
              {w.holdings.map((h) => {
                const PnlRowCls = h.upnl >= 0 ? C.WalletPanelHoldingPnlPos : C.WalletPanelHoldingPnlNeg;
                return (
                  <C.WalletPanelHoldingRow key={h.id}>
                    <C.WalletPanelHoldingSym>{h.sym}</C.WalletPanelHoldingSym>
                    <C.WalletPanelHoldingAmt>{fmt(h.amt, 4)} · avg ${fmt(h.avg, 6)}</C.WalletPanelHoldingAmt>
                    <PnlRowCls>{h.upnl >= 0 ? '+' : ''}${fmt(h.upnl)}</PnlRowCls>
                  </C.WalletPanelHoldingRow>
                );
              })}
            </C.WalletPanelHoldingsList>
          )}
        </>
      ) : null}
    </C.WalletPanelRoot>
  );
}
