'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

interface ShortcutHandlers {
  onCobrar: () => void;
  onBuscarProducto: () => void;
  onFocoDescuento?: () => void;
  onCambiarCliente: () => void;
  onCancelarVenta: () => void;
  onCambiarTipo: () => void;
  disabled?: boolean;
}

const SHORTCUTS = [
  { key: 'F2', desc: 'Cobrar / abrir modal de pago' },
  { key: 'F3', desc: 'Foco en el campo de escaneo / búsqueda' },
  { key: 'F9', desc: 'Foco en el descuento del resumen' },
  { key: 'F4', desc: 'Cambiar cliente' },
  { key: 'F8', desc: 'Cancelar venta' },
  { key: 'F12', desc: 'Cambiar tipo de comprobante' },
  { key: 'Escape', desc: 'Cerrar modal abierto' },
  { key: 'Enter', desc: 'Confirmar código escaneado' },
  { key: 'F1 / ?', desc: 'Mostrar esta ayuda' },
];

export function usePosKeyboardShortcuts(handlers: ShortcutHandlers) {
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (handlers.disabled) return;

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      switch (e.key) {
        case 'F1':
          e.preventDefault();
          setShowHelp((v) => !v);
          break;
        case 'F2':
          e.preventDefault();
          handlers.onCobrar();
          break;
        case 'F3':
          e.preventDefault();
          handlers.onBuscarProducto();
          break;
        case 'F9':
          if (handlers.onFocoDescuento) {
            e.preventDefault();
            handlers.onFocoDescuento();
          }
          break;
        case 'F4':
          e.preventDefault();
          handlers.onCambiarCliente();
          break;
        case 'F8':
          e.preventDefault();
          handlers.onCancelarVenta();
          break;
        case 'F12':
          e.preventDefault();
          handlers.onCambiarTipo();
          break;
        case '?':
          if (!isInput) {
            e.preventDefault();
            setShowHelp((v) => !v);
          }
          break;
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handlers]);

  return { showHelp, setShowHelp };
}

export function ShortcutsHelpModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-96 rounded-xl border bg-background p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Atajos de teclado</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.key} className="border-b last:border-0">
                <td className="py-2 pr-4">
                  <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">
                    {s.key}
                  </kbd>
                </td>
                <td className="py-2 text-muted-foreground">{s.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button variant="outline" className="w-full" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}
