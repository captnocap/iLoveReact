/**
 * eval-component.ts — Safe eval wrapper for user JSX code.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Box, Text } from '../../ilovereact/shared/src';

export interface EvalResult { component: React.ComponentType | null; error: string | null; }

export function evalComponent(transformedCode: string): EvalResult {
  try {
    const funcMatch = transformedCode.match(/function\s+([A-Z][a-zA-Z0-9]*)\s*\(/);
    const constMatch = transformedCode.match(/(?:const|let|var)\s+([A-Z][a-zA-Z0-9]*)\s*=/);
    const name = funcMatch?.[1] || constMatch?.[1];

    const wrapped = name
      ? `${transformedCode}\nreturn ${name};`
      : `return function __UserComponent__() { return ${transformedCode.trim().replace(/;$/, '')}; };`;

    const fn = new Function('React', 'useState', 'useEffect', 'useCallback', 'useRef', 'useMemo', 'Box', 'Text', wrapped);
    const result = fn(React, useState, useEffect, useCallback, useRef, useMemo, Box, Text);

    if (typeof result === 'function') return { component: result, error: null };
    if (result && typeof result === 'object' && result.$$typeof) return { component: () => result, error: null };
    return { component: null, error: 'Code did not produce a component. Define a function that returns JSX.' };
  } catch (e: any) {
    return { component: null, error: e?.message || String(e) };
  }
}
