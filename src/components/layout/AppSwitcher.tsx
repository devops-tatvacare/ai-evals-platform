import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import { APPS, type AppId } from '@/types';
import { cn } from '@/utils';
import { routes } from '@/config/routes';

interface AppConfig {
  id: AppId;
  name: string;
  icon: string;
  route: string;
}

const apps: AppConfig[] = [
  {
    id: 'voice-rx',
    name: APPS['voice-rx'].name,
    icon: APPS['voice-rx'].icon,
    route: routes.voiceRx.dashboard,
  },
  {
    id: 'kaira-bot',
    name: APPS['kaira-bot'].name,
    icon: APPS['kaira-bot'].icon,
    route: routes.kaira.dashboard,
  },
];

export function AppSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { currentApp, setCurrentApp } = useAppStore();

  const currentAppConfig = apps.find((app) => app.id === currentApp) ?? apps[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectApp = (app: AppConfig) => {
    setCurrentApp(app.id);
    setIsOpen(false);
    navigate(app.route);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
          'hover:bg-[var(--interactive-secondary)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] focus-visible:ring-offset-1',
          isOpen && 'bg-[var(--interactive-secondary)]'
        )}
      >
        <img
          src={currentAppConfig.icon}
          alt={currentAppConfig.name}
          className="h-6 w-6 rounded object-cover"
        />
        <span className="text-base font-semibold text-[var(--text-primary)]">
          {currentAppConfig.name}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-[var(--text-muted)] transition-transform',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] py-1 shadow-lg">
          {apps.map((app) => (
            <button
              key={app.id}
              onClick={() => handleSelectApp(app)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors',
                'hover:bg-[var(--interactive-secondary)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]',
                app.id === currentApp && 'bg-[var(--color-brand-accent)]/10'
              )}
            >
              <img
                src={app.icon}
                alt={app.name}
                className="h-5 w-5 rounded object-cover"
              />
              <span className="flex-1 font-medium text-[var(--text-primary)]">
                {app.name}
              </span>
              {app.id === currentApp && (
                <Check className="h-4 w-4 text-[var(--text-brand)]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
