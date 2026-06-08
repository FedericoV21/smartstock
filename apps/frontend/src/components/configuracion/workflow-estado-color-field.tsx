'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { normalizeWorkflowHexColor } from '@/lib/colors/workflow-hex';
import { cn } from '@/lib/utils';

const PRESETS = ['#64748B', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#A855F7', '#EC4899', '#06B6D4'] as const;

type Props = {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
};

export function WorkflowEstadoColorField({ value, onChange, disabled, className, compact }: Props) {
  const inputId = useId();
  const colorInputRef = useRef<HTMLInputElement>(null);
  const [hexText, setHexText] = useState(() => value ?? '');

  useEffect(() => {
    setHexText(value ?? '');
  }, [value]);

  const pickerValue =
    value && normalizeWorkflowHexColor(value) !== null ? normalizeWorkflowHexColor(value)! : '#808080';

  const emit = useCallback(
    (next: string | null) => {
      onChange(next);
    },
    [onChange],
  );

  const onPickerInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const n = normalizeWorkflowHexColor(e.target.value);
      if (n) emit(n);
    },
    [emit],
  );

  const onHexBlur = useCallback(() => {
    const raw = hexText.trim();
    if (!raw) {
      emit(null);
      setHexText('');
      return;
    }
    const n = normalizeWorkflowHexColor(raw);
    if (n) {
      setHexText(n);
      emit(n);
    } else {
      setHexText(value ?? '');
    }
  }, [emit, hexText, value]);

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'relative shrink-0 rounded-md border shadow-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring',
            compact ? 'h-8 w-8' : 'h-9 w-9',
            value ? 'border-border' : 'border-dashed border-muted-foreground/40 bg-muted/30',
          )}
          style={
            normalizeWorkflowHexColor(value)
              ? { backgroundColor: normalizeWorkflowHexColor(value)! }
              : undefined
          }
          title="Elegir color"
          aria-label="Abrir selector de color"
          onClick={() => colorInputRef.current?.click()}
        >
          {!value ? (
            <span className="flex h-full w-full items-center justify-center text-[10px] font-medium text-muted-foreground">
              —
            </span>
          ) : null}
        </button>
        <input
          ref={colorInputRef}
          type="color"
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          value={pickerValue}
          onChange={onPickerInput}
        />
      </div>
      <Input
        id={inputId}
        className={cn('h-8 font-mono text-xs', compact ? 'w-[7.25rem]' : 'w-28')}
        placeholder="#RRGGBB"
        value={hexText}
        disabled={disabled}
        onChange={(e) => setHexText(e.target.value)}
        onBlur={onHexBlur}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs text-muted-foreground"
        disabled={disabled || !value}
        onClick={() => {
          setHexText('');
          emit(null);
        }}
      >
        Quitar
      </Button>
      {!compact ? (
        <div className="flex basis-full gap-1.5 pt-0.5 sm:basis-auto sm:pt-0">
          {PRESETS.map((hex) => (
            <button
              key={hex}
              type="button"
              disabled={disabled}
              className="h-6 w-6 shrink-0 rounded-full border border-border shadow-sm outline-none ring-offset-background hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
              style={{ backgroundColor: hex }}
              title={hex}
              aria-label={`Color ${hex}`}
              onClick={() => {
                setHexText(hex);
                emit(hex);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
