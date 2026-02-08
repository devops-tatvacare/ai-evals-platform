import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, Sparkles, Settings } from 'lucide-react';
import { Input, Button, VariablePickerPopover } from '@/components/ui';
import { ModelSelector } from '@/features/settings/components/ModelSelector';
import { ArrayItemConfigModal } from './ArrayItemConfigModal';
import { useSettingsStore } from '@/stores';
import { cn } from '@/utils';
import { DEFAULT_MODEL } from '@/constants';
import type { Listing, EvaluatorDefinition, EvaluatorOutputField, EvaluatorFieldType, ArrayItemSchema } from '@/types';

interface CreateEvaluatorOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (evaluator: EvaluatorDefinition) => void;
  listing: Listing;
  editEvaluator?: EvaluatorDefinition;
}

export function CreateEvaluatorOverlay({ 
  isOpen, 
  onClose, 
  onSave, 
  listing,
  editEvaluator 
}: CreateEvaluatorOverlayProps) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState(DEFAULT_MODEL);
  const [outputFields, setOutputFields] = useState<EvaluatorOutputField[]>([]);
  const [arrayConfigModal, setArrayConfigModal] = useState<{ isOpen: boolean; fieldIndex: number | null }>({
    isOpen: false,
    fieldIndex: null,
  });
  
  const apiKey = useSettingsStore((state) => state.llm.apiKey);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Handle escape key
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, handleEscape]);
  
  // Reset form when modal opens or editEvaluator changes
  useEffect(() => {
    if (isOpen) {
      setName(editEvaluator?.name || '');
      setPrompt(editEvaluator?.prompt || '');
      setModelId(editEvaluator?.modelId || DEFAULT_MODEL);
      setOutputFields(editEvaluator?.outputSchema || []);
    }
  }, [isOpen, editEvaluator]);
  
  const handleInsertVariable = (variable: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setPrompt(prev => `${prev}${variable}`);
      return;
    }
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const newText = text.substring(0, start) + variable + text.substring(end);
    setPrompt(newText);
    
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + variable.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };
  
  const addField = () => {
    const newField: EvaluatorOutputField = {
      key: '',
      type: 'text',
      description: '',
      displayMode: 'card',
      isMainMetric: false,
    };
    setOutputFields([...outputFields, newField]);
  };
  
  const updateField = (index: number, updates: Partial<EvaluatorOutputField>) => {
    const newFields = [...outputFields];
    newFields[index] = { ...newFields[index], ...updates };
    
    // Ensure only one main metric
    if (updates.displayMode === 'header' && updates.isMainMetric) {
      newFields.forEach((f, i) => {
        if (i !== index) f.isMainMetric = false;
      });
    }
    
    setOutputFields(newFields);
  };
  
  const removeField = (index: number) => {
    setOutputFields(outputFields.filter((_, i) => i !== index));
  };
  
  const openArrayConfig = (fieldIndex: number) => {
    setArrayConfigModal({ isOpen: true, fieldIndex });
  };
  
  const handleArrayConfigSave = (schema: ArrayItemSchema) => {
    if (arrayConfigModal.fieldIndex !== null) {
      updateField(arrayConfigModal.fieldIndex, { arrayItemSchema: schema });
    }
  };
  
  const handleSave = () => {
    const evaluator: EvaluatorDefinition = {
      id: editEvaluator?.id || crypto.randomUUID(),
      name,
      prompt,
      modelId,
      outputSchema: outputFields,
      appId: listing.appId,
      listingId: editEvaluator?.listingId ?? listing.id,
      isGlobal: editEvaluator?.isGlobal ?? false,
      forkedFrom: editEvaluator?.forkedFrom,
      createdAt: editEvaluator?.createdAt || new Date(),
      updatedAt: new Date(),
    };
    
    onSave(evaluator);
    onClose();
  };
  
  const isValid = name.trim() && prompt.trim() && outputFields.length > 0;
  const charCount = prompt.length;

  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop - not clickable */}
      <div 
        className={cn(
          "absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0"
        )}
      />
      
      {/* Slide-in panel */}
      <div 
        className={cn(
          "ml-auto relative z-10 h-full w-[1000px] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden",
          "flex flex-col",
          "transform transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {editEvaluator ? 'Edit Evaluator' : 'Create New Evaluator'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-[6px] p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Compact Header: Name + Model */}
          <div className="grid grid-cols-[1fr_320px] gap-4 items-end pb-4 border-b border-[var(--border-subtle)]">
            <div>
              <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                Evaluator Name
              </label>
              <p className="text-[12px] text-[var(--text-muted)] mb-2">
                Give your evaluator a descriptive name
              </p>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Factual Integrity Check"
              />
            </div>
            <div>
              <ModelSelector
                apiKey={apiKey}
                selectedModel={modelId}
                onChange={setModelId}
              />
            </div>
          </div>
          
          <div className="py-4 space-y-6">
            {/* Prompt Canvas */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-[var(--text-primary)]">
                  Prompt Template
                </label>
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span>{charCount} characters</span>
                </div>
              </div>
              
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="You are an AI evaluator. Analyze the following:&#10;&#10;Transcript: {{transcript}}&#10;&#10;Task: Evaluate the quality and provide a score from 0-10."
                className={cn(
                  "w-full h-64 border rounded-lg p-3 font-mono text-xs resize-none",
                  "bg-[var(--bg-surface)] text-[var(--text-primary)]",
                  "border-[var(--border-default)]",
                  "focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/20",
                  "placeholder:text-[var(--text-muted)]"
                )}
              />
              
              {/* Action Buttons */}
              <div className="flex gap-2 mt-2">
                <VariablePickerPopover
                  listing={listing}
                  onInsert={handleInsertVariable}
                />
              </div>
              
              <p className="text-xs text-[var(--text-muted)] mt-2">
                Use variables like <code className="px-1 py-0.5 bg-[var(--bg-secondary)] rounded font-mono text-[10px]">{'{{transcript}}'}</code> to reference data from your listing.
              </p>
            </div>
            
            {/* Output Schema */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Output Schema</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Define what structured data the LLM should return
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={addField}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Field
                </Button>
              </div>
              
              {outputFields.length === 0 ? (
                <div className="border border-dashed border-[var(--border-default)] rounded-lg p-8 text-center">
                  <p className="text-sm text-[var(--text-muted)] mb-3">
                    No output fields defined yet
                  </p>
                  <Button variant="secondary" size="sm" onClick={addField}>
                    <Plus className="h-4 w-4 mr-1.5" />
                    Add Your First Field
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {outputFields.map((field, index) => (
                    <div
                      key={index}
                      className={cn(
                        "border rounded-lg p-3 transition-colors",
                        "border-[var(--border-default)]",
                        "bg-[var(--bg-surface)]",
                        field.isMainMetric && "border-[var(--color-brand-accent)] bg-[var(--color-brand-accent)]/5"
                      )}
                    >
                      <div className="grid grid-cols-12 gap-3">
                        {/* Key */}
                        <div className="col-span-3">
                          <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
                            Key Name
                          </label>
                          <Input
                            value={field.key}
                            onChange={(e) => updateField(index, { key: e.target.value })}
                            placeholder="score"
                            className="h-8 text-xs"
                          />
                        </div>
                        
                        {/* Type */}
                        <div className="col-span-2">
                          <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
                            Type
                          </label>
                          <select
                            value={field.type}
                            onChange={(e) => updateField(index, { type: e.target.value as EvaluatorFieldType })}
                            className={cn(
                              "h-8 w-full text-xs border rounded px-2",
                              "bg-[var(--bg-surface)] text-[var(--text-primary)]",
                              "border-[var(--border-default)]"
                            )}
                          >
                            <option value="number">Number</option>
                            <option value="text">Text</option>
                            <option value="boolean">Boolean</option>
                            <option value="array">Array</option>
                          </select>
                        </div>
                        
                        {/* Description */}
                        <div className="col-span-5">
                          <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
                            Description
                          </label>
                          <Input
                            value={field.description}
                            onChange={(e) => updateField(index, { description: e.target.value })}
                            placeholder="What this field represents"
                            className="h-8 text-xs"
                          />
                        </div>
                        
                        {/* Display Mode */}
                        <div className="col-span-2 flex items-end gap-1">
                          <div className="flex-1">
                            <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
                              Display
                            </label>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => updateField(index, { displayMode: 'header', isMainMetric: true })}
                                className={cn(
                                  "flex-1 h-8 px-2 text-[10px] font-medium rounded transition-colors",
                                  "border border-[var(--border-default)]",
                                  field.displayMode === 'header'
                                    ? "bg-[var(--color-brand-accent)] text-white"
                                    : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)]"
                                )}
                                title="Show in header (main metric)"
                              >
                                H
                              </button>
                              <button
                                type="button"
                                onClick={() => updateField(index, { displayMode: 'card', isMainMetric: false })}
                                className={cn(
                                  "flex-1 h-8 px-2 text-[10px] font-medium rounded transition-colors",
                                  "border border-[var(--border-default)]",
                                  field.displayMode === 'card'
                                    ? "bg-[var(--color-brand-accent)] text-white"
                                    : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)]"
                                )}
                                title="Show in card body"
                              >
                                C
                              </button>
                              <button
                                type="button"
                                onClick={() => updateField(index, { displayMode: 'hidden', isMainMetric: false })}
                                className={cn(
                                  "flex-1 h-8 px-2 text-[10px] font-medium rounded transition-colors",
                                  "border border-[var(--border-default)]",
                                  field.displayMode === 'hidden'
                                    ? "bg-[var(--color-brand-accent)] text-white"
                                    : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)]"
                                )}
                                title="Hidden (computed only)"
                              >
                                X
                              </button>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeField(index)}
                            className="h-8 w-8 p-0"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-[var(--color-error)]" />
                          </Button>
                        </div>
                      </div>
                      
                      {/* RYG Thresholds for Number type */}
                      {field.type === 'number' && (
                        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                              Thresholds (Optional)
                            </label>
                            <span className="text-[9px] text-[var(--text-muted)]">
                              🔴 Red &lt; Yellow &lt; 🟢 Green
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[9px] text-emerald-600 font-medium mb-1 block">
                                Green ≥
                              </label>
                              <Input
                                type="number"
                                value={field.thresholds?.green ?? ''}
                                onChange={(e) => updateField(index, { 
                                  thresholds: { 
                                    ...field.thresholds,
                                    green: parseFloat(e.target.value) || 0,
                                    yellow: field.thresholds?.yellow ?? 0
                                  } 
                                })}
                                placeholder="80"
                                className="h-7 text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-[9px] text-yellow-600 font-medium mb-1 block">
                                Yellow ≥
                              </label>
                              <Input
                                type="number"
                                value={field.thresholds?.yellow ?? ''}
                                onChange={(e) => updateField(index, { 
                                  thresholds: { 
                                    green: field.thresholds?.green ?? 0,
                                    yellow: parseFloat(e.target.value) || 0
                                  } 
                                })}
                                placeholder="50"
                                className="h-7 text-xs"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Array Configuration */}
                      {field.type === 'array' && (
                        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
                                Array Items
                              </label>
                              {field.arrayItemSchema ? (
                                <p className="text-xs text-[var(--text-primary)]">
                                  {field.arrayItemSchema.itemType === 'object' 
                                    ? `Object (${field.arrayItemSchema.properties?.length || 0} properties)`
                                    : field.arrayItemSchema.itemType.charAt(0).toUpperCase() + field.arrayItemSchema.itemType.slice(1)
                                  }
                                </p>
                              ) : (
                                <p className="text-xs text-[var(--text-muted)] italic">
                                  Not configured (defaults to string array)
                                </p>
                              )}
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => openArrayConfig(index)}
                              className="h-7"
                            >
                              <Settings className="h-3.5 w-3.5 mr-1" />
                              Configure
                            </Button>
                          </div>
                        </div>
                      )}
                      
                      {field.isMainMetric && (
                        <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
                          <p className="text-[10px] text-[var(--color-brand-accent)] font-medium">
                            ⭐ Main Metric - Will be prominently displayed
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              <p className="text-xs text-[var(--text-muted)] mt-2">
                <strong>Display modes:</strong> H=Header (main metric), C=Card body, X=Hidden
              </p>
            </div>
          </div>
        </div>
        
        {/* Fixed Footer */}
        <div className="shrink-0 flex justify-end gap-2 px-6 py-4 border-t border-[var(--border-subtle)]">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            <Sparkles className="h-4 w-4 mr-1.5" />
            {editEvaluator ? 'Update' : 'Save'} Evaluator
          </Button>
        </div>
      </div>
      
      {/* Array Configuration Modal */}
      {arrayConfigModal.fieldIndex !== null && (
        <ArrayItemConfigModal
          isOpen={arrayConfigModal.isOpen}
          onClose={() => setArrayConfigModal({ isOpen: false, fieldIndex: null })}
          onSave={handleArrayConfigSave}
          initialSchema={outputFields[arrayConfigModal.fieldIndex]?.arrayItemSchema}
          fieldName={outputFields[arrayConfigModal.fieldIndex]?.key || 'Array Field'}
        />
      )}
    </div>
  );
}
