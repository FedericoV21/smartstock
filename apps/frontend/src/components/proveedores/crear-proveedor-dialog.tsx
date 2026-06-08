'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { round2 } from '@/lib/analizador/descuento-proveedor';
import { toast } from 'sonner';

export type CrearProveedorExitoPayload = { id: string; nombre: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se llama después de crear correctamente; el diálogo ya cerró el estado de guardado. */
  onCreado?: (proveedor: CrearProveedorExitoPayload) => void;
};

export function CrearProveedorDialog({ open, onOpenChange, onCreado }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [cuit, setCuit] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [direccion, setDireccion] = useState('');
  const [notas, setNotas] = useState('');
  const [crearCuentaCorriente, setCrearCuentaCorriente] = useState(true);
  const [descuentoPct, setDescuentoPct] = useState('0');

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setNombre('');
      setCuit('');
      setTelefono('');
      setEmail('');
      setDireccion('');
      setNotas('');
      setDescuentoPct('0');
      setCrearCuentaCorriente(true);
      setError(null);
    });
  }, [open]);

  const handleSave = useCallback(async () => {
    if (!nombre.trim()) return;
    const descNum = Number(String(descuentoPct).replace(',', '.'));
    if (!Number.isFinite(descNum) || descNum < 0 || descNum >= 100) {
      setError('El descuento debe ser un número entre 0 y 99.99.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/proveedores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: nombre.trim(),
          cuit: cuit || null,
          telefono: telefono || null,
          email: email || null,
          direccion: direccion || null,
          notas: notas || null,
          descuento_pct: round2(Math.min(99.99, Math.max(0, descNum))),
          crear_cuenta_corriente: crearCuentaCorriente,
        }),
      });
      const body = (await res.json()) as { id?: string; nombre?: string; error?: string };
      setSaving(false);
      if (!res.ok) {
        const msg = body.error ?? 'No se pudo crear el proveedor';
        setError(msg);
        toast.error(msg);
        return;
      }
      if (typeof body.id !== 'string' || typeof body.nombre !== 'string') {
        const msg = 'Respuesta inválida del servidor';
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success(`Proveedor «${body.nombre}» creado.`);
      onOpenChange(false);
      onCreado?.({ id: body.id, nombre: body.nombre });
    } catch {
      setSaving(false);
      const msg = 'No se pudo conectar. Revisá tu red e intentá de nuevo.';
      setError(msg);
      toast.error(msg);
    }
  }, [
    nombre,
    cuit,
    telefono,
    email,
    direccion,
    notas,
    crearCuentaCorriente,
    descuentoPct,
    onOpenChange,
    onCreado,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo proveedor</DialogTitle>
          <DialogDescription>Datos de contacto y fiscalidad.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Nombre</span>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">CUIT</span>
            <Input value={cuit} onChange={(e) => setCuit(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Teléfono</span>
            <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Email</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Dirección</span>
            <Input value={direccion} onChange={(e) => setDireccion(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Notas</span>
            <Input value={notas} onChange={(e) => setNotas(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Descuento en listas de precios (%)</span>
            <Input
              type="number"
              step="0.01"
              min={0}
              max={99.99}
              value={descuentoPct}
              onChange={(e) => setDescuentoPct(e.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground -mt-1">
            Opcional. Se usa como default en el analizador al aplicar listas de este proveedor. No afecta
            facturas de compra.
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border"
              checked={crearCuentaCorriente}
              onChange={(e) => setCrearCuentaCorriente(e.target.checked)}
            />
            <span>Crear cuenta corriente (proveedor / a pagar)</span>
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={saving || !nombre.trim()} onClick={() => void handleSave()}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
