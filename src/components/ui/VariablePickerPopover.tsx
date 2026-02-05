import { useState, useRef } from 'react';
import { Code, Search } from 'lucide-react';
import { Button, Popover, PopoverTrigger, PopoverContent } from '@/components/ui';
import { TEMPLATE_VARIABLES, getAvailableVariables } from '@/services/templates/variableRegistry';
import { extractApiVariablePaths } from '@/services/templates/apiVariableExtractor';
import { cn } from '@/utils';
import type { Listing, PromptType } from '@/types';

interface VariablePickerPopoverProps {
  listing: Listing;
  onInsert: (variable: string) => void;
  promptType?: PromptType;
  buttonLabel?: string;
  className?: string;
}

export function VariablePickerPopover({ 
  listing, 
  onInsert, 
  promptType,
  buttonLabel = 'Variables',
  className,
}: VariablePickerPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  
  // Registry variables - filter by promptType if provided
  const registryVars = promptType 
    ? getAvailableVariables(promptType, listing.sourceType)
    : Object.values(TEMPLATE_VARIABLES);
  
  // API variables (only if sourceType is 'api' and apiResponse exists)
  const apiVars = listing.sourceType === 'api' && listing.apiResponse
    ? extractApiVariablePaths(listing.apiResponse as unknown as Record<string, unknown>)
    : [];
  
  // Filter by search
  const filteredRegistry = registryVars.filter(v => 
    !search || 
    v.key.toLowerCase().includes(search.toLowerCase()) ||
    v.description.toLowerCase().includes(search.toLowerCase())
  );
  
  const filteredApi = apiVars.filter((path: string) => 
    !search || path.toLowerCase().includes(search.toLowerCase())
  );
  
  const handleInsert = (variable: string) => {
    onInsert(variable);
    setIsOpen(false);
    setSearch('');
  };
  
  return (
    <Popover open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (!open) setSearch('');
    }}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" className={cn("h-8 text-xs", className)}>
          <Code className="h-3.5 w-3.5 mr-1.5" />
          {buttonLabel}
        </Button>
      </PopoverTrigger>
      
      <PopoverContent 
        className="w-[420px] p-0 bg-[var(--bg-primary)] border-[var(--border-default)] shadow-xl" 
        align="start"
      >
        {/* Search */}
        <div className="p-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search variables..."
              className={cn(
                "w-full h-8 pl-9 pr-3 text-xs rounded-md",
                "bg-[var(--bg-surface)] text-[var(--text-primary)]",
                "border border-[var(--border-default)]",
                "placeholder:text-[var(--text-muted)]",
                "focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/20"
              )}
              autoFocus
            />
          </div>
        </div>
        
        <div className="max-h-96 overflow-y-auto">
          {/* Registry Variables */}
          <div className="p-3">
            <h4 className="text-xs font-semibold mb-2 text-[var(--text-secondary)] uppercase tracking-wide">
              Template Variables
            </h4>
            {filteredRegistry.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] py-2">No variables found</p>
            ) : (
              <div className="space-y-1">
                {filteredRegistry.map(v => (
                  <button
                    key={v.key}
                    onClick={() => handleInsert(v.key)}
                    className={cn(
                      "w-full text-left px-2 py-1.5 rounded text-xs transition-colors",
                      "hover:bg-[var(--interactive-secondary)]"
                    )}
                  >
                    <div className="font-mono font-medium text-[var(--color-brand-accent)]">{v.key}</div>
                    <div className="text-[var(--text-muted)] text-[11px] mt-0.5">{v.description}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          
          {/* API Variables */}
          {apiVars.length > 0 && (
            <div className="p-3 pt-2 border-t border-[var(--border-subtle)]">
              <h4 className="text-xs font-semibold mb-2 text-[var(--text-secondary)] uppercase tracking-wide">
                API Response Data
              </h4>
              {filteredApi.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] py-2">No API variables found</p>
              ) : (
                <div className="space-y-0.5">
                  {filteredApi.slice(0, 50).map((path: string) => (
                    <button
                      key={path}
                      onClick={() => handleInsert(`{{${path}}}`)}
                      className={cn(
                        "w-full text-left px-2 py-1 rounded text-xs transition-colors font-mono",
                        "hover:bg-[var(--interactive-secondary)]",
                        "text-[var(--text-primary)]"
                      )}
                    >
                      {`{{${path}}}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
