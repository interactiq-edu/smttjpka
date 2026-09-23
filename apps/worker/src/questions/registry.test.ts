import { describe, expect, it } from 'vitest';
import { parseQuestionInput } from './registry';

const prompt = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Which answer is correct?' }] }] };

describe('question registry', () => {
  it('accepts a multiple-choice question with exactly one correct option', () => {
    expect(parseQuestionInput({ type: 'MULTIPLE_CHOICE', prompt, options: [
      { id: 'a', text: 'Answer A', isCorrect: true },
      { id: 'b', text: 'Answer B', isCorrect: false },
    ] })).toMatchObject({ type: 'MULTIPLE_CHOICE', points: 1 });
  });

  it('rejects a multiple-choice question with no correct option', () => {
    expect(() => parseQuestionInput({ type: 'MULTIPLE_CHOICE', prompt, options: [
      { id: 'a', text: 'Answer A', isCorrect: false },
      { id: 'b', text: 'Answer B', isCorrect: false },
    ] })).toThrow('Set the correct answer');
  });

  it('requires an answer for fill-in-the-blanks questions', () => {
    expect(() => parseQuestionInput({ type: 'FILL_IN_THE_BLANKS', prompt, acceptedAnswers: [] })).toThrow('accepted answer');
  });

  it('accepts a dropdown with one selected correct option', () => {
    expect(parseQuestionInput({ type: 'DROPDOWN', prompt, options: [
      { id: 'a', text: 'Answer A', isCorrect: false },
      { id: 'b', text: 'Answer B', isCorrect: true },
    ] })).toMatchObject({ type: 'DROPDOWN' });
  });

  it('stores an answer key for structured interactive question types', () => {
    expect(parseQuestionInput({ type: 'MATCH', prompt, acceptedAnswers: ['Mercury = planet', 'Venus = planet'] }))
      .toMatchObject({ type: 'MATCH', acceptedAnswers: ['mercury = planet\nvenus = planet'] });
  });

  it('allows a passage without an answer key', () => {
    expect(parseQuestionInput({ type: 'PASSAGE', prompt })).toMatchObject({ type: 'PASSAGE', acceptedAnswers: [] });
  });

  it('keeps open-ended key ideas for preliminary AI marking', () => {
    expect(parseQuestionInput({ type: 'OPEN_ENDED', prompt, acceptedAnswers: ['Independence', 'A sovereign nation'] }))
      .toMatchObject({ type: 'OPEN_ENDED', acceptedAnswers: ['Independence', 'A sovereign nation'] });
  });

  it('accepts an optional question time limit', () => {
    expect(parseQuestionInput({ type: 'TRUE_FALSE', prompt, correctAnswer: 'true', timeLimitSeconds: 90 }))
      .toMatchObject({ timeLimitSeconds: 90 });
  });

  it('accepts visual labelling configuration', () => {
    expect(parseQuestionInput({ type: 'LABELLING', prompt, interaction: { kind: 'labelling', imageUrl: 'https://example.com/lion.jpg', labels: [{ id: 'nose', text: 'Nose', x: .5, y: .4 }], distractors: [] } }))
      .toMatchObject({ type: 'LABELLING', interaction: { kind: 'labelling' } });
  });

  it('accepts visual match pairs', () => {
    expect(parseQuestionInput({ type: 'MATCH', prompt, interaction: { kind: 'match', partialCredit: true, pairs: [{ id: 'a', prompt: 'Batu bata', response: 'Pembinaan' }, { id: 'b', prompt: 'Sayur', response: 'Makanan' }] } }))
      .toMatchObject({ type: 'MATCH', interaction: { kind: 'match', partialCredit: true } });
  });

  it('accepts a configured match table grid', () => {
    expect(parseQuestionInput({ type: 'MATCH_TABLE_GRID', prompt, interaction: { kind: 'match_table_grid', partialCredit: true, allowMultiplePerRow: false, rows: [{ id: 'r1', text: 'One' }, { id: 'r2', text: 'Two' }], columns: [{ id: 'c1', text: 'A' }, { id: 'c2', text: 'B' }], correctCells: ['r1:c1'] } }))
      .toMatchObject({ type: 'MATCH_TABLE_GRID', interaction: { kind: 'match_table_grid' } });
  });

  it('accepts a configured categorize board with two categories', () => {
    expect(parseQuestionInput({ type: 'CATEGORIZE', prompt, interaction: { kind: 'categorize', partialCredit: true, categories: [
      { id: 'food', name: 'Food', items: [{ id: 'veg', text: 'Vegetable' }] },
      { id: 'build', name: 'Construction', items: [{ id: 'brick', text: 'Brick' }] },
    ] } })).toMatchObject({ type: 'CATEGORIZE', interaction: { kind: 'categorize', partialCredit: true } });
  });
});
