import { describe, expect, it } from 'vitest';
import type { LearningQuestion } from '@interactiq/contracts';
import type { D1Database, D1PreparedStatement } from '../db/types';
import { AttemptService, displayAnswer, gradeAnswer } from './service';

const baseQuestion: Omit<LearningQuestion, 'type' | 'options' | 'acceptedAnswers'> = {
  id: 'q1', prompt: { type: 'doc', content: [] }, points: 2, timeLimitSeconds: null, position: 0,
};

describe('automatic grading', () => {
  it('requires an exact option set for multi-select answers', () => {
    const question: LearningQuestion = { ...baseQuestion, type: 'MULTI_SELECT', acceptedAnswers: [], options: [{ id: 'a', text: 'A', isCorrect: true }, { id: 'b', text: 'B', isCorrect: true }, { id: 'c', text: 'C', isCorrect: false }] };
    expect(gradeAnswer(question, ['a', 'b'])).toEqual({ correct: true, points: 2 });
    expect(gradeAnswer(question, ['a'])).toEqual({ correct: false, points: 0 });
  });

  it('normalizes fill-in-the-blanks answers before grading', () => {
    const question: LearningQuestion = { ...baseQuestion, type: 'FILL_IN_THE_BLANKS', options: [], acceptedAnswers: ['kuala lumpur'] };
    expect(gradeAnswer(question, '  KUALA LUMPUR ')).toEqual({ correct: true, points: 2 });
  });

  it('leaves open-ended answers for manual grading', () => {
    const question: LearningQuestion = { ...baseQuestion, type: 'OPEN_ENDED', options: [], acceptedAnswers: [] };
    expect(gradeAnswer(question, 'My explanation')).toEqual({ correct: null, points: 0 });
  });

  it('awards partial marks for multiple visual blanks', () => {
    const question: LearningQuestion = { ...baseQuestion, type: 'FILL_IN_THE_BLANKS', options: [], acceptedAnswers: [], interaction: { kind: 'fill_blank', template: 'I [[drink]] [[water]]', ignoreAccents: false, blanks: [{ id: 'one', answers: ['drink'], mode: 'text', options: [] }, { id: 'two', answers: ['water'], mode: 'text', options: [] }] } };
    expect(gradeAnswer(question, ['Drink', 'juice'])).toEqual({ correct: false, points: 1 });
  });

  it('grades reorder chains in the teacher-defined order', () => {
    const question: LearningQuestion = { ...baseQuestion, type: 'REORDER', options: [], acceptedAnswers: [], interaction: { kind: 'reorder', items: ['Seed', 'Plant', 'Flower'] } };
    expect(gradeAnswer(question, ['Seed', 'Plant', 'Flower'])).toEqual({ correct: true, points: 2 });
    expect(gradeAnswer(question, ['Flower', 'Plant', 'Seed'])).toEqual({ correct: false, points: 0 });
  });

  it('awards partial credit for correctly matched pairs', () => {
    const question: LearningQuestion = { ...baseQuestion, type: 'MATCH', options: [], acceptedAnswers: [], interaction: { kind: 'match', partialCredit: true, pairs: [{ id: 'rock', prompt: 'Rock', response: 'Construction' }, { id: 'veg', prompt: 'Vegetable', response: 'Food' }] } };
    expect(gradeAnswer(question, ['rock:rock', 'veg:wrong'])).toEqual({ correct: false, points: 1 });
    expect(gradeAnswer(question, ['rock:rock', 'veg:veg'])).toEqual({ correct: true, points: 2 });
  });

  it('grades match-table cells and penalizes extra selections', () => {
    const question: LearningQuestion = { ...baseQuestion, type: 'MATCH_TABLE_GRID', options: [], acceptedAnswers: [], interaction: { kind: 'match_table_grid', partialCredit: true, allowMultiplePerRow: true, rows: [{ id: 'r1', text: 'One' }, { id: 'r2', text: 'Two' }], columns: [{ id: 'c1', text: 'A' }, { id: 'c2', text: 'B' }], correctCells: ['r1:c1', 'r2:c2'] } };
    expect(gradeAnswer(question, ['r1:c1', 'r2:c1'])).toEqual({ correct: false, points: 0 });
    expect(gradeAnswer(question, ['r1:c1', 'r2:c2'])).toEqual({ correct: true, points: 2 });
  });

  it('grades categorized answer cards and supports partial credit', () => {
    const question: LearningQuestion = { ...baseQuestion, type: 'CATEGORIZE', options: [], acceptedAnswers: [], interaction: { kind: 'categorize', partialCredit: true, categories: [
      { id: 'food', name: 'Food', items: [{ id: 'veg', text: 'Vegetable' }] },
      { id: 'build', name: 'Construction', items: [{ id: 'brick', text: 'Brick' }] },
    ] } };
    expect(gradeAnswer(question, ['veg:food', 'brick:wrong'])).toEqual({ correct: false, points: 1 });
    expect(gradeAnswer(question, ['veg:food', 'brick:build'])).toEqual({ correct: true, points: 2 });
  });
});

describe('human-readable review answers', () => {
  it('replaces internal matching and grid identifiers with teacher labels', () => {
    const match: LearningQuestion = { ...baseQuestion, type:'MATCH', options:[], acceptedAnswers:[], interaction:{kind:'match',partialCredit:true,pairs:[{id:'p1',prompt:'System Grid',response:'Planned area'},{id:'p2',prompt:'Dead end',response:'Unplanned area'}]} };
    expect(displayAnswer(['p1:p2'],match)).toEqual(['System Grid → Unplanned area']);
    const grid: LearningQuestion = { ...baseQuestion, type:'MATCH_TABLE_GRID', options:[], acceptedAnswers:[], interaction:{kind:'match_table_grid',partialCredit:true,allowMultiplePerRow:false,rows:[{id:'r1',text:'Pressure'}],columns:[{id:'c1',text:'Grid system'}],correctCells:['r1:c1']} };
    expect(displayAnswer(['r1:c1'],grid)).toEqual(['Pressure → Grid system']);
  });

  it('renders labelling and hotspot answers without UUIDs or raw JSON', () => {
    const labelling: LearningQuestion = { ...baseQuestion, type:'LABELLING', options:[], acceptedAnswers:[], interaction:{kind:'labelling',imageUrl:'image.png',distractors:['Wrong'],labels:[{id:'l1',text:'Surface course',x:.2,y:.3}]} };
    expect(displayAnswer(['l1:l1'],labelling)).toEqual(['Surface course → Surface course']);
    const hotspot: LearningQuestion = { ...baseQuestion, type:'HOTSPOT', options:[], acceptedAnswers:[], interaction:{kind:'hotspot',imageUrl:'image.png',shape:'point',regions:[{id:'h1',points:[{x:.2,y:.3}]}]} };
    expect(displayAnswer('{"x":0.21,"y":0.35}',hotspot)).toBe('Selected point: 21% across, 35% down');
  });
});

describe('resource-scoped student attempts', () => {
  it('restores the in-progress attempt and student identity after a browser refresh', async () => {
    let inserted=false;
    const db: D1Database = {
      prepare: (query) => {
        const statement: D1PreparedStatement = {
          bind: () => statement,
          first: async <T,>() => {
            if (query.includes('FROM learning_resources WHERE tenant_id')) return ({ id:'resource-live',title:'Live lesson',description:null,type:'PRESENTATION',status:'PUBLISHED',visibility:'LINK_ONLY',shareCode:'LIVE1234',publishedAt:'2026-09-20 00:00:00',themeId:'AURORA',assetUrl:null,externalUrl:null,attemptPolicy:'MULTIPLE',resultReleasePolicy:'SHOW_SCORE',accessStartsAt:null,assignedClassName:'5 PKA 2',submissionDueAt:null,assignmentMaxScore:100,createdAt:'2026-09-20 00:00:00',updatedAt:'2026-09-20 00:00:00' } as T);
            if (query.includes("status = 'IN_PROGRESS'")) return ({ id:'attempt-existing',resourceId:'resource-live',status:'IN_PROGRESS',score:null,maxScore:null,submittedAt:null,studentFullName:'Aisyah',studentClassName:'5 PKA 2' } as T);
            return null;
          },
          all: async <T,>() => ({ results: [] as T[], success: true, meta: {} }),
          run: async () => { inserted=true;return { results: [], success: true, meta: {} }; },
        };
        return statement;
      },
      batch: async () => [],
    };
    const attempt=await new AttemptService(db).start('tenant-one','student-one','resource-live');
    expect(attempt).toMatchObject({id:'attempt-existing',studentFullName:'Aisyah',studentClassName:'5 PKA 2'});
    expect(inserted).toBe(false);
  });

  it('checks the one-attempt rule against the requested resource, not the student email globally', async () => {
    const boundQueries: Array<{ query: string; values: unknown[] }> = [];
    const db: D1Database = {
      prepare: (query) => {
        let values: unknown[] = [];
        const statement: D1PreparedStatement = {
          bind: (...input) => { values = input; boundQueries.push({ query, values }); return statement; },
          first: async <T,>() => {
            if (query.includes('FROM learning_resources WHERE tenant_id')) return ({
              id: 'resource-two', title: 'Second quiz', description: null, type: 'QUIZ', status: 'PUBLISHED', visibility: 'LINK_ONLY', shareCode: 'BBBB2222', publishedAt: '2026-09-20 00:00:00',
              themeId: 'AURORA', assetUrl: null, externalUrl: null, attemptPolicy: 'ONCE_PER_EMAIL', resultReleasePolicy: 'SHOW_SCORE', accessStartsAt: null, assignedClassName: null, submissionDueAt: null,
              assignmentMaxScore: 100, createdAt: '2026-09-20 00:00:00', updatedAt: '2026-09-20 00:00:00',
            } as T);
            if (query.includes("status = 'COMPLETED'")) return null;
            return null;
          },
          all: async <T,>() => ({ results: [] as T[], success: true, meta: {} }),
          run: async () => ({ results: [], success: true, meta: {} }),
        };
        return statement;
      },
      batch: async () => [],
    };

    const attempt = await new AttemptService(db).start('tenant-one', 'same-student-email', 'resource-two');

    expect(attempt.resourceId).toBe('resource-two');
    const previousAttemptLookup = boundQueries.find(({ query }) => query.includes("status = 'COMPLETED'"));
    expect(previousAttemptLookup?.values).toEqual(['tenant-one', 'resource-two', 'same-student-email']);
  });
});
