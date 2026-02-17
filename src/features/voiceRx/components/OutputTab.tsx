import { useState, useMemo, useCallback } from 'react';
import { Search, FileJson, Copy, Check, Maximize2, Minimize2, ChevronRight } from 'lucide-react';
import { Input, Button, EmptyState } from '@/components/ui';
import { EnhancedJsonViewer } from './EnhancedJsonViewer';
import type { Listing } from '@/types';

interface OutputTabProps {
  listing: Listing;
}

export function OutputTab({ listing }: OutputTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
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

  const toggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  const handlePathChange = useCallback((path: string[]) => {
    setCurrentPath(path);
  }, []);

  // Zero state
  if (!apiResponse) {
    return (
      <div className="flex-1 min-h-full flex items-center justify-center">
        <EmptyState
          icon={FileJson}
          title="No API response yet"
          description='Click "Fetch from API" to see the structured output.'
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="flex-1">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search in JSON..."
            icon={<Search className="h-4 w-4" />}
          />
        </div>
        {searchTerm && (
          <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
            {matchCount} match{matchCount !== 1 ? 'es' : ''}
          </span>
        )}
        
        {/* Toggle Expand/Collapse */}
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={toggleExpanded}
          title={isExpanded ? 'Collapse All' : 'Expand All'}
        >
          {isExpanded ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
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
          expandAll={isExpanded}
          onPathChange={handlePathChange}
        />
      </div>
    </div>
  );
}
