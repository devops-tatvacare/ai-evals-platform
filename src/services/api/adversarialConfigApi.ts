/**
 * Adversarial Config API — typed endpoints for managing adversarial evaluation config.
 *
 * v3 Goal Framework: Goals, Traits, Rules (no Categories).
 * The BE route returns raw snake_case JSON, so we convert both directions.
 */
import { apiRequest } from './client';

export interface AdversarialGoal {
    id: string;
    label: string;
    description: string;
    completionCriteria: string[];
    notCompletion: string[];
    agentBehavior: string;
    signalPatterns: string[];
    enabled: boolean;
}

export interface AdversarialTrait {
    id: string;
    label: string;
    description: string;
    enabled: boolean;
}

export interface AdversarialRule {
    ruleId: string;
    section: string;
    ruleText: string;
    goalIds: string[];
}

export interface AdversarialConfig {
    version: number;
    goals: AdversarialGoal[];
    traits: AdversarialTrait[];
    rules: AdversarialRule[];
}

// ─── Snake/Camel Conversion ──────────────────────────────────────

interface SnakeGoal {
    id: string;
    label: string;
    description: string;
    completion_criteria: string[];
    not_completion: string[];
    agent_behavior: string;
    signal_patterns: string[];
    enabled: boolean;
}

interface SnakeRule {
    rule_id: string;
    section: string;
    rule_text: string;
    goal_ids: string[];
}

interface SnakeConfig {
    version: number;
    goals: SnakeGoal[];
    traits: AdversarialTrait[];  // trait fields have no multi-word keys
    rules: SnakeRule[];
}

function fromSnake(raw: SnakeConfig): AdversarialConfig {
    return {
        version: raw.version,
        goals: (raw.goals || []).map((g) => ({
            id: g.id,
            label: g.label,
            description: g.description,
            completionCriteria: g.completion_criteria || [],
            notCompletion: g.not_completion || [],
            agentBehavior: g.agent_behavior || '',
            signalPatterns: g.signal_patterns || [],
            enabled: g.enabled ?? true,
        })),
        traits: raw.traits || [],
        rules: (raw.rules || []).map((r) => ({
            ruleId: r.rule_id,
            section: r.section,
            ruleText: r.rule_text,
            goalIds: r.goal_ids || [],
        })),
    };
}

function toSnake(config: AdversarialConfig): SnakeConfig {
    return {
        version: config.version,
        goals: config.goals.map((g) => ({
            id: g.id,
            label: g.label,
            description: g.description,
            completion_criteria: g.completionCriteria,
            not_completion: g.notCompletion,
            agent_behavior: g.agentBehavior,
            signal_patterns: g.signalPatterns,
            enabled: g.enabled,
        })),
        traits: config.traits,
        rules: config.rules.map((r) => ({
            rule_id: r.ruleId,
            section: r.section,
            rule_text: r.ruleText,
            goal_ids: r.goalIds,
        })),
    };
}

// ─── API Client ──────────────────────────────────────────────────

export const adversarialConfigApi = {
    async get(): Promise<AdversarialConfig> {
        const raw = await apiRequest<SnakeConfig>('/api/adversarial-config');
        return fromSnake(raw);
    },

    async save(config: AdversarialConfig): Promise<AdversarialConfig> {
        const raw = await apiRequest<SnakeConfig>('/api/adversarial-config', {
            method: 'PUT',
            body: JSON.stringify(toSnake(config)),
        });
        return fromSnake(raw);
    },

    async reset(): Promise<AdversarialConfig> {
        const raw = await apiRequest<SnakeConfig>('/api/adversarial-config/reset', {
            method: 'POST',
        });
        return fromSnake(raw);
    },

    async exportConfig(): Promise<AdversarialConfig> {
        const raw = await apiRequest<SnakeConfig>('/api/adversarial-config/export');
        return fromSnake(raw);
    },

    async importConfig(config: AdversarialConfig): Promise<AdversarialConfig> {
        const raw = await apiRequest<SnakeConfig>('/api/adversarial-config/import', {
            method: 'POST',
            body: JSON.stringify(toSnake(config)),
        });
        return fromSnake(raw);
    },
};
