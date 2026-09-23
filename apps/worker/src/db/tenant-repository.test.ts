import { describe, expect, it } from 'vitest';
import { TenantRepository } from './tenant-repository';
import type { D1Database, D1PreparedStatement } from './types';

const tenantRow = {
  id: 'tenant_1',
  slug: 'north-school',
  name: 'North School',
  status: 'active' as const,
  created_at: '2026-09-12 00:00:00',
  updated_at: '2026-09-12 00:00:00',
};

const createDatabase = (row: unknown): { db: D1Database; queries: string[]; values: unknown[][] } => {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const statement: D1PreparedStatement = {
    bind(...boundValues) {
      values.push(boundValues);
      return statement;
    },
    first: async () => row as never,
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

describe('TenantRepository', () => {
  it('selects only an active tenant with a parameter-bound slug', async () => {
    const fake = createDatabase(tenantRow);
    const repository = new TenantRepository(fake.db);

    await expect(repository.findActiveBySlug('north-school')).resolves.toMatchObject({ id: 'tenant_1', status: 'active' });
    expect(fake.queries[0]).toContain("status = 'active'");
    expect(fake.values[0]).toEqual(['north-school']);
  });
});
