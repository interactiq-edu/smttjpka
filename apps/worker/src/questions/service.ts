import type { LearningQuestion } from '@interactiq/contracts';
import { AuthError } from '../auth/service';
import { ResourceRepository } from '../resources/repository';
import { parseQuestionInput } from './registry';
import { QuestionRepository } from './repository';

export class QuestionService {
  constructor(private readonly resources: ResourceRepository, private readonly questions: QuestionRepository) {}

  async list(tenantId: string, resourceId: string): Promise<LearningQuestion[]> {
    await this.requireQuiz(tenantId, resourceId);
    return this.questions.list(tenantId, resourceId);
  }

  async create(tenantId: string, userId: string, resourceId: string, body: unknown): Promise<LearningQuestion> {
    await this.requireQuiz(tenantId, resourceId);
    const input = parseQuestionInput(body);
    return this.questions.create({
      tenantId,
      userId,
      resourceId,
      type: input.type,
      prompt: input.prompt,
      options: input.options ?? [],
      acceptedAnswers: input.acceptedAnswers ?? [],
      interaction: input.interaction ?? null,
      points: input.points ?? 1,
      timeLimitSeconds: input.timeLimitSeconds ?? null,
    });
  }

  async update(tenantId: string, resourceId: string, questionId: string, body: unknown): Promise<LearningQuestion> {
    await this.requireQuiz(tenantId, resourceId);
    const input = parseQuestionInput(body);
    const question = await this.questions.update({ tenantId, resourceId, questionId, type: input.type, prompt: input.prompt,
      options: input.options ?? [], acceptedAnswers: input.acceptedAnswers ?? [], interaction: input.interaction ?? null, points: input.points ?? 1,
      timeLimitSeconds: input.timeLimitSeconds ?? null });
    if (!question) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested question does not exist.');
    return question;
  }

  async delete(tenantId: string, resourceId: string, questionId: string): Promise<void> {
    await this.requireQuiz(tenantId, resourceId);
    if (!await this.questions.delete(tenantId, resourceId, questionId)) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested question does not exist.');
  }

  private async requireQuiz(tenantId: string, resourceId: string): Promise<void> {
    const resource = await this.resources.findById(tenantId, resourceId);
    if (!resource || !['QUIZ', 'ASSESSMENT', 'PRESENTATION', 'INTERACTIVE_VIDEO'].includes(resource.type)) throw new AuthError(404, 'VALIDATION_ERROR', 'The requested quiz-enabled resource does not exist.');
  }
}
