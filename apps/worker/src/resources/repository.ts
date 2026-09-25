import type { AttemptPolicy, DashboardOverview, Flashcard, LearningResourceDetail, LearningResourceSummary, LiveResourceState, LiveWhiteboardStroke, QuizTheme, ResourceStatus, ResourceType, ResourceVisibility, ResultReleasePolicy, RichTextDocument, TenantThemeSettings } from '@interactiq/contracts';
import type { D1Database } from '../db/types';

interface ResourceRow {
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

const resourceSelect = `id, title, description, resource_type AS type, status, visibility,
  share_code AS shareCode, published_at AS publishedAt, theme_id AS themeId, asset_url AS assetUrl,
  external_url AS externalUrl, attempt_policy AS attemptPolicy, result_release_policy AS resultReleasePolicy, access_starts_at AS accessStartsAt,
  assigned_class_name AS assignedClassName, submission_due_at AS submissionDueAt,
  assignment_max_score AS assignmentMaxScore,
  created_at AS createdAt, updated_at AS updatedAt`;

export class ResourceRepository {
  constructor(private readonly db: D1Database) {}

  async list(tenantId: string): Promise<LearningResourceSummary[]> {
    const result = await this.db
      .prepare(`SELECT ${resourceSelect} FROM learning_resources WHERE tenant_id = ? AND resource_type <> 'PASSAGE' ORDER BY updated_at DESC, id DESC LIMIT 100`)
      .bind(tenantId)
      .all<ResourceRow>();
    return result.results;
  }

  async findById(tenantId: string, resourceId: string): Promise<LearningResourceSummary | null> {
    return this.db
      .prepare(`SELECT ${resourceSelect} FROM learning_resources WHERE tenant_id = ? AND id = ? LIMIT 1`)
      .bind(tenantId, resourceId)
      .first<LearningResourceSummary>();
  }

  async findDetailById(tenantId: string, resourceId: string): Promise<LearningResourceDetail | null> {
    const row = await this.db
      .prepare(`SELECT ${resourceSelect}, content_json AS contentJson FROM learning_resources WHERE tenant_id = ? AND id = ? LIMIT 1`)
      .bind(tenantId, resourceId)
      .first<ResourceRow & { contentJson: string }>();
    if (!row) return null;
    const content = JSON.parse(row.contentJson) as RichTextDocument;
    return { ...row, content: content.type === 'doc' && Array.isArray(content.content) ? content : { type: 'doc', content: [] } };
  }

  async findPublishedByShareCode(tenantId: string, shareCode: string): Promise<LearningResourceDetail | null> {
    const row = await this.db
      .prepare(`SELECT ${resourceSelect}, content_json AS contentJson FROM learning_resources
        WHERE tenant_id = ? AND share_code = ? AND status = 'PUBLISHED' LIMIT 1`)
      .bind(tenantId, shareCode)
      .first<ResourceRow & { contentJson: string }>();
    if (!row) return null;
    const content = JSON.parse(row.contentJson) as RichTextDocument;
    return { ...row, content: content.type === 'doc' && Array.isArray(content.content) ? content : { type: 'doc', content: [] } };
  }

  async findPublishedContextByShareCode(shareCode: string): Promise<(LearningResourceDetail & { tenantId: string; tenantSlug: string; tenantName: string }) | null> {
    const row = await this.db.prepare(`SELECT r.id, r.title, r.description, r.resource_type AS type, r.status, r.visibility,
      r.share_code AS shareCode, r.published_at AS publishedAt, r.theme_id AS themeId, r.asset_url AS assetUrl, r.external_url AS externalUrl,
      r.attempt_policy AS attemptPolicy, r.result_release_policy AS resultReleasePolicy, r.access_starts_at AS accessStartsAt,
      r.assigned_class_name AS assignedClassName, r.submission_due_at AS submissionDueAt,
      r.assignment_max_score AS assignmentMaxScore,
      r.created_at AS createdAt, r.updated_at AS updatedAt, r.content_json AS contentJson,
      r.tenant_id AS tenantId, t.slug AS tenantSlug, t.name AS tenantName
      FROM learning_resources r JOIN tenants t ON t.id = r.tenant_id
      WHERE r.share_code = ? AND r.status = 'PUBLISHED' AND t.status = 'active' LIMIT 1`)
      .bind(shareCode).first<ResourceRow & { contentJson: string; tenantId: string; tenantSlug: string; tenantName: string }>();
    if (!row) return null;
    const content = JSON.parse(row.contentJson) as RichTextDocument;
    return { ...row, content: content.type === 'doc' && Array.isArray(content.content) ? content : { type: 'doc', content: [] } };
  }

  async create(input: {
    id: string;
    tenantId: string;
    userId: string;
    title: string;
    description: string | null;
    type: ResourceType;
    attemptPolicy: AttemptPolicy;
    assignedClassName?: string | null;
  }): Promise<LearningResourceSummary> {
    await this.db
      .prepare(`INSERT INTO learning_resources
        (id, tenant_id, created_by_user_id, title, description, resource_type, attempt_policy, assigned_class_name, theme_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT default_theme FROM tenant_settings WHERE tenant_id = ?), 'AURORA'))`)
      .bind(input.id, input.tenantId, input.userId, input.title, input.description, input.type, input.attemptPolicy, input.assignedClassName ?? null, input.tenantId)
      .run();
    const resource = await this.findById(input.tenantId, input.id);
    if (!resource) throw new Error('Resource creation did not return a record.');
    return resource;
  }

  async dashboard(tenantId: string): Promise<DashboardOverview> {
    const countsQuery = this.db
      .prepare(`SELECT COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END), 0) AS drafts,
          COALESCE(SUM(CASE WHEN status = 'PUBLISHED' THEN 1 ELSE 0 END), 0) AS published
        FROM learning_resources WHERE tenant_id = ? AND resource_type <> 'PASSAGE'`)
      .bind(tenantId)
      .first<{ total: number; drafts: number; published: number }>();
    const studentsQuery = this.db
      .prepare(`SELECT COUNT(DISTINCT ur.user_id) AS total
        FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.tenant_id = ? AND r.name = 'STUDENT'`)
      .bind(tenantId)
      .first<{ total: number }>();
    const activeSessionsQuery = this.db
      .prepare(`SELECT COUNT(*) AS total FROM sessions
        WHERE tenant_id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`)
      .bind(tenantId)
      .first<{ total: number }>();
    const submissionRowsQuery = this.db.prepare(`SELECT a.id AS attemptId, a.student_full_name AS studentName,
      a.student_class_name AS className, u.email AS studentEmail, r.title AS resourceTitle,
      r.resource_type AS resourceType, a.score, a.max_score AS maxScore, a.submitted_at AS submittedAt
      FROM attempts a JOIN users u ON u.id = a.user_id JOIN learning_resources r ON r.id = a.resource_id
      WHERE a.tenant_id = ? AND a.status = 'COMPLETED' AND r.resource_type <> 'ASSESSMENT' ORDER BY a.submitted_at DESC LIMIT 2000`)
      .bind(tenantId).all<Record<string, unknown>>();
    const wrongRowsQuery = this.db.prepare(`SELECT a.student_class_name AS className, q.id AS questionId,
      q.prompt_json AS promptJson, r.title AS resourceTitle,
      SUM(CASE WHEN COALESCE(aa.teacher_points, aa.ai_suggested_points, aa.awarded_points, 0) < q.points THEN 1 ELSE 0 END) AS incorrectCount,
      COUNT(*) AS answerCount FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
      JOIN questions q ON q.id = aa.question_id JOIN learning_resources r ON r.id = a.resource_id
      WHERE a.tenant_id = ? AND a.status = 'COMPLETED' GROUP BY a.student_class_name, q.id, r.title`)
      .bind(tenantId).all<Record<string, unknown>>();
    const [counts, students, activeSessions, submissionRows, wrongRows] = await Promise.all([
      countsQuery, studentsQuery, activeSessionsQuery, submissionRowsQuery, wrongRowsQuery,
    ]);
    const groups = new Map<string, { className: string; students: DashboardOverview['classAnalytics'][number]['students']; wrong: DashboardOverview['classAnalytics'][number]['commonlyWrongQuestions'] }>();
    for (const row of submissionRows.results) {
      const className = normalizeClassName(String(row.className ?? 'No class'));
      const group = groups.get(className) ?? { className, students: [], wrong: [] };
      const score = Number(row.score ?? 0); const maxScore = Number(row.maxScore ?? 0);
      group.students.push({ attemptId: String(row.attemptId), studentName: String(row.studentName ?? row.studentEmail ?? 'Student'),
        studentEmail: String(row.studentEmail ?? ''), resourceTitle: String(row.resourceTitle), resourceType: row.resourceType as ResourceType,
        score, maxScore, percentage: maxScore ? Math.round(score / maxScore * 100) : 0, submittedAt: String(row.submittedAt) });
      groups.set(className, group);
    }
    for (const row of wrongRows.results) {
      const className = normalizeClassName(String(row.className ?? 'No class')); const group = groups.get(className); if (!group) continue;
      const incorrectCount = Number(row.incorrectCount ?? 0); const answerCount = Number(row.answerCount ?? 0);
      group.wrong.push({ questionId: String(row.questionId), prompt: richTextPlainText(String(row.promptJson)), resourceTitle: String(row.resourceTitle),
        incorrectCount, answerCount, incorrectPercentage: answerCount ? Math.round(incorrectCount / answerCount * 100) : 0 });
    }
    const classAnalytics = [...groups.values()].map((group) => ({ className: group.className,
      studentCount: new Set(group.students.map((student) => student.studentEmail)).size, submissionCount: group.students.length,
      averagePercentage: group.students.length ? Math.round(group.students.reduce((sum, student) => sum + student.percentage, 0) / group.students.length) : 0,
      students: group.students, commonlyWrongQuestions: group.wrong.sort((a,b) => b.incorrectPercentage - a.incorrectPercentage).slice(0,50) }));
    return {
      resources: counts ?? { total: 0, drafts: 0, published: 0 },
      students: students?.total ?? 0,
      activeSessions: activeSessions?.total ?? 0,
      classAnalytics,
    };
  }

  async updateContent(tenantId: string, resourceId: string, content: RichTextDocument): Promise<LearningResourceDetail | null> {
    await this.db
      .prepare('UPDATE learning_resources SET content_json = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?')
      .bind(JSON.stringify(content), tenantId, resourceId)
      .run();
    return this.findDetailById(tenantId, resourceId);
  }

  async publish(tenantId: string, resourceId: string, shareCode: string, attemptPolicy: AttemptPolicy, resultReleasePolicy: ResultReleasePolicy, accessStartsAt: string | null): Promise<LearningResourceSummary | null> {
    await this.db.prepare(`UPDATE learning_resources
      SET status = 'PUBLISHED', visibility = 'TENANT', share_code = COALESCE(share_code, ?),
        published_at = COALESCE(published_at, CURRENT_TIMESTAMP), attempt_policy = ?, result_release_policy = ?, access_starts_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND id = ?`).bind(shareCode, attemptPolicy, resultReleasePolicy, accessStartsAt, tenantId, resourceId).run();
    return this.findById(tenantId, resourceId);
  }

  async unpublish(tenantId: string, resourceId: string): Promise<LearningResourceSummary | null> {
    await this.db.batch([
      this.db.prepare(`UPDATE learning_resources SET status = 'DRAFT', visibility = 'PRIVATE', share_code = NULL,
        published_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?`).bind(tenantId, resourceId),
      this.db.prepare(`UPDATE attempts SET kicked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND resource_id = ? AND status = 'IN_PROGRESS' AND kicked_at IS NULL`).bind(tenantId, resourceId),
      this.db.prepare('DELETE FROM live_drawing_permissions WHERE tenant_id = ? AND resource_id = ?').bind(tenantId, resourceId),
    ]);
    return this.findById(tenantId, resourceId);
  }

  async kickParticipant(tenantId: string, resourceId: string, attemptId: string): Promise<boolean> {
    const results = await this.db.batch([
      this.db.prepare(`UPDATE attempts SET kicked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND resource_id = ? AND id = ? AND status = 'IN_PROGRESS' AND kicked_at IS NULL`).bind(tenantId, resourceId, attemptId),
      this.db.prepare('DELETE FROM live_drawing_permissions WHERE tenant_id = ? AND resource_id = ? AND attempt_id = ?').bind(tenantId, resourceId, attemptId),
    ]);
    return Number((results[0]?.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
  }

  async deleteClassData(tenantId: string, className: string): Promise<number> {
    const normalized = normalizeClassName(className);
    const attempts = await this.db.prepare('SELECT id FROM attempts WHERE tenant_id = ? AND UPPER(TRIM(student_class_name)) = ?')
      .bind(tenantId, normalized).all<{ id: string }>();
    await this.db.batch([
      this.db.prepare('DELETE FROM attempts WHERE tenant_id = ? AND UPPER(TRIM(student_class_name)) = ?').bind(tenantId, normalized),
      this.db.prepare('UPDATE learning_resources SET assigned_class_name = NULL, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND UPPER(TRIM(assigned_class_name)) = ?').bind(tenantId, normalized),
    ]);
    return attempts.results.length;
  }

  async updateTheme(tenantId: string, resourceId: string, themeId: QuizTheme): Promise<LearningResourceSummary | null> {
    await this.db.prepare('UPDATE learning_resources SET theme_id = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?')
      .bind(themeId, tenantId, resourceId).run();
    return this.findById(tenantId, resourceId);
  }

  async getThemeSettings(tenantId: string): Promise<TenantThemeSettings> {
    return (await this.db.prepare('SELECT default_theme AS defaultTheme FROM tenant_settings WHERE tenant_id = ? LIMIT 1')
      .bind(tenantId).first<TenantThemeSettings>()) ?? { defaultTheme: 'AURORA' };
  }

  async updateThemeSettings(tenantId: string, defaultTheme: QuizTheme): Promise<TenantThemeSettings> {
    await this.db.prepare(`INSERT INTO tenant_settings (tenant_id, default_theme) VALUES (?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET default_theme = excluded.default_theme, updated_at = CURRENT_TIMESTAMP`)
      .bind(tenantId, defaultTheme).run();
    return { defaultTheme };
  }

  async updateDelivery(tenantId: string, resourceId: string, assetUrl: string | null, externalUrl: string | null): Promise<LearningResourceDetail | null> {
    await this.db.prepare(`UPDATE learning_resources SET asset_url = ?, external_url = ?, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND id = ?`).bind(assetUrl, externalUrl, tenantId, resourceId).run();
    return this.findDetailById(tenantId, resourceId);
  }

  async updateAssignedClass(tenantId: string, resourceId: string, assignedClassName: string | null): Promise<LearningResourceSummary | null> {
    await this.db.prepare('UPDATE learning_resources SET assigned_class_name = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?')
      .bind(assignedClassName, tenantId, resourceId).run();
    return this.findById(tenantId, resourceId);
  }

  async updateAssignmentSettings(tenantId: string, resourceId: string, submissionDueAt: string | null, assignmentMaxScore: number): Promise<LearningResourceDetail | null> {
    await this.db.prepare(`UPDATE learning_resources SET submission_due_at = ?, assignment_max_score = ?, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND id = ? AND resource_type = 'ASSESSMENT'`).bind(submissionDueAt, assignmentMaxScore, tenantId, resourceId).run();
    return this.findDetailById(tenantId, resourceId);
  }

  async listFlashcards(tenantId: string, resourceId: string): Promise<Flashcard[]> {
    const result = await this.db.prepare(`SELECT id, resource_id AS resourceId, front_json AS frontJson, back_json AS backJson, position
      FROM flashcards WHERE tenant_id = ? AND resource_id = ? ORDER BY position`).bind(tenantId, resourceId)
      .all<{ id: string; resourceId: string; frontJson: string; backJson: string; position: number }>();
    return result.results.map((row) => ({ id: row.id, resourceId: row.resourceId, front: JSON.parse(row.frontJson), back: JSON.parse(row.backJson), position: row.position }));
  }

  async createFlashcard(tenantId: string, resourceId: string, front: RichTextDocument, back: RichTextDocument): Promise<Flashcard> {
    const id = crypto.randomUUID();
    await this.db.prepare(`INSERT INTO flashcards (id, resource_id, tenant_id, front_json, back_json, position)
      VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM flashcards WHERE resource_id = ?), 0))`)
      .bind(id, resourceId, tenantId, JSON.stringify(front), JSON.stringify(back), resourceId).run();
    return (await this.listFlashcards(tenantId, resourceId)).find((card) => card.id === id)!;
  }

  async updateFlashcard(tenantId: string, resourceId: string, cardId: string, front: RichTextDocument, back: RichTextDocument): Promise<Flashcard | null> {
    await this.db.prepare(`UPDATE flashcards SET front_json = ?, back_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND resource_id = ? AND tenant_id = ?`).bind(JSON.stringify(front), JSON.stringify(back), cardId, resourceId, tenantId).run();
    return (await this.listFlashcards(tenantId, resourceId)).find((card) => card.id === cardId) ?? null;
  }

  async deleteFlashcard(tenantId: string, resourceId: string, cardId: string): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM flashcards WHERE id = ? AND resource_id = ? AND tenant_id = ?')
      .bind(cardId, resourceId, tenantId).run();
    return Number((result.meta as { changes?: number }).changes ?? 0) > 0;
  }

  async getLiveState(tenantId: string, resourceId: string): Promise<LiveResourceState> {
    const row = await this.db.prepare(`SELECT r.id AS resourceId, r.asset_url AS assetUrl, r.external_url AS externalUrl,
      COALESCE(s.current_slide, 1) AS currentSlide, COALESCE(s.current_zoom, 100) AS currentZoom,
      s.active_question_id AS activeQuestionId, COALESCE(s.whiteboard_json, '[]') AS whiteboardJson,
      COALESCE(s.presentation_mode, 'SLIDE') AS presentationMode,
      COALESCE(s.allow_student_draw, 0) AS allowStudentDraw, COALESCE(s.allow_download, 0) AS allowDownload,
      COALESCE(s.show_current_slide, 0) AS showCurrentSlide, COALESCE(s.show_quiz, 0) AS showQuiz,
      COALESCE(s.updated_at, r.updated_at) AS updatedAt
      FROM learning_resources r LEFT JOIN resource_live_states s
        ON s.resource_id = r.id AND s.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND r.id = ? LIMIT 1`).bind(tenantId, resourceId)
      .first<{ resourceId: string; assetUrl: string | null; externalUrl: string | null; currentSlide: number; currentZoom: number; activeQuestionId: string | null; whiteboardJson: string; presentationMode: LiveResourceState['presentationMode']; allowStudentDraw: number; allowDownload: number; showCurrentSlide: number; showQuiz: number; updatedAt: string }>();
    if (!row) return { resourceId, assetUrl: null, externalUrl: null, currentSlide: 1, currentZoom: 100, activeQuestionId: null, whiteboard: [], presentationMode: 'SLIDE', allowStudentDraw: false, allowDownload: false, showCurrentSlide: false, showQuiz: false, updatedAt: new Date(0).toISOString() };
    return { resourceId: row.resourceId, assetUrl: row.assetUrl, externalUrl: row.externalUrl, currentSlide: row.currentSlide, currentZoom: row.currentZoom, activeQuestionId: row.activeQuestionId,
      whiteboard: JSON.parse(row.whiteboardJson) as LiveWhiteboardStroke[], presentationMode: row.presentationMode,
      allowStudentDraw: Boolean(row.allowStudentDraw), allowDownload: Boolean(row.allowDownload), showCurrentSlide: Boolean(row.showCurrentSlide), showQuiz: Boolean(row.showQuiz), updatedAt: row.updatedAt };
  }

  async updateLiveState(tenantId: string, resourceId: string, state: Omit<LiveResourceState, 'resourceId' | 'updatedAt'>): Promise<LiveResourceState> {
    await this.db.prepare(`INSERT INTO resource_live_states (resource_id, tenant_id, current_slide, current_zoom, active_question_id, whiteboard_json, presentation_mode, allow_student_draw, allow_download, show_current_slide, show_quiz)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(resource_id) DO UPDATE SET current_slide = excluded.current_slide, current_zoom = excluded.current_zoom,
      active_question_id = excluded.active_question_id, whiteboard_json = excluded.whiteboard_json, presentation_mode = excluded.presentation_mode,
      allow_student_draw = excluded.allow_student_draw, allow_download = excluded.allow_download, show_current_slide = excluded.show_current_slide, show_quiz = excluded.show_quiz, updated_at = CURRENT_TIMESTAMP`)
      .bind(resourceId, tenantId, state.currentSlide, state.currentZoom, state.activeQuestionId, JSON.stringify(state.whiteboard), state.presentationMode,
        Number(state.allowStudentDraw), Number(state.allowDownload), Number(state.showCurrentSlide), Number(state.showQuiz)).run();
    return this.getLiveState(tenantId, resourceId);
  }

  async delete(tenantId: string, resourceId: string): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM learning_resources WHERE tenant_id = ? AND id = ?').bind(tenantId, resourceId).run();
    return Number((result.meta as { changes?: number }).changes ?? 0) > 0;
  }
}

export const normalizeClassName = (value: string): string => {
  if (!value.trim() || /^no\s*class$/i.test(value)) return 'No class';
  const compact = value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const common = /^(\d+)([A-Z]+)(\d*)$/.exec(compact);
  return common ? `${common[1]} ${common[2]}${common[3] ? ` ${common[3]}` : ''}` : compact;
};

const richTextPlainText = (json: string): string => {
  try { const walk = (nodes: Array<{ text?: string; content?: unknown[] }>): string => nodes.map((node) => `${node.text ?? ''} ${Array.isArray(node.content) ? walk(node.content as Array<{ text?: string; content?: unknown[] }>) : ''}`).join(' '); return walk((JSON.parse(json) as { content?: Array<{ text?: string; content?: unknown[] }> }).content ?? []).replace(/\s+/g, ' ').trim(); }
  catch { return 'Question'; }
};
