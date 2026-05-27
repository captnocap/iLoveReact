// DexCard — reusable buy/sell card driven entirely by classifier styles.
// All visible affordances are <C.DexXxx> elements; nothing inline. Skins
// swap appearance by overriding the classifier variant + theme tokens
// at the SkinProvider boundary.

import { useState, useMemo } from 'react';
import { classifiers as C } from '../../../../runtime/classifier';
import { sim, useLatestPrice, useWallet, type QuoteResult } from '../../sim';
import './DexCard.cls';

type Side = 'buy' | 'sell';

export interface DexCardProps {
  tokenId: number;
  /** Initial input value when switching to BUY mode (USD). */
  defaultUsdIn?: number;
  /** Title above the card. Defaults to "Swap". */
  title?: string;
  /** Optional footer hint — site components use this for "Get tokens
   *  with cross-chain" copy etc. */
  footer?: string;
}

function fmtNum(n: number, dec: number = 4): string {
  if (!isFinite(n) || n === 0) return '0';
  if (Math.abs(n) >= 1) return n.toFixed(dec);
  if (Math.abs(n) >= 0.001) return n.toFixed(dec + 2);
  return n.toExponential(2);
}

function pctStr(n: number, dec: number = 2): string {
  if (!isFinite(n)) return '—';
  return (n * 100).toFixed(dec) + '%';
}

export function DexCard({ tokenId, defaultUsdIn = 100, title = 'Swap', footer }: DexCardProps) {
  const price = useLatestPrice(tokenId);
  const wallet = useWallet();
  const [side, setSide] = useState<Side>('buy');
  const [usdIn, setUsdIn] = useState(String(defaultUsdIn));
  const [tokenIn, setTokenIn] = useState('100');

  // Quote refreshes per render (cheap — single Zig call). The amount
  // input is the only thing driving the cost, so this is fine even if
  // wallet/price tick fires extra renders.
  const inputNum = parseFloat(side === 'buy' ? usdIn : tokenIn) || 0;
  const quote: QuoteResult = useMemo(() => {
    if (inputNum <= 0) return { output: 0, impact: 0, fee: 0, effective_price: 0 };
    return side === 'buy' ? sim.quoteBuy(tokenId, inputNum) : sim.quoteSell(tokenId, inputNum);
  }, [tokenId, side, inputNum, price?.p]);

  const sym = price?.sym ?? '???';
  const cashStr = wallet ? `$${wallet.usd.toFixed(2)}` : '—';
  const holdingAmt = wallet?.holdings.find((h) => h.id === tokenId)?.amt ?? 0;

  const impactPct = quote.impact;
  const impactCls = impactPct >= 0.10 ? C.DexQuoteValueDanger
                   : impactPct >= 0.03 ? C.DexQuoteValueWarn
                   : C.DexQuoteValue;

  const onSubmit = () => {
    if (inputNum <= 0) return;
    if (side === 'buy') sim.buy(tokenId, inputNum);
    else sim.sell(tokenId, inputNum);
  };

  const canSubmit =
    inputNum > 0 &&
    (side === 'buy' ? (wallet?.usd ?? 0) >= inputNum : holdingAmt >= inputNum);

  const CtaText = canSubmit ? C.DexSwapCtaText : C.DexSwapCtaTextDisabled;

  return (
    <C.DexCardRoot>
      <C.DexCardHeader>
        <C.DexCardTitle>{title}</C.DexCardTitle>
        <C.DexSideToggle>
          {side === 'buy' ? (
            <C.DexSideToggleButtonActive onPress={() => setSide('buy')}>
              <C.DexSideToggleTextActive>Buy</C.DexSideToggleTextActive>
            </C.DexSideToggleButtonActive>
          ) : (
            <C.DexSideToggleButton onPress={() => setSide('buy')}>
              <C.DexSideToggleText>Buy</C.DexSideToggleText>
            </C.DexSideToggleButton>
          )}
          {side === 'sell' ? (
            <C.DexSideToggleButtonActive onPress={() => setSide('sell')}>
              <C.DexSideToggleTextActive>Sell</C.DexSideToggleTextActive>
            </C.DexSideToggleButtonActive>
          ) : (
            <C.DexSideToggleButton onPress={() => setSide('sell')}>
              <C.DexSideToggleText>Sell</C.DexSideToggleText>
            </C.DexSideToggleButton>
          )}
        </C.DexSideToggle>
      </C.DexCardHeader>

      <C.DexInputRow>
        <C.DexInputLabel>
          {side === 'buy' ? `You pay (cash ${cashStr})` : `You sell (bag ${fmtNum(holdingAmt, 4)} ${sym})`}
        </C.DexInputLabel>
        <C.DexInputBox>
          {side === 'buy' ? (
            <C.DexInputField value={usdIn} onChangeText={(v: string) => setUsdIn(v)} />
          ) : (
            <C.DexInputField value={tokenIn} onChangeText={(v: string) => setTokenIn(v)} />
          )}
          <C.DexTokenChip>
            <C.DexTokenChipText>{side === 'buy' ? 'USDT' : sym}</C.DexTokenChipText>
          </C.DexTokenChip>
        </C.DexInputBox>
      </C.DexInputRow>

      <C.DexInputRow>
        <C.DexInputLabel>You receive (estimated)</C.DexInputLabel>
        <C.DexInputBox>
          <C.DexOutputAmount>{fmtNum(quote.output, 6)}</C.DexOutputAmount>
          <C.DexTokenChip>
            <C.DexTokenChipText>{side === 'buy' ? sym : 'USDT'}</C.DexTokenChipText>
          </C.DexTokenChip>
        </C.DexInputBox>
      </C.DexInputRow>

      <C.DexQuoteRow>
        <C.DexQuoteLabel>Price impact</C.DexQuoteLabel>
        <impactCls>{pctStr(impactPct)}</impactCls>
      </C.DexQuoteRow>

      <C.DexQuoteRow>
        <C.DexQuoteLabel>Fee</C.DexQuoteLabel>
        <C.DexQuoteValue>${fmtNum(quote.fee, 2)}</C.DexQuoteValue>
      </C.DexQuoteRow>

      <C.DexQuoteRow>
        <C.DexQuoteLabel>Spot price</C.DexQuoteLabel>
        <C.DexQuoteValue>${fmtNum(price?.p ?? 0, 8)}</C.DexQuoteValue>
      </C.DexQuoteRow>

      <C.DexSwapCta onPress={onSubmit}>
        <CtaText>{side === 'buy' ? `Buy ${sym}` : `Sell ${sym}`}</CtaText>
      </C.DexSwapCta>

      {footer ? <C.DexFooterHint>{footer}</C.DexFooterHint> : null}
    </C.DexCardRoot>
  );
}
