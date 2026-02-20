/**
 * Adversarial Config API — typed endpoints for managing adversarial evaluation config.
 *
 * The BE route returns raw snake_case JSON (not CamelORMModel), so we
 * convert both directions: snake→camel on read, camel→snake on write.
 */
import { apiRequest } from './client';

export interface AdversarialCategory {
    id: string;
    label: string;
    description: string;
    weight: number;
    enabled: boolean;
}

export interface AdversarialRule {
    ruleId: string;
    section: string;
    ruleText: string;
    categories: string[];
}

export interface AdversarialConfig {
    version: number;
    categories: AdversarialCategory[];
    rules: AdversarialRule[];
}

// ─── Snake/Camel Conversion ──────────────────────────────────────

interface SnakeRule {
    rule_id: string;
    section: string;
    rule_text: string;
    categories: string[];
}

interface SnakeConfig {
    version: number;
    categories: AdversarialCategory[];  // category fields have no underscores
    rules: SnakeRule[];
}

function fromSnake(raw: SnakeConfig): AdversarialConfig {
    return {
        version: raw.version,
        categories: raw.categories,
        rules: raw.rules.map((r) => ({
            ruleId: r.rule_id,
            section: r.section,
            ruleText: r.rule_text,
            categories: r.categories,
        })),
    };
}

function toSnake(config: AdversarialConfig): SnakeConfig {
    return {
        version: config.version,
        categories: config.categories,
        rules: config.rules.map((r) => ({
            rule_id: r.ruleId,
            section: r.section,
            rule_text: r.ruleText,
            categories: r.categories,
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
