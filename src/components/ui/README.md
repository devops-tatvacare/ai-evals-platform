# UI Component Library

Standardized, theme-aware UI primitives. All components use CSS variables from `src/styles/globals.css` and support light/dark mode automatically.

## When to Use What

| Need | Component | Import |
|------|-----------|--------|
| Simple dropdown | `<Select>` | `import { Select } from '@/components/ui'` |
| Searchable dropdown | `<Combobox>` | `import { Combobox } from '@/components/ui'` |
| Multi-select with search | `<Combobox multi>` | `import { Combobox } from '@/components/ui'` |
| Paginated list navigation | `<Pagination>` | `import { Pagination } from '@/components/ui'` |
| Filter toggle pills | `<FilterPills>` | `import { FilterPills } from '@/components/ui'` |
| Primary/secondary actions | `<Button>` | `import { Button } from '@/components/ui'` |
| Icon-only button | `<IconButton>` | `import { IconButton } from '@/components/ui'` |
| Button with dropdown menu | `<SplitButton>` | `import { SplitButton } from '@/components/ui'` |
| Centered dialog | `<Modal>` | `import { Modal } from '@/components/ui'` |
| Confirm before action | `<ConfirmDialog>` | `import { ConfirmDialog } from '@/components/ui'` |
| Hover tooltip | `<Tooltip>` | `import { Tooltip } from '@/components/ui'` |
| Positioned popup | `<Popover>` | `import { Popover } from '@/components/ui'` |
| Status indicator | `<Badge>` | `import { Badge } from '@/components/ui'` |
| Alert message | `<Alert>` | `import { Alert } from '@/components/ui'` |
| Loading spinner | `<Spinner>` | `import { Spinner } from '@/components/ui'` |
| Loading placeholder | `<Skeleton>` | `import { Skeleton } from '@/components/ui'` |
| Text input | `<Input>` | `import { Input } from '@/components/ui'` |
| Toggle switch | `<Switch>` | `import { Switch } from '@/components/ui'` |
| File upload area | `<FileDropZone>` | `import { FileDropZone } from '@/components/ui'` |

## Select vs Combobox

- **`<Select>`**: Short, known list (< 15 items). No search. Built on Radix UI Select.
- **`<Combobox>`**: Long/dynamic list, needs search, or multi-select. Built on Radix UI Popover.

## Adding New Tokens

1. Define raw value in `src/styles/globals.css` `@theme` block
2. If semantic mapping needed, add to `:root` and `[data-theme="dark"]` sections
3. If JS access needed, add to `src/utils/statusColors.ts`
4. For chart/canvas, call `resolveColor('var(--your-token)')` to get hex

## Never Do

- Hardcode hex colors in `.tsx` files
- Use `z-[arbitrary-number]` — use z-index tokens
- Use native `<select>` — use `<Select>` or `<Combobox>`
- Copy-paste pagination buttons — use `<Pagination>`
- Use Tailwind color classes like `text-red-500` — use `text-[var(--color-error)]`
