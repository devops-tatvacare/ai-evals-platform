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

  /**
   * Get evaluators visible for a specific listing.
   * Returns ONLY evaluators owned by this listing - strict scoping.
   */
  async getForListing(appId: string, listingId: string): Promise<EvaluatorDefinition[]> {
    const allForApp = await this.getByAppId(appId);
    
    // STRICT: Only evaluators explicitly owned by this listing
    return allForApp.filter(e => e.listingId === listingId);
  }

  /**
   * Get all global evaluators for the registry picker
   */
  async getRegistry(appId: string): Promise<EvaluatorDefinition[]> {
    const allForApp = await this.getByAppId(appId);
    return allForApp.filter(e => e.isGlobal === true);
  }

  /**
   * Fork an evaluator to a new listing (creates independent copy)
   */
  async fork(sourceId: string, targetListingId: string): Promise<EvaluatorDefinition> {
    const source = await this.getById(sourceId);
    if (!source) throw new Error('Source evaluator not found');
    
    const forked: EvaluatorDefinition = {
      ...source,
      id: crypto.randomUUID(),
      listingId: targetListingId,
      isGlobal: false,
      forkedFrom: source.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await this.save(forked);
    return forked;
  }

  /**
   * Toggle global/registry status of an evaluator
   */
  async setGlobal(id: string, isGlobal: boolean): Promise<void> {
    const evaluator = await this.getById(id);
    if (!evaluator) return;
    
    const updated: EvaluatorDefinition = {
      ...evaluator,
      isGlobal,
      updatedAt: new Date(),
    };
    
    await this.save(updated);
  }

  async delete(id: string): Promise<void> {
    await db.entities
      .where('type').equals('evaluator')
      .and(e => e.key === id)
      .delete();
  }
}

export const evaluatorsRepository = new EvaluatorsRepository();
