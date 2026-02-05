import { useState, useRef, useEffect, useCallback, type ReactNode, type HTMLAttributes } from 'react';
import React from 'react';
import { createPortal } from 'react-dom';

interface PopoverProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

interface PopoverTriggerProps extends HTMLAttributes<HTMLElement> {
  asChild?: boolean;
  children: ReactNode;
}

interface PopoverContentProps extends HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}

interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

export function Popover({ open: controlledOpen, onOpenChange, children }: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const triggerRef = useRef<HTMLElement>(null);
  
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  
  const setOpen = useCallback((value: boolean) => {
    if (!isControlled) {
      setUncontrolledOpen(value);
    }
    onOpenChange?.(value);
  }, [isControlled, onOpenChange]);
  
  return (
    <PopoverContext.Provider value={{ open, setOpen, triggerRef }}>
      {children}
    </PopoverContext.Provider>
  );
}

export function PopoverTrigger({ asChild, children, ...props }: PopoverTriggerProps) {
  const context = React.useContext(PopoverContext);
  if (!context) throw new Error('PopoverTrigger must be used within Popover');
  
  const { setOpen, triggerRef } = context;
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(!context.open);
  };
  
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      ref: triggerRef,
      onClick: handleClick,
      ...props,
    });
  }
  
  return (
    <button
      ref={triggerRef as React.RefObject<HTMLButtonElement>}
      onClick={handleClick}
      {...props}
    >
      {children}
    </button>
  );
}

export function PopoverContent({ 
  align = 'center', 
  side = 'bottom', 
  className = '',
  children,
  ...props 
}: PopoverContentProps) {
  const context = React.useContext(PopoverContext);
  if (!context) throw new Error('PopoverContent must be used within Popover');
  
  const { open, setOpen, triggerRef } = context;
  const contentRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  
  // Calculate position
  useEffect(() => {
    if (open && triggerRef.current && contentRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const contentRect = contentRef.current.getBoundingClientRect();
      
      let x = 0;
      let y = 0;
      
      // Calculate base position based on side
      switch (side) {
        case 'top':
          y = triggerRect.top - contentRect.height - 8;
          x = triggerRect.left;
          break;
        case 'bottom':
          y = triggerRect.bottom + 8;
          x = triggerRect.left;
          break;
        case 'left':
          x = triggerRect.left - contentRect.width - 8;
          y = triggerRect.top;
          break;
        case 'right':
          x = triggerRect.right + 8;
          y = triggerRect.top;
          break;
      }
      
      // Adjust for alignment
      if (side === 'top' || side === 'bottom') {
        switch (align) {
          case 'start':
            // x already set to triggerRect.left
            break;
          case 'center':
            x = triggerRect.left + (triggerRect.width - contentRect.width) / 2;
            break;
          case 'end':
            x = triggerRect.right - contentRect.width;
            break;
        }
      } else {
        switch (align) {
          case 'start':
            // y already set to triggerRect.top
            break;
          case 'center':
            y = triggerRect.top + (triggerRect.height - contentRect.height) / 2;
            break;
          case 'end':
            y = triggerRect.bottom - contentRect.height;
            break;
        }
      }
      
      // Keep within viewport
      x = Math.max(8, Math.min(x, window.innerWidth - contentRect.width - 8));
      y = Math.max(8, Math.min(y, window.innerHeight - contentRect.height - 8));
      
      setCoords({ x, y });
    }
  }, [open, align, side, triggerRef]);
  
  // Close on outside click
  useEffect(() => {
    if (!open) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      if (
        contentRef.current && 
        !contentRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, setOpen, triggerRef]);
  
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, setOpen]);
  
  if (!open) return null;
  
  return createPortal(
    <div
      ref={contentRef}
      style={{
        position: 'fixed',
        left: coords.x,
        top: coords.y,
        zIndex: 9999,
      }}
      className={`bg-background border border-border rounded-md shadow-lg ${className}`}
      {...props}
    >
      {children}
    </div>,
    document.body
  );
}
