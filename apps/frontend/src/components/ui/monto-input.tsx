'use client';

import { forwardRef, useCallback, useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  formatearMontoArgentinoEditable,
  debePostergarFormateoMonto,
  parsearMontoEnteroEditable,
  parsearMontoInputUsuario,
} from '@/lib/ui/monto-argentino';
import { cn } from '@/lib/utils';

export type MontoInputProps = Omit<
  React.ComponentProps<typeof Input>,
  'type' | 'value' | 'onChange' | 'defaultValue'
> & {
  /** Valor numérico en unidad de cuenta (ej. pesos con centavos); `null` = vacío / no definido. */
  value: number | null;
  onValueChange: (n: number | null) => void;
  /** Cantidad máxima de decimales (default 2). */
  decimals?: number;
  min?: number;
  max?: number;
  allowNegative?: boolean;
};

function clampMonto(
  n: number,
  decimals: number,
  min: number | undefined,
  max: number | undefined,
  allowNegative: boolean,
): number {
  let v = n;
  if (!allowNegative && v < 0) v = 0;
  const f = 10 ** decimals;
  v = Math.round(v * f) / f;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  return v;
}

function parseMontoRaw(raw: string, decimals: number): number | null {
  if (decimals <= 0) {
    return parsearMontoEnteroEditable(raw);
  }
  return parsearMontoInputUsuario(raw);
}

export const MontoInput = forwardRef<HTMLInputElement, MontoInputProps>(function MontoInput(
  {
    value,
    onValueChange,
    decimals = 2,
    min,
    max,
    allowNegative = false,
    className,
    onBlur,
    onFocus,
    disabled,
    ...rest
  },
  ref,
) {
  const [text, setText] = useState(() =>
    value == null ? '' : formatearMontoArgentinoEditable(value, decimals),
  );
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) return;
    setText(value == null ? '' : formatearMontoArgentinoEditable(value, decimals));
  }, [value, focused, decimals]);

  const commit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === '') {
        onValueChange(null);
        setText('');
        return;
      }
      const parsed = parseMontoRaw(raw, decimals);
      if (parsed === null) {
        return;
      }
      const v = clampMonto(parsed, decimals, min, max, allowNegative);
      onValueChange(v);
      setText(formatearMontoArgentinoEditable(v, decimals));
    },
    [allowNegative, decimals, max, min, onValueChange],
  );

  return (
    <Input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      className={cn('tabular-nums text-right', className)}
      value={text}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        commit(e.target.value);
        onBlur?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const trimmed = raw.trim();
        if (trimmed === '') {
          onValueChange(null);
          return;
        }
        const parsed = parseMontoRaw(raw, decimals);
        if (parsed === null) {
          return;
        }
        const v = clampMonto(parsed, decimals, min, max, allowNegative);
        onValueChange(v);
        if (!debePostergarFormateoMonto(raw)) {
          setText(formatearMontoArgentinoEditable(v, decimals));
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const paste = e.clipboardData.getData('text');
        const parsed = parseMontoRaw(paste, decimals);
        if (parsed === null) {
          return;
        }
        const v = clampMonto(parsed, decimals, min, max, allowNegative);
        onValueChange(v);
        setText(formatearMontoArgentinoEditable(v, decimals));
      }}
    />
  );
});
