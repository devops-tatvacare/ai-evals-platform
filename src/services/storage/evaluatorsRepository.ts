import { db } from './db';
import type { EvaluatorDefinition } from '@/types';

export class EvaluatorsRepository {
  async save(evaluator: EvaluatorDefinition): Promise<void> {
    const existing = await this.getById(evaluator.id);
    
    if (existing) {
      // Update
      await db.entities
        .where('type').equals('evaluator')
        .and(e => e.key === evaluator.id)
        .modify({ data: evaluator as unknown as Record<string, unknown> });
    } else {
      // Create
      await db.entities.add({
        appId: evaluator.appId,
        type: 'evaluator',
        key: evaluator.id,
        version: null,
        data: evaluator as unknown as Record<string, unknown>,
      });
    }
  }

  async getById(id: string): Promise<EvaluatorDefinition | undefined> {
    const entity = await db.entities
      .where('type').equals('evaluator')
      .and(e => e.key === id)
      .first();
    
    return entity ? (entity.data as unknown as EvaluatorDefinition) : undefined;
  }

  async getByAppId(appId: string): Promise<EvaluatorDefinition[]> {
    const entities = await db.entities
      .where('type').equals('evaluator')
      .and(e => e.appId === appId)
      .toArray();
    
    return entities.map(e => e.data as unknown as EvaluatorDefinition);
  }

  async delete(id: string): Promise<void> {
    await db.entities
      .where('type').equals('evaluator')
      .and(e => e.key === id)
      .delete();
  }
}

export const evaluatorsRepository = new EvaluatorsRepository();
