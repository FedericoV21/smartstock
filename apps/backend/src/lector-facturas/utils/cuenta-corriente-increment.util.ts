import type { Repository } from 'typeorm';

import { CuentaCorriente } from '../../importaciones/entities/cuenta-corriente.entity';

export type IncrementarSaldoCuentaResult = {
  cuentaId: string;
  saldoAnterior: number;
  saldoNuevo: number;
  creada: boolean;
};

export async function incrementarSaldoCuentaCliente(
  repo: Repository<CuentaCorriente>,
  tenantId: string,
  clienteId: string,
  delta: number,
): Promise<IncrementarSaldoCuentaResult> {
  const row = await repo.findOne({ where: { tenantId, clienteId } });
  if (!row) {
    const saved = await repo.save(
      repo.create({
        tenantId,
        clienteId,
        proveedorId: null,
        saldo: delta.toFixed(6),
        tipoCuenta: 'cliente',
      }),
    );
    return {
      cuentaId: saved.id,
      saldoAnterior: 0,
      saldoNuevo: delta,
      creada: true,
    };
  }

  const saldoAnterior = Number(row.saldo);
  const saldoNuevo = saldoAnterior + delta;
  await repo.update({ id: row.id }, { saldo: saldoNuevo.toFixed(6) });
  return { cuentaId: row.id, saldoAnterior, saldoNuevo, creada: false };
}

export async function incrementarSaldoCuentaProveedor(
  repo: Repository<CuentaCorriente>,
  tenantId: string,
  proveedorId: string,
  delta: number,
): Promise<IncrementarSaldoCuentaResult> {
  const row = await repo.findOne({ where: { tenantId, proveedorId } });
  if (!row) {
    const saved = await repo.save(
      repo.create({
        tenantId,
        clienteId: null,
        proveedorId,
        saldo: delta.toFixed(6),
        tipoCuenta: 'proveedor',
      }),
    );
    return {
      cuentaId: saved.id,
      saldoAnterior: 0,
      saldoNuevo: delta,
      creada: true,
    };
  }

  const saldoAnterior = Number(row.saldo);
  const saldoNuevo = saldoAnterior + delta;
  await repo.update({ id: row.id }, { saldo: saldoNuevo.toFixed(6) });
  return { cuentaId: row.id, saldoAnterior, saldoNuevo, creada: false };
}
