import { useState, useEffect, useCallback } from 'react';
import { Download, Upload, RotateCcw, AlertCircle, Check, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui';
import { useToast } from '@/hooks';
import {
    adversarialConfigApi,
    type AdversarialConfig,
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

    useEffect(() => { loadConfig(); }, [loadConfig]);

    const handleSaveJson = async () => {
        try {
            const parsed = JSON.parse(jsonText) as AdversarialConfig;
            setSaving(true);
            const saved = await adversarialConfigApi.save(parsed);
            setConfig(saved);
            setJsonText(JSON.stringify(saved, null, 2));
            setJsonError('');
            setEditMode(false);
            toast.success('Config saved');
        } catch (err) {
            const msg = err instanceof SyntaxError ? 'Invalid JSON' : String(err);
            setJsonError(msg);
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async () => {
        if (!confirm('Reset to built-in defaults?')) return;
        setSaving(true);
        try {
            const cfg = await adversarialConfigApi.reset();
            setConfig(cfg);
            setJsonText(JSON.stringify(cfg, null, 2));
            setEditMode(false);
            toast.success('Reset to defaults');
        } catch { toast.error('Reset failed'); }
        finally { setSaving(false); }
    };

    const handleExport = () => {
        if (!config) return;
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'adversarial-config.json';
        a.click();
    };

    const handleImport = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const parsed = JSON.parse(await file.text()) as AdversarialConfig;
                setSaving(true);
                const saved = await adversarialConfigApi.importConfig(parsed);
                setConfig(saved);
                setJsonText(JSON.stringify(saved, null, 2));
                setEditMode(false);
                toast.success('Imported');
            } catch (err) { toast.error(`Import failed: ${err}`); }
            finally { setSaving(false); }
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
            {/* Categories */}
            <Card>
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-3">
                    Categories
                    <span className="ml-1.5 font-normal text-[var(--text-muted)]">
                        {config?.categories.filter((c) => c.enabled).length}/{config?.categories.length}
                    </span>
                </h3>
                <table className="w-full text-[12px]">
                    <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                            <th className="text-left pb-1.5 font-medium">ID</th>
                            <th className="text-left pb-1.5 font-medium">Description</th>
                            <th className="text-center pb-1.5 font-medium w-16">Weight</th>
                            <th className="text-center pb-1.5 font-medium w-16">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {config?.categories.map((cat) => (
                            <tr key={cat.id} className={`border-b border-[var(--border-subtle)]/50 ${!cat.enabled ? 'opacity-40' : ''}`}>
                                <td className="py-2 pr-3 font-mono text-[var(--text-brand)] whitespace-nowrap">{cat.id}</td>
                                <td className="py-2 pr-3 text-[var(--text-secondary)] leading-relaxed">{cat.description}</td>
                                <td className="py-2 text-center text-[var(--text-muted)]">{cat.weight}</td>
                                <td className="py-2 text-center">
                                    <span className={`inline-block h-2 w-2 rounded-full ${cat.enabled ? 'bg-emerald-500' : 'bg-[var(--text-muted)]'}`} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Card>

            {/* Rules */}
            <Card>
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-3">
                    Rules
                    <span className="ml-1.5 font-normal text-[var(--text-muted)]">{config?.rules.length}</span>
                </h3>
                <div className="space-y-2.5">
                    {config?.rules.map((rule) => (
                        <div key={rule.ruleId} className="text-[12px]">
                            <div className="flex items-baseline gap-2 mb-0.5">
                                <code className="text-[11px] font-mono text-[var(--text-brand)] shrink-0">{rule.ruleId}</code>
                                <span className="text-[10px] text-[var(--text-muted)]">{rule.section}</span>
                            </div>
                            <p className="text-[var(--text-secondary)] leading-relaxed mb-1">{rule.ruleText}</p>
                            <div className="flex flex-wrap gap-1">
                                {rule.categories.map((catId) => (
                                    <span key={catId} className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                                        {catId}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </Card>

            {/* JSON Editor */}
            <Card>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                        {editMode ? 'Edit JSON' : 'Raw JSON'}
                    </h3>
                    <div className="flex items-center gap-1">
                        {!editMode ? (
                            <>
                                <button onClick={() => setEditMode(true)} className="px-2 py-1 rounded text-[11px] text-[var(--text-brand)] hover:bg-[var(--bg-tertiary)]">Edit</button>
                                <button onClick={handleExport} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)]" title="Export"><Download className="h-3.5 w-3.5 text-[var(--text-muted)]" /></button>
                                <button onClick={handleImport} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)]" title="Import"><Upload className="h-3.5 w-3.5 text-[var(--text-muted)]" /></button>
                                <button onClick={handleReset} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)]" title="Reset"><RotateCcw className="h-3.5 w-3.5 text-[var(--text-muted)]" /></button>
                            </>
                        ) : (
                            <>
                                <button onClick={handleSaveJson} disabled={saving} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[var(--color-brand-accent)] text-white disabled:opacity-50">
                                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
                                </button>
                                <button onClick={() => { setEditMode(false); if (config) setJsonText(JSON.stringify(config, null, 2)); setJsonError(''); }} className="px-2 py-1 rounded text-[11px] text-[var(--text-muted)]">Cancel</button>
                            </>
                        )}
                    </div>
                </div>
                {jsonError && (
                    <div className="flex items-center gap-1.5 mb-2 text-[11px] text-red-400">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" /><span>{jsonError}</span>
                    </div>
                )}
                <textarea
                    value={jsonText}
                    onChange={(e) => { setJsonText(e.target.value); setJsonError(''); }}
                    readOnly={!editMode}
                    className={`w-full rounded-[6px] border font-mono text-[11px] leading-relaxed p-3 resize-y ${editMode ? 'border-[var(--border-input)] bg-[var(--bg-primary)] text-[var(--text-primary)]' : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] cursor-default'
                        } focus:outline-none focus:ring-1 focus:ring-[var(--interactive-primary)]`}
                    rows={14}
                    spellCheck={false}
                />
            </Card>
        </div>
    );
}
