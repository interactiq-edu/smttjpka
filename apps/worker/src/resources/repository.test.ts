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

  it('loads live state together with the current presentation delivery', async () => {
    const row = {
      resourceId: '3a209468-d64b-4d39-8c61-a1f5df3612f7', assetUrl: '/api/v1/media/files/new-deck.pptx', externalUrl: null,
      currentSlide: 4, currentZoom: 120, activeQuestionId: null, whiteboardJson: '[]', presentationMode: 'SLIDE' as const,
      allowStudentDraw: 0, allowDownload: 0, showCurrentSlide: 1, showQuiz: 0, updatedAt: '2026-09-25 10:00:00',
    };
    const statement: D1PreparedStatement = {
      bind: () => statement,
      first: async <T>() => row as T,
      all: async () => ({ results: [], success: true, meta: {} }),
      run: async () => ({ results: [], success: true, meta: {} }),
    };
    const db: D1Database = { prepare: () => statement, batch: async () => [] };

    const state = await new ResourceRepository(db).getLiveState('tenant-a', row.resourceId);

    expect(state.assetUrl).toBe(row.assetUrl);
    expect(state.currentSlide).toBe(4);
    expect(state.currentZoom).toBe(120);
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
