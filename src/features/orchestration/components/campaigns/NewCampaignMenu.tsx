import { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { cn } from '@/utils';

export type CampaignKind = 'workflow' | 'dataset' | 'cohort';

interface Props {
  onCreate: (kind: CampaignKind) => void;
  disabled?: boolean;
}

const ITEMS: Array<{ kind: CampaignKind; label: string }> = [
  { kind: 'workflow', label: 'Workflow' },
  { kind: 'dataset', label: 'Dataset' },
  { kind: 'cohort', label: 'Cohort' },
];

export function NewCampaignMenu({ onCreate, disabled }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button disabled={disabled} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="min-w-[160px] p-1"
      >
        {ITEMS.map((it) => (
          <button
            key={it.kind}
            type="button"
            onClick={() => {
              setOpen(false);
              onCreate(it.kind);
            }}
            className={cn(
              'w-full rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)]',
              'hover:bg-[var(--bg-tertiary)] focus:bg-[var(--bg-tertiary)] focus:outline-none',
            )}
          >
            {it.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
