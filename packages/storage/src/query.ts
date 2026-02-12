/**
 * Simple query engine for filtering, sorting, and paginating data.
 * Used by adapters that store data as flat files (JSON, markdown, text).
 * SQL adapters use native SQL queries instead.
 */

import type { Query, WhereClause } from './types';

/** Apply a query to an array of records. */
export function applyQuery<T>(items: T[], query?: Query): T[] {
  if (!query) return items;

  let result = items;

  // Filter
  if (query.where) {
    result = result.filter(item => matchesWhere(item, query.where!));
  }

  // Sort
  if (query.orderBy) {
    const field = query.orderBy;
    const dir = query.order === 'desc' ? -1 : 1;
    result = [...result].sort((a, b) => {
      const va = (a as any)[field];
      const vb = (b as any)[field];
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }

  // Pagination
  if (query.offset) {
    result = result.slice(query.offset);
  }
  if (query.limit) {
    result = result.slice(0, query.limit);
  }

  return result;
}

/** Check if a record matches a where clause. */
function matchesWhere(item: any, where: WhereClause): boolean {
  for (const [field, condition] of Object.entries(where)) {
    const value = item[field];

    // Direct value comparison: { name: 'Alice' }
    if (typeof condition !== 'object' || condition === null || condition instanceof Date) {
      if (value !== condition) return false;
      continue;
    }

    // Operator comparisons: { age: { $gt: 18 } }
    for (const [op, expected] of Object.entries(condition as Record<string, any>)) {
      switch (op) {
        case '$eq':
          if (value !== expected) return false;
          break;
        case '$ne':
          if (value === expected) return false;
          break;
        case '$gt':
          if (!(value > expected)) return false;
          break;
        case '$gte':
          if (!(value >= expected)) return false;
          break;
        case '$lt':
          if (!(value < expected)) return false;
          break;
        case '$lte':
          if (!(value <= expected)) return false;
          break;
        case '$in':
          if (!Array.isArray(expected) || !expected.includes(value)) return false;
          break;
        case '$contains':
          if (typeof value === 'string') {
            if (!value.includes(expected)) return false;
          } else if (Array.isArray(value)) {
            if (!value.includes(expected)) return false;
          } else {
            return false;
          }
          break;
      }
    }
  }

  return true;
}
