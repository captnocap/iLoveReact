import React, { useState } from 'react';
import { Box, Text, Pressable } from '@ilovereact/core';
import { useWallet } from '../wallet/context';
import { formatEther } from '../network/rpc';
import { shortenAddress } from '../crypto/keys';
import { chains } from '../network/chains';

const C = {
  bg: '#11111b',
  surface: '#1e1e2e',
  overlay: '#313244',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  dim: '#585b70',
  accent: '#89b4fa',
  green: '#a6e3a1',
  red: '#f38ba8',
  yellow: '#f9e2af',
  peach: '#fab387',
};

function copyToClipboard(text: string) {
  (globalThis as any).__hostLog('CLIPBOARD:' + text);
}

export function Dashboard() {
  const { state, actions } = useWallet();
  const account = state.accounts[0];
  const chain = chains[state.network];

  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!account) return null;

  return (
    <Box style={{
      width: '100%',
      height: '100%',
      backgroundColor: C.bg,
      padding: 20,
      gap: 16,
    }}>
      {/* Top bar: network + lock */}
      <Box style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
      }}>
        {/* Network badge */}
        <Pressable onPress={() => actions.navigate('settings')}>
          <Box style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: C.surface,
            borderRadius: 16,
            paddingLeft: 10, paddingRight: 10,
            paddingTop: 6, paddingBottom: 6,
          }}>
            <Box style={{
              width: 8, height: 8,
              borderRadius: 4,
              backgroundColor: state.network === 'mainnet' ? C.green : C.yellow,
            }} />
            <Text style={{ fontSize: 12, color: C.subtext }}>
              {chain.name}
            </Text>
          </Box>
        </Pressable>

        {/* Tor status + Lock */}
        <Box style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Box style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            backgroundColor: C.surface,
            borderRadius: 12,
            paddingLeft: 8, paddingRight: 8,
            paddingTop: 4, paddingBottom: 4,
          }}>
            <Box style={{
              width: 6, height: 6,
              borderRadius: 3,
              backgroundColor: state.useTor ? C.green : C.dim,
            }} />
            <Text style={{ fontSize: 10, color: state.useTor ? C.green : C.dim }}>
              Tor
            </Text>
          </Box>

          <Pressable onPress={() => actions.lock()}>
            <Box style={{
              backgroundColor: C.surface,
              borderRadius: 12,
              paddingLeft: 10, paddingRight: 10,
              paddingTop: 4, paddingBottom: 4,
            }}>
              <Text style={{ fontSize: 11, color: C.dim }}>
                Lock
              </Text>
            </Box>
          </Pressable>
        </Box>
      </Box>

      {/* Address */}
      <Pressable
        onPress={() => handleCopy(account.address)}
        style={{
          width: '100%',
          alignItems: 'center',
          paddingTop: 6,
          paddingBottom: 6,
          borderRadius: 8,
        }}
      >
        <Text style={{ fontSize: 13, color: copied ? C.green : C.dim }}>
          {copied ? 'Copied!' : shortenAddress(account.address)}
        </Text>
        {!copied && (
          <Text style={{ fontSize: 10, color: C.overlay }}>
            tap to copy
          </Text>
        )}
      </Pressable>

      {/* Balance card */}
      <Box style={{
        backgroundColor: C.surface,
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        gap: 6,
      }}>
        <Text style={{ fontSize: 11, color: C.dim, fontWeight: '600' }}>
          BALANCE
        </Text>
        {state.balanceLoading ? (
          <Text style={{ fontSize: 32, color: C.subtext, fontWeight: '700' }}>
            {'...'}
          </Text>
        ) : (
          <Text style={{ fontSize: 32, color: C.text, fontWeight: '700' }}>
            {`${formatEther(state.balance)} ${chain.symbol}`}
          </Text>
        )}
        <Pressable onPress={() => actions.refreshBalance()}>
          <Text style={{ fontSize: 11, color: C.accent }}>
            Refresh
          </Text>
        </Pressable>
      </Box>

      {/* Send / Receive buttons */}
      <Box style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
        <Pressable
          onPress={() => actions.navigate('send')}
          style={(s) => ({
            flexGrow: 1,
            backgroundColor: s.pressed ? '#7aa2f7' : s.hovered ? '#89b4fa' : C.accent,
            paddingTop: 14, paddingBottom: 14,
            borderRadius: 12,
            alignItems: 'center',
          })}
        >
          <Text style={{ fontSize: 15, color: C.bg, fontWeight: '700' }}>
            Send
          </Text>
        </Pressable>

        <Pressable
          onPress={() => actions.navigate('receive')}
          style={(s) => ({
            flexGrow: 1,
            backgroundColor: s.pressed ? '#45475a' : s.hovered ? '#313244' : C.surface,
            paddingTop: 14, paddingBottom: 14,
            borderRadius: 12,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: C.overlay,
          })}
        >
          <Text style={{ fontSize: 15, color: C.text, fontWeight: '600' }}>
            Receive
          </Text>
        </Pressable>
      </Box>

      {/* Transaction result */}
      {state.txHash && (
        <Pressable onPress={() => handleCopy(state.txHash!)} style={{ width: '100%' }}>
          <Box style={{
            backgroundColor: '#152a1d',
            borderRadius: 10,
            paddingLeft: 12, paddingRight: 12,
            paddingTop: 10, paddingBottom: 10,
            gap: 4,
          }}>
            <Text style={{ fontSize: 12, color: C.green, fontWeight: '600' }}>
              Transaction sent!
            </Text>
            <Text style={{ fontSize: 11, color: C.subtext }}>
              {`${state.txHash.slice(0, 16)}...${state.txHash.slice(-8)}`}
            </Text>
            <Text style={{ fontSize: 10, color: C.dim }}>
              tap to copy hash
            </Text>
          </Box>
        </Pressable>
      )}

      {/* Error */}
      {state.error && (
        <Box style={{
          backgroundColor: '#2a1520',
          borderRadius: 8,
          paddingLeft: 12, paddingRight: 12,
          paddingTop: 8, paddingBottom: 8,
        }}>
          <Text style={{ fontSize: 12, color: C.red }}>
            {state.error}
          </Text>
        </Box>
      )}

      {/* Spacer */}
      <Box style={{ flexGrow: 1 }} />

      {/* Settings */}
      <Pressable onPress={() => actions.navigate('settings')}>
        <Box style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 8 }}>
          <Text style={{ fontSize: 12, color: C.dim }}>
            Settings
          </Text>
        </Box>
      </Pressable>
    </Box>
  );
}
