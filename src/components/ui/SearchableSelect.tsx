import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
  searchText?: string; // Additional text to search against (e.g., native name)
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select...",
  className,
  disabled = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  const selectedOption = options.find((o) => o.value === value);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-option]');
    items[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, isOpen]);

  // Reset highlight when filtered results change
  useEffect(() => {
    setHighlightIndex(0);
  }, [filtered.length]);

  const openDropdown = useCallback(() => {
    if (disabled) return;
    setIsOpen(true);
    setSearch("");
    setHighlightIndex(0);
    // Focus input after render
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [disabled]);

  const selectOption = useCallback(
    (opt: SearchableSelectOption) => {
      onChange(opt.value);
      setIsOpen(false);
      setSearch("");
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          openDropdown();
        }
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[highlightIndex]) selectOption(filtered[highlightIndex]);
          break;
        case "Escape":
          setIsOpen(false);
          setSearch("");
          break;
      }
    },
    [isOpen, filtered, highlightIndex, openDropdown, selectOption],
  );

  return (
    <div ref={containerRef} className={cn("relative", className)} onKeyDown={handleKeyDown}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : openDropdown())}
        disabled={disabled}
        className={cn(
          "w-full h-9 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)]",
          "text-[13px] text-[var(--text-primary)] text-left",
          "focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50",
          "flex items-center justify-between gap-2",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        <span className="truncate">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full min-w-[240px] rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg">
          {/* Search input */}
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
                onClick={() => setSearch("")}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Options list */}
          <div ref={listRef} className="max-h-[240px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">
                No matches found
              </div>
            ) : (
              filtered.map((opt, i) => (
                <button
                  key={opt.value}
                  type="button"
                  data-option
                  onClick={() => selectOption(opt)}
                  className={cn(
                    "w-full px-3 py-1.5 text-left text-[13px] flex items-center gap-2",
                    "hover:bg-[var(--bg-hover)]",
                    i === highlightIndex && "bg-[var(--bg-hover)]",
                    opt.value === value && "text-[var(--text-brand)] font-medium",
                  )}
                >
                  <span className="truncate">{opt.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
