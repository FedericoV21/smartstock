'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type PendienteItem = {
  id: string;
  clienteId: string;
  estado: 'recordatorio_dia_5' | 'vencido' | 'saldo_cobranza_diaria';
  clienteNombre: string;
  numeroComprobanteLabel: string;
  tipoComprobanteLabel: string;
  saldoPendiente: number;
  vencimientoLabel: string;
};

export function CobranzaPendientesCard() {
  const [items, setItems] = useState<PendienteItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const res = await fetch('/api/cobranza/pendientes');
      if (!res.ok) {
        setItems([]);
        setLoading(false);
        return;
      }
      const json = (await res.json()) as { items?: PendienteItem[] };
      setItems(json.items ?? []);
      setLoading(false);
    }
    void fetchData();
  }, []);

  if (loading) {
    return <div className="animate-pulse h-48 rounded-xl border bg-card" />;
  }
  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Bell className="h-5 w-5 text-rose-700" aria-hidden />
        <h3 className="font-semibold text-rose-950">
          Cobranzas ({items.length} factura{items.length !== 1 ? 's' : ''})
        </h3>
      </div>
      <ul className="space-y-2">
        {items.slice(0, 5).map((it) => (
          <li key={it.id} className="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-2">
              <Link
                href={`/cuenta-corriente/${it.clienteId}`}
                className="font-medium text-rose-900 hover:underline"
              >
                {it.clienteNombre}
              </Link>
              <span
                className={
                  it.estado === 'vencido'
                    ? 'rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive'
                    : 'rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-900'
                }
              >
                {it.estado === 'vencido'
                  ? 'Vencido'
                  : it.estado === 'saldo_cobranza_diaria'
                    ? 'Cobranza diaria'
                    : 'Próximo a vencer'}
              </span>
            </div>
            <span className="text-xs text-rose-800 sm:text-right">
              {it.tipoComprobanteLabel} {it.numeroComprobanteLabel} · vence {it.vencimientoLabel}
            </span>
          </li>
        ))}
      </ul>
      {items.length > 5 ? (
        <p className="mt-2 text-sm text-rose-800">
          Abrí la campana arriba para ver las {items.length} y enviar WhatsApp.
        </p>
      ) : null}
    </div>
  );
}
