import { useState } from 'react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { Code, FileJson } from 'lucide-react';
import { TEMPLATE_VARIABLES } from '@/services/templates/variableRegistry';
import { extractApiVariablePaths, getPathDepth, isObjectPath } from '@/services/templates/apiVariableExtractor';
import type { Listing } from '@/types';

interface VariablePickerProps {
  listing: Listing;
  onInsert: (variable: string) => void;
}

export function VariablePicker({ listing, onInsert }: VariablePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  // Registry variables (always available)
  const registryVars = Object.values(TEMPLATE_VARIABLES);
  
  // API variables (only if sourceType is 'api' and apiResponse exists)
  const apiVars = listing.sourceType === 'api' && listing.apiResponse
    ? extractApiVariablePaths(listing.apiResponse as unknown as Record<string, unknown>)
    : [];
  
  const handleInsert = (variable: string) => {
    onInsert(variable);
    setIsOpen(false);
  };
  
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" className="h-8 text-xs">
          <Code className="h-3.5 w-3.5 mr-1.5" />
          Insert Variable
        </Button>
      </PopoverTrigger>
      
      <PopoverContent className="w-[480px] p-0" align="end" side="bottom">
        <div className="max-h-[500px] overflow-y-auto">
          {/* Registry Variables */}
          <div className="p-3 border-b">
            <h4 className="font-semibold text-xs mb-2 text-muted-foreground uppercase tracking-wide">Template Variables</h4>
            <div className="space-y-0.5">
              {registryVars.map(v => (
                <button
                  key={v.key}
                  onClick={() => handleInsert(v.key)}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-muted text-xs transition-colors"
                >
                  <div className="font-mono text-xs text-primary font-medium">{v.key}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{v.description}</div>
                </button>
              ))}
            </div>
          </div>
          
          {/* API Variables (hierarchical display) */}
          {apiVars.length > 0 && (
            <div className="p-3">
              <h4 className="font-semibold text-xs mb-1.5 text-muted-foreground uppercase tracking-wide">API Response Data</h4>
              <p className="text-[10px] text-muted-foreground mb-2">
                Click to insert. Parent objects insert full JSON.
              </p>
              <div className="space-y-0.5">
                {apiVars.map(path => {
                  const depth = getPathDepth(path);
                  const isObject = isObjectPath(path, apiVars);
                  const parts = path.split('.');
                  const name = parts[parts.length - 1];
                  
                  return (
                    <button
                      key={path}
                      onClick={() => handleInsert(`{{${path}}}`)}
                      className="w-full text-left px-2.5 py-1 rounded hover:bg-muted text-xs group transition-colors"
                      style={{ paddingLeft: `${10 + depth * 16}px` }}
                    >
                      <div className="flex items-center gap-1.5">
                        {isObject && <FileJson className="h-3 w-3 text-blue-500 shrink-0" />}
                        <div className="font-mono text-[11px] text-primary group-hover:text-blue-600 font-medium">
                          {name}
                          {isObject && <span className="text-muted-foreground ml-1 font-normal">{`{...}`}</span>}
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground ml-4 truncate opacity-60">
                        {`{{${path}}}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
