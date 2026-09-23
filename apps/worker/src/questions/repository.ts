import type { LearningQuestion, QuestionType, RichTextDocument } from '@interactiq/contracts';
import type { D1Database } from '../db/types';

interface QuestionRow {
  id: string;
  type: QuestionType;
  promptJson: string;
  configurationJson: string;
  points: number;
  timeLimitSeconds: number | null;
  position: number;
}

const toQuestion = (row: QuestionRow): LearningQuestion => {
  const config = JSON.parse(row.configurationJson) as { options?: LearningQuestion['options']; acceptedAnswers?: string[]; interaction?: LearningQuestion['interaction'] };
  return { id: row.id, type: row.type, prompt: JSON.parse(row.promptJson) as RichTextDocument, options: config.options ?? [], acceptedAnswers: config.acceptedAnswers ?? [], interaction: config.interaction ?? null, points: row.points, timeLimitSeconds: row.timeLimitSeconds, position: row.position };
};

export class QuestionRepository {
  constructor(private readonly db: D1Database) {}

  async list(tenantId: string, resourceId: string): Promise<LearningQuestion[]> {
    const result = await this.db.prepare(`SELECT q.id, q.question_type AS type, q.prompt_json AS promptJson, q.configuration_json AS configurationJson, q.points, q.time_limit_seconds AS timeLimitSeconds, qq.position
      FROM quiz_questions qq JOIN questions q ON q.id = qq.question_id
      JOIN learning_resources r ON r.id = qq.resource_id
      WHERE qq.resource_id = ? AND q.tenant_id = ? AND r.tenant_id = ?
      ORDER BY qq.position ASC`).bind(resourceId, tenantId, tenantId).all<QuestionRow>();
    return result.results.map(toQuestion);
  }

  async create(input: { tenantId: string; userId: string; resourceId: string; type: QuestionType; prompt: RichTextDocument; options: LearningQuestion['options']; acceptedAnswers: string[]; interaction: LearningQuestion['interaction']; points: number; timeLimitSeconds: number | null }): Promise<LearningQuestion> {
    const id = crypto.randomUUID();
    const configuration = JSON.stringify({ options: input.options, acceptedAnswers: input.acceptedAnswers, interaction: input.interaction });
    await this.db.prepare(`INSERT INTO questions (id, tenant_id, created_by_user_id, question_type, prompt_json, configuration_json, points, time_limit_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, input.tenantId, input.userId, input.type, JSON.stringify(input.prompt), configuration, input.points, input.timeLimitSeconds).run();
    await this.db.prepare(`INSERT INTO quiz_questions (resource_id, question_id, position)
      VALUES (?, ?, COALESCE((SELECT MAX(position) + 1 FROM quiz_questions WHERE resource_id = ?), 0))`).bind(input.resourceId, id, input.resourceId).run();
    const question = (await this.list(input.tenantId, input.resourceId)).find((item) => item.id === id);
    if (!question) throw new Error('Question creation did not return a record.');
    return question;
  }

  async update(input: { tenantId: string; resourceId: string; questionId: string; type: QuestionType; prompt: RichTextDocument; options: LearningQuestion['options']; acceptedAnswers: string[]; interaction: LearningQuestion['interaction']; points: number; timeLimitSeconds: number | null }): Promise<LearningQuestion | null> {
    const configuration = JSON.stringify({ options: input.options, acceptedAnswers: input.acceptedAnswers, interaction: input.interaction });
    await this.db.prepare(`UPDATE questions SET question_type = ?, prompt_json = ?, configuration_json = ?, points = ?,
      time_limit_seconds = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ? AND EXISTS
      (SELECT 1 FROM quiz_questions WHERE resource_id = ? AND question_id = questions.id)`)
      .bind(input.type, JSON.stringify(input.prompt), configuration, input.points, input.timeLimitSeconds, input.questionId, input.tenantId, input.resourceId).run();
    return (await this.list(input.tenantId, input.resourceId)).find((question) => question.id === input.questionId) ?? null;
  }

  async delete(tenantId: string, resourceId: string, questionId: string): Promise<boolean> {
    const result = await this.db.prepare(`DELETE FROM questions WHERE id = ? AND tenant_id = ? AND EXISTS
      (SELECT 1 FROM quiz_questions WHERE resource_id = ? AND question_id = questions.id)`)
      .bind(questionId, tenantId, resourceId).run();
    return Number((result.meta as { changes?: number }).changes ?? 0) > 0;
  }
}
