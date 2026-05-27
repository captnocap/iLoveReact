// ArbBot — CEX↔DEX arb monitor + auto-arb rule runner.
// Same shape as SniperBot, different trigger/action set.

import { ScriptApp } from './ScriptApp';

const TRIGGERS = [
  { label: 'Spread on $tokenId > $frac', spec: 'sim:cex:spread:$tokenId:gt:$frac' },
  { label: 'CEX listing on $tokenId',    spec: 'sim:cex:listing:$tokenId' },
  { label: 'Any CEX listing',            spec: 'sim:cex:listing:any' },
  { label: 'Price $tokenId crosses above $usd', spec: 'sim:price:$tokenId:above:$usd' },
];

const ACTIONS = [
  { label: 'CEX buy: $cexId $tokenId $usd',         spec: 'cex:buy:$cexId:$tokenId:$usd' },
  { label: 'CEX sell: $cexId $tokenId $amt',        spec: 'cex:sell:$cexId:$tokenId:$amt' },
  { label: 'Deposit $tokenId $amt to CEX $cexId',   spec: 'cex:deposit:$cexId:$tokenId:$amt' },
  { label: 'Withdraw $tokenId $amt from CEX $cexId',spec: 'cex:withdraw:$cexId:$tokenId:$amt' },
  { label: 'AMM buy $tokenId $usd',                 spec: 'trade:buy:$tokenId:$usd' },
  { label: 'AMM sell $tokenId $amt',                spec: 'trade:sell:$tokenId:$amt' },
  { label: 'Notify',                                spec: 'notify:Arb on $tokenId' },
];

export function ArbBot() {
  return (
    <ScriptApp
      appId="arb"
      title="Arb Bot"
      subtitle="Front-run the spread between centralized + decentralized prices."
      triggerTemplates={TRIGGERS}
      actionTemplates={ACTIONS}
    />
  );
}
