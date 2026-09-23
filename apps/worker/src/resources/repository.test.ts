import { describe, expect, it } from 'vitest';
import { normalizeClassName, ResourceRepository } from './repository';
import type { D1Database, D1PreparedStatement } from '../db/types';

const createDatabase = (): { db: D1Database; queries: string[]; values: unknown[][] } => {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const statement: D1PreparedStatement = {
    bind(...boundValues) {
      values.push(boundValues);
      return statement;
    },
    first: async () => null,
    all: async () => ({ results: [], success: true, meta: {} }),
    run: async () => ({ results: [], success: true, meta: {} }),
  };
  return {
    db: {
      prepare(query) {
        queries.push(query);
        return statement;
      },
      batch: async () => [],
    },
    queries,
    values,
  };
};

describe('ResourceRepository tenant boundaries', () => {
  it('lists resources with a parameter-bound tenant scope', async () => {
    const fake = createDatabase();
    await new ResourceRepository(fake.db).list('tenant-a');
    expect(fake.queries[0]).toContain('WHERE tenant_id = ?');
    expect(fake.values[0]).toEqual(['tenant-a']);
  });

  it('requires the tenant scope when looking up a single resource', async () => {
    const fake = createDatabase();
    await new ResourceRepository(fake.db).findById('tenant-a', '3a209468-d64b-4d39-8c61-a1f5df3612f7');
    expect(fake.queries[0]).toContain('tenant_id = ? AND id = ?');
    expect(fake.values[0]).toEqual(['tenant-a', '3a209468-d64b-4d39-8c61-a1f5df3612f7']);
  });
});

describe('class name normalisation', () => {
  it.each(['5 PKA 2', '5PKA2', '5 PKA2', '5-pka-2'])('groups %s under one class', (value) => {
    expect(normalizeClassName(value)).toBe('5 PKA 2');
  });

  it('normalises class names without a trailing number', () => {
    expect(normalizeClassName('5 padu')).toBe('5 PADU');
  });
});
