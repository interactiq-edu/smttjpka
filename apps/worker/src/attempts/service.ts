import type { AttemptAnswerInput, AttemptResult, AttemptReview, LearningQuestion, LiveWhiteboardStroke, QuestionCheckResult, ResourceReport } from '@interactiq/contracts';
import { AuthError } from '../auth/service';
import { QuestionRepository } from '../questions/repository';
import { normalizeClassName, ResourceRepository } from '../resources/repository';
import type { D1Database } from '../db/types';

interface AttemptRow extends AttemptResult { tenantId: string; userId: string; }
interface AiBinding { run(model: string, input: Record<string, unknown>): Promise<unknown>; }

const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const promptText = (question: LearningQuestion): string => {
  const walk = (nodes: LearningQuestion['prompt']['content']): string => nodes.map((node) => `${node.text ?? ''}${node.content ? walk(node.content) : ''}`).join(' ');
  return walk(question.prompt.content).replace(/\s+/g, ' ').trim();
};

export const displayAnswer = (value: string | string[], question: LearningQuestion): string | string[] => {
  if (question.interaction?.kind === 'categorize') {
    const categories = question.interaction.categories;
    const rendered = (Array.isArray(value) ? value : [value]).map((entry) => { const [itemId,categoryId]=entry.split(':'); const category=categories.find((candidate)=>candidate.id===categoryId); const item=categories.flatMap((candidate)=>candidate.items).find((candidate)=>candidate.id===itemId); return `${item?.text ?? itemId} → ${category?.name ?? categoryId}`; });
    return rendered;
  }
  if (question.interaction?.kind === 'match') {
    const pairs = question.interaction.pairs;
    return (Array.isArray(value) ? value : [value]).map((entry) => { const [promptId,responseId]=entry.split(':'); const prompt=pairs.find((pair)=>pair.id===promptId); const response=pairs.find((pair)=>pair.id===responseId); return `${prompt?.prompt ?? 'Unknown prompt'} → ${response?.response ?? 'Unknown answer'}`; });
  }
  if (question.interaction?.kind === 'match_table_grid') {
    const grid = question.interaction;
    return (Array.isArray(value) ? value : [value]).map((entry) => { const [rowId,columnId]=entry.split(':'); return `${grid.rows.find((row)=>row.id===rowId)?.text ?? 'Unknown row'} → ${grid.columns.find((column)=>column.id===columnId)?.text ?? 'Unknown column'}`; });
  }
  if (question.interaction?.kind === 'labelling') {
    const labels = question.interaction.labels;
    return (Array.isArray(value) ? value : [value]).map((entry) => { const [labelId='',targetId='']=entry.split(':'); const label=labels.find((candidate)=>candidate.id===labelId); const target=labels.find((candidate)=>candidate.id===targetId); return `${label?.text ?? (labelId.startsWith('wrong-') ? 'Incorrect label' : 'Unknown label')} → ${target?.text ?? 'Unknown target'}`; });
  }
  if (question.interaction?.kind === 'hotspot') {
    const rendered = (Array.isArray(value) ? value[0] : value) ?? '';
    try { const point=JSON.parse(rendered) as {x?:number;y?:number}; if(typeof point.x==='number'&&typeof point.y==='number') return `Selected point: ${Math.round(point.x*100)}% across, ${Math.round(point.y*100)}% down`; } catch {}
    return 'Image area selected';
  }
  const map = new Map(question.options.map((option) => [option.id, option.text]));
  const convert = (item: string) => map.get(item) ?? item;
  return Array.isArray(value) ? value.map(convert) : convert(value);
};

const correctAnswer = (question: LearningQuestion): string | string[] | null => {
  const options = question.options.filter((option) => option.isCorrect).map((option) => option.text);
  if (options.length) return options.length === 1 ? options[0]! : options;
  if (question.interaction?.kind === 'fill_blank') return question.interaction.blanks.map((blank) => blank.answers.join(' / '));
  if (question.interaction?.kind === 'drag_drop') return question.interaction.blanks.map((blank) => blank.answer);
  if (question.interaction?.kind === 'reorder') return question.interaction.items;
  if (question.interaction?.kind === 'categorize') return question.interaction.categories.flatMap((category) => category.items.map((item) => `${item.text} → ${category.name}`));
  if (question.interaction?.kind === 'match') return question.interaction.pairs.map((pair) => `${pair.prompt} → ${pair.response}`);
  if (question.interaction?.kind === 'match_table_grid') { const grid=question.interaction; return grid.correctCells.map((cell) => { const [rowId,columnId]=cell.split(':'); return `${grid.rows.find((row)=>row.id===rowId)?.text ?? rowId} → ${grid.columns.find((column)=>column.id===columnId)?.text ?? columnId}`; }); }
  if (question.type !== 'OPEN_ENDED' && question.acceptedAnswers.length) return question.acceptedAnswers;
  return null;
};

const parseSubmission = (value: unknown): { answers: AttemptAnswerInput[]; fullName: string; className: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'VALIDATION_ERROR', 'A submission object is required.');
  const body = value as Record<string, unknown>;
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const className = typeof body.className === 'string' ? body.className.trim() : '';
  if (fullName.length < 2 || fullName.length > 120) throw new AuthError(400, 'VALIDATION_ERROR', 'Enter your full name.');
  if (!className || className.length > 80) throw new AuthError(400, 'VALIDATION_ERROR', 'Enter your class.');
  if (!Array.isArray(body.answers) || body.answers.length > 500) throw new AuthError(400, 'VALIDATION_ERROR', 'An answers array is required.');
  const answers = body.answers.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new AuthError(400, 'VALIDATION_ERROR', 'An answer is invalid.');
    const answer = entry as Record<string, unknown>;
    if (!isUuid(answer.questionId) || !(typeof answer.value === 'string' || (Array.isArray(answer.value) && answer.value.every((item) => typeof item === 'string')))) throw new AuthError(400, 'VALIDATION_ERROR', 'An answer is invalid.');
    return { questionId: answer.questionId, value: answer.value } as AttemptAnswerInput;
  });
  if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length) throw new AuthError(400, 'VALIDATION_ERROR', 'Each question can have only one answer.');
  return { answers, fullName, className };
};

const parseIdentity = (value: unknown): { fullName: string; className: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'VALIDATION_ERROR', 'Student details are required.');
  const body = value as Record<string, unknown>; const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const className = typeof body.className === 'string' ? body.className.trim() : '';
  if (fullName.length < 2 || fullName.length > 120) throw new AuthError(400, 'VALIDATION_ERROR', 'Enter your full name.');
  if (!className || className.length > 80) throw new AuthError(400, 'VALIDATION_ERROR', 'Enter your class.');
  return { fullName, className };
};

export const gradeAnswer = (question: LearningQuestion, value: string | string[]): { correct: boolean | null; points: number } => {
  if (question.type === 'OPEN_ENDED' || question.type === 'PASSAGE') return { correct: null, points: 0 };
  const interaction = question.interaction;
  const clean = (item: string, accents = false) => {
    const normalized = item.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    return accents ? normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : normalized;
  };
  if (interaction?.kind === 'fill_blank') {
    const submitted = Array.isArray(value) ? value : [value];
    const hits = interaction.blanks.filter((blank, index) => blank.answers.some((answer) => clean(answer, interaction.ignoreAccents) === clean(submitted[index] ?? '', interaction.ignoreAccents))).length;
    return { correct: hits === interaction.blanks.length, points: question.points * hits / interaction.blanks.length };
  }
  if (interaction?.kind === 'drag_drop') {
    const submitted = Array.isArray(value) ? value : [value];
    const hits = interaction.blanks.filter((blank, index) => clean(blank.answer) === clean(submitted[index] ?? '')).length;
    return { correct: hits === interaction.blanks.length, points: question.points * hits / interaction.blanks.length };
  }
  if (interaction?.kind === 'reorder') {
    const submitted = Array.isArray(value) ? value : [value];
    const correct = interaction.items.length === submitted.length && interaction.items.every((item, index) => clean(item) === clean(submitted[index] ?? ''));
    return { correct, points: correct ? question.points : 0 };
  }
  if (interaction?.kind === 'categorize') {
    const submitted = new Set(Array.isArray(value) ? value : [value]);
    const expected = interaction.categories.flatMap((category) => category.items.map((item) => `${item.id}:${category.id}`));
    const expectedSet = new Set(expected);
    const hits = [...submitted].filter((item) => expectedSet.has(item)).length;
    const wrong = [...submitted].filter((item) => !expectedSet.has(item)).length;
    const correct = hits === expected.length && wrong === 0;
    return { correct, points: correct || interaction.partialCredit ? question.points * hits / expected.length : 0 };
  }
  if (interaction?.kind === 'match') {
    const submitted=new Set(Array.isArray(value)?value:[value]); const hits=interaction.pairs.filter((pair)=>submitted.has(`${pair.id}:${pair.id}`)).length;
    const correct=hits===interaction.pairs.length; return {correct,points:correct||interaction.partialCredit?question.points*hits/interaction.pairs.length:0};
  }
  if (interaction?.kind === 'match_table_grid') {
    const submitted=new Set(Array.isArray(value)?value:[value]); const expected=new Set(interaction.correctCells); const hits=[...submitted].filter((cell)=>expected.has(cell)).length; const wrong=[...submitted].filter((cell)=>!expected.has(cell)).length; const correct=hits===expected.size&&wrong===0; const earned=Math.max(0,hits-wrong);
    return {correct,points:correct||interaction.partialCredit?question.points*earned/expected.size:0};
  }
  if (interaction?.kind === 'math_response') {
    const submitted = clean(Array.isArray(value) ? value.join('') : value).replace(/[×·]/g, '*').replace(/÷/g, '/');
    const correct = question.acceptedAnswers.some((answer) => clean(answer).replace(/[×·]/g, '*').replace(/÷/g, '/') === submitted);
    return { correct, points: correct ? question.points : 0 };
  }
  if (interaction?.kind === 'labelling') {
    const submitted = new Set(Array.isArray(value) ? value : [value]);
    const hits = interaction.labels.filter((label) => submitted.has(`${label.id}:${label.id}`)).length;
    return { correct: hits === interaction.labels.length, points: question.points * hits / interaction.labels.length };
  }
  if (interaction?.kind === 'hotspot') {
    try {
      const point = JSON.parse(Array.isArray(value) ? value[0] ?? '' : value) as { x: number; y: number };
      const inside = interaction.regions.some((region) => {
        const xs = region.points.map((p) => p.x); const ys = region.points.map((p) => p.y);
        return point.x >= Math.min(...xs) && point.x <= Math.max(...xs) && point.y >= Math.min(...ys) && point.y <= Math.max(...ys);
      });
      return { correct: inside, points: inside ? question.points : 0 };
    } catch { return { correct: false, points: 0 }; }
  }
  if (['FILL_IN_THE_BLANKS', 'TABLE_FILL_IN', 'DRAG_AND_DROP', 'CATEGORIZE', 'MATCH', 'MATCH_TABLE_GRID', 'REORDER'].includes(question.type)) {
    const normalized = (Array.isArray(value) ? value.join(' ') : value).trim().toLocaleLowerCase();
    const correct = question.acceptedAnswers.includes(normalized);
    return { correct, points: correct ? question.points : 0 };
  }
  const selected = new Set(Array.isArray(value) ? value : [value]);
  const expected = new Set(question.options.filter((option) => option.isCorrect).map((option) => option.id));
  const correct = selected.size === expected.size && [...selected].every((id) => expected.has(id));
  return { correct, points: correct ? question.points : 0 };
};

export class AttemptService {
  private readonly resources: ResourceRepository;
  private readonly questions: QuestionRepository;
  constructor(private readonly db: D1Database, private readonly ai?: AiBinding) {
    this.resources = new ResourceRepository(db);
    this.questions = new QuestionRepository(db);
  }

  async start(tenantId: string, userId: string, resourceId: string): Promise<AttemptResult> {
    const resource = await this.resources.findById(tenantId, resourceId);
    if (!resource || resource.status !== 'PUBLISHED' || !['QUIZ', 'ASSESSMENT', 'PRESENTATION', 'INTERACTIVE_VIDEO'].includes(resource.type)) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested activity does not exist or is no longer published.');
    if (resource.accessStartsAt && Date.parse(resource.accessStartsAt) > Date.now()) throw new AuthError(403, 'FORBIDDEN', 'This activity has not opened yet. Keep this page open for the countdown.');
    const active = await this.db.prepare(`SELECT id, resource_id AS resourceId, status, score, max_score AS maxScore, submitted_at AS submittedAt,
      student_full_name AS studentFullName, student_class_name AS studentClassName FROM attempts
      WHERE tenant_id = ? AND resource_id = ? AND user_id = ? AND status = 'IN_PROGRESS' AND kicked_at IS NULL ORDER BY started_at DESC LIMIT 1`)
      .bind(tenantId, resourceId, userId).first<AttemptResult>();
    if (active) return active;
    if (resource.attemptPolicy === 'ONCE_PER_EMAIL') {
      const previous = await this.db.prepare(`SELECT id FROM attempts WHERE tenant_id = ? AND resource_id = ? AND user_id = ? AND status = 'COMPLETED' LIMIT 1`)
        .bind(tenantId, resourceId, userId).first<{ id: string }>();
      if (previous) throw new AuthError(409, 'VALIDATION_ERROR', 'Only one submission is allowed for each Google email.');
    }
    const id = crypto.randomUUID();
    await this.db.prepare('INSERT INTO attempts (id, tenant_id, resource_id, user_id) VALUES (?, ?, ?, ?)').bind(id, tenantId, resourceId, userId).run();
    return { id, resourceId, status: 'IN_PROGRESS', score: null, maxScore: null, submittedAt: null };
  }

  async setIdentity(tenantId: string, userId: string, attemptId: string, body: unknown): Promise<AttemptResult> {
    const identity = parseIdentity(body);
    const attempt = await this.db.prepare(`SELECT a.id, a.resource_id AS resourceId, a.status, a.score, a.max_score AS maxScore,
      a.submitted_at AS submittedAt, r.assigned_class_name AS assignedClassName FROM attempts a JOIN learning_resources r ON r.id = a.resource_id
      WHERE a.id = ? AND a.tenant_id = ? AND a.user_id = ? AND a.kicked_at IS NULL LIMIT 1`).bind(attemptId, tenantId, userId)
      .first<AttemptResult & { assignedClassName: string | null }>();
    if (!attempt || attempt.status !== 'IN_PROGRESS') throw new AuthError(404, 'VALIDATION_ERROR', 'The active student session does not exist.');
    const className = attempt.assignedClassName?.trim() || normalizeClassName(identity.className);
    await this.db.prepare(`UPDATE attempts SET student_full_name = ?, student_class_name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ? AND user_id = ?`).bind(identity.fullName, className, attemptId, tenantId, userId).run();
    return { ...attempt, studentFullName: identity.fullName, studentClassName: className };
  }

  async updateLiveDrawing(tenantId: string, userId: string, attemptId: string, body: unknown): Promise<LiveWhiteboardStroke[]> {
    const attempt = await this.db.prepare(`SELECT id, resource_id AS resourceId FROM attempts WHERE id = ? AND tenant_id = ? AND user_id = ? AND status = 'IN_PROGRESS' AND kicked_at IS NULL LIMIT 1`)
      .bind(attemptId, tenantId, userId).first<{ id: string; resourceId: string }>();
    if (!attempt) throw new AuthError(404, 'VALIDATION_ERROR', 'The active student session does not exist.');
    const permission=await this.db.prepare('SELECT attempt_id AS attemptId FROM live_drawing_permissions WHERE tenant_id=? AND resource_id=? AND attempt_id=? LIMIT 1')
      .bind(tenantId,attempt.resourceId,attempt.id).first<{attemptId:string}>();
    if (!permission) throw new AuthError(403, 'FORBIDDEN', 'Drawing is not enabled for this participant.');
    const state = await this.resources.getLiveState(tenantId, attempt.resourceId);
    const submitted = body && typeof body === 'object' && !Array.isArray(body) && Array.isArray((body as Record<string, unknown>).whiteboard)
      ? (body as Record<string, unknown>).whiteboard as LiveWhiteboardStroke[] : [];
    const owned = submitted.filter((stroke) => stroke.ownerType === 'STUDENT' && stroke.ownerId === attempt.id)
      .map((stroke) => ({ ...stroke, id: stroke.id || crypto.randomUUID(), ownerType: 'STUDENT' as const, ownerId: attempt.id }));
    const protectedStrokes = state.whiteboard.filter((stroke) => !(stroke.ownerType === 'STUDENT' && stroke.ownerId === attempt.id));
    const whiteboard = [...protectedStrokes, ...owned];
    const points = whiteboard.reduce((sum, stroke) => sum + (Array.isArray(stroke?.points) ? stroke.points.length : 0), 0);
    if (whiteboard.length > 500 || points > 20_000) throw new AuthError(400, 'VALIDATION_ERROR', 'The drawing is too large.');
    const updated = await this.resources.updateLiveState(tenantId, attempt.resourceId, { ...state, whiteboard });
    return updated.whiteboard;
  }

  async submit(tenantId: string, userId: string, attemptId: string, body: unknown): Promise<AttemptResult> {
    const attempt = await this.db.prepare(`SELECT id, resource_id AS resourceId, status, score, max_score AS maxScore, submitted_at AS submittedAt,
      tenant_id AS tenantId, user_id AS userId FROM attempts WHERE id = ? AND tenant_id = ? AND user_id = ? AND kicked_at IS NULL LIMIT 1`)
      .bind(attemptId, tenantId, userId).first<AttemptRow>();
    if (!attempt) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested attempt does not exist.');
    if (attempt.status !== 'IN_PROGRESS') throw new AuthError(409, 'VALIDATION_ERROR', 'This attempt has already been submitted.');
    const resource = await this.resources.findById(tenantId, attempt.resourceId);
    if (resource?.attemptPolicy === 'ONCE_PER_EMAIL') {
      const previous = await this.db.prepare(`SELECT id FROM attempts WHERE tenant_id = ? AND resource_id = ? AND user_id = ? AND status = 'COMPLETED' AND id <> ? LIMIT 1`)
        .bind(tenantId, attempt.resourceId, userId, attemptId).first<{ id: string }>();
      if (previous) throw new AuthError(409, 'VALIDATION_ERROR', 'Only one submission is allowed for each Google email.');
    }
    const submission = parseSubmission(body);
    submission.className = resource?.assignedClassName?.trim() || normalizeClassName(submission.className);
    const questions = await this.questions.list(tenantId, attempt.resourceId);
    const questionMap = new Map(questions.map((question) => [question.id, question]));
    if (submission.answers.some((answer) => !questionMap.has(answer.questionId))) throw new AuthError(400, 'VALIDATION_ERROR', 'An answer does not belong to this quiz.');
    const graded = await Promise.all(submission.answers.map(async (answer) => {
      const question = questionMap.get(answer.questionId)!;
      const normal = gradeAnswer(question, answer.value);
      const ai = question.type === 'OPEN_ENDED' ? await this.aiGrade(question, answer.value) : null;
      return { answer, result: ai ? { correct: null, points: ai.points } : normal, ai };
    }));
    const score = graded.reduce((total, item) => total + item.result.points, 0);
    const maxScore = questions.reduce((total, question) => total + question.points, 0);
    const statements = graded.map((item) => this.db.prepare(`INSERT INTO attempt_answers
      (attempt_id, question_id, answer_json, is_correct, awarded_points, ai_suggested_points, ai_feedback) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(attemptId, item.answer.questionId, JSON.stringify(item.answer.value), item.result.correct === null ? null : Number(item.result.correct),
        item.result.points, item.ai?.points ?? null, item.ai?.feedback ?? null));
    statements.push(this.db.prepare(`UPDATE attempts SET status = 'COMPLETED', score = ?, max_score = ?, student_full_name = ?, student_class_name = ?,
      submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ? AND user_id = ? AND status = 'IN_PROGRESS'`)
      .bind(score, maxScore, submission.fullName, submission.className, attemptId, tenantId, userId));
    await this.db.batch(statements);
    const release=resource?.resultReleasePolicy ?? 'DETAILED_AFTER_SUBMISSION';
    return { id: attemptId, resourceId: attempt.resourceId, status: 'COMPLETED', score: release==='TEACHER_REVIEW'?null:score, maxScore: release==='TEACHER_REVIEW'?null:maxScore, submittedAt: new Date().toISOString(),
      studentFullName: submission.fullName, studentClassName: submission.className,
      ...(release==='DETAILED_AFTER_SUBMISSION'||release==='IMMEDIATE_PER_QUESTION'?{answerResults:graded.map(({answer,result})=>({questionId:answer.questionId,correct:result.correct,points:result.points,maxPoints:questionMap.get(answer.questionId)!.points,correctAnswer:correctAnswer(questionMap.get(answer.questionId)!)}))}:{}) };
  }

  async checkAnswer(tenantId:string,userId:string,attemptId:string,body:unknown):Promise<QuestionCheckResult> {
    const attempt=await this.db.prepare(`SELECT a.resource_id AS resourceId, a.status, r.result_release_policy AS resultReleasePolicy FROM attempts a JOIN learning_resources r ON r.id=a.resource_id WHERE a.id=? AND a.tenant_id=? AND a.user_id=? AND a.kicked_at IS NULL LIMIT 1`).bind(attemptId,tenantId,userId).first<{resourceId:string;status:string;resultReleasePolicy:string}>();
    if(!attempt||attempt.status!=='IN_PROGRESS')throw new AuthError(404,'VALIDATION_ERROR','The active attempt does not exist.');
    if(attempt.resultReleasePolicy!=='IMMEDIATE_PER_QUESTION')throw new AuthError(403,'FORBIDDEN','Immediate answer checking is not enabled.');
    const input=body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{}; if(!isUuid(input.questionId)||!(typeof input.value==='string'||(Array.isArray(input.value)&&input.value.every((item)=>typeof item==='string'))))throw new AuthError(400,'VALIDATION_ERROR','A valid answer is required.');
    const question=(await this.questions.list(tenantId,attempt.resourceId)).find((item)=>item.id===input.questionId); if(!question)throw new AuthError(404,'VALIDATION_ERROR','The question does not exist.');
    if(question.type==='OPEN_ENDED')return {questionId:question.id,correct:null,points:0,maxPoints:question.points};
    const result=gradeAnswer(question,input.value as string|string[]); return {questionId:question.id,correct:result.correct,points:result.points,maxPoints:question.points,correctAnswer:correctAnswer(question)};
  }

  async reports(tenantId: string): Promise<ResourceReport[]> {
    const resources = (await this.resources.list(tenantId)).filter((resource) => ['QUIZ', 'ASSESSMENT', 'PRESENTATION', 'INTERACTIVE_VIDEO'].includes(resource.type));
    return Promise.all(resources.map(async (resource) => {
      const result = await this.db.prepare(`SELECT a.id, a.score, a.max_score AS maxScore, a.submitted_at AS submittedAt,
        a.student_full_name AS studentFullName, a.student_class_name AS studentClassName, u.email AS studentEmail,
        a.submission_file_url AS submissionFileUrl, a.submission_file_name AS submissionFileName,
        a.submission_mime_type AS submissionMimeType, a.submission_file_size AS submissionFileSize, a.submission_notes AS submissionNotes,
        a.assignment_review_status AS assignmentReviewStatus, a.assignment_mark AS assignmentMark, a.assignment_feedback AS assignmentFeedback,
        a.final_reviewed_at AS finalReviewedAt, (CASE WHEN a.submission_file_url IS NOT NULL THEN a.assignment_review_status <> 'REVIEWED' ELSE a.final_reviewed_at IS NULL END) AS pendingReview,
        EXISTS (SELECT 1 FROM attempts other WHERE other.tenant_id = a.tenant_id AND other.status = 'COMPLETED'
          AND other.user_id <> a.user_id AND LOWER(TRIM(other.student_full_name)) = LOWER(TRIM(a.student_full_name))) AS duplicateNameWarning
        FROM attempts a JOIN users u ON u.id = a.user_id WHERE a.tenant_id = ? AND a.resource_id = ? AND a.status = 'COMPLETED'
        ORDER BY a.submitted_at DESC LIMIT 200`).bind(tenantId, resource.id).all<Record<string, unknown>>();
      const attempts = result.results.map((row) => ({ id: String(row.id), resourceId: resource.id, status: 'COMPLETED' as const,
        score: Number(row.score ?? 0), maxScore: Number(row.maxScore ?? 0), submittedAt: String(row.submittedAt),
        studentFullName: row.studentFullName ? String(row.studentFullName) : null, studentClassName: row.studentClassName ? String(row.studentClassName) : null,
        studentEmail: row.studentEmail ? String(row.studentEmail) : null,
        submissionFileUrl: row.submissionFileUrl ? String(row.submissionFileUrl) : null, submissionFileName: row.submissionFileName ? String(row.submissionFileName) : null,
        submissionMimeType: row.submissionMimeType ? String(row.submissionMimeType) : null, submissionFileSize: row.submissionFileSize === null ? null : Number(row.submissionFileSize), submissionNotes: row.submissionNotes ? String(row.submissionNotes) : null,
        assignmentReviewStatus: resource.type === 'ASSESSMENT' && row.assignmentReviewStatus ? String(row.assignmentReviewStatus) as AttemptReview['assignmentReviewStatus'] : null,
        assignmentMark: resource.type === 'ASSESSMENT' && row.assignmentMark !== null ? Number(row.assignmentMark) : null, assignmentFeedback: resource.type === 'ASSESSMENT' && row.assignmentFeedback ? String(row.assignmentFeedback) : null,
        finalReviewedAt: row.finalReviewedAt ? String(row.finalReviewedAt) : null, duplicateNameWarning: Number(row.duplicateNameWarning) === 1 }));
      return { resource, submissionCount: attempts.length, pendingReviewCount: result.results.filter((row) => Number(row.pendingReview) === 1).length, attempts };
    }));
  }

  async review(tenantId: string, attemptId: string): Promise<AttemptReview> {
    const attempt = await this.db.prepare(`SELECT a.id, a.resource_id AS resourceId, a.status, a.score, a.max_score AS maxScore,
      a.submitted_at AS submittedAt, a.student_full_name AS studentFullName, a.student_class_name AS studentClassName,
      a.submission_file_url AS submissionFileUrl, a.submission_file_name AS submissionFileName,
      a.submission_mime_type AS submissionMimeType, a.submission_file_size AS submissionFileSize, a.submission_notes AS submissionNotes,
      a.assignment_review_status AS assignmentReviewStatus, a.assignment_mark AS assignmentMark, a.assignment_feedback AS assignmentFeedback,
      a.final_reviewed_at AS finalReviewedAt,
      EXISTS (SELECT 1 FROM attempts other WHERE other.tenant_id = a.tenant_id AND other.status = 'COMPLETED'
        AND other.user_id <> a.user_id AND LOWER(TRIM(other.student_full_name)) = LOWER(TRIM(a.student_full_name))) AS duplicateNameWarning,
      u.email AS studentEmail, u.display_name AS studentDisplayName FROM attempts a JOIN users u ON u.id = a.user_id
      WHERE a.id = ? AND a.tenant_id = ? AND a.status = 'COMPLETED' LIMIT 1`).bind(attemptId, tenantId).first<Omit<AttemptReview, 'answers'>>();
    if (!attempt) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested submission does not exist.');
    const rows = await this.db.prepare(`SELECT aa.question_id AS questionId, q.question_type AS questionType, q.prompt_json AS promptJson, q.configuration_json AS configurationJson,
      aa.answer_json AS answerJson, aa.is_correct AS isCorrect, aa.awarded_points AS awardedPoints, aa.ai_suggested_points AS aiSuggestedPoints,
      aa.ai_feedback AS aiFeedback, aa.teacher_points AS teacherPoints, aa.teacher_feedback AS teacherFeedback, q.points AS maxPoints
      FROM attempt_answers aa JOIN questions q ON q.id = aa.question_id WHERE aa.attempt_id = ?
      ORDER BY (SELECT position FROM quiz_questions WHERE question_id = q.id LIMIT 1)`).bind(attemptId).all<Record<string, unknown>>();
    return { ...attempt, duplicateNameWarning: Boolean(attempt.duplicateNameWarning), answers: rows.results.map((row) => { const config = JSON.parse(String(row.configurationJson)) as Pick<LearningQuestion, 'options' | 'acceptedAnswers' | 'interaction'>; const question = { id: String(row.questionId), type: row.questionType as LearningQuestion['type'], prompt: JSON.parse(String(row.promptJson)), options: config.options ?? [], acceptedAnswers: config.acceptedAnswers ?? [], interaction: config.interaction ?? null, points: Number(row.maxPoints), timeLimitSeconds: null, position: 0 } satisfies LearningQuestion; const rawAnswer = JSON.parse(String(row.answerJson)) as string | string[]; return ({ questionId: String(row.questionId), questionType: row.questionType as LearningQuestion['type'],
      prompt: question.prompt, rawAnswer, answer: displayAnswer(rawAnswer, question), correctAnswer: correctAnswer(question), interaction: question.interaction ?? null, isCorrect: row.isCorrect === null ? null : Number(row.isCorrect) === 1,
      awardedPoints: Number(row.awardedPoints ?? 0), aiSuggestedPoints: row.aiSuggestedPoints === null ? null : Number(row.aiSuggestedPoints),
      aiFeedback: row.aiFeedback ? String(row.aiFeedback) : null, teacherPoints: row.teacherPoints === null ? null : Number(row.teacherPoints),
      teacherFeedback: row.teacherFeedback ? String(row.teacherFeedback) : null, maxPoints: Number(row.maxPoints) }); }) };
  }

  async grade(tenantId: string, teacherId: string, attemptId: string, questionId: string, body: unknown): Promise<AttemptReview> {
    const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const points = typeof value.points === 'number' ? value.points : Number.NaN;
    const feedback = typeof value.feedback === 'string' ? value.feedback.trim().slice(0, 2000) : '';
    const max = await this.db.prepare(`SELECT q.points FROM questions q JOIN attempt_answers aa ON aa.question_id = q.id
      JOIN attempts a ON a.id = aa.attempt_id WHERE a.id = ? AND aa.question_id = ? AND a.tenant_id = ? LIMIT 1`)
      .bind(attemptId, questionId, tenantId).first<{ points: number }>();
    if (!max || !Number.isFinite(points) || points < 0 || points > max.points) throw new AuthError(400, 'VALIDATION_ERROR', 'Enter a valid mark for this answer.');
    await this.db.prepare(`UPDATE attempt_answers SET teacher_points = ?, teacher_feedback = ?, reviewed_at = CURRENT_TIMESTAMP,
      reviewed_by_user_id = ? WHERE attempt_id = ? AND question_id = ?`).bind(points, feedback || null, teacherId, attemptId, questionId).run();
    await this.db.prepare(`UPDATE attempts SET score = (SELECT COALESCE(SUM(COALESCE(teacher_points, awarded_points, 0)), 0)
      FROM attempt_answers WHERE attempt_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`).bind(attemptId, attemptId, tenantId).run();
    return this.review(tenantId, attemptId);
  }

  async finalizeReview(tenantId: string, teacherId: string, attemptId: string): Promise<AttemptReview> {
    const attempt = await this.db.prepare(`SELECT id FROM attempts WHERE id = ? AND tenant_id = ? AND status = 'COMPLETED' LIMIT 1`)
      .bind(attemptId, tenantId).first<{ id: string }>();
    if (!attempt) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested submission does not exist.');
    await this.db.prepare(`UPDATE attempt_answers SET
      teacher_points = COALESCE(teacher_points, ai_suggested_points, awarded_points, 0),
      teacher_feedback = COALESCE(teacher_feedback, ai_feedback),
      reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP),
      reviewed_by_user_id = COALESCE(reviewed_by_user_id, ?)
      WHERE attempt_id = ?`).bind(teacherId, attemptId).run();
    await this.db.prepare(`UPDATE attempts SET
      score = (SELECT COALESCE(SUM(COALESCE(teacher_points, awarded_points, 0)), 0) FROM attempt_answers WHERE attempt_id = ?),
      final_reviewed_at = CURRENT_TIMESTAMP, final_reviewed_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?`).bind(attemptId, teacherId, attemptId, tenantId).run();
    return this.review(tenantId, attemptId);
  }

  async updateAssignmentReview(tenantId: string, teacherId: string, attemptId: string, body: unknown): Promise<AttemptReview> {
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const status = input.status;
    if (status !== 'PENDING' && status !== 'NOT_REVIEWED' && status !== 'REVIEWED') throw new AuthError(400, 'VALIDATION_ERROR', 'Choose a valid assignment review status.');
    const row = await this.db.prepare(`SELECT a.id, r.assignment_max_score AS maxScore FROM attempts a
      JOIN learning_resources r ON r.id = a.resource_id WHERE a.id = ? AND a.tenant_id = ? AND a.status = 'COMPLETED'
      AND r.resource_type = 'ASSESSMENT' LIMIT 1`).bind(attemptId, tenantId).first<{id:string;maxScore:number}>();
    if (!row) throw new AuthError(404, 'VALIDATION_ERROR', 'The assignment submission does not exist.');
    const mark = input.mark === null || input.mark === undefined || input.mark === '' ? null : Number(input.mark);
    if (mark !== null && (!Number.isFinite(mark) || mark < 0 || mark > row.maxScore)) throw new AuthError(400, 'VALIDATION_ERROR', `Enter a mark between 0 and ${row.maxScore}.`);
    const feedback = typeof input.feedback === 'string' ? input.feedback.trim().slice(0, 4000) : '';
    await this.db.prepare(`UPDATE attempts SET assignment_review_status = ?, assignment_mark = ?, assignment_feedback = ?,
      score = ?, max_score = ?, final_reviewed_at = CASE WHEN ? = 'REVIEWED' THEN COALESCE(final_reviewed_at, CURRENT_TIMESTAMP) ELSE NULL END,
      final_reviewed_by_user_id = CASE WHEN ? = 'REVIEWED' THEN ? ELSE NULL END, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?`).bind(status, mark, feedback || null, mark, row.maxScore, status, status, teacherId, attemptId, tenantId).run();
    return this.review(tenantId, attemptId);
  }

  private async aiGrade(question: LearningQuestion, answer: string | string[]): Promise<{ points: number; feedback: string } | null> {
    if (!this.ai) return null;
    try {
      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct-fast', { messages: [
        { role: 'system', content: `You are a conservative education marking assistant. Judge meaning, not exact wording: award credit when a student's paraphrase clearly expresses an expected idea. Do not require a literal keyword match, and do not invent ideas absent from the response. Return JSON only with numeric points and short feedback. Points must be between 0 and ${question.points}. A teacher will review your suggestion.` },
        { role: 'user', content: `Question: ${promptText(question)}\nExpected key ideas (one idea per separator): ${question.acceptedAnswers.join(' | ') || 'Use sound educational judgment.'}\nStudent answer: ${Array.isArray(answer) ? answer.join(', ') : answer}` },
      ], response_format: { type: 'json_object' } });
      const output = (response as { response?: unknown }).response;
      const parsed = typeof output === 'object' && output !== null
        ? output as { points?: unknown; feedback?: unknown }
        : JSON.parse((String(output ?? '').match(/\{[\s\S]*\}/)?.[0] ?? '{}')) as { points?: unknown; feedback?: unknown };
      const points = Math.max(0, Math.min(question.points, Number(parsed.points)));
      return Number.isFinite(points) ? { points, feedback: typeof parsed.feedback === 'string' ? parsed.feedback.slice(0, 1000) : 'AI preliminary review.' } : null;
    } catch (error) {
      console.warn('AI preliminary marking failed', { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }
}
