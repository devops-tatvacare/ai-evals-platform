# Phase 1 — Design System Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the token layer, build new standardized UI components (Select, Combobox, Pagination, FilterPills), update z-index in primitives, and consolidate report colors.

**Architecture:** New components sit alongside old ones — no consumers are migrated yet. Phase 2 handles migration. This phase is purely additive except for z-index fixes in existing UI primitives and report color consolidation.

**Tech Stack:** React 19, Radix UI (@radix-ui/react-select, @radix-ui/react-popover), Tailwind CSS v4, CSS custom properties, TypeScript strict mode.

**Spec:** `docs/plans/design-system-cleanup/spec.md`

---

### Task 1: Extend globals.css with missing tokens

**Files:**
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Add z-index scale tokens to @theme block**

Open `src/styles/globals.css`. Inside the `@theme` block (after the component tokens around line 117), add:

```css
  /* Z-index scale */
  --z-base: 1;
  --z-sticky: 10;
  --z-dropdown: 50;
  --z-overlay: 100;
  --z-modal: 200;
  --z-tooltip: 300;
  --z-max: 999;
```

- [ ] **Step 2: Add HTTP method color tokens to @theme block**

In the same `@theme` block, after the run type badge colors (around line 98), add:

```css
  /* HTTP method colors */
  --color-http-get: #10b981;
  --color-http-post: #6366f1;
  --color-http-put: #8b5cf6;
  --color-http-patch: #f59e0b;
  --color-http-delete: #ef4444;
```

- [ ] **Step 3: Add gap type color tokens**

These are used in PromptGapAnalysis and report components. Add to `@theme` block:

```css
  /* Gap type colors */
  --color-gap-underspec: #3b82f6;
  --color-gap-silent: #f59e0b;
  --color-gap-leakage: #ef4444;
  --color-gap-conflicting: #8b5cf6;
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat: extend design tokens with z-index scale, HTTP method colors, and gap type colors"
```

---

### Task 2: Build Select component on Radix

**Files:**
- Create: `src/components/ui/Select.tsx`
- Modify: `src/components/ui/index.ts`

- [ ] **Step 1: Create Select.tsx**

Create `src/components/ui/Select.tsx` with the following content. This wraps `@radix-ui/react-select` with the same API shape as `SingleSelect` but uses z-index tokens:

```tsx
import { useMemo } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/utils';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  className,
  disabled = false,
  size = 'md',
}: SelectProps) {
  const selectedOption = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  return (
    <SelectPrimitive.Root
      value={value || undefined}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        className={cn(
          'w-full rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)]',
          'flex items-center justify-between gap-2 text-left text-[var(--text-primary)]',
          size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3 text-[13px]',
          'focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        title={selectedOption?.label}
        aria-label={selectedOption?.label ?? placeholder}
      >
        <SelectPrimitive.Value
          placeholder={<span className="text-[var(--text-muted)]">{placeholder}</span>}
        />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(
            'z-[var(--z-dropdown)] overflow-hidden rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)] py-1 shadow-lg',
            'min-w-[220px] w-[var(--radix-select-trigger-width)] max-h-[280px]',
          )}
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className={cn(
                  'relative flex w-full cursor-default items-center justify-between gap-3 px-3 py-2 text-[13px] outline-none transition-colors',
                  'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)]',
                  'data-[state=checked]:bg-[var(--surface-brand-subtle)] data-[state=checked]:text-[var(--text-brand)]',
                )}
              >
                <SelectPrimitive.ItemText>
                  <span className="truncate">{option.label}</span>
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    <Check className="h-3.5 w-3.5 text-[var(--text-brand)]" />
                  </span>
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
```

- [ ] **Step 2: Add Select export to index.ts**

Add this line to `src/components/ui/index.ts` after the existing `SingleSelect` export (line 28):

```ts
export { Select, type SelectOption } from './Select';
```

- [ ] **Step 3: Verify build**

Run: `npx tsc -b && npm run build`
Expected: No errors. Both old `SingleSelect` and new `Select` coexist.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Select.tsx src/components/ui/index.ts
git commit -m "feat: add Select component on Radix with design system tokens"
```

---

### Task 3: Build Combobox component

**Files:**
- Create: `src/components/ui/Combobox.tsx`
- Modify: `src/components/ui/index.ts`

- [ ] **Step 1: Create Combobox.tsx**

Create `src/components/ui/Combobox.tsx`. This replaces both `SearchableSelect` (single + search) and `MultiSelect` (multi + search) with one component:

```tsx
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X, Check } from 'lucide-react';
import { cn } from '@/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  searchText?: string;
}

interface ComboboxBaseProps {
  options: ComboboxOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

interface SingleComboboxProps extends ComboboxBaseProps {
  multi?: false;
  value: string;
  onChange: (value: string) => void;
}

interface MultiComboboxProps extends ComboboxBaseProps {
  multi: true;
  value: string[];
  onChange: (values: string[]) => void;
}

type ComboboxProps = SingleComboboxProps | MultiComboboxProps;

export function Combobox(props: ComboboxProps) {
  const {
    options,
    placeholder = 'Select...',
    className,
    disabled = false,
    size = 'md',
    multi = false,
  } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const selectedValues: string[] = multi
    ? (props as MultiComboboxProps).value
    : (props as SingleComboboxProps).value
      ? [(props as SingleComboboxProps).value]
      : [];

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase().trim();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        o.searchText?.toLowerCase().includes(q),
    );
  }, [options, search]);

  const selectedLabel = useMemo(() => {
    if (selectedValues.length === 0) return null;
    const labels = selectedValues
      .map((v) => options.find((o) => o.value === v)?.label ?? v)
      .filter(Boolean);
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return labels.join(', ');
    return `${labels.length} selected`;
  }, [options, selectedValues]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Scroll highlighted into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-option]');
    items[highlightIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, isOpen]);

  // Reset highlight on filter change
  useEffect(() => {
    setHighlightIndex(0);
  }, [filtered.length]);

  const updatePosition = useCallback(() => {
    const trigger = containerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const pad = 8;
    const top = rect.bottom + 4;
    const width = Math.max(rect.width, 220);
    setPosition({
      left: Math.max(pad, Math.min(rect.left, window.innerWidth - width - pad)),
      top,
      width,
      maxHeight: Math.max(160, window.innerHeight - top - pad),
    });
  }, []);

  const openDropdown = useCallback(() => {
    if (disabled) return;
    setIsOpen(true);
    setSearch('');
    setHighlightIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const handleReposition = () => updatePosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen, updatePosition]);

  const handleSelect = useCallback(
    (optionValue: string) => {
      if (multi) {
        const onChange = (props as MultiComboboxProps).onChange;
        const current = (props as MultiComboboxProps).value;
        if (current.includes(optionValue)) {
          onChange(current.filter((v) => v !== optionValue));
        } else {
          onChange([...current, optionValue]);
        }
      } else {
        (props as SingleComboboxProps).onChange(optionValue);
        setIsOpen(false);
        setSearch('');
      }
    },
    [multi, props],
  );

  const handleClear = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      if (multi) {
        (props as MultiComboboxProps).onChange([]);
      } else {
        (props as SingleComboboxProps).onChange('');
      }
    },
    [multi, props],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          openDropdown();
        }
        return;
      }
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filtered[highlightIndex]) handleSelect(filtered[highlightIndex].value);
          break;
        case 'Escape':
          setIsOpen(false);
          setSearch('');
          break;
      }
    },
    [isOpen, filtered, highlightIndex, openDropdown, handleSelect],
  );

  const sizeStyles = size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3 text-[13px]';

  return (
    <div ref={containerRef} className={cn('relative', className)} onKeyDown={handleKeyDown}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : openDropdown())}
        disabled={disabled}
        className={cn(
          'w-full rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)]',
          'text-left flex items-center justify-between gap-2',
          sizeStyles,
          'focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50',
          selectedValues.length > 0 && multi && 'border-[var(--border-brand)] bg-[var(--surface-brand-subtle)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <span
          className={cn(
            'truncate',
            selectedLabel
              ? selectedValues.length > 0 && multi
                ? 'font-medium text-[var(--text-brand)]'
                : 'text-[var(--text-primary)]'
              : 'text-[var(--text-muted)]',
          )}
        >
          {selectedLabel ?? placeholder}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {selectedValues.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleClear(e);
              }}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
        </div>
      </button>

      {/* Dropdown */}
      {isOpen &&
        position &&
        createPortal(
          <div
            ref={dropdownRef}
            className={cn(
              'fixed z-[var(--z-dropdown)] rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg',
            )}
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
            }}
          >
            {/* Search */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-default)]">
              <Search className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Options */}
            <div
              ref={listRef}
              className="overflow-y-auto py-1"
              style={{ maxHeight: Math.min(position.maxHeight, 280) }}
            >
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[var(--text-muted)]">No matches found</div>
              ) : (
                filtered.map((opt, i) => {
                  const selected = selectedValues.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      data-option
                      onClick={() => handleSelect(opt.value)}
                      className={cn(
                        'w-full px-3 py-1.5 text-left text-[13px] flex items-center gap-2 transition-colors',
                        i === highlightIndex && 'bg-[var(--bg-hover)]',
                        selected && !multi && 'text-[var(--text-brand)] font-medium',
                        selected && multi &&
                          'bg-[var(--surface-brand-subtle)] text-[var(--text-brand)] hover:bg-[var(--surface-brand-hover)]',
                        !selected && 'hover:bg-[var(--bg-hover)]',
                      )}
                    >
                      {multi && (
                        <span
                          className={cn(
                            'h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center',
                            selected
                              ? 'border-[var(--interactive-primary)] bg-[var(--interactive-primary)]'
                              : 'border-[var(--border-default)]',
                          )}
                        >
                          {selected && <Check className="h-2.5 w-2.5 text-[var(--text-on-color)]" />}
                        </span>
                      )}
                      <span className="truncate">{opt.label}</span>
                      {!multi && selected && (
                        <Check className="h-3.5 w-3.5 ml-auto shrink-0 text-[var(--text-brand)]" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
```

- [ ] **Step 2: Add Combobox export to index.ts**

Add this line to `src/components/ui/index.ts` after the `Select` export:

```ts
export { Combobox, type ComboboxOption } from './Combobox';
```

- [ ] **Step 3: Verify build**

Run: `npx tsc -b && npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Combobox.tsx src/components/ui/index.ts
git commit -m "feat: add Combobox component replacing SearchableSelect and MultiSelect"
```

---

### Task 4: Build Pagination component

**Files:**
- Create: `src/components/ui/Pagination.tsx`
- Modify: `src/components/ui/index.ts`

- [ ] **Step 1: Create Pagination.tsx**

Create `src/components/ui/Pagination.tsx`:

```tsx
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Show "Showing X–Y of Z" text. Requires totalItems and pageSize. */
  showCount?: boolean;
  totalItems?: number;
  pageSize?: number;
  className?: string;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  showCount = false,
  totalItems,
  pageSize,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const showNumberedPages = totalPages <= 10;

  return (
    <div className={cn('flex items-center justify-between', className)}>
      {/* Count text */}
      {showCount && totalItems != null && pageSize != null ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          Showing {(page - 1) * pageSize + 1}&ndash;{Math.min(page * pageSize, totalItems)} of{' '}
          {totalItems}
        </p>
      ) : (
        <div />
      )}

      {/* Navigation */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {showNumberedPages ? (
          Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={cn(
                'min-w-[28px] h-7 px-1.5 text-xs font-medium rounded transition-colors',
                page === p
                  ? 'bg-[var(--interactive-primary)] text-[var(--text-on-color)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
              )}
            >
              {p}
            </button>
          ))
        ) : (
          <span className="px-2 text-[12px] text-[var(--text-secondary)]">
            {page} / {totalPages}
          </span>
        )}

        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add Pagination export to index.ts**

Add to `src/components/ui/index.ts`:

```ts
export { Pagination } from './Pagination';
```

- [ ] **Step 3: Verify build**

Run: `npx tsc -b && npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Pagination.tsx src/components/ui/index.ts
git commit -m "feat: add Pagination component for standardized list navigation"
```

---

### Task 5: Promote FilterPills to UI library

**Files:**
- Create: `src/components/ui/FilterPills.tsx`
- Modify: `src/components/ui/index.ts`
- Modify: `src/features/guide/components/FilterPills.tsx` (keep as re-export for now)

- [ ] **Step 1: Create FilterPills.tsx in ui/**

Create `src/components/ui/FilterPills.tsx`. This is the guide version cleaned up — no hardcoded `#ffffff`, no default export, uses `cn()`:

```tsx
import { cn } from '@/utils';

interface FilterPillOption {
  id: string;
  label: string;
}

interface FilterPillsProps {
  options: FilterPillOption[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function FilterPills({ options, active, onChange, className }: FilterPillsProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {options.map((opt) => {
        const isActive = active === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={cn(
              'rounded-full px-3 py-1.5 text-[13px] font-medium cursor-pointer transition-colors',
              isActive
                ? 'bg-[var(--interactive-primary)] text-[var(--text-on-color)] border border-transparent'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--bg-tertiary)]',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Update guide FilterPills to re-export**

Replace the content of `src/features/guide/components/FilterPills.tsx` with a re-export so existing guide imports don't break:

```tsx
// Re-export from UI library — guide consumers will be migrated in Phase 2
export { FilterPills as default } from '@/components/ui/FilterPills';
```

- [ ] **Step 3: Add FilterPills export to index.ts**

Add to `src/components/ui/index.ts`:

```ts
export { FilterPills } from './FilterPills';
```

- [ ] **Step 4: Verify build**

Run: `npx tsc -b && npm run build`
Expected: No errors. Guide pages still work via re-export.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/FilterPills.tsx src/components/ui/index.ts src/features/guide/components/FilterPills.tsx
git commit -m "feat: promote FilterPills to UI library, clean up hardcoded colors"
```

---

### Task 6: Fix z-index in UI primitives

**Files:**
- Modify: `src/components/ui/Tooltip.tsx:69`
- Modify: `src/components/ui/Modal.tsx:34`
- Modify: `src/components/ui/SingleSelect.tsx:67`
- Modify: `src/components/ui/MultiSelect.tsx:179`
- Modify: `src/components/ui/SearchableSelect.tsx:144`

- [ ] **Step 1: Fix Tooltip z-index**

In `src/components/ui/Tooltip.tsx`, line 69, the z-index is set via inline style. Change:

```tsx
// Old (line 69):
            zIndex: 9999,
// New:
            zIndex: 'var(--z-tooltip)',
```

Note: Since this is an inline style object, the CSS var will be resolved by the browser.

- [ ] **Step 2: Fix Modal z-index**

In `src/components/ui/Modal.tsx`, line 34, change:

```tsx
// Old:
    <div className="fixed inset-0 z-50 flex items-center justify-center">
// New:
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center">
```

- [ ] **Step 3: Fix SingleSelect z-index**

In `src/components/ui/SingleSelect.tsx`, line 67, change:

```tsx
// Old:
            'z-[9999] overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] py-1 shadow-lg',
// New:
            'z-[var(--z-dropdown)] overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] py-1 shadow-lg',
```

- [ ] **Step 4: Fix MultiSelect z-index**

In `src/components/ui/MultiSelect.tsx`, line 179, change:

```tsx
// Old:
          className="fixed z-[9999] rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg"
// New:
          className="fixed z-[var(--z-dropdown)] rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg"
```

- [ ] **Step 5: Fix SearchableSelect z-index**

In `src/components/ui/SearchableSelect.tsx`, line 144, change:

```tsx
// Old:
        <div className="absolute z-50 mt-1 w-full min-w-[240px] rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg">
// New:
        <div className="absolute z-[var(--z-dropdown)] mt-1 w-full min-w-[240px] rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg">
```

- [ ] **Step 6: Verify build**

Run: `npx tsc -b && npm run build`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/Tooltip.tsx src/components/ui/Modal.tsx src/components/ui/SingleSelect.tsx src/components/ui/MultiSelect.tsx src/components/ui/SearchableSelect.tsx
git commit -m "fix: replace hardcoded z-index values with design system tokens in UI primitives"
```

---

### Task 7: Consolidate report colors

**Files:**
- Modify: `src/features/evalRuns/components/report/shared/colors.ts`

- [ ] **Step 1: Replace METRIC_HEX with resolveColor**

In `src/features/evalRuns/components/report/shared/colors.ts`, replace the `METRIC_HEX` function (lines 14-18) with:

```ts
import { resolveColor } from '@/utils/statusColors';

/** Resolved hex for Recharts (no CSS var support). */
export const METRIC_HEX = (value: number): string => {
  if (value >= 80) return resolveColor('var(--color-success)');
  if (value >= 60) return resolveColor('var(--color-warning)');
  return resolveColor('var(--color-error)');
};
```

- [ ] **Step 2: Replace VERDICT_COLORS hex map**

Replace the `VERDICT_COLORS` constant (lines 20-36) with:

```ts
export const VERDICT_COLORS: Record<string, string> = {
  // Correctness
  PASS: resolveColor('var(--color-verdict-pass)'),
  'NOT APPLICABLE': resolveColor('var(--color-verdict-na)'),
  'SOFT FAIL': resolveColor('var(--color-verdict-soft-fail)'),
  'HARD FAIL': resolveColor('var(--color-verdict-fail)'),
  CRITICAL: resolveColor('var(--color-verdict-critical)'),
  // Efficiency
  EFFICIENT: resolveColor('var(--color-verdict-pass)'),
  ACCEPTABLE: resolveColor('var(--color-level-easy)'),
  INCOMPLETE: resolveColor('var(--color-verdict-na)'),
  FRICTION: resolveColor('var(--color-verdict-soft-fail)'),
  BROKEN: resolveColor('var(--color-verdict-fail)'),
  // Adversarial
  FAIL: resolveColor('var(--color-verdict-fail)'),
  ERROR: resolveColor('var(--color-verdict-na)'),
};
```

- [ ] **Step 3: Replace SEVERITY_COLORS hex map**

Replace the `SEVERITY_COLORS` constant (lines 38-43) with:

```ts
export const SEVERITY_COLORS: Record<string, string> = {
  LOW: resolveColor('var(--color-verdict-na)'),
  MEDIUM: resolveColor('var(--color-warning)'),
  HIGH: resolveColor('var(--color-error)'),
  CRITICAL: resolveColor('var(--color-verdict-critical)'),
};
```

- [ ] **Step 4: Replace GAP_TYPE_DOT_COLORS hex map**

Replace the `GAP_TYPE_DOT_COLORS` constant (lines 52-58) with:

```ts
export const GAP_TYPE_DOT_COLORS: Record<string, string> = {
  UNDERSPEC: resolveColor('var(--color-gap-underspec)'),
  SILENT: resolveColor('var(--color-gap-silent)'),
  LEAKAGE: resolveColor('var(--color-gap-leakage)'),
  CONFLICTING: resolveColor('var(--color-gap-conflicting)'),
};
```

- [ ] **Step 5: Replace RECOVERY_COLORS and DIFFICULTY_COLORS hex maps**

Replace `RECOVERY_COLORS` (lines 66-72) with:

```ts
export const RECOVERY_COLORS: Record<string, string> = {
  GOOD: resolveColor('var(--color-success)'),
  PARTIAL: resolveColor('var(--color-warning)'),
  FAILED: resolveColor('var(--color-error)'),
  'NOT NEEDED': resolveColor('var(--color-verdict-na)'),
  NOT_NEEDED: resolveColor('var(--color-verdict-na)'),
};
```

Replace `DIFFICULTY_COLORS` (lines 74-79) with:

```ts
export const DIFFICULTY_COLORS: Record<string, string> = {
  EASY: resolveColor('var(--color-level-easy)'),
  MEDIUM: resolveColor('var(--color-level-medium)'),
  HARD: resolveColor('var(--color-level-hard)'),
  CRACK: resolveColor('var(--color-accent-purple)'),
};
```

- [ ] **Step 6: Replace GAP_TYPE_COLORS Tailwind hardcoded classes**

Replace `GAP_TYPE_COLORS` (lines 45-50) with CSS variable-based classes:

```ts
export const GAP_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  UNDERSPEC: { bg: 'bg-[var(--surface-info)]', text: 'text-[var(--color-info)]' },
  SILENT: { bg: 'bg-[var(--surface-warning)]', text: 'text-[var(--color-warning)]' },
  LEAKAGE: { bg: 'bg-[var(--surface-error)]', text: 'text-[var(--color-error)]' },
  CONFLICTING: { bg: 'bg-[var(--surface-brand-subtle)]', text: 'text-[var(--text-brand)]' },
};
```

- [ ] **Step 7: Verify build**

Run: `npx tsc -b && npm run build`
Expected: No errors. Note: `resolveColor` calls at module level will resolve to the current theme's hex values. Components using `useResolvedColor` hook will handle theme changes reactively.

- [ ] **Step 8: Commit**

```bash
git add src/features/evalRuns/components/report/shared/colors.ts
git commit -m "fix: replace hardcoded hex in report colors with resolveColor against design tokens"
```

---

### Task 8: Phase 1 verification

- [ ] **Step 1: Full build check**

Run: `npm run build && npm run lint && npx tsc -b`
Expected: Zero errors.

- [ ] **Step 2: Verify new components exist in barrel export**

Run: `grep -E 'Select|Combobox|Pagination|FilterPills' src/components/ui/index.ts`

Expected output should show exports for: `Select`, `SelectOption`, `Combobox`, `ComboboxOption`, `Pagination`, `FilterPills` (plus the old `SingleSelect`, `SearchableSelect`, `MultiSelect` which still exist).

- [ ] **Step 3: Verify old components still work**

Run: `grep -r 'SingleSelect\|SearchableSelect\|MultiSelect' src/features/ --include='*.tsx' -l`

Expected: All existing consumer files still import from the old components. No breakage.

- [ ] **Step 4: Commit any remaining fixes**

If any issues were found and fixed, commit them.

- [ ] **Step 5: Final commit and merge prep**

```bash
git log --oneline -10
```

Verify all Phase 1 commits are present. Branch is ready for merge to main before Phase 2 begins.
