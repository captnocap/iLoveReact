import React from 'react';
import { Box, Text, Pressable } from '@ilovereact/core';
import { useWallet } from '../wallet/context';
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
};

function copyToClipboard(text: string) {
  (globalThis as any).__hostLog('CLIPBOARD:' + text);
}

export function Receive() {
  const { state, actions } = useWallet();
  const account = state.accounts[0];
  const chain = chains[state.network];

  if (!account) return null;

  // Split address into lines for readability
  const addr = account.address;

  return (
    <Box style={{
      width: '100%',
      height: '100%',
      backgroundColor: C.bg,
      padding: 24,
      gap: 24,
    }}>
      {/* Header */}
      <Box style={{ gap: 4 }}>
        <Pressable onPress={() => actions.navigate('dashboard')}>
          <Text style={{ fontSize: 13, color: C.dim }}>
            {'< Back'}
          </Text>
        </Pressable>
        <Text style={{ fontSize: 22, color: C.text, fontWeight: '700' }}>
          Receive
        </Text>
        <Text style={{ fontSize: 13, color: C.subtext }}>
          {`Share this address to receive ${chain.symbol} on ${chain.name}`}
        </Text>
      </Box>

      {/* Address display */}
      <Box style={{
        backgroundColor: C.surface,
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        gap: 16,
      }}>
        <Text style={{ fontSize: 11, color: C.dim, fontWeight: '600' }}>
          YOUR ADDRESS
        </Text>

        {/* Full address in monospace-like format */}
        <Box style={{
          backgroundColor: C.bg,
          borderRadius: 10,
          padding: 16,
          width: '100%',
          alignItems: 'center',
        }}>
          <Text style={{ fontSize: 14, color: C.accent, textAlign: 'center' }}>
            {addr.slice(0, 22)}
          </Text>
          <Text style={{ fontSize: 14, color: C.accent, textAlign: 'center' }}>
            {addr.slice(22)}
          </Text>
        </Box>

        {/* Copy button */}
        <Pressable
          onPress={() => copyToClipboard(addr)}
          style={(s) => ({
            backgroundColor: s.pressed ? '#7aa2f7' : C.accent,
            paddingLeft: 24, paddingRight: 24,
            paddingTop: 10, paddingBottom: 10,
            borderRadius: 10,
          })}
        >
          <Text style={{ fontSize: 14, color: C.bg, fontWeight: '700' }}>
            Copy Address
          </Text>
        </Pressable>
      </Box>

      {/* Network info */}
      <Box style={{
        backgroundColor: C.surface,
        borderRadius: 10,
        paddingLeft: 14, paddingRight: 14,
        paddingTop: 10, paddingBottom: 10,
        gap: 4,
      }}>
        <Box style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          width: '100%',
        }}>
          <Text style={{ fontSize: 12, color: C.dim }}>
            Network
          </Text>
          <Text style={{ fontSize: 12, color: C.subtext }}>
            {chain.name}
          </Text>
        </Box>
        <Box style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          width: '100%',
        }}>
          <Text style={{ fontSize: 12, color: C.dim }}>
            Chain ID
          </Text>
          <Text style={{ fontSize: 12, color: C.subtext }}>
            {`${chain.chainId}`}
          </Text>
        </Box>
      </Box>

      {/* Warning */}
      <Box style={{
        backgroundColor: '#2a2215',
        borderRadius: 8,
        paddingLeft: 12, paddingRight: 12,
        paddingTop: 8, paddingBottom: 8,
      }}>
        <Text style={{ fontSize: 12, color: '#f9e2af' }}>
          {`Only send ${chain.symbol} and ERC-20 tokens on ${chain.name} to this address.`}
        </Text>
      </Box>
    </Box>
  );
}
