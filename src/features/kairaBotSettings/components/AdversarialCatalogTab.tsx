import { useState, useEffect, useCallback } from 'react';
import { Shield, Download, Upload, RotateCcw, AlertCircle, Check, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui';
import { useToast } from '@/hooks';
import {
    adversarialConfigApi,
    type AdversarialConfig,
    type AdversarialCategory,
    type AdversarialRule,
} from '@/services/api/adversarialConfigApi';

export function AdversarialCatalogTab() {
    const toast = useToast();
    const [config, setConfig] = useState<AdversarialConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [jsonText, setJsonText] = useState('');
    const [jsonError, setJsonError] = useState('');
    const [editMode, setEditMode] = useState(false);

    const loadConfig = useCallback(async () => {
        try {
            setLoading(true);
            const cfg = await adversarialConfigApi.get();
            setConfig(cfg);
            setJsonText(JSON.stringify(cfg, null, 2));
            setJsonError('');
        } catch (err) {
            toast.error('Failed to load adversarial config');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadConfig();
    }, [loadConfig]);

    const handleSaveJson = async () => {
        try {
            const parsed = JSON.parse(jsonText) as AdversarialConfig;
            setSaving(true);
            const saved = await adversarialConfigApi.save(parsed);
            setConfig(saved);
            setJsonText(JSON.stringify(saved, null, 2));
            setJsonError('');
            setEditMode(false);
            toast.success('Adversarial config saved');
        } catch (err) {
            const msg = err instanceof SyntaxError ? 'Invalid JSON' : String(err);
            setJsonError(msg);
            toast.error(`Save failed: ${msg}`);
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async () => {
        if (!confirm('Reset to built-in defaults? This will overwrite your current config.')) return;
        try {
            setSaving(true);
            const cfg = await adversarialConfigApi.reset();
            setConfig(cfg);
            setJsonText(JSON.stringify(cfg, null, 2));
            setJsonError('');
            setEditMode(false);
            toast.success('Config reset to defaults');
        } catch (err) {
            toast.error('Reset failed');
            console.error(err);
        } finally {
            setSaving(false);
        }
    };

    const handleExport = () => {
        if (!config) return;
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'adversarial-config.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImport = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = JSON.parse(text) as AdversarialConfig;
                setSaving(true);
                const saved = await adversarialConfigApi.importConfig(parsed);
                setConfig(saved);
                setJsonText(JSON.stringify(saved, null, 2));
                setJsonError('');
                setEditMode(false);
                toast.success('Config imported successfully');
            } catch (err) {
                toast.error(`Import failed: ${err}`);
            } finally {
                setSaving(false);
            }
        };
        input.click();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Category overview */}
            <Card>
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-[var(--text-brand)]" />
                        <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">Categories</h3>
                        <span className="text-[11px] text-[var(--text-muted)]">
                            ({config?.categories.filter((c) => c.enabled).length ?? 0} enabled)
                        </span>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {config?.categories.map((cat: AdversarialCategory) => (
                        <div
                            key={cat.id}
                            className={`px-2.5 py-1 rounded-md border text-[11px] ${cat.enabled
                                    ? 'border-[var(--color-brand-accent)]/30 bg-[var(--color-brand-accent)]/5 text-[var(--text-primary)]'
                                    : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-muted)] opacity-50'
                                }`}
                        >
                            <div className="font-medium font-mono">{cat.id}</div>
                            <div className="text-[10px] text-[var(--text-muted)] mt-0.5 max-w-[200px] truncate">
                                {cat.description}
                            </div>
                        </div>
                    ))}
                </div>
            </Card>

            {/* Rules summary */}
            <Card>
                <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-2">
                    Rules <span className="text-[var(--text-muted)] font-normal">({config?.rules.length ?? 0})</span>
                </h3>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {config?.rules.map((rule: AdversarialRule) => (
                        <div key={rule.ruleId} className="flex items-start gap-2 text-[11px] py-1">
                            <code className="text-[var(--text-brand)] font-mono shrink-0">{rule.ruleId}</code>
                            <span className="text-[var(--text-secondary)] truncate">{rule.ruleText.slice(0, 100)}...</span>
                        </div>
                    ))}
                </div>
            </Card>

            {/* JSON editor */}
            <Card>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
                        {editMode ? 'Edit Config (JSON)' : 'Config JSON'}
                    </h3>
                    <div className="flex items-center gap-2">
                        {!editMode ? (
                            <>
                                <button
                                    onClick={() => setEditMode(true)}
                                    className="px-2.5 py-1 rounded text-[11px] font-medium text-[var(--text-brand)] hover:bg-[var(--bg-tertiary)] transition-colors"
                                >
                                    Edit
                                </button>
                                <button onClick={handleExport} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors" title="Export">
                                    <Download className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                                </button>
                                <button onClick={handleImport} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors" title="Import">
                                    <Upload className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                                </button>
                                <button onClick={handleReset} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors" title="Reset to Defaults">
                                    <RotateCcw className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={handleSaveJson}
                                    disabled={saving}
                                    className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-[var(--color-brand-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                    Save
                                </button>
                                <button
                                    onClick={() => {
                                        setEditMode(false);
                                        if (config) setJsonText(JSON.stringify(config, null, 2));
                                        setJsonError('');
                                    }}
                                    className="px-2.5 py-1 rounded text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                                >
                                    Cancel
                                </button>
                            </>
                        )}
                    </div>
                </div>
                {jsonError && (
                    <div className="flex items-center gap-1.5 mb-2 text-[11px] text-red-400">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{jsonError}</span>
                    </div>
                )}
                <textarea
                    value={jsonText}
                    onChange={(e) => {
                        setJsonText(e.target.value);
                        setJsonError('');
                    }}
                    readOnly={!editMode}
                    className={`w-full rounded-[6px] border font-mono text-[11px] leading-relaxed p-3 resize-y ${editMode
                            ? 'border-[var(--border-input)] bg-[var(--bg-primary)] text-[var(--text-primary)]'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] cursor-default'
                        } focus:outline-none focus:ring-1 focus:ring-[var(--interactive-primary)]`}
                    rows={16}
                    spellCheck={false}
                />
            </Card>
        </div>
    );
}
