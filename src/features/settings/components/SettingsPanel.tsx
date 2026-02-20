import { useState, useRef } from 'react';
import { Eye, EyeOff, RotateCcw, Wand2, Upload } from 'lucide-react';
import { Input, Button } from '@/components/ui';
import { PromptGeneratorModal } from './PromptGeneratorModal';
import type { SettingDefinition } from '@/types';

type PromptType = 'transcription' | 'evaluation' | 'extraction';

interface SettingsPanelProps {
  settings: SettingDefinition[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onReset?: (key: string) => void;
}

export function SettingsPanel({ settings, values, onChange, onReset }: SettingsPanelProps) {
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [generatorModal, setGeneratorModal] = useState<{
    isOpen: boolean;
    promptType: PromptType;
    settingKey: string;
  } | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const getValue = (key: string): unknown => {
    const parts = key.split('.');
    let value: unknown = values;
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return value;
  };

  // Map setting keys to prompt types
  const getPromptType = (key: string): PromptType | null => {
    if (key.includes('transcription')) return 'transcription';
    if (key.includes('evaluation')) return 'evaluation';
    if (key.includes('extraction')) return 'extraction';
    return null;
  };

  const handleOpenGenerator = (key: string) => {
    const promptType = getPromptType(key);
    if (promptType) {
      setGeneratorModal({ isOpen: true, promptType, settingKey: key });
    }
  };

  const handleGeneratedPrompt = (prompt: string) => {
    if (generatorModal) {
      onChange(generatorModal.settingKey, prompt);
    }
  };

  const handleCloseGenerator = () => {
    setGeneratorModal(null);
  };

  const handleFileUpload = (key: string, file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      onChange(key, content);
    };
    reader.readAsText(file);
  };

  // Check if setting should be visible based on dependencies
  const shouldShowSetting = (setting: SettingDefinition): boolean => {
    if (!setting.dependsOn) return true;
    const dependencyValue = getValue(setting.dependsOn.key);
    return dependencyValue === setting.dependsOn.value;
  };

  const renderSetting = (setting: SettingDefinition) => {
    const value = getValue(setting.key);

    switch (setting.type) {
      case 'select':
        return (
          <select
            value={String(value ?? setting.defaultValue)}
            onChange={(e) => {
              // Coerce value to number if defaultValue is a number
              const newValue = typeof setting.defaultValue === 'number'
                ? Number(e.target.value)
                : e.target.value;
              onChange(setting.key, newValue);
            }}
            className="h-9 w-full rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[14px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50"
          >
            {setting.options?.map((option) => (
              <option key={String(option.value)} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );

      case 'password': {
        const isVisible = showPasswords[setting.key];
        return (
          <div className="relative">
            <Input
              type={isVisible ? 'text' : 'password'}
              value={String(value ?? '')}
              onChange={(e) => onChange(setting.key, e.target.value)}
              placeholder="Enter API key"
              className="pr-10"
            />
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
              onClick={() => setShowPasswords((prev) => ({ ...prev, [setting.key]: !isVisible }))}
            >
              {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        );
      }

      case 'text':
        return (
          <Input
            type="text"
            value={String(value ?? '')}
            onChange={(e) => onChange(setting.key, e.target.value)}
          />
        );

      case 'number':
        return (
          <Input
            type="number"
            value={value !== undefined ? Number(value) : Number(setting.defaultValue)}
            onChange={(e) => onChange(setting.key, Number(e.target.value))}
            min={setting.validation?.min}
            max={setting.validation?.max}
          />
        );

      case 'toggle':
        return (
          <button
            type="button"
            onClick={() => onChange(setting.key, !value)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)] ${value ? 'bg-[var(--color-brand-primary)]' : 'bg-[var(--color-neutral-300)]'
              }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--color-neutral-0)] shadow ring-0 transition duration-200 ease-in-out ${value ? 'translate-x-5' : 'translate-x-0'
                }`}
            />
          </button>
        );

      case 'textarea': {
        const currentValue = String(value ?? setting.defaultValue ?? '');
        const isDefault = currentValue === setting.defaultValue;
        const promptType = getPromptType(setting.key);
        return (
          <div className="space-y-2">
            <textarea
              value={currentValue}
              onChange={(e) => onChange(setting.key, e.target.value)}
              rows={8}
              className="w-full rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 font-mono text-[13px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-y"
            />
            <div className="flex items-center gap-2">
              {promptType && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenGenerator(setting.key)}
                  className="text-[var(--text-brand)] hover:text-[var(--text-brand)] hover:bg-[var(--border-brand)]/10"
                  title="Generate prompt with AI"
                >
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                  Generate with AI
                </Button>
              )}
              {onReset && !isDefault && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onReset(setting.key)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Reset to default
                </Button>
              )}
            </div>
          </div>
        );
      }

      case 'file': {
        const fileName = value ? 'File uploaded' : 'No file selected';
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                ref={(el) => { fileInputRefs.current[setting.key] = el; }}
                type="file"
                accept=".json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleFileUpload(setting.key, file);
                  }
                }}
                className="hidden"
              />
              <Button
                variant="secondary"
                onClick={() => fileInputRefs.current[setting.key]?.click()}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                Choose File
              </Button>
              <span className="text-[13px] text-[var(--text-muted)]">{fileName}</span>
            </div>
            {value ? (
              <div className="rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                <p className="text-[11px] font-mono text-[var(--text-muted)] truncate">
                  {String(value).substring(0, 100)}...
                </p>
              </div>
            ) : null}
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <>
      <div className="space-y-6">
        {settings.filter(shouldShowSetting).map((setting) => (
          <div key={setting.key}>
            <label className="mb-1.5 block text-[13px] font-medium text-[var(--text-primary)]">
              {setting.label}
              {setting.validation?.required && <span className="text-[var(--color-error)]"> *</span>}
            </label>
            {setting.description && (
              <p className="mb-2 text-[12px] text-[var(--text-muted)]">{setting.description}</p>
            )}
            {renderSetting(setting)}
          </div>
        ))}
      </div>

      {/* Prompt Generator Modal */}
      {generatorModal && (
        <PromptGeneratorModal
          isOpen={generatorModal.isOpen}
          onClose={handleCloseGenerator}
          promptType={generatorModal.promptType}
          onGenerated={handleGeneratedPrompt}
        />
      )}
    </>
  );
}
