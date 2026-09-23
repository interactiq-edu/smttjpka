import type { CreateQuestionInput, QuestionInteraction, QuestionOption, QuestionType, RichTextDocument } from '@interactiq/contracts';
import { AuthError } from '../auth/service';

const questionTypes = new Set<QuestionType>([
  'MULTIPLE_CHOICE', 'MULTI_SELECT', 'TRUE_FALSE', 'FILL_IN_THE_BLANKS', 'OPEN_ENDED', 'PASSAGE',
  'DRAG_AND_DROP', 'CATEGORIZE', 'MATCH', 'MATCH_TABLE_GRID', 'DROPDOWN', 'REORDER', 'MATH_RESPONSE', 'LABELLING', 'HOTSPOT',
]);

const optionTypes = new Set<QuestionType>(['MULTIPLE_CHOICE', 'MULTI_SELECT', 'DROPDOWN']);
const keyedTextTypes = new Set<QuestionType>();
const interactiveTypes = new Set<QuestionType>(['FILL_IN_THE_BLANKS', 'DRAG_AND_DROP', 'CATEGORIZE', 'MATCH', 'MATCH_TABLE_GRID', 'REORDER', 'MATH_RESPONSE', 'LABELLING', 'HOTSPOT']);

const requireDocument = (value: unknown): RichTextDocument => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'VALIDATION_ERROR', 'A structured question prompt is required.');
  const document = value as Record<string, unknown>;
  if (document.type !== 'doc' || !Array.isArray(document.content) || document.content.length > 1000 || JSON.stringify(document).length > 750_000) {
    throw new AuthError(400, 'VALIDATION_ERROR', 'The question prompt is invalid.');
  }
  return document as unknown as RichTextDocument;
};

const parseOptions = (value: unknown, type: QuestionType): QuestionOption[] => {
  if (type === 'TRUE_FALSE') return [{ id: 'true', text: 'True', isCorrect: false }, { id: 'false', text: 'False', isCorrect: false }];
  if (type === 'FILL_IN_THE_BLANKS' || type === 'OPEN_ENDED' || type === 'PASSAGE' || interactiveTypes.has(type) || keyedTextTypes.has(type)) return [];
  if (!Array.isArray(value) || value.length < 2 || value.length > 12) throw new AuthError(400, 'VALIDATION_ERROR', 'This question type needs between 2 and 12 answer options.');
  const options = value.map((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) throw new AuthError(400, 'VALIDATION_ERROR', 'Each option is invalid.');
    const candidate = option as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(candidate.id) || typeof candidate.text !== 'string' || !candidate.text.trim() || candidate.text.length > 2000 || typeof candidate.isCorrect !== 'boolean') {
      throw new AuthError(400, 'VALIDATION_ERROR', 'Each option needs a valid id, text, and correctness value.');
    }
    return { id: candidate.id, text: candidate.text.trim(), isCorrect: candidate.isCorrect };
  });
  if (new Set(options.map((option) => option.id)).size !== options.length) throw new AuthError(400, 'VALIDATION_ERROR', 'Option identifiers must be unique.');
  const correct = options.filter((option) => option.isCorrect).length;
  if (type === 'MULTIPLE_CHOICE' && correct !== 1) throw new AuthError(400, 'VALIDATION_ERROR', 'Set the correct answer before saving.');
  if (type === 'DROPDOWN' && correct !== 1) throw new AuthError(400, 'VALIDATION_ERROR', 'Set one correct answer before saving.');
  if (type === 'MULTI_SELECT' && correct < 1) throw new AuthError(400, 'VALIDATION_ERROR', 'Set at least one correct answer before saving.');
  return options;
};

const parseAnswers = (value: unknown, type: QuestionType): string[] => {
  if (type === 'MATCH' || type === 'MATCH_TABLE_GRID') {
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return [];
    if (!Array.isArray(value) || value.length > 20 || value.some((answer) => typeof answer !== 'string' || !answer.trim() || answer.length > 500)) throw new AuthError(400,'VALIDATION_ERROR','Add valid matching answers.');
    return [[...new Set(value.map((answer)=>(answer as string).trim().toLocaleLowerCase()))].join('\n')];
  }
  if (type === 'PASSAGE' || optionTypes.has(type) || (interactiveTypes.has(type) && type !== 'MATH_RESPONSE') || type === 'TRUE_FALSE') return [];
  if (type === 'OPEN_ENDED') {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 50 || value.some((answer) => typeof answer !== 'string' || !answer.trim() || answer.length > 1000)) {
      throw new AuthError(400, 'VALIDATION_ERROR', 'Add up to 50 clear key ideas for AI marking.');
    }
    return [...new Set(value.map((answer) => (answer as string).trim()))];
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 20 || value.some((answer) => typeof answer !== 'string' || !answer.trim() || answer.length > 500)) {
    throw new AuthError(400, 'VALIDATION_ERROR', 'Add at least one accepted answer for each blank.');
  }
  const answers = [...new Set(value.map((answer) => (answer as string).trim().toLocaleLowerCase()))];
  return keyedTextTypes.has(type) ? [answers.join('\n')] : answers;
};

const parseInteraction = (value: unknown, type: QuestionType): QuestionInteraction | null => {
  if (!interactiveTypes.has(type)) return null;
  if ((type === 'MATCH' || type === 'MATCH_TABLE_GRID') && (value === undefined || value === null)) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 150_000) throw new AuthError(400, 'VALIDATION_ERROR', type === 'FILL_IN_THE_BLANKS' ? 'Add at least one accepted answer for the blank.' : 'Complete the interactive question setup before saving.');
  const interaction = value as Record<string, unknown>;
  const expected: Partial<Record<QuestionType, QuestionInteraction['kind']>> = {
    FILL_IN_THE_BLANKS: 'fill_blank', DRAG_AND_DROP: 'drag_drop', CATEGORIZE: 'categorize', MATCH: 'match', MATCH_TABLE_GRID: 'match_table_grid', REORDER: 'reorder', MATH_RESPONSE: 'math_response', LABELLING: 'labelling', HOTSPOT: 'hotspot',
  };
  if (interaction.kind !== expected[type]) throw new AuthError(400, 'VALIDATION_ERROR', 'The interactive setup does not match the selected question type.');
  if ((type === 'FILL_IN_THE_BLANKS' || type === 'DRAG_AND_DROP') && (typeof interaction.template !== 'string' || !interaction.template.trim() || !Array.isArray(interaction.blanks) || interaction.blanks.length < 1)) throw new AuthError(400, 'VALIDATION_ERROR', 'Add a sentence and at least one blank.');
  if (type === 'REORDER' && (!Array.isArray(interaction.items) || interaction.items.length < 2 || interaction.items.length > 20 || interaction.items.some((item) => typeof item !== 'string' || !item.trim()))) throw new AuthError(400, 'VALIDATION_ERROR', 'Reorder needs between 2 and 20 complete items.');
  if (type === 'CATEGORIZE') {
    const categories = interaction.categories;
    if (!Array.isArray(categories) || categories.length < 2 || categories.length > 8 || categories.some((category) => {
      if (!category || typeof category !== 'object') return true;
      const item = category as Record<string, unknown>;
      return typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name.trim() || !Array.isArray(item.items) || item.items.length < 1 || item.items.length > 20 || item.items.some((answer) => !answer || typeof answer !== 'object' || typeof (answer as Record<string, unknown>).id !== 'string' || typeof (answer as Record<string, unknown>).text !== 'string' || !(answer as Record<string, unknown>).text?.toString().trim());
    })) throw new AuthError(400, 'VALIDATION_ERROR', 'Categorize needs 2 to 8 named categories with at least one answer in each category.');
  }
  if (type === 'MATCH') {
    const pairs = interaction.pairs;
    if (!Array.isArray(pairs) || pairs.length < 2 || pairs.length > 12 || pairs.some((pair) => !pair || typeof pair !== 'object' || typeof (pair as Record<string,unknown>).id !== 'string' || typeof (pair as Record<string,unknown>).prompt !== 'string' || !(pair as Record<string,unknown>).prompt || typeof (pair as Record<string,unknown>).response !== 'string' || !(pair as Record<string,unknown>).response)) throw new AuthError(400, 'VALIDATION_ERROR', 'Match needs between 2 and 12 complete pairs.');
  }
  if (type === 'MATCH_TABLE_GRID') {
    const rows=interaction.rows, columns=interaction.columns, correctCells=interaction.correctCells;
    if (!Array.isArray(rows)||!Array.isArray(columns)||!Array.isArray(correctCells)||rows.length<2||columns.length<2||rows.length>12||columns.length>12||correctCells.length<1) throw new AuthError(400,'VALIDATION_ERROR','Match Table Grid needs at least two rows, two columns, and one correct cell.');
  }
  if (type === 'LABELLING' || type === 'HOTSPOT') {
    const targets = type === 'LABELLING' ? interaction.labels : interaction.regions;
    if (typeof interaction.imageUrl !== 'string' || !interaction.imageUrl || !Array.isArray(targets) || targets.length < 1) throw new AuthError(400, 'VALIDATION_ERROR', 'Upload an image and add at least one target.');
  }
  return value as QuestionInteraction;
};

export const parseQuestionInput = (value: unknown): CreateQuestionInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'VALIDATION_ERROR', 'A JSON object is required.');
  const body = value as Record<string, unknown>;
  if (typeof body.type !== 'string' || !questionTypes.has(body.type as QuestionType)) throw new AuthError(400, 'VALIDATION_ERROR', 'A valid question type is required.');
  const type = body.type as QuestionType;
  const points = body.points === undefined ? 1 : body.points;
  if (typeof points !== 'number' || !Number.isFinite(points) || points < 0 || points > 1000) throw new AuthError(400, 'VALIDATION_ERROR', 'Points must be a number between 0 and 1000.');
  const timeLimitSeconds = body.timeLimitSeconds === undefined || body.timeLimitSeconds === null ? null : body.timeLimitSeconds;
  if (timeLimitSeconds !== null && (typeof timeLimitSeconds !== 'number' || !Number.isInteger(timeLimitSeconds) || timeLimitSeconds < 5 || timeLimitSeconds > 5400)) {
    throw new AuthError(400, 'VALIDATION_ERROR', 'The time limit must be between 5 seconds and 90 minutes, or left unset.');
  }
  const options = parseOptions(body.options, type);
  if (type === 'TRUE_FALSE') {
    const answer = body.correctAnswer;
    if (answer !== 'true' && answer !== 'false') throw new AuthError(400, 'VALIDATION_ERROR', 'Select True or False as the correct answer.');
    options.find((option) => option.id === answer)!.isCorrect = true;
  }
  return { type, prompt: requireDocument(body.prompt), options, acceptedAnswers: parseAnswers(body.acceptedAnswers, type), interaction: parseInteraction(body.interaction, type), points, timeLimitSeconds };
};
