import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { cn } from '@/utils';
import type { ArrayItemSchema, ArrayItemProperty, ArrayItemType } from '@/types';

interface ArrayItemConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (schema: ArrayItemSchema) => void;
  initialSchema?: ArrayItemSchema;
  fieldName: string;
}

export function ArrayItemConfigModal({
  isOpen,
  onClose,
  onSave,
  initialSchema,
  fieldName,
}: ArrayItemConfigModalProps) {
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
  const [itemType, setItemType] = useState<ArrayItemType>('string');
  const [properties, setProperties] = useState<ArrayItemProperty[]>([]);

  useEffect(() => {
    if (isOpen && initialSchema) {
      setItemType(initialSchema.itemType);
      setProperties(initialSchema.properties || []);
    } else if (isOpen && !initialSchema) {
      // Default to object with empty properties for new configs
      setItemType('object');
      setProperties([]);
    }
  }, [isOpen, initialSchema]);

  const addProperty = () => {
    setProperties([
      ...properties,
      { key: '', type: 'string', description: '' },
    ]);
  };

  const updateProperty = (index: number, updates: Partial<ArrayItemProperty>) => {
    const newProperties = [...properties];
    newProperties[index] = { ...newProperties[index], ...updates };
    setProperties(newProperties);
  };

  const removeProperty = (index: number) => {
    setProperties(properties.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const schema: ArrayItemSchema = {
      itemType,
      properties: itemType === 'object' ? properties : undefined,
    };
    onSave(schema);
    onClose();
  };

  const handleItemTypeChange = (newType: ArrayItemType) => {
    setItemType(newType);
    // Clear properties if switching from object to simple type
    if (newType !== 'object') {
      setProperties([]);
    }
  };

  const isValid =
    itemType !== 'object' ||
    (properties.length > 0 && properties.every((p) => p.key.trim()));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex">
      {/* Backdrop */}
      <div 
        className={cn(
          "absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
      />
      
      {/* Slide-in panel */}
      <div 
        className={cn(
          "ml-auto relative z-10 h-full w-[700px] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden",
          "flex flex-col",
          "transform transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Configure Array Items
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {fieldName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-[6px] p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-6">
            {/* Item Type Selection */}
            <div>
              <label className="text-sm font-medium text-[var(--text-primary)] mb-2 block">
                Each item in this array is:
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleItemTypeChange('object')}
                  className={cn(
                    'p-3 rounded-lg border-2 text-left transition-all',
                    itemType === 'object'
                      ? 'border-[var(--color-brand-accent)] bg-[var(--color-brand-accent)]/10'
                      : 'border-[var(--border-default)] hover:border-[var(--border-focus)]'
                  )}
                >
                  <div className="font-medium text-sm text-[var(--text-primary)]">An Object</div>
                  <div className="text-xs text-[var(--text-muted)] mt-1">
                    With properties defined below
                  </div>
                </button>
                
                <div className="space-y-2">
                  {(['string', 'number', 'boolean'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => handleItemTypeChange(type)}
                      className={cn(
                        'w-full px-3 py-2 rounded-lg border text-left text-sm transition-all',
                        itemType === type
                          ? 'border-[var(--color-brand-accent)] bg-[var(--color-brand-accent)]/10 text-[var(--text-primary)]'
                          : 'border-[var(--border-default)] hover:border-[var(--border-focus)] text-[var(--text-muted)]'
                      )}
                    >
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Object Properties Configuration */}
            {itemType === 'object' && (
              <div className="border border-[var(--border-default)] rounded-lg p-4 bg-[var(--bg-surface)]">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-[var(--text-primary)]">
                    Object Properties
                  </label>
                  <Button variant="secondary" size="sm" onClick={addProperty}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add Property
                  </Button>
                </div>

                {properties.length === 0 ? (
                  <div className="text-center py-6 border border-dashed border-[var(--border-default)] rounded-lg">
                    <p className="text-sm text-[var(--text-muted)] mb-2">
                      No properties defined yet
                    </p>
                    <Button variant="secondary" size="sm" onClick={addProperty}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add First Property
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {properties.map((property, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-[2fr_1fr_3fr_auto] gap-2 items-start p-2 bg-[var(--bg-primary)] rounded-lg border border-[var(--border-subtle)]"
                      >
                        <div>
                          <label className="text-[9px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
                            Key
                          </label>
                          <Input
                            value={property.key}
                            onChange={(e) => updateProperty(index, { key: e.target.value })}
                            placeholder="entity"
                            className="h-7 text-xs"
                          />
                        </div>

                        <div>
                          <label className="text-[9px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
                            Type
                          </label>
                          <select
                            value={property.type}
                            onChange={(e) =>
                              updateProperty(index, {
                                type: e.target.value as 'string' | 'number' | 'boolean',
                              })
                            }
                            className={cn(
                              'h-7 w-full text-xs border rounded px-2',
                              'bg-[var(--bg-surface)] text-[var(--text-primary)]',
                              'border-[var(--border-default)]'
                            )}
                          >
                            <option value="string">String</option>
                            <option value="number">Number</option>
                            <option value="boolean">Boolean</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-[9px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
                            Description
                          </label>
                          <Input
                            value={property.description}
                            onChange={(e) => updateProperty(index, { description: e.target.value })}
                            placeholder="What this property represents"
                            className="h-7 text-xs"
                          />
                        </div>

                        <div className="pt-5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeProperty(index)}
                            className="h-7 w-7 p-0"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-[var(--color-error)]" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-xs text-[var(--text-muted)] mt-3">
                  Define the structure of each object in the array. All properties are required in the output.
                </p>
              </div>
            )}

            {/* Info Box for Simple Types */}
            {itemType !== 'object' && (
              <div className="p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)]">
                <p className="text-xs text-[var(--text-muted)]">
                  The LLM will return an array of <strong>{itemType}</strong> values.
                  Example: <code className="px-1 py-0.5 bg-[var(--bg-primary)] rounded font-mono text-[10px]">
                    [{itemType === 'string' ? '"value1", "value2"' : itemType === 'number' ? '1, 2, 3' : 'true, false, true'}]
                  </code>
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Fixed Footer */}
        <div className="shrink-0 flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border-subtle)]">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!isValid}>
            Save Configuration
          </Button>
        </div>
      </div>
    </div>
  );
}
