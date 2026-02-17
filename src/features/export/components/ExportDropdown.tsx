import { useState, useMemo } from 'react';
import { Download, FileJson, FileText, FileType } from 'lucide-react';
import { SplitButton } from '@/components/ui';
import { exporterRegistry, downloadBlob, type Exporter } from '@/services/export';
import type { Listing, AIEvaluation, HumanEvaluation } from '@/types';

interface ExportDropdownProps {
  listing: Listing;
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  aiEval?: AIEvaluation | null;
  humanEval?: HumanEvaluation | null;
}

export function ExportDropdown({ listing, className, size = 'md', disabled = false, aiEval, humanEval }: ExportDropdownProps) {
  const [isExporting, setIsExporting] = useState<string | null>(null);
  
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
        aiEval,
        humanEval,
      });
      
      const safeTitle = listing.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const filename = `${safeTitle}_${exporter.id}.${exporter.extension}`;
      
      downloadBlob(blob, filename);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(null);
    }
  };

  // Use the first exporter as the primary action
  const primaryExporter = exporters[0];
  const dropdownExporters = exporters.slice(1);

  if (!primaryExporter) {
    return null;
  }

  return (
    <SplitButton
      className={className}
      primaryLabel="Export"
      primaryIcon={<Download className="h-4 w-4" />}
      primaryAction={() => handleExport(primaryExporter)}
      isLoading={isExporting === primaryExporter.id}
      disabled={disabled || isExporting !== null}
      variant="secondary"
      size={size}
      dropdownItems={dropdownExporters.map((exporter) => ({
        label: exporter.name,
        icon: getIconForExporter(exporter),
        action: () => handleExport(exporter),
        disabled: disabled || isExporting !== null,
      }))}
    />
  );
}
