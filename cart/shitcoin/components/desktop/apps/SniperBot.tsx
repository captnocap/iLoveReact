// SniperBot — auto-buy on pattern flip / price breakout / volume spike.
// Just a thin shell over <ScriptApp> with sniper-flavoured templates.

import { ScriptApp } from './ScriptApp';

const TRIGGERS = [
  { label: 'Any token flips to pump',  spec: 'sim:pattern:any:to:pump' },
  { label: 'Token $tokenId flips to pump', spec: 'sim:pattern:$tokenId:to:pump' },
  { label: 'Price $tokenId crosses above $usd', spec: 'sim:price:$tokenId:above:$usd' },
  { label: 'Volume $tokenId spikes $mult×', spec: 'sim:volume:$tokenId:spike:$mult' },
  { label: 'Any rug', spec: 'sim:rug:any' },
];

const ACTIONS = [
  { label: 'Buy $usd of token', spec: 'trade:buy:$tokenId:$usd' },
  { label: 'Sell entire bag',   spec: 'trade:sell-all:$tokenId' },
  { label: 'Notify',            spec: 'notify:Sniper fired on $tokenId' },
];

export function SniperBot() {
  return (
    <ScriptApp
      appId="sniper"
      title="Sniper Bot"
      subtitle="Auto-buy on pattern flip. Tier-up your CPU + RAM for faster ticks + more rules."
      triggerTemplates={TRIGGERS}
      actionTemplates={ACTIONS}
    />
  );
}
