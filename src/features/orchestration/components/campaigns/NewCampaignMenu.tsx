import { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { PAGE_METADATA } from '@/config/pageMetadata';
import { cn } from '@/utils';

export type CampaignKind = 'workflow' | 'dataset' | 'cohort';

interface Props {
  onCreate: (kind: CampaignKind) => void;
  disabled?: boolean;
}

// Icons + labels mirror the platform page registry so the menu reads
// identical to the sidebar / page header icons for the same objects.
const ITEMS: Array<{ kind: CampaignKind; label: string; pageType: 'campaigns' | 'datasets' | 'cohorts' }> = [
  { kind: 'workflow', label: 'Workflow', pageType: 'campaigns' },
  { kind: 'dataset', label: 'Dataset', pageType: 'datasets' },
  { kind: 'cohort', label: 'Cohort', pageType: 'cohorts' },
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
        {ITEMS.map((it) => {
          const Icon = PAGE_METADATA[it.pageType].icon;
          return (
            <button
              key={it.kind}
              type="button"
              onClick={() => {
                setOpen(false);
                onCreate(it.kind);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)]',
                'hover:bg-[var(--bg-tertiary)] focus:bg-[var(--bg-tertiary)] focus:outline-none',
              )}
            >
              <Icon className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden />
              {it.label}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
