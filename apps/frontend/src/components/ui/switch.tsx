'use client';

import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '@/lib/utils';

type SwitchProps = Omit<ComponentPropsWithoutRef<'button'>, 'type' | 'role' | 'onClick'> & {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
};

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-11 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors outline-none select-none',
        'focus-visible:ring-3 focus-visible:ring-ring/50',
        'disabled:pointer-events-none disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-muted',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1 left-0.5 block size-5 rounded-full bg-background shadow-sm ring-1 ring-black/5 transition-transform duration-200 ease-out dark:ring-white/10',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}
