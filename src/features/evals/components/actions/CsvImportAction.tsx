import { useState } from 'react';
import { Upload } from 'lucide-react';

import { Button } from '@/components/ui';
import { EvaluatorCSVImport } from '@/features/insideSalesEval';
import type { PageActionComponentProps } from '@/features/pageActions/registry';

export function CsvImportAction({ displayMode = 'button' }: PageActionComponentProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {displayMode === 'icon' ? (
        <Button
          variant="secondary"
          size="sm"
          icon={Upload}
          iconOnly
          onClick={() => setOpen(true)}
          aria-label="Import CSV"
          title="Import CSV"
        />
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)} icon={Upload}>
          Import CSV
        </Button>
      )}
      <EvaluatorCSVImport isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
