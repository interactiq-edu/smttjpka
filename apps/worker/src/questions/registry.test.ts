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

  it('accepts image-only choices in match pairs', () => {
    const parsed=parseQuestionInput({ type: 'MATCH', prompt, interaction: { kind: 'match', partialCredit: true, pairs: [
      { id: 'a', prompt: '', promptImageUrl: '/api/v1/media/tenants/demo/images/brick.png', response: '', responseImageUrl: '/api/v1/media/tenants/demo/images/wall.png' },
      { id: 'b', prompt: '', promptImageUrl: '/api/v1/media/tenants/demo/images/apple.png', response: 'Food' },
    ] } });
    expect(parsed.interaction?.kind === 'match' && parsed.interaction.pairs[0]?.promptImageUrl).toContain('brick.png');
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

  it('accepts image-only answer cards in a categorize board', () => {
    const parsed=parseQuestionInput({ type: 'CATEGORIZE', prompt, interaction: { kind: 'categorize', partialCredit: true, categories: [
      { id: 'food', name: 'Food', items: [{ id: 'veg', text: '', imageUrl: '/api/v1/media/tenants/demo/images/vegetable.png' }] },
      { id: 'build', name: 'Construction', items: [{ id: 'brick', text: '', imageUrl: '/api/v1/media/tenants/demo/images/brick.png' }] },
    ] } });
    expect(parsed.interaction?.kind === 'categorize' && parsed.interaction.categories[0]?.items[0]?.imageUrl).toContain('vegetable.png');
  });

  it('rejects blank match and categorize choices when no image is supplied', () => {
    expect(() => parseQuestionInput({ type: 'MATCH', prompt, interaction: { kind: 'match', partialCredit: true, pairs: [
      { id: 'a', prompt: '', response: 'Wall' }, { id: 'b', prompt: 'Apple', response: 'Food' },
    ] } })).toThrow('text or image pairs');
    expect(() => parseQuestionInput({ type: 'CATEGORIZE', prompt, interaction: { kind: 'categorize', partialCredit: true, categories: [
      { id: 'food', name: 'Food', items: [{ id: 'veg', text: '' }] }, { id: 'build', name: 'Construction', items: [{ id: 'brick', text: 'Brick' }] },
    ] } })).toThrow('at least one answer');
  });

  it('stores the per-student reorder reshuffle setting and defaults older questions to enabled', () => {
    const interaction = { kind: 'reorder', items: ['First', 'Second', 'Third'] };
    expect(parseQuestionInput({ type: 'REORDER', prompt, interaction }))
      .toMatchObject({ interaction: { kind: 'reorder', shufflePerStudent: true } });
    expect(parseQuestionInput({ type: 'REORDER', prompt, interaction: { ...interaction, shufflePerStudent: false } }))
      .toMatchObject({ interaction: { kind: 'reorder', shufflePerStudent: false } });
  });

  it('accepts structured Math Response rubrics whose section marks match the question total', () => {
    const interaction={kind:'math_response',calculator:true,handwriting:true,parts:[
      {id:'formula',label:'Formula',enabled:true,marks:1,scheme:'Use F = ma.'},
      {id:'method',label:'Method calculation',enabled:true,marks:2,scheme:'Substitute the values and show units.'},
      {id:'answer',label:'Final answer',enabled:true,marks:1,scheme:'10 N, accept 9.9–10.1 N.'},
    ]};
    expect(parseQuestionInput({type:'MATH_RESPONSE',prompt,points:4,interaction})).toMatchObject({type:'MATH_RESPONSE',points:4,acceptedAnswers:[],interaction:{kind:'math_response',handwriting:true}});
    expect(()=>parseQuestionInput({type:'MATH_RESPONSE',prompt,points:5,interaction})).toThrow('total marks');
  });

  it('accepts a Math Response rubric supplied as a reference image', () => {
    const interaction={kind:'math_response',calculator:false,handwriting:true,parts:[
      {id:'formula',label:'Formula',enabled:true,marks:1,scheme:'',schemeDocument:{type:'doc',content:[{type:'image',attrs:{src:'/api/v1/media/tenants%2Fteacher%2Fformula.png',alt:'formula scheme'}}]}},
      {id:'method',label:'Method calculation',enabled:false,marks:2,scheme:''},
      {id:'answer',label:'Final answer',enabled:false,marks:1,scheme:''},
    ]};
    const parsed=parseQuestionInput({type:'MATH_RESPONSE',prompt,points:1,interaction});
    expect(parsed.interaction?.kind).toBe('math_response');
    expect(parsed.interaction?.kind==='math_response'&&parsed.interaction.parts?.[0]?.schemeDocument).toMatchObject({type:'doc'});
  });
});
