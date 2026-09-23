import type { AttemptPolicy, CreateLearningResourceInput, Flashcard, LearningResourceDetail, LearningResourceSummary, LiveResourceState, LiveWhiteboardStroke, PublishedResource, QuizTheme, ResourceType, ResultReleasePolicy, RichTextDocument, RichTextMark, RichTextNode, TenantThemeSettings } from '@interactiq/contracts';
import { AuthError } from '../auth/service';
import { QuestionRepository } from '../questions/repository';
import { ResourceRepository } from './repository';

const resourceTypes = new Set<ResourceType>(['QUIZ', 'ASSESSMENT', 'FLASHCARD_SET', 'PRESENTATION', 'INTERACTIVE_VIDEO']);
const attemptPolicies = new Set<AttemptPolicy>(['ONCE_PER_EMAIL', 'MULTIPLE']);
const resultReleasePolicies = new Set<ResultReleasePolicy>(['DETAILED_AFTER_SUBMISSION', 'SCORE_ONLY', 'TEACHER_REVIEW', 'IMMEDIATE_PER_QUESTION']);
const nodeTypes = new Set(['paragraph', 'heading', 'text', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'hardBreak', 'codeBlock', 'image']);
const markTypes = new Set<RichTextMark['type']>(['bold', 'italic', 'underline', 'strike', 'link', 'highlight', 'textStyle']);

const parseCreateInput = (value: unknown): CreateLearningResourceInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'VALIDATION_ERROR', 'A JSON object is required.');
  const body = value as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 160) throw new AuthError(400, 'VALIDATION_ERROR', 'A title between 1 and 160 characters is required.');
  if (typeof body.type !== 'string' || !resourceTypes.has(body.type as ResourceType)) throw new AuthError(400, 'VALIDATION_ERROR', 'A valid resource type is required.');
  const description = body.description;
  if (description !== undefined && (typeof description !== 'string' || description.length > 2000)) {
    throw new AuthError(400, 'VALIDATION_ERROR', 'Description must be text with at most 2000 characters.');
  }
  const attemptPolicy = typeof body.attemptPolicy === 'string' && attemptPolicies.has(body.attemptPolicy as AttemptPolicy) ? body.attemptPolicy as AttemptPolicy : 'MULTIPLE';
  const assignedClassName = typeof body.assignedClassName === 'string' ? body.assignedClassName.trim().slice(0, 80) : '';
  return { title, type: body.type as ResourceType, attemptPolicy, ...(assignedClassName ? { assignedClassName } : {}), ...(typeof description === 'string' && description.trim() ? { description: description.trim() } : {}) };
};

const parseAccessSettings = (value: unknown): { attemptPolicy: AttemptPolicy; resultReleasePolicy: ResultReleasePolicy; accessStartsAt: string | null } => {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const attemptPolicy = typeof body.attemptPolicy === 'string' && attemptPolicies.has(body.attemptPolicy as AttemptPolicy) ? body.attemptPolicy as AttemptPolicy : 'MULTIPLE';
  const resultReleasePolicy = typeof body.resultReleasePolicy === 'string' && resultReleasePolicies.has(body.resultReleasePolicy as ResultReleasePolicy) ? body.resultReleasePolicy as ResultReleasePolicy : 'DETAILED_AFTER_SUBMISSION';
  const accessStartsAt = typeof body.accessStartsAt === 'string' && body.accessStartsAt.trim() ? body.accessStartsAt.trim() : null;
  if (accessStartsAt && Number.isNaN(Date.parse(accessStartsAt))) throw new AuthError(400, 'VALIDATION_ERROR', 'Enter a valid access date and time.');
  return { attemptPolicy, resultReleasePolicy, accessStartsAt: accessStartsAt ? new Date(accessStartsAt).toISOString() : null };
};

const isSafeHref = (value: string): boolean => /^https?:\/\//i.test(value);

const validateNode = (node: unknown, depth = 0): node is RichTextNode => {
  if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 12) return false;
  const value = node as Record<string, unknown>;
  if (typeof value.type !== 'string' || !nodeTypes.has(value.type)) return false;
  if (value.text !== undefined && (typeof value.text !== 'string' || value.text.length > 10000)) return false;
  if (value.type === 'image') {
    const src = (value.attrs as Record<string, unknown> | undefined)?.src;
    const alt = (value.attrs as Record<string, unknown> | undefined)?.alt;
    if (typeof src !== 'string' || (!/^https?:\/\//i.test(src) && !/^\/api\/v1\/media\/[a-z0-9/_-]+\.(png|jpe?g|webp|gif)$/i.test(src) && !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(src)) || src.length > 700_000 || (alt !== undefined && typeof alt !== 'string')) return false;
  }
  if (value.marks !== undefined) {
    if (!Array.isArray(value.marks) || value.marks.some((mark) => {
      if (!mark || typeof mark !== 'object' || Array.isArray(mark)) return true;
      const candidate = mark as Record<string, unknown>;
      if (typeof candidate.type !== 'string' || !markTypes.has(candidate.type as RichTextMark['type'])) return true;
      const attrs = candidate.attrs;
      if (attrs === undefined) return false;
      if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return true;
      if (candidate.type !== 'link') return false;
      const href = (attrs as Record<string, unknown>).href;
      return typeof href !== 'string' || !isSafeHref(href);
    })) return false;
  }
  return value.content === undefined || (Array.isArray(value.content) && value.content.every((child) => validateNode(child, depth + 1)));
};

const parseContent = (value: unknown): RichTextDocument => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'VALIDATION_ERROR', 'A structured rich text document is required.');
  const document = value as Record<string, unknown>;
  if (document.type !== 'doc' || !Array.isArray(document.content) || document.content.length > 1000 || !document.content.every((node) => validateNode(node))) {
    throw new AuthError(400, 'VALIDATION_ERROR', 'The rich text document contains unsupported content.');
  }
  if (JSON.stringify(document).length > 750_000) throw new AuthError(400, 'VALIDATION_ERROR', 'The rich text document is too large.');
  return document as unknown as RichTextDocument;
};

export class ResourceService {
  constructor(private readonly resources: ResourceRepository, private readonly questions?: QuestionRepository) {}

  list(tenantId: string): Promise<LearningResourceSummary[]> {
    return this.resources.list(tenantId);
  }

  async create(tenantId: string, userId: string, body: unknown): Promise<LearningResourceSummary> {
    const input = parseCreateInput(body);
    return this.resources.create({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      title: input.title,
      description: input.description ?? null,
      type: input.type,
      attemptPolicy: input.attemptPolicy ?? 'MULTIPLE',
      assignedClassName: input.assignedClassName ?? null,
    });
  }

  async updateContent(tenantId: string, resourceId: string, body: unknown): Promise<LearningResourceDetail> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AuthError(400, 'VALIDATION_ERROR', 'A JSON object is required.');
    const content = parseContent((body as Record<string, unknown>).content);
    const resource = await this.resources.updateContent(tenantId, resourceId, content);
    if (!resource) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested resource does not exist.');
    return resource;
  }

  async publish(tenantId: string, resourceId: string, body: unknown): Promise<PublishedResource> {
    const settings = parseAccessSettings(body);
    const shareCode = crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const resource = await this.resources.publish(tenantId, resourceId, shareCode, settings.attemptPolicy, settings.resultReleasePolicy, settings.accessStartsAt);
    if (!resource || !resource.shareCode) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested resource does not exist.');
    return { resource, shareCode: resource.shareCode };
  }

  async unpublish(tenantId: string, resourceId: string): Promise<LearningResourceSummary> {
    const resource = await this.resources.unpublish(tenantId, resourceId);
    if (!resource) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested resource does not exist.');
    return resource;
  }

  async kickParticipant(tenantId: string, resourceId: string, attemptId: string): Promise<void> {
    await this.requireLiveResource(tenantId, resourceId);
    if (!await this.resources.kickParticipant(tenantId, resourceId, attemptId)) throw new AuthError(404, 'VALIDATION_ERROR', 'This participant is no longer online.');
  }

  async deleteClassData(tenantId: string, body: unknown): Promise<{ deletedAttempts: number }> {
    const className = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).className : null;
    if (typeof className !== 'string' || !className.trim() || className.length > 80) throw new AuthError(400, 'VALIDATION_ERROR', 'Select a valid class.');
    return { deletedAttempts: await this.resources.deleteClassData(tenantId, className) };
  }

  async updateTheme(tenantId: string, resourceId: string, body: unknown): Promise<LearningResourceSummary> {
    const themeId = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).themeId : null;
    if (typeof themeId !== 'string' || !isQuizTheme(themeId)) throw new AuthError(400, 'VALIDATION_ERROR', 'Select a valid quiz theme.');
    const resource = await this.resources.updateTheme(tenantId, resourceId, themeId);
    if (!resource) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested resource does not exist.');
    return resource;
  }

  getThemeSettings(tenantId: string): Promise<TenantThemeSettings> { return this.resources.getThemeSettings(tenantId); }

  async updateThemeSettings(tenantId: string, body: unknown): Promise<TenantThemeSettings> {
    const theme = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).defaultTheme : null;
    if (typeof theme !== 'string' || !isQuizTheme(theme)) throw new AuthError(400, 'VALIDATION_ERROR', 'Select a valid default theme.');
    return this.resources.updateThemeSettings(tenantId, theme);
  }

  async updateDelivery(tenantId: string, resourceId: string, body: unknown): Promise<LearningResourceDetail> {
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const assetUrl = typeof input.assetUrl === 'string' && input.assetUrl.trim() ? input.assetUrl.trim() : null;
    const externalUrl = typeof input.externalUrl === 'string' && input.externalUrl.trim() ? input.externalUrl.trim() : null;
    if (assetUrl && !/^\/api\/v1\/media\//.test(assetUrl) && !/^https:\/\//i.test(assetUrl)) throw new AuthError(400, 'VALIDATION_ERROR', 'Invalid presentation file URL.');
    if (externalUrl && !/^https:\/\//i.test(externalUrl)) throw new AuthError(400, 'VALIDATION_ERROR', 'Enter a secure https video URL.');
    const resource = await this.resources.updateDelivery(tenantId, resourceId, assetUrl, externalUrl);
    if (!resource) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested resource does not exist.');
    return resource;
  }

  async updateAssignedClass(tenantId: string, resourceId: string, body: unknown): Promise<LearningResourceSummary> {
    const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).assignedClassName : null;
    if (raw !== null && raw !== undefined && typeof raw !== 'string') throw new AuthError(400, 'VALIDATION_ERROR', 'Class name must be text.');
    const assignedClassName = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 80) : null;
    const resource = await this.resources.updateAssignedClass(tenantId, resourceId, assignedClassName);
    if (!resource) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested resource does not exist.');
    return resource;
  }

  async updateAssignmentSettings(tenantId: string, resourceId: string, body: unknown): Promise<LearningResourceDetail> {
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const raw = input.submissionDueAt ?? null;
    if (raw !== null && typeof raw !== 'string') throw new AuthError(400, 'VALIDATION_ERROR', 'Due date must be a date or null.');
    const parsed = typeof raw === 'string' && raw.trim() ? Date.parse(raw) : Number.NaN;
    if (typeof raw === 'string' && raw.trim() && !Number.isFinite(parsed)) throw new AuthError(400, 'VALIDATION_ERROR', 'Enter a valid due date.');
    const submissionDueAt = Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
    const assignmentMaxScore = Number(input.assignmentMaxScore ?? 100);
    if (!Number.isFinite(assignmentMaxScore) || assignmentMaxScore < 1 || assignmentMaxScore > 1000) throw new AuthError(400, 'VALIDATION_ERROR', 'Maximum mark must be between 1 and 1000.');
    const resource = await this.resources.updateAssignmentSettings(tenantId, resourceId, submissionDueAt, assignmentMaxScore);
    if (!resource) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested assessment does not exist.');
    return resource;
  }

  async duplicate(tenantId: string, userId: string, resourceId: string): Promise<LearningResourceSummary> {
    const source = await this.resources.findDetailById(tenantId, resourceId);
    if (!source) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested resource does not exist.');
    const copy = await this.resources.create({ id: crypto.randomUUID(), tenantId, userId, title: `${source.title} (Copy)`,
      description: source.description, type: source.type, attemptPolicy: source.attemptPolicy, assignedClassName: source.assignedClassName });
    await this.resources.updateContent(tenantId, copy.id, source.content);
    await this.resources.updateTheme(tenantId, copy.id, source.themeId);
    await this.resources.updateDelivery(tenantId, copy.id, source.assetUrl, source.externalUrl);
    if (source.type === 'ASSESSMENT') await this.resources.updateAssignmentSettings(tenantId, copy.id, source.submissionDueAt, source.assignmentMaxScore);
    if (this.questions) for (const question of await this.questions.list(tenantId, source.id)) await this.questions.create({ tenantId, userId,
      resourceId: copy.id, type: question.type, prompt: question.prompt, options: question.options, acceptedAnswers: question.acceptedAnswers,
      interaction: question.interaction ?? null, points: question.points, timeLimitSeconds: question.timeLimitSeconds });
    for (const card of await this.resources.listFlashcards(tenantId, source.id)) await this.resources.createFlashcard(tenantId, copy.id, card.front, card.back);
    return (await this.resources.findById(tenantId, copy.id))!;
  }

  async listFlashcards(tenantId: string, resourceId: string): Promise<Flashcard[]> {
    await this.requireType(tenantId, resourceId, 'FLASHCARD_SET');
    return this.resources.listFlashcards(tenantId, resourceId);
  }

  async saveFlashcard(tenantId: string, resourceId: string, cardId: string | null, body: unknown): Promise<Flashcard> {
    await this.requireType(tenantId, resourceId, 'FLASHCARD_SET');
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const front = parseContent(input.front); const back = parseContent(input.back);
    const card = cardId ? await this.resources.updateFlashcard(tenantId, resourceId, cardId, front, back) : await this.resources.createFlashcard(tenantId, resourceId, front, back);
    if (!card) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested flashcard does not exist.');
    return card;
  }

  async deleteFlashcard(tenantId: string, resourceId: string, cardId: string): Promise<void> {
    await this.requireType(tenantId, resourceId, 'FLASHCARD_SET');
    if (!await this.resources.deleteFlashcard(tenantId, resourceId, cardId)) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested flashcard does not exist.');
  }

  async getLiveState(tenantId: string, resourceId: string): Promise<LiveResourceState> {
    await this.requireLiveResource(tenantId, resourceId);
    return this.resources.getLiveState(tenantId, resourceId);
  }

  async updateLiveState(tenantId: string, resourceId: string, body: unknown): Promise<LiveResourceState> {
    await this.requireLiveResource(tenantId, resourceId);
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const currentSlide = Number(input.currentSlide ?? 1);
    const currentZoom = Number(input.currentZoom ?? 100);
    const activeQuestionId = typeof input.activeQuestionId === 'string' && /^[0-9a-f-]{36}$/i.test(input.activeQuestionId) ? input.activeQuestionId : null;
    const strokes = Array.isArray(input.whiteboard) ? input.whiteboard : [];
    const presentationMode = ['SLIDE','ANNOTATE','WHITEBOARD'].includes(String(input.presentationMode)) ? input.presentationMode as LiveResourceState['presentationMode'] : 'SLIDE';
    // Drawing access is granted per active participant. Never let an older
    // client re-enable the former resource-wide permission.
    const allowStudentDraw = false;
    const allowDownload = input.allowDownload === true;
    const showCurrentSlide = input.showCurrentSlide === true;
    const showQuiz = input.showQuiz === true;
    const pointCount = strokes.reduce((sum, stroke) => sum + (stroke && typeof stroke === 'object' && Array.isArray((stroke as Record<string, unknown>).points) ? ((stroke as Record<string, unknown>).points as unknown[]).length : 0), 0);
    if (!Number.isInteger(currentSlide) || currentSlide < 1 || currentSlide > 1000 || !Number.isInteger(currentZoom) || currentZoom < 25 || currentZoom > 200 || strokes.length > 500 || pointCount > 20_000 || !strokes.every(isValidStroke)) throw new AuthError(400, 'VALIDATION_ERROR', 'Invalid live classroom state.');
    return this.resources.updateLiveState(tenantId, resourceId, { currentSlide, currentZoom, activeQuestionId, whiteboard: strokes as LiveWhiteboardStroke[], presentationMode, allowStudentDraw, allowDownload, showCurrentSlide, showQuiz });
  }

  async delete(tenantId: string, resourceId: string): Promise<void> {
    if (!await this.resources.delete(tenantId, resourceId)) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested resource does not exist.');
  }

  private async requireType(tenantId: string, resourceId: string, type: ResourceType): Promise<void> {
    const resource = await this.resources.findById(tenantId, resourceId);
    if (!resource || resource.type !== type) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested resource does not exist.');
  }

  private async requireLiveResource(tenantId: string, resourceId: string): Promise<void> {
    const resource = await this.resources.findById(tenantId, resourceId);
    if (!resource || !['PRESENTATION','INTERACTIVE_VIDEO'].includes(resource.type)) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested live classroom does not exist.');
  }
}

const isQuizTheme = (value: string): value is QuizTheme => ['AURORA','OCEAN','SUNSET','FOREST','GALAXY','CANDY','NEON','PAPER','SAFARI','MIDNIGHT'].includes(value);
const isValidStroke = (stroke: unknown): boolean => {
  if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke)) return false;
  const value = stroke as Record<string, unknown>;
  return (value.id === undefined || typeof value.id === 'string') && (value.ownerType === undefined || value.ownerType === 'TEACHER' || value.ownerType === 'STUDENT') &&
    (value.ownerId === undefined || typeof value.ownerId === 'string') && typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color) && typeof value.size === 'number' && value.size >= 1 && value.size <= 20 &&
    Array.isArray(value.points) && value.points.length <= 2000 && value.points.every((point) => point && typeof point === 'object' &&
      Number((point as Record<string, unknown>).x) >= 0 && Number((point as Record<string, unknown>).x) <= 1 &&
      Number((point as Record<string, unknown>).y) >= 0 && Number((point as Record<string, unknown>).y) <= 1);
};
