// renderer/hostConfig.test.ts — mutation placements move keyed children.
// Run:
//   tools/esbuild renderer/hostConfig.test.ts --bundle --format=iife \
//     --platform=neutral --target=es2022 --alias:@reactjit/core=./runtime/core_stub.ts \
//     '--banner:js=globalThis.setTimeout=(fn)=>{fn();return 0};globalThis.clearTimeout=()=>{};' \
//     --outfile=/tmp/reactjit-host-config.test.js
//   tools/v8cli /tmp/reactjit-host-config.test.js

import { hostConfig, type Instance } from './hostConfig';

function node(id: number): Instance {
  return {
    id,
    type: 'Box',
    props: {},
    handlers: {},
    children: [],
    renderCount: 1,
    parent: null,
  };
}

function ids(parent: Instance): number[] {
  return parent.children.map((child) => child.id);
}

function expectIds(label: string, actual: number[], expected: number[]): void {
  if (actual.length !== expected.length || actual.some((id, i) => id !== expected[i])) {
    throw new Error(`${label}: expected [${expected}], got [${actual}]`);
  }
}

const firstParent = node(10);
const first = node(1);
const second = node(2);
hostConfig.appendInitialChild(firstParent, first);
hostConfig.appendInitialChild(firstParent, second);
hostConfig.appendChild(firstParent, first);
expectIds('append reorder', ids(firstParent), [2, 1]);

hostConfig.insertBefore(firstParent, first, second);
expectIds('insert-before reorder', ids(firstParent), [1, 2]);

const secondParent = node(20);
hostConfig.appendChild(secondParent, first);
expectIds('old parent after cross-parent move', ids(firstParent), [2]);
expectIds('new parent after cross-parent move', ids(secondParent), [1]);

console.log('hostConfig keyed child placement: ok');
