'use client';

import { useState, type ReactNode } from 'react';

import { CuentaCorrienteClient } from '@/components/analizador/cuenta-corriente-client';
import { CobranzaClientePanel } from '@/components/cobranza/cobranza-cliente-panel';
import { ClienteComprobantesHistorial } from '@/components/clientes/cliente-comprobantes-historial';
import { CuentaCorrienteExtractoPanel } from '@/components/cuenta-corriente/cuenta-corriente-extracto-panel';
import { CuentaCorrienteMovimientosDiaPanel } from '@/components/cuenta-corriente/cuenta-corriente-movimientos-dia-panel';

export function ClienteDetalleCuentaRefreshGroup({
  children,
  clienteId,
  showHistorialComprobantes,
  showCobranzaFacturas,
  showCuentaCorriente,
  canEdit,
}: {
  children?: ReactNode;
  clienteId: string;
  showHistorialComprobantes: boolean;
  showCobranzaFacturas: boolean;
  showCuentaCorriente: boolean;
  canEdit: boolean;
}) {
  const [dataVersion, setDataVersion] = useState(0);

  const bump = () => setDataVersion((v) => v + 1);

  return (
    <>
      {children}
      <CuentaCorrienteMovimientosDiaPanel
        clienteId={clienteId}
        refreshKey={dataVersion}
        onDatosActualizados={bump}
      />
      {showCobranzaFacturas ? (
        <CuentaCorrienteExtractoPanel
          clienteId={clienteId}
          refreshKey={dataVersion}
          onDatosActualizados={bump}
        />
      ) : null}
      {showHistorialComprobantes ? (
        <ClienteComprobantesHistorial key={dataVersion} clienteId={clienteId} />
      ) : null}
      {showCobranzaFacturas ? (
        <CobranzaClientePanel clienteId={clienteId} onPagoRegistrado={bump} />
      ) : null}
      {showCuentaCorriente ? (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-4 font-medium">Cuenta corriente</h2>
          <CuentaCorrienteClient
            key={dataVersion}
            clienteId={clienteId}
            canEdit={canEdit}
            onPagoRegistrado={bump}
          />
        </section>
      ) : null}
    </>
  );
}
