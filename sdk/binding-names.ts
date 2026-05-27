// sdk/binding-names.ts - TYPE-ONLY.

import type bindings from './bindings';

export type Binding = keyof typeof bindings;
