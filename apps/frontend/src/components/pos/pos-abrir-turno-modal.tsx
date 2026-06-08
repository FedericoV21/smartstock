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
import { MontoInput } from '@/components/ui/monto-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type CajaRow = {
  id: string;
  numero: number;
  nombre: string;
  /** True si otro usuario (o vos) ya tiene turno abierto en esta caja (no se puede abrir otro hasta el cierre Z). */
  turno_abierto?: boolean;
};

export function PosAbrirTurnoModal({
  open,
  onOpenChange,
  sucursalId,
  onTurnoAbierto,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sucursal operativa del POS; sin esto no se cargan cajas. */
  sucursalId: string | null;
  onTurnoAbierto?: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cajas, setCajas] = useState<CajaRow[]>([]);
  const [cajaId, setCajaId] = useState('');
  const [sugeridaId, setSugeridaId] = useState<string | null>(null);
  const [montoInicial, setMontoInicial] = useState<number | null>(0);
  const [abriendo, setAbriendo] = useState(false);
  const [cerrandoTurnoAbiertoPrevio, setCerrandoTurnoAbiertoPrevio] = useState(false);
  const [bloqueadoPorTurnoExistente, setBloqueadoPorTurnoExistente] = useState<{
    puedeCerrar: boolean;
    mensaje: string | null;
  } | null>(null);

  const cargar = useCallback(async () => {
    if (!sucursalId?.trim()) {
      setCajas([]);
      setCajaId('');
      setSugeridaId(null);
      setError('No hay sucursal operativa. Revisá tu perfil o recargá la página.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/caja/disponibles?sucursal_id=${encodeURIComponent(sucursalId.trim())}`,
        { cache: 'no-store' },
      );
      const j = (await res.json()) as {
        cajas?: CajaRow[];
        caja_sugerida_id?: string | null;
        todas_con_turno_abierto?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setCajas([]);
        setCajaId('');
        setSugeridaId(null);
        setError(j.error ?? 'No se pudieron cargar las cajas');
        return;
      }
      const list = j.cajas ?? [];
      const sug = typeof j.caja_sugerida_id === 'string' && j.caja_sugerida_id.trim() ? j.caja_sugerida_id.trim() : null;
      setCajas(list);
      setSugeridaId(sug);
      const primeraLibre = list.find((c) => !c.turno_abierto)?.id ?? '';
      const inicial =
        sug && list.some((c) => c.id === sug && !c.turno_abierto)
          ? sug
          : primeraLibre ||
            (list.length === 1 && !list[0].turno_abierto ? list[0].id : '');
      setCajaId(inicial);
      if (list.length === 0) {
        setError(
          'No hay caja habilitada para vos en esta sucursal. Pedile al administrador que asigne tu caja (usuario por defecto o membresía en la caja).',
        );
      } else if (j.todas_con_turno_abierto || list.every((c) => Boolean(c.turno_abierto))) {
        setError(
          'Todas las cajas de esta sucursal tienen un turno abierto. Esperá el cierre Z o pedí que den de alta otra caja.',
        );
      }
    } catch {
      setError('Error de conexión');
      setCajas([]);
    } finally {
      setLoading(false);
    }
  }, [sucursalId]);

  useEffect(() => {
    if (!open) return;
    setMontoInicial(0);
    setBloqueadoPorTurnoExistente(null);
    void cargar();
  }, [open, cargar]);

  async function confirmar() {
    setAbriendo(true);
    setError(null);
    try {
      if (!cajaId.trim()) {
        setError('Elegí una caja.');
        return;
      }
      const res = await fetch('/api/caja/turno/abrir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caja_id: cajaId.trim(),
          monto_inicial: montoInicial ?? 0,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        codigo?: string;
        puede_cerrar_turno_actual?: boolean;
      };
      if (!res.ok) {
        const msg =
          typeof j.error === 'string'
            ? j.error
            : res.status === 409
              ? 'No se pudo abrir el turno porque ya existe uno abierto.'
              : 'No se pudo abrir el turno';
        setError(msg);
        if (
          res.status === 409 &&
          j.codigo === 'turno_usuario_ya_abierto' &&
          j.puede_cerrar_turno_actual === true
        ) {
          setBloqueadoPorTurnoExistente({ puedeCerrar: true, mensaje: msg });
        } else if (res.status === 409) {
          setBloqueadoPorTurnoExistente({ puedeCerrar: false, mensaje: msg });
        }
        return;
      }
      setBloqueadoPorTurnoExistente(null);
      onOpenChange(false);
      await onTurnoAbierto?.();
    } catch {
      setError('Error de conexión');
    } finally {
      setAbriendo(false);
    }
  }

  async function cerrarTurnoPreexistenteIgualEsperadoSistema() {
    if (!bloqueadoPorTurnoExistente?.puedeCerrar) return;
    setCerrandoTurnoAbiertoPrevio(true);
    setError(null);
    try {
      const res = await fetch('/api/caja/turno/cerrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usar_efectivo_esperado_del_sistema: true }),
      });
      const jr = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(typeof jr.error === 'string' ? jr.error : 'No se pudo cerrar el turno anterior');
        return;
      }
      setBloqueadoPorTurnoExistente(null);
      await cargar();
      await onTurnoAbierto?.();
    } catch {
      setError('Error de conexión al cerrar el turno anterior');
    } finally {
      setCerrandoTurnoAbiertoPrevio(false);
    }
  }

  const labelCaja = (c: CajaRow) =>
    `${String(c.numero).padStart(2, '0')} — ${c.nombre}${c.turno_abierto ? ' (turno abierto)' : ''}`;
  const cajaSeleccionada = cajas.find((c) => c.id === cajaId);
  const textoSelectCaja = cajaSeleccionada ? labelCaja(cajaSeleccionada) : undefined;
  const mostrarSelector = cajas.length > 1;
  const cajaSeleccionadaOcupada = Boolean(cajas.find((c) => c.id === cajaId && c.turno_abierto));
  const todasCajasConTurno = cajas.length > 0 && cajas.every((c) => Boolean(c.turno_abierto));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="pos-abrir-turno-desc">
        <DialogHeader>
          <DialogTitle>Abrir turno de caja</DialogTitle>
          <DialogDescription id="pos-abrir-turno-desc">
            El efectivo inicial es el fondo en gaveta para este turno. Los tickets usarán la numeración de la caja
            elegida.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-muted-foreground text-sm">Cargando cajas…</p>
        ) : (
          <div className="space-y-4 py-1">
            {error ? (
              <div className="space-y-2">
                <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
                  {error}
                </div>
                {bloqueadoPorTurnoExistente?.puedeCerrar ? (
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={cerrandoTurnoAbiertoPrevio || abriendo || loading}
                      onClick={() => void cerrarTurnoPreexistenteIgualEsperadoSistema()}
                    >
                      {cerrandoTurnoAbiertoPrevio ? 'Cerrando…' : 'Cerrar turno abierto (Z, efectivo = sistema)'}
                    </Button>
                    <p className="text-muted-foreground text-xs">
                      Se registra el cierre Z usando el efectivo esperado por movimientos. Verificá la gaveta si
                      hace falta.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!error || cajas.length > 0 ? (
              <>
                <div className="space-y-2">
                  <span className="text-sm font-medium leading-none">Caja</span>
                  {mostrarSelector ? (
                    <Select
                      value={cajaId.trim() ? cajaId : undefined}
                      onValueChange={(v) => setCajaId(typeof v === 'string' ? v : '')}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Elegí caja">{textoSelectCaja}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {cajas.map((c) => (
                          <SelectItem key={c.id} value={c.id} disabled={Boolean(c.turno_abierto)}>
                            {labelCaja(c)}
                            {sugeridaId === c.id ? ' · sugerida' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : cajas.length === 1 ? (
                    <p className="text-sm font-semibold">
                      {labelCaja(cajas[0])}
                      {cajas[0].turno_abierto ? (
                        <span className="text-muted-foreground block text-xs font-normal">
                          Hay un turno abierto en esta caja; no podés abrir otro hasta el cierre Z.
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label htmlFor="pos-turno-monto" className="text-sm font-medium">
                    Monto inicial efectivo
                  </label>
                  <MontoInput
                    id="pos-turno-monto"
                    placeholder="0,00"
                    value={montoInicial}
                    onValueChange={setMontoInicial}
                    min={0}
                    decimals={2}
                    disabled={cajas.length === 0 && Boolean(error)}
                  />
                </div>
              </>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={abriendo}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={
              abriendo ||
              loading ||
              !cajaId ||
              cajas.length === 0 ||
              cajaSeleccionadaOcupada ||
              todasCajasConTurno
            }
            onClick={() => void confirmar()}
          >
            {abriendo ? 'Abriendo…' : 'Abrir turno'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
