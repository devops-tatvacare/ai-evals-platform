import { useState, useCallback, useEffect, useMemo } from 'react';
import { Plus, Trash2, Check, FileJson, ChevronDown, ChevronRight, Eye, Pencil, CircleCheck } from 'lucide-react';
import { Card, Button, EmptyState } from '@/components/ui';
import { useCurrentSchemas, useCurrentAppId } from '@/hooks';
import { useLLMSettingsStore } from '@/stores';
import { useSchemasStore } from '@/stores/schemasStore';
import { schemasRepository } from '@/services/storage';
import { SchemaCreateOverlay } from './SchemaCreateOverlay';
import { ReadOnlyViewOverlay } from './ReadOnlyViewOverlay';
import { DeleteSchemaModal } from './DeleteSchemaModal';
import { JsonViewer } from '@/features/structured-outputs/components/JsonViewer';
import type { SchemaDefinition } from '@/types';

type PromptType = 'transcription' | 'evaluation' | 'extraction';

const PROMPT_TYPES: PromptType[] = ['transcription', 'evaluation', 'extraction'];

const PROMPT_TYPE_LABELS: Record<PromptType, string> = {
  transcription: 'Transcription Schemas',
  evaluation: 'Evaluation Schemas',
  extraction: 'Extraction Schemas',
};

export function SchemasTab() {
  const appId = useCurrentAppId();
  const schemas = useCurrentSchemas();
  const deleteSchemaAction = useSchemasStore((state) => state.deleteSchema);
  const loadSchemasAction = useSchemasStore((state) => state.loadSchemas);
  const activeSchemaIds = useLLMSettingsStore((state) => state.activeSchemaIds);
  const setActiveSchemaId = useLLMSettingsStore((state) => state.setActiveSchemaId);
  const save = useLLMSettingsStore((state) => state.save);
  
  // Unified modal state
  const [showSchemaModal, setShowSchemaModal] = useState(false);
  const [schemaModalType, setSchemaModalType] = useState<PromptType>('transcription');
  const [schemaModalInitial, setSchemaModalInitial] = useState<SchemaDefinition | null>(null);
  
  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [schemaToDelete, setSchemaToDelete] = useState<SchemaDefinition | null>(null);
  const [deleteDependencies, setDeleteDependencies] = useState<{ count: number; listings: string[] }>({ count: 0, listings: [] });
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Collapsible section state - collapsed by default
  const [collapsedSections, setCollapsedSections] = useState<Record<PromptType, boolean>>({
    transcription: true,
    evaluation: true,
    extraction: true,
  });
  
  // Expanded schema rows for inline preview
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());
  
  // Full view modal state
  const [viewingSchema, setViewingSchema] = useState<SchemaDefinition | null>(null);
  
  // Loading state for Set Active button
  const [activatingSchema, setActivatingSchema] = useState<string | null>(null);

  // Load schemas on mount ONLY
  useEffect(() => {
    loadSchemasAction(appId);
  }, [appId, loadSchemasAction]);

  // Auto-activate built-in default schemas if no schemas are active yet
  useEffect(() => {
    if (schemas.length === 0) return;

    const needsInitialization = (
      activeSchemaIds.transcription === null ||
      activeSchemaIds.evaluation === null ||
      activeSchemaIds.extraction === null
    );

    if (!needsInitialization) return;

    // Find built-in defaults and activate them
    const builtInDefaults: Record<PromptType, SchemaDefinition | undefined> = {
      transcription: schemas.find(s => s.promptType === 'transcription' && s.isDefault),
      evaluation: schemas.find(s => s.promptType === 'evaluation' && s.isDefault),
      extraction: schemas.find(s => s.promptType === 'extraction' && s.isDefault),
    };

    let hasChanges = false;

    (['transcription', 'evaluation', 'extraction'] as PromptType[]).forEach(type => {
      if (!activeSchemaIds[type] && builtInDefaults[type]) {
        setActiveSchemaId(type, builtInDefaults[type]!.id);
        hasChanges = true;
      }
    });

    if (hasChanges) {
      save().catch(err => console.error('[SchemasTab] Failed to save auto-activated schemas:', err));
    }
  }, [schemas, activeSchemaIds, setActiveSchemaId, save]);

  // Group schemas by type, then sub-group by sourceType
  const schemasByType = useMemo(() => {
    const grouped: Record<PromptType, SchemaDefinition[]> = {
      transcription: [],
      evaluation: [],
      extraction: [],
    };
    schemas.forEach((schema) => {
      if (schema.promptType in grouped) {
        grouped[schema.promptType as PromptType].push(schema);
      }
    });
    return grouped;
  }, [schemas]);

  // Sub-group by sourceType for display
  const getFlowGroups = useCallback((typeSchemas: SchemaDefinition[]) => {
    const upload = typeSchemas.filter(s => s.sourceType === 'upload');
    const api = typeSchemas.filter(s => s.sourceType === 'api');
    const untagged = typeSchemas.filter(s => !s.sourceType);
    const groups: { label: string; badge: string; schemas: SchemaDefinition[] }[] = [];
    if (upload.length > 0) groups.push({ label: 'Upload Flow', badge: 'Upload', schemas: upload });
    if (api.length > 0) groups.push({ label: 'API Flow', badge: 'API', schemas: api });
    if (untagged.length > 0) groups.push({ label: 'Custom (Any Flow)', badge: 'Custom', schemas: untagged });
    return groups;
  }, []);

  const handleSetDefault = useCallback(async (type: PromptType, schemaId: string) => {
    setActivatingSchema(schemaId);

    // Add small delay for visual feedback
    await new Promise(resolve => setTimeout(resolve, 300));

    setActiveSchemaId(type, schemaId);
    await save();

    setActivatingSchema(null);
  }, [setActiveSchemaId, save]);

  const handleDeleteClick = useCallback(async (schema: SchemaDefinition) => {
    const deps = await schemasRepository.checkDependencies(appId, schema.id);
    setSchemaToDelete(schema);
    setDeleteDependencies(deps);
    setShowDeleteModal(true);
  }, [appId]);

  const handleConfirmDelete = useCallback(async () => {
    if (!schemaToDelete) return;
    
    setIsDeleting(true);
    try {
      await deleteSchemaAction(appId, schemaToDelete.id);
      
      // Clear default if this was the default
      const type = schemaToDelete.promptType as PromptType;
      if (activeSchemaIds[type] === schemaToDelete.id) {
        setActiveSchemaId(type, null);
        await save();
      }
      
      setShowDeleteModal(false);
      setSchemaToDelete(null);
    } catch (err) {
      console.error('Failed to delete schema:', err);
    } finally {
      setIsDeleting(false);
    }
  }, [schemaToDelete, deleteSchemaAction, appId, activeSchemaIds, setActiveSchemaId, save]);

  const handleCreateNew = useCallback((type: PromptType) => {
    setSchemaModalType(type);
    setSchemaModalInitial(null);
    setShowSchemaModal(true);
  }, []);

  const handleEditSchema = useCallback((schema: SchemaDefinition) => {
    setSchemaModalType(schema.promptType as PromptType);
    setSchemaModalInitial(schema);
    setShowSchemaModal(true);
  }, []);

  const toggleSection = useCallback((type: PromptType) => {
    setCollapsedSections(prev => ({ ...prev, [type]: !prev[type] }));
  }, []);

  const toggleSchemaExpand = useCallback((schemaId: string) => {
    setExpandedSchemas(prev => {
      const next = new Set(prev);
      if (next.has(schemaId)) {
        next.delete(schemaId);
      } else {
        next.add(schemaId);
      }
      return next;
    });
  }, []);

  const handleViewSchema = useCallback((schema: SchemaDefinition) => {
    setViewingSchema(schema);
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[var(--text-secondary)]">
        Manage output schemas for AI responses. Schemas ensure structured, consistent JSON output from the LLM.
      </p>

      {PROMPT_TYPES.map((type) => {
        const typeSchemas = schemasByType[type];
        const isCollapsed = collapsedSections[type];
        const activeSchema = typeSchemas.find(s => activeSchemaIds[type] === s.id);
        
        return (
          <Card key={type} className="p-0" hoverable={false}>
            {/* Collapsible Section Header */}
            <button
              onClick={() => toggleSection(type)}
              className="w-full px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 flex items-center justify-between hover:bg-[var(--bg-secondary)]/70 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                )}
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {PROMPT_TYPE_LABELS[type]}
                </h3>
                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                  {typeSchemas.length}
                </span>
              </div>
              {isCollapsed && activeSchema && (
                <span className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-success)]/10 text-[var(--color-success)] font-medium">
                  <Check className="h-3 w-3" />
                  {activeSchema.name}
                </span>
              )}
            </button>
            
            {/* Collapsible Content */}
            {!isCollapsed && (
              <>
                <div className="divide-y divide-[var(--border-subtle)]">
                  {typeSchemas.length === 0 ? (
                    <div className="px-4 py-4">
                      <EmptyState
                        icon={FileJson}
                        title="No schemas yet"
                        description="Create one to get started."
                        compact
                      />
                    </div>
                  ) : (
                    getFlowGroups(typeSchemas).map((group) => (
                      <div key={group.badge}>
                        {/* Flow Group Header */}
                        <div className="px-4 py-2 bg-[var(--bg-tertiary)]/50 border-b border-[var(--border-subtle)]">
                          <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                            group.badge === 'API'
                              ? 'text-[var(--color-info)]'
                              : group.badge === 'Upload'
                                ? 'text-[var(--color-brand-primary)]'
                                : 'text-[var(--text-muted)]'
                          }`}>
                            {group.label}
                          </span>
                        </div>
                        {group.schemas.map((schema) => {
                          const isDefault = activeSchemaIds[type] === schema.id;
                          const isExpanded = expandedSchemas.has(schema.id);
                          
                          return (
                            <div key={schema.id}>
                              {/* Schema Row */}
                              <div className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-secondary)]/30">
                                {/* Expand toggle */}
                                <button
                                  onClick={() => toggleSchemaExpand(schema.id)}
                                  className="shrink-0 p-0.5 rounded hover:bg-[var(--interactive-secondary)]"
                                  title={isExpanded ? 'Collapse schema' : 'Expand schema'}
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
                                  )}
                                </button>
                                
                                <FileJson className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
                                
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[13px] text-[var(--text-primary)] truncate">
                                      {schema.name}
                                    </span>
                                    {schema.isDefault && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                                        built-in
                                      </span>
                                    )}
                                    {schema.sourceType && (
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                        schema.sourceType === 'api'
                                          ? 'bg-[var(--color-info)]/10 text-[var(--color-info)]'
                                          : 'bg-[var(--color-brand-accent)]/20 text-[var(--color-brand-primary)]'
                                      }`}>
                                        {schema.sourceType === 'api' ? 'API' : 'Upload'}
                                      </span>
                                    )}
                                    {isDefault && (
                                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-success)]/10 text-[var(--color-success)]">
                                        <Check className="h-3 w-3" />
                                        active
                                      </span>
                                    )}
                                  </div>
                                  {schema.description && (
                                    <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                                      {schema.description}
                                    </p>
                                  )}
                                </div>
                                
                                <div className="flex items-center gap-1 shrink-0 justify-end">
                                  {/* View */}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleViewSchema(schema)}
                                    className="h-7 w-7 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                    title="View full schema"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                  
                                  {/* Edit */}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleEditSchema(schema)}
                                    className="h-7 w-7 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                    title="Edit schema"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  
                                  {/* Set Active */}
                                  <div className="w-7 flex justify-center">
                                    {!isDefault && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleSetDefault(type, schema.id)}
                                        disabled={activatingSchema === schema.id}
                                        className="h-7 w-7 p-0 text-[var(--text-muted)] hover:text-[var(--color-success)]"
                                        title="Set as active schema"
                                      >
                                        <CircleCheck className={`h-3.5 w-3.5 ${activatingSchema === schema.id ? 'animate-pulse' : ''}`} />
                                      </Button>
                                    )}
                                  </div>
                                  
                                  {/* Delete */}
                                  <div className="w-7 flex justify-center">
                                    {!schema.isDefault && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDeleteClick(schema)}
                                        className="h-7 w-7 p-0 text-[var(--text-muted)] hover:text-[var(--color-error)]"
                                        title="Delete schema"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              {/* Inline Schema Preview */}
                              {isExpanded && (
                                <div className="px-4 pb-3 pt-0 ml-9">
                                  <div className="max-h-64 overflow-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                                    <JsonViewer data={schema.schema} initialExpanded={false} />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
                <div className="px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/30">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCreateNew(type)}
                    className="h-8 text-[12px] gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create New Schema
                  </Button>
                </div>
              </>
            )}
          </Card>
        );
      })}

      {/* View Schema Overlay (Read-Only) */}
      <ReadOnlyViewOverlay
        isOpen={!!viewingSchema}
        onClose={() => setViewingSchema(null)}
        title={viewingSchema?.name || 'Schema'}
        description={viewingSchema?.description}
        jsonData={viewingSchema?.schema as Record<string, unknown>}
      />

      {/* Unified Schema Overlay (Browse/Edit/Generate) */}
      <SchemaCreateOverlay
        isOpen={showSchemaModal}
        onClose={() => {
          setShowSchemaModal(false);
          loadSchemasAction(appId); // Refresh after potential changes
        }}
        promptType={schemaModalType}
        initialSchema={schemaModalInitial}
      />

      {/* Delete Confirmation Modal */}
      <DeleteSchemaModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        schema={schemaToDelete}
        dependencies={deleteDependencies}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}
