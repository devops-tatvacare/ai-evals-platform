import { useState, useMemo } from 'react';
import { Search, FileJson, Copy, Check } from 'lucide-react';
import { Input, Button } from '@/components/ui';
import type { Listing } from '@/types';

interface OutputTabProps {
  listing: Listing;
}

export function OutputTab({ listing }: OutputTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [copied, setCopied] = useState(false);

  const apiResponse = listing.apiResponse;

  // Filter/highlight based on search
  const jsonString = useMemo(() => {
    if (!apiResponse) return '';
    return JSON.stringify(apiResponse, null, 2);
  }, [apiResponse]);

  const highlightedJson = useMemo(() => {
    if (!searchTerm || !jsonString) return jsonString;
    
    // Simple highlight - wrap matches in <mark>
    const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return jsonString.replace(regex, '<mark class="bg-yellow-200 dark:bg-yellow-800">$1</mark>');
  }, [jsonString, searchTerm]);

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

  // Zero state
  if (!apiResponse) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-12 h-12 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center mb-4">
          <FileJson className="h-6 w-6 text-[var(--text-tertiary)]" />
        </div>
        <p className="text-sm text-[var(--text-secondary)] max-w-sm">
          No API response yet. Fetch from API to see the output.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex items-center gap-2">
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
          <span className="text-xs text-[var(--text-secondary)]">
            {matchCount} match{matchCount !== 1 ? 'es' : ''}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={handleCopy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>

      {/* JSON viewer */}
      <div className="bg-[var(--bg-secondary)] rounded-lg p-4 overflow-auto max-h-[600px]">
        <pre
          className="text-xs font-mono text-[var(--text-primary)]"
          dangerouslySetInnerHTML={{ __html: highlightedJson }}
        />
      </div>
    </div>
  );
}
