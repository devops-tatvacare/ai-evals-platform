import { useState, useMemo, useCallback } from 'react';
import { Search, FileJson, Copy, Check, ChevronsUpDown, ChevronRight } from 'lucide-react';
import { Input, Button } from '@/components/ui';
import { EnhancedJsonViewer } from './EnhancedJsonViewer';
import type { Listing } from '@/types';

interface OutputTabProps {
  listing: Listing;
}

export function OutputTab({ listing }: OutputTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [copied, setCopied] = useState(false);
  const [expandAll, setExpandAll] = useState<boolean | null>(null); // null = default behavior
  const [currentPath, setCurrentPath] = useState<string[]>([]);

  const apiResponse = listing.apiResponse;

  const jsonString = useMemo(() => {
    if (!apiResponse) return '';
    return JSON.stringify(apiResponse, null, 2);
  }, [apiResponse]);

  const matchCount = useMemo(() => {
    if (!searchTerm || !jsonString) return 0;
    const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return (jsonString.match(regex) || []).length;
  }, [jsonString, searchTerm]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExpandAll = useCallback(() => {
    setExpandAll(true);
  }, []);

  const handleCollapseAll = useCallback(() => {
    setExpandAll(false);
  }, []);

  const handlePathChange = useCallback((path: string[]) => {
    setCurrentPath(path);
  }, []);

  // Zero state
  if (!apiResponse) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-12 h-12 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center mb-4">
          <FileJson className="h-6 w-6 text-[var(--text-tertiary)]" />
        </div>
        <p className="text-sm text-[var(--text-secondary)] max-w-sm">
          No API response yet. Click "Fetch from API" to see the structured output.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search in JSON..."
            className="pl-9"
          />
        </div>
        {searchTerm && (
          <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
            {matchCount} match{matchCount !== 1 ? 'es' : ''}
          </span>
        )}
        
        {/* Expand/Collapse buttons */}
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={handleExpandAll}
          title="Expand All"
        >
          <ChevronsUpDown className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={handleCollapseAll}
          title="Collapse All"
        >
          <ChevronsUpDown className="h-4 w-4 rotate-90" />
        </Button>
        
        {/* Copy */}
        <Button variant="ghost" size="sm" onClick={handleCopy} title="Copy JSON">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>

      {/* Path breadcrumb */}
      {currentPath.length > 0 && (
        <div className="flex items-center gap-1 text-xs text-[var(--text-muted)] overflow-x-auto">
          <span className="text-[var(--text-secondary)]">root</span>
          {currentPath.map((segment, idx) => (
            <span key={idx} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              <span className="text-[var(--text-secondary)]">{segment}</span>
            </span>
          ))}
        </div>
      )}

      {/* JSON viewer */}
      <div className="bg-[var(--bg-secondary)] rounded-lg overflow-auto max-h-[600px]">
        <EnhancedJsonViewer 
          data={apiResponse} 
          searchTerm={searchTerm}
          expandAll={expandAll}
          onPathChange={handlePathChange}
        />
      </div>
    </div>
  );
}
