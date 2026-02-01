import { type ReactNode, useState } from 'react';
import { cn } from '@/utils';

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  onChange?: (tabId: string) => void;
  className?: string;
  /** When true, tabs fill available height and content scrolls internally */
  fillHeight?: boolean;
}

export function Tabs({ tabs, defaultTab, onChange, className, fillHeight }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    onChange?.(tabId);
  };

  return (
    <div className={cn(fillHeight && 'flex flex-col h-full min-h-0', className)}>
      <div className="flex border-b border-[var(--border-subtle)] shrink-0 bg-[var(--bg-primary)]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={cn(
              'px-4 py-2 text-[13px] font-medium transition-colors',
              activeTab === tab.id
                ? 'border-b-2 border-[var(--color-brand-primary)] text-[var(--text-brand)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Keep all tabs mounted but hide inactive ones to preserve state */}
      <div className={cn('pt-4', fillHeight && 'flex-1 min-h-0 overflow-hidden')}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              activeTab !== tab.id && 'hidden',
              fillHeight && activeTab === tab.id && 'h-full overflow-y-auto'
            )}
          >
            {tab.content}
          </div>
        ))}
      </div>
    </div>
  );
}
