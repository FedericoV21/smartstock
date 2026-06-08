export type ParteCuentaCorriente = 'cliente' | 'proveedor';

export type EstadoSaldoCuentaCorriente = 'deuda' | 'saldo_a_favor' | 'sin_saldo';

export type DescripcionSaldoCuentaCorriente = {
  estado: EstadoSaldoCuentaCorriente;
  titulo: string;
  descripcion: string;
  monto: number;
};

export const TOLERANCIA_SALDO_CUENTA_CORRIENTE = 0.01;

function normalizarMonto(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.abs(n) * 100) / 100;
}

export function clasificarSaldoCuentaCorriente(
  saldo: number,
  tolerancia = TOLERANCIA_SALDO_CUENTA_CORRIENTE,
): EstadoSaldoCuentaCorriente {
  if (!Number.isFinite(saldo) || Math.abs(saldo) <= tolerancia) return 'sin_saldo';
  return saldo > 0 ? 'deuda' : 'saldo_a_favor';
}

export function describirSaldoCuentaCorriente(
  saldo: number,
  parte: ParteCuentaCorriente,
): DescripcionSaldoCuentaCorriente {
  const estado = clasificarSaldoCuentaCorriente(saldo);
  const monto = normalizarMonto(saldo);

  if (estado === 'sin_saldo') {
    return {
      estado,
      titulo: 'Sin saldo',
      descripcion: 'La cuenta esta al dia.',
      monto: 0,
    };
  }

  if (parte === 'cliente') {
    return estado === 'deuda'
      ? {
          estado,
          titulo: 'Deuda del cliente',
          descripcion: 'Importe que el cliente le debe al negocio.',
          monto,
        }
      : {
          estado,
          titulo: 'Saldo a favor del cliente',
          descripcion: 'Credito disponible para futuras ventas o ajustes.',
          monto,
        };
  }

  return estado === 'deuda'
    ? {
        estado,
        titulo: 'Saldo a pagar al proveedor',
        descripcion: 'Importe que el negocio le debe al proveedor.',
        monto,
      }
    : {
        estado,
        titulo: 'Saldo a favor del tenant',
        descripcion: 'Credito disponible del negocio frente al proveedor.',
        monto,
      };
}

export function calcularSaldoPendienteNuevoCargo(
  saldoDespuesCargo: number,
  montoCargo: number,
  tolerancia = TOLERANCIA_SALDO_CUENTA_CORRIENTE,
): number {
  if (!Number.isFinite(montoCargo) || montoCargo <= tolerancia) return 0;
  const saldoNormalizado = Number.isFinite(saldoDespuesCargo) ? saldoDespuesCargo : montoCargo;
  const pendiente = Math.min(montoCargo, Math.max(0, saldoNormalizado));
  return pendiente <= tolerancia ? 0 : Math.round(pendiente * 100) / 100;
}
