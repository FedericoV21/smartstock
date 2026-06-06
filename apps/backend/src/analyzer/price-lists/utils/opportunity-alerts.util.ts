export interface ListaHistoricaRow {
  proveedorId: string;
  createdAt: Date;
  variacionPromedioPct: number | null;
}

export interface AlertaOportunidad {
  proveedor_id: string;
  proveedor_nombre: string;
  tipo: 'aumento_probable' | 'sin_lista_reciente';
  mensaje: string;
  dias_desde_ultima_lista: number;
  frecuencia_historica_dias: number | null;
  variacion_promedio_historica_pct: number | null;
}

function diasEntre(a: Date, b: Date): number {
  return Math.abs((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function detectarOportunidadesFromListas(
  listas: ListaHistoricaRow[],
  nombresMap: Map<string, string>,
): { alertas: AlertaOportunidad[]; total: number } {
  if (listas.length === 0) {
    return { alertas: [], total: 0 };
  }

  const porProveedor = new Map<string, { fechas: Date[]; variaciones: number[] }>();
  for (const l of listas) {
    if (!porProveedor.has(l.proveedorId)) {
      porProveedor.set(l.proveedorId, { fechas: [], variaciones: [] });
    }
    const entry = porProveedor.get(l.proveedorId)!;
    entry.fechas.push(l.createdAt);
    if (l.variacionPromedioPct != null) {
      entry.variaciones.push(l.variacionPromedioPct);
    }
  }

  const hoy = new Date();
  const alertas: AlertaOportunidad[] = [];

  for (const [provId, data] of porProveedor) {
    const { fechas, variaciones } = data;
    if (fechas.length < 2) continue;

    fechas.sort((a, b) => a.getTime() - b.getTime());
    const intervalos: number[] = [];
    for (let i = 1; i < fechas.length; i++) {
      intervalos.push(diasEntre(fechas[i - 1], fechas[i]));
    }
    const frecuenciaPromedio = intervalos.reduce((s, d) => s + d, 0) / intervalos.length;
    const ultimaFecha = fechas[fechas.length - 1];
    const diasDesdeUltima = diasEntre(ultimaFecha, hoy);
    const varPromedio =
      variaciones.length > 0 ? variaciones.reduce((s, v) => s + v, 0) / variaciones.length : null;
    const provNombre = nombresMap.get(provId) ?? provId;

    if (diasDesdeUltima > frecuenciaPromedio * 1.3) {
      const esProblableAumento = varPromedio != null && varPromedio > 2;
      alertas.push({
        proveedor_id: provId,
        proveedor_nombre: provNombre,
        tipo: esProblableAumento ? 'aumento_probable' : 'sin_lista_reciente',
        mensaje: esProblableAumento
          ? `${provNombre} suele enviar listas cada ~${Math.round(frecuenciaPromedio)} d├¡as con aumentos promedio de ${varPromedio?.toFixed(1)}%. Hace ${Math.round(diasDesdeUltima)} d├¡as que no env├¡a: probable aumento pendiente.`
          : `${provNombre} suele enviar listas cada ~${Math.round(frecuenciaPromedio)} d├¡as. ├Ültima lista hace ${Math.round(diasDesdeUltima)} d├¡as.`,
        dias_desde_ultima_lista: Math.round(diasDesdeUltima),
        frecuencia_historica_dias: Math.round(frecuenciaPromedio),
        variacion_promedio_historica_pct:
          varPromedio != null ? Math.round(varPromedio * 100) / 100 : null,
      });
    }
  }

  alertas.sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'aumento_probable' ? -1 : 1;
    return b.dias_desde_ultima_lista - a.dias_desde_ultima_lista;
  });

  return { alertas, total: alertas.length };
}
