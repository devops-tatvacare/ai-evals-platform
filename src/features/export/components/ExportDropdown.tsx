import { useState, useMemo } from 'react';
import { Download, ChevronDown, FileJson, FileText, FileType, CheckCircle } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { exporterRegistry, downloadBlob, type Exporter } from '@/services/export';
import type { Listing } from '@/types';
import { cn } from '@/utils';

interface ExportDropdownProps {
  listing: Listing;
  className?: string;
}

export function ExportDropdown({ listing, className }: ExportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [lastExported, setLastExported] = useState<string | null>(null);
  
  const exporters = useMemo(() => exporterRegistry.getAll(), []);

  const getIconForExporter = (exporter: Exporter) => {
    switch (exporter.id) {
      case 'json':
      case 'corrections-json':
        return <FileJson className="h-4 w-4" />;
      case 'csv':
        return <FileText className="h-4 w-4" />;
      case 'pdf':
        return <FileType className="h-4 w-4" />;
      default:
        return <Download className="h-4 w-4" />;
    }
  };

  const handleExport = async (exporter: Exporter) => {
    setIsExporting(exporter.id);
    
    try {
      const blob = await exporter.export({
        listing,
        exportedAt: new Date(),
      });
      
      const safeTitle = listing.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const filename = `${safeTitle}_${exporter.id}.${exporter.extension}`;
      
      downloadBlob(blob, filename);
      setLastExported(exporter.id);
      setTimeout(() => setLastExported(null), 2000);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(null);
      setIsOpen(false);
    }
  };

  return (
    <div className={cn('relative', className)}>
      <Button
        variant="secondary"
        onClick={() => setIsOpen(!isOpen)}
        className="gap-2"
      >
        <Download className="h-4 w-4" />
        Export
        <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
      </Button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown */}
          <Card className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden p-0 shadow-lg">
            <div className="p-2">
              <p className="px-2 pb-2 text-[12px] font-medium text-[var(--text-muted)]">
                Export Format
              </p>
              {exporters.map((exporter) => (
                <button
                  key={exporter.id}
                  onClick={() => handleExport(exporter)}
                  disabled={isExporting !== null}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[13px]',
                    'text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)]',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    'transition-colors'
                  )}
                >
                  <span className="text-[var(--text-secondary)]">
                    {getIconForExporter(exporter)}
                  </span>
                  <span className="flex-1">{exporter.name}</span>
                  {isExporting === exporter.id && (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-brand-primary)] border-t-transparent" />
                  )}
                  {lastExported === exporter.id && (
                    <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />
                  )}
                </button>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
