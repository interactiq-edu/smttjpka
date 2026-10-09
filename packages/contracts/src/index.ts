export type ApiErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'RATE_LIMITED'
  | 'CONFIGURATION_ERROR'
  | 'INTERNAL_ERROR';

export type ApiResponse<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: {
        code: ApiErrorCode;
        message: string;
        details?: Record<string, unknown>;
      };
    };

export interface HealthData {
  service: 'interactiq-api';
  environment: 'development' | 'staging' | 'production';
}

export type HealthResponse = ApiResponse<HealthData>;

export type TenantStatus = 'active' | 'suspended' | 'archived';
export type PlatformRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'TEACHER' | 'EDITOR' | 'STUDENT';
export type Permission =
  | 'tenant.manage'
  | 'user.manage'
  | 'resource.create'
  | 'resource.read'
  | 'resource.update'
  | 'resource.delete'
  | 'assignment.manage'
  | 'report.read'
  | 'live.manage';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TenantSettings {
  tenantId: string;
  accentColor: string | null;
  welcomeMessage: string | null;
  logoMediaId: string | null;
  faviconMediaId: string | null;
  updatedAt: string;
}

export interface TenantContext {
  tenantId: string;
  userId: string;
  roles: PlatformRole[];
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface AuthSessionData {
  user: AuthenticatedUser;
  tenant: Pick<Tenant, 'id' | 'slug' | 'name'>;
  roles: PlatformRole[];
  expiresAt: string;
}

export type AuthLoginResponse = ApiResponse<AuthSessionData & { csrfToken: string; sessionToken: string }>;
export type AuthSessionResponse = ApiResponse<AuthSessionData>;

export type ResourceType = 'QUIZ' | 'ASSESSMENT' | 'FLASHCARD_SET' | 'PRESENTATION' | 'PASSAGE' | 'INTERACTIVE_VIDEO';
export type ResourceStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type ResourceVisibility = 'PRIVATE' | 'TENANT' | 'PUBLIC';
export type QuizTheme = 'AURORA' | 'OCEAN' | 'SUNSET' | 'FOREST' | 'GALAXY' | 'CANDY' | 'NEON' | 'PAPER' | 'SAFARI' | 'MIDNIGHT';
export type AttemptPolicy = 'ONCE_PER_EMAIL' | 'MULTIPLE';
export type ResultReleasePolicy = 'DETAILED_AFTER_SUBMISSION' | 'SCORE_ONLY' | 'TEACHER_REVIEW' | 'IMMEDIATE_PER_QUESTION';
export type AssignmentReviewStatus = 'PENDING' | 'NOT_REVIEWED' | 'REVIEWED';

export interface LearningResourceSummary {
  id: string;
  title: string;
  description: string | null;
  type: ResourceType;
  status: ResourceStatus;
  visibility: ResourceVisibility;
  shareCode: string | null;
  publishedAt: string | null;
  themeId: QuizTheme;
  assetUrl: string | null;
  externalUrl: string | null;
  attemptPolicy: AttemptPolicy;
  resultReleasePolicy: ResultReleasePolicy;
  accessStartsAt: string | null;
  assignedClassName: string | null;
  submissionDueAt: string | null;
  assignmentMaxScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface RichTextMark {
  type: 'bold' | 'italic' | 'underline' | 'strike' | 'link' | 'highlight' | 'textStyle';
  attrs?: Record<string, string>;
}

export interface RichTextNode {
  type: string;
  text?: string;
  attrs?: Record<string, string | number | null>;
  marks?: RichTextMark[];
  content?: RichTextNode[];
}

export interface RichTextDocument {
  type: 'doc';
  content: RichTextNode[];
}

export interface LearningResourceDetail extends LearningResourceSummary {
  content: RichTextDocument;
}

export interface CreateLearningResourceInput {
  title: string;
  description?: string;
  type: ResourceType;
  attemptPolicy?: AttemptPolicy;
  assignedClassName?: string;
}

export interface PublishedResource {
  resource: LearningResourceSummary;
  shareCode: string;
}

export interface DashboardOverview {
  resources: {
    total: number;
    drafts: number;
    published: number;
  };
  students: number;
  activeSessions: number;
  classAnalytics: ClassAnalytics[];
}

export interface ClassAnalyticsStudent {
  attemptId: string;
  studentName: string;
  studentEmail: string;
  resourceTitle: string;
  resourceType: ResourceType;
  score: number;
  maxScore: number;
  percentage: number;
  submittedAt: string;
}

export interface ClassAnalyticsQuestion {
  questionId: string;
  prompt: string;
  resourceTitle: string;
  incorrectCount: number;
  answerCount: number;
  incorrectPercentage: number;
}

export interface ClassAnalytics {
  className: string;
  studentCount: number;
  submissionCount: number;
  averagePercentage: number;
  students: ClassAnalyticsStudent[];
  commonlyWrongQuestions: ClassAnalyticsQuestion[];
}

export type QuestionType =
  | 'MULTIPLE_CHOICE'
  | 'MULTI_SELECT'
  | 'TRUE_FALSE'
  | 'FILL_IN_THE_BLANKS'
  | 'OPEN_ENDED'
  | 'PASSAGE'
  | 'DRAG_AND_DROP'
  | 'CATEGORIZE'
  | 'MATCH'
  | 'MATCH_TABLE_GRID'
  | 'DROPDOWN'
  | 'REORDER'
  | 'MATH_RESPONSE'
  | 'LABELLING'
  | 'HOTSPOT';

export type QuestionInteraction =
  | { kind: 'fill_blank'; template: string; blanks: Array<{ id: string; answers: string[]; mode: 'text' | 'dropdown'; options: string[] }>; ignoreAccents: boolean }
  | { kind: 'drag_drop'; template: string; blanks: Array<{ id: string; answer: string }>; distractors: string[] }
  | { kind: 'math_response'; calculator: boolean }
  | { kind: 'labelling'; imageUrl: string; labels: Array<{ id: string; text: string; x: number; y: number }>; distractors: string[] }
  | { kind: 'hotspot'; imageUrl: string; shape: 'point' | 'rectangle' | 'polygon'; regions: Array<{ id: string; points: Array<{ x: number; y: number }> }> }
  | { kind: 'reorder'; items: string[]; shufflePerStudent?: boolean }
  | { kind: 'categorize'; categories: Array<{ id: string; name: string; items: Array<{ id: string; text: string }> }>; partialCredit: boolean }
  | { kind: 'match'; pairs: Array<{ id: string; prompt: string; response: string }>; partialCredit: boolean }
  | { kind: 'match_table_grid'; rows: Array<{ id: string; text: string }>; columns: Array<{ id: string; text: string }>; correctCells: string[]; allowMultiplePerRow: boolean; partialCredit: boolean };

export interface QuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface LearningQuestion {
  id: string;
  type: QuestionType;
  prompt: RichTextDocument;
  options: QuestionOption[];
  acceptedAnswers: string[];
  interaction?: QuestionInteraction | null;
  points: number;
  timeLimitSeconds: number | null;
  position: number;
}

export const gradeQuestionAnswer = (question: LearningQuestion, value: string | string[]): { correct: boolean | null; points: number } => {
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
    const submitted = new Set(Array.isArray(value) ? value : [value]);
    const hits = interaction.pairs.filter((pair) => submitted.has(`${pair.id}:${pair.id}`)).length;
    const correct = hits === interaction.pairs.length;
    return { correct, points: correct || interaction.partialCredit ? question.points * hits / interaction.pairs.length : 0 };
  }
  if (interaction?.kind === 'match_table_grid') {
    const submitted = new Set(Array.isArray(value) ? value : [value]);
    const expected = new Set(interaction.correctCells);
    const hits = [...submitted].filter((cell) => expected.has(cell)).length;
    const wrong = [...submitted].filter((cell) => !expected.has(cell)).length;
    const correct = hits === expected.size && wrong === 0;
    return { correct, points: correct || interaction.partialCredit ? question.points * Math.max(0, hits - wrong) / expected.size : 0 };
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
        const xs = region.points.map((candidate) => candidate.x); const ys = region.points.map((candidate) => candidate.y);
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

export interface CreateQuestionInput {
  type: QuestionType;
  prompt: RichTextDocument;
  options?: QuestionOption[];
  acceptedAnswers?: string[];
  interaction?: QuestionInteraction | null;
  points?: number;
  timeLimitSeconds?: number | null;
}

export interface UpdateQuestionInput extends CreateQuestionInput {}

export type AttemptStatus = 'IN_PROGRESS' | 'COMPLETED';

export interface AttemptAnswerInput {
  questionId: string;
  value: string | string[];
}

export interface AttemptResult {
  id: string;
  resourceId: string;
  status: AttemptStatus;
  score: number | null;
  maxScore: number | null;
  submittedAt: string | null;
  studentFullName?: string | null;
  studentClassName?: string | null;
  finalReviewedAt?: string | null;
  duplicateNameWarning?: boolean;
  submissionFileUrl?: string | null;
  submissionFileName?: string | null;
  submissionMimeType?: string | null;
  submissionFileSize?: number | null;
  submissionNotes?: string | null;
  assignmentReviewStatus?: AssignmentReviewStatus | null;
  assignmentMark?: number | null;
  assignmentFeedback?: string | null;
  answerResults?: AttemptAnswerResult[];
}

export interface AttemptAnswerResult {
  questionId: string;
  correct: boolean | null;
  points: number;
  maxPoints: number;
  correctAnswer?: string | string[] | null;
}

export interface QuestionCheckResult extends AttemptAnswerResult {}

export interface OpenEndedPreviewGradeResult extends QuestionCheckResult {
  aiFeedback: string;
}

export interface AttemptSubmissionInput {
  answers: AttemptAnswerInput[];
  fullName: string;
  className: string;
}

export interface AttemptAnswerReview {
  questionId: string;
  questionType: QuestionType;
  prompt: RichTextDocument;
  /** Original answer payload used to reconstruct the same visual control seen by the student. */
  rawAnswer: string | string[];
  answer: string | string[];
  correctAnswer: string | string[] | null;
  interaction: QuestionInteraction | null;
  isCorrect: boolean | null;
  awardedPoints: number;
  aiSuggestedPoints: number | null;
  aiFeedback: string | null;
  teacherPoints: number | null;
  teacherFeedback: string | null;
  maxPoints: number;
}

export interface AttemptReview extends AttemptResult {
  studentFullName: string | null;
  studentClassName: string | null;
  studentEmail: string | null;
  studentDisplayName: string | null;
  answers: AttemptAnswerReview[];
}

export interface ResourceReport {
  resource: LearningResourceSummary;
  submissionCount: number;
  pendingReviewCount: number;
  attempts: Array<Pick<AttemptReview, 'id' | 'status' | 'score' | 'maxScore' | 'submittedAt' | 'studentFullName' | 'studentClassName' | 'studentEmail' | 'finalReviewedAt' | 'duplicateNameWarning' | 'submissionFileUrl' | 'submissionFileName' | 'submissionMimeType' | 'submissionFileSize' | 'submissionNotes' | 'assignmentReviewStatus' | 'assignmentMark' | 'assignmentFeedback'>>;
}

export interface TenantThemeSettings {
  defaultTheme: QuizTheme;
}

export interface Flashcard {
  id: string;
  resourceId: string;
  front: RichTextDocument;
  back: RichTextDocument;
  position: number;
}

export interface LiveWhiteboardStroke {
  id?: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  size: number;
  ownerType?: 'TEACHER' | 'STUDENT';
  ownerId?: string;
}

export interface LiveResourceState {
  resourceId: string;
  /** Current delivery URLs are included so a connected student can swap media live. */
  assetUrl?: string | null;
  externalUrl?: string | null;
  currentSlide: number;
  currentZoom: number;
  activeQuestionId: string | null;
  whiteboard: LiveWhiteboardStroke[];
  presentationMode: 'SLIDE' | 'ANNOTATE' | 'WHITEBOARD';
  allowStudentDraw: boolean;
  allowDownload: boolean;
  showCurrentSlide: boolean;
  showQuiz: boolean;
  updatedAt: string;
}

export interface LiveParticipant {
  attemptId: string;
  displayName: string;
  email: string | null;
  className: string | null;
  status: 'IN_PROGRESS' | 'COMPLETED';
  lastSeenAt: string;
  canDraw: boolean;
  isOnline: boolean;
}

export interface StorageInventory {
  d1: Array<{ key: string; label: string; rows: number; cleanup?: 'EXPIRED_SESSIONS' | 'ABANDONED_ATTEMPTS' | 'OLD_AUDIT_LOGS' }>;
  r2: Array<{ key: string; size: number; uploadedAt: string | null; referenceCount: number }>;
  totals: { d1Rows: number; r2Bytes: number; r2Objects: number };
}
