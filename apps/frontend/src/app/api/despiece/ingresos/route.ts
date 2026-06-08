import { NextResponse } from 'next/server';

import {
  rejectUnlessDespieceAplicarPrecios,
  rejectUnlessDespieceEditar,
} from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import {
  costoCatalogoDesdePrecioVentaDespiece,
  resolverPesoIngresoKgDesdePayload,
  type PlantillaConRelaciones,
} from '@/lib/despiece/api';
import { upsertPrecioSucursalDespiece } from '@/lib/despiece/catalogo';
import { IVA_DESPIECE } from '@/lib/despiece/constantes';
import { calcular4Estrategias } from '@/lib/despiece/motor';
import type { DespieceEstrategia } from '@/lib/despiece/tipos';
import { calcularImportes } from '@/lib/facturacion/calcular-importes';
import {
  ejecutarConfirmacionImportado,
  type ConfirmarImportadoBody,
} from '@/lib/lector-facturas/ejecutar-confirmacion-importado';
import { recalcularPreciosSucursalConGanancia } from '@/lib/producto/precio-sucursal';
import { registrarLoteIngreso } from '@/lib/productos/upsert-con-proveedor';
import { moduloGuardDespieceConNegocio } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

const PLANTILLA_SELECT = `
  id,
  nombre,
  producto_padre_id,
  peso_total_kg,
  unidad_base_tipo,
  unidad_base_nombre,
  unidad_base_cantidad,
  unidad_contenedor_nombre,
  unidad_contenedor_cantidad,
  rentabilidad_objetivo_pct,
  activo,
  notas,
  created_at,
  updated_at,
  producto_padre:producto_padre_id(id, nombre, precio_costo, precio_venta, proveedor_id),
  cortes:despiece_corte(
    id,
    producto_hijo_id,
    kg_rendimiento,
    factor_ajuste_pct,
    precio_anclado,
    nombre_en_plantilla,
    plu_sugerido,
    peso_promedio_unidad_kg,
    orden,
    producto_hijo:producto_hijo_id(id, nombre, precio_costo, precio_venta, unidad, plu, activo, es_pesable)
  )
`;

function readRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function isYmd(value: string | null): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function readOptionalDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readOptionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normalizarNombreCorte(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

type CorteIngreso = {
  producto_id: string;
  nombre: string;
  cantidad: number;
  factor_ajuste_pct: number;
  precio_anclado: number | null;
};

const TIPOS_COMPRA_PADRE = new Set(['factura_a', 'factura_b', 'factura_c', 'remito']);

export async function POST(request: Request) {
  const guard = await moduloGuardDespieceConNegocio();
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = await rejectUnlessDespieceEditar(session.supabase, session);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = readRecord(body);
  const plantillaId = typeof b.plantilla_id === 'string' ? b.plantilla_id : '';
  const costoKgPadre = Number(b.costo_kg);
  const aplicarPrecios = b.aplicar_precios === true;
  const preview = b.preview === true;
  const estrategia = String(b.estrategia ?? 'fija') as DespieceEstrategia;
  const mermaKgRaw = b.merma_kg;
  const mermaPctRaw = b.merma_pct;
  const tieneMermaKg = mermaKgRaw !== undefined && mermaKgRaw !== null && mermaKgRaw !== '';
  const tieneMermaPct = mermaPctRaw !== undefined && mermaPctRaw !== null && mermaPctRaw !== '';
  const preciosEditadosRaw = Array.isArray(b.precios_editados) ? b.precios_editados : [];
  const preciosEditados = new Map<string, number | null>();
  for (const item of preciosEditadosRaw) {
    const row = readRecord(item);
    const productoId = typeof row.producto_id === 'string' ? row.producto_id : '';
    if (!productoId) continue;
    const precio = row.precio_venta == null || row.precio_venta === '' ? null : Number(row.precio_venta);
    if (precio != null && (!Number.isFinite(precio) || precio < 0)) {
      return NextResponse.json({ error: 'Los precios editados deben ser mayores o iguales a 0.' }, { status: 400 });
    }
    preciosEditados.set(productoId, precio);
  }
  const cortesRealesRaw = Array.isArray(b.cortes_reales) ? b.cortes_reales : [];
  const kgRealPorNombre = new Map<string, number>();
  const kgRealPorProducto = new Map<string, number>();
  for (const item of cortesRealesRaw) {
    const row = readRecord(item);
    const productoId = typeof row.producto_id === 'string' ? row.producto_id.trim() : '';
    const nombre = typeof row.nombre === 'string' ? row.nombre : '';
    const keyNombre = normalizarNombreCorte(nombre);
    if (!productoId && !keyNombre) continue;

    const kgRaw = row.kg_ingresado ?? row.cantidad;
    const kg = kgRaw == null || kgRaw === '' ? 0 : Number(kgRaw);
    if (!Number.isFinite(kg) || kg < 0) {
      return NextResponse.json({ error: 'Los kg reales por corte deben ser mayores o iguales a 0.' }, { status: 400 });
    }

    if (keyNombre) kgRealPorNombre.set(keyNombre, round3(kg));
    if (productoId) kgRealPorProducto.set(productoId, round3(kg));
  }
  const proveedorId = typeof b.proveedor_id === 'string' && b.proveedor_id.trim() ? b.proveedor_id.trim() : null;
  const fechaVencimiento =
    typeof b.fecha_vencimiento === 'string' && b.fecha_vencimiento.trim()
      ? b.fecha_vencimiento.trim()
      : null;
  const registrarFacturaCompra = b.registrar_factura_compra === true;
  const registrarIngresoPadre = b.registrar_ingreso_padre === true || registrarFacturaCompra;
  const tipoComprobanteCompra =
    typeof b.tipo_comprobante_compra === 'string' && b.tipo_comprobante_compra.trim()
      ? b.tipo_comprobante_compra.trim()
      : 'factura_c';
  const fechaCompra = readOptionalDate(b.fecha_compra);
  const fechaVencimientoCompra = readOptionalDate(b.fecha_vencimiento_compra);
  const puntoVentaCompra = readOptionalNumber(b.punto_venta_compra);
  const numeroDocumentoCompra = readOptionalNumber(b.numero_documento_compra);
  const observacionesCompra =
    typeof b.observaciones_compra === 'string' && b.observaciones_compra.trim()
      ? b.observaciones_compra.trim()
      : null;

  if (!plantillaId) return NextResponse.json({ error: 'Seleccioná una plantilla.' }, { status: 400 });
  if (!Number.isFinite(costoKgPadre) || costoKgPadre <= 0) {
    return NextResponse.json({ error: 'El costo por kg debe ser mayor a 0.' }, { status: 400 });
  }
  if (aplicarPrecios && !['variable', 'fija', 'anclada'].includes(estrategia)) {
    return NextResponse.json({ error: 'Estrategia inválida.' }, { status: 400 });
  }

  if (aplicarPrecios || Array.from(preciosEditados.values()).some((precio) => precio != null)) {
    const noAplicar = await rejectUnlessDespieceAplicarPrecios(session.supabase, session);
    if (noAplicar) return noAplicar;
  }

  const sucursalScope = await resolveAndValidateSucursalScope(
    session,
    typeof b.sucursal_id === 'string' ? b.sucursal_id : null,
  );
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const { data, error } = await session.supabase
    .from('despiece_plantilla')
    .select(PLANTILLA_SELECT)
    .eq('id', plantillaId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Plantilla no encontrada.' }, { status: 404 });

  const plantilla = data as unknown as PlantillaConRelaciones;
  const cortes = (plantilla.cortes ?? []).slice().sort((a, b) => a.orden - b.orden);
  if (cortes.length === 0) {
    return NextResponse.json({ error: 'La plantilla no tiene cortes.' }, { status: 400 });
  }

  const kgPlantilla = Number(plantilla.peso_total_kg);
  if (!(kgPlantilla > 0)) {
    return NextResponse.json({ error: 'La plantilla no tiene peso base valido.' }, { status: 400 });
  }

  let pesoIngresadoKg: number;
  try {
    pesoIngresadoKg = round3(resolverPesoIngresoKgDesdePayload(plantilla, body).pesoKg);
  } catch (pesoError) {
    return NextResponse.json(
      { error: pesoError instanceof Error ? pesoError.message : 'El peso ingresado debe ser mayor a 0.' },
      { status: 400 },
    );
  }
  if (!Number.isFinite(pesoIngresadoKg) || pesoIngresadoKg <= 0) {
    return NextResponse.json({ error: 'El peso ingresado debe ser mayor a 0.' }, { status: 400 });
  }

  let kgVendiblesObjetivo: number | null = null;
  if (tieneMermaKg) {
    const mermaKgManual = Number(mermaKgRaw);
    if (!Number.isFinite(mermaKgManual) || mermaKgManual < 0) {
      return NextResponse.json({ error: 'La merma en kg debe ser mayor o igual a 0.' }, { status: 400 });
    }
    if (mermaKgManual >= pesoIngresadoKg) {
      return NextResponse.json({ error: 'La merma en kg debe ser menor al peso ingresado.' }, { status: 400 });
    }
    kgVendiblesObjetivo = round3(pesoIngresadoKg - mermaKgManual);
  } else if (tieneMermaPct) {
    const mermaPctManual = Number(mermaPctRaw);
    if (!Number.isFinite(mermaPctManual) || mermaPctManual < 0) {
      return NextResponse.json({ error: 'La merma % debe ser mayor o igual a 0.' }, { status: 400 });
    }
    if (mermaPctManual >= 100) {
      return NextResponse.json({ error: 'La merma % debe ser menor a 100.' }, { status: 400 });
    }
    kgVendiblesObjetivo = round3(pesoIngresadoKg * (1 - mermaPctManual / 100));
  }

  const factor = pesoIngresadoKg / kgPlantilla;
  const kgRendidosPlantilla = cortes.reduce((acc, c) => acc + Number(c.kg_rendimiento), 0);
  if (!(kgRendidosPlantilla > 0)) {
    return NextResponse.json({ error: 'La plantilla no tiene kg rendibles.' }, { status: 400 });
  }

  const cortesIngresoPorNombre = new Map<string, CorteIngreso>();
  for (const corte of cortes) {
    const productoId = corte.producto_hijo_id;
    const nombre = corte.nombre_en_plantilla || corte.producto_hijo?.nombre || productoId;
    const keyNombre = normalizarNombreCorte(nombre);
    const participacionVendible = Number(corte.kg_rendimiento) / kgRendidosPlantilla;
    let cantidad =
      kgVendiblesObjetivo == null
        ? round3(Number(corte.kg_rendimiento) * factor)
        : round3(kgVendiblesObjetivo * participacionVendible);
    if (kgRealPorNombre.has(keyNombre)) {
      cantidad = kgRealPorNombre.get(keyNombre)!;
    } else if (kgRealPorProducto.has(productoId)) {
      cantidad = kgRealPorProducto.get(productoId)!;
    }

    if (cortesIngresoPorNombre.has(keyNombre)) cortesIngresoPorNombre.delete(keyNombre);
    cortesIngresoPorNombre.set(keyNombre, {
      producto_id: productoId,
      nombre,
      cantidad,
      factor_ajuste_pct: Number(corte.factor_ajuste_pct ?? 0),
      precio_anclado: corte.precio_anclado == null ? null : Number(corte.precio_anclado),
    });
  }

  const cortesIngreso = Array.from(cortesIngresoPorNombre.values());
  const kgVendiblesIngreso = round3(cortesIngreso.reduce((acc, corte) => acc + corte.cantidad, 0));
  if (!(kgVendiblesIngreso > 0)) {
    return NextResponse.json({ error: 'La suma de kg reales por corte debe ser mayor a 0.' }, { status: 400 });
  }
  if (kgVendiblesIngreso - pesoIngresadoKg > 0.01) {
    return NextResponse.json(
      { error: 'Los kg vendibles no pueden superar el peso ingresado de la media res.' },
      { status: 400 },
    );
  }

  const costoTotalIngreso = round2(costoKgPadre * pesoIngresadoKg);
  const costoEfectivoKgCorte = round2(costoTotalIngreso / kgVendiblesIngreso);
  const mermaKg = round3(pesoIngresadoKg - kgVendiblesIngreso);
  const mermaPct = round2((mermaKg / pesoIngresadoKg) * 100);
  const rendimientoPct = round2((kgVendiblesIngreso / pesoIngresadoKg) * 100);
  const resultado = calcular4Estrategias({
    nombre: plantilla.nombre,
    costoKgPadre,
    pesoTotalKg: pesoIngresadoKg,
    rentabilidadObjetivoPct: Number(plantilla.rentabilidad_objetivo_pct ?? 0),
    cortes: cortesIngreso.map((corte) => ({
      id: corte.producto_id,
      nombre: corte.nombre,
      kgRendimiento: corte.cantidad,
      factorAjustePct: corte.factor_ajuste_pct,
      precioAnclado: corte.precio_anclado,
    })),
  });
  const precioPorProducto = new Map(
    resultado.cortes.map((corte) => {
      const precio =
        estrategia === 'variable'
          ? corte.variable.precioKg
          : estrategia === 'fija'
            ? corte.fija.precioKg
            : corte.anclada.precioKg;
      return [String(corte.id), precio == null ? null : round2(precio)] as const;
    }),
  );

  const movimientos: Array<{
    producto_id: string;
    nombre: string;
    cantidad: number;
    movimiento_id: string | null;
    precio_venta_nuevo: number | null;
  }> = [];

  const previewMovimientos = cortesIngreso
    .map((corte) => {
      const productoId = corte.producto_id;
      const cantidad = corte.cantidad;
      const precioCalculado = aplicarPrecios ? precioPorProducto.get(productoId) ?? null : null;
      const precioVentaNuevo = preciosEditados.has(productoId) ? preciosEditados.get(productoId)! : precioCalculado;
      return {
        producto_id: productoId,
        nombre: corte.nombre,
        cantidad,
        movimiento_id: null,
        precio_venta_nuevo: precioVentaNuevo,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (preview) {
    return NextResponse.json({
      preview: true,
      plantilla_id: plantillaId,
      sucursal_id: sucursalScope.sucursalId,
      peso_ingresado_kg: pesoIngresadoKg,
      costo_kg: costoKgPadre,
      costo_efectivo_kg_corte: costoEfectivoKgCorte,
      kg_vendibles: kgVendiblesIngreso,
      merma_kg: mermaKg,
      merma_pct: mermaPct,
      rendimiento_pct: rendimientoPct,
      movimientos: previewMovimientos,
      resultado,
    });
  }

  if (registrarIngresoPadre || registrarFacturaCompra) {
    if (!plantilla.producto_padre_id) {
      return NextResponse.json(
        { error: 'La plantilla necesita un producto padre para registrar el ingreso.' },
        { status: 400 },
      );
    }
    if (!proveedorId) {
      return NextResponse.json(
        { error: 'Selecciona un proveedor para registrar el ingreso del padre.' },
        { status: 400 },
      );
    }
  }

  if (registrarFacturaCompra) {
    if (!TIPOS_COMPRA_PADRE.has(tipoComprobanteCompra)) {
      return NextResponse.json({ error: 'Tipo de comprobante de compra invalido.' }, { status: 400 });
    }
    if (!isYmd(fechaCompra)) {
      return NextResponse.json({ error: 'La fecha de compra es obligatoria.' }, { status: 400 });
    }
    if (fechaVencimientoCompra != null && !isYmd(fechaVencimientoCompra)) {
      return NextResponse.json({ error: 'La fecha de vencimiento de compra es invalida.' }, { status: 400 });
    }
    if (
      puntoVentaCompra == null ||
      numeroDocumentoCompra == null ||
      puntoVentaCompra <= 0 ||
      numeroDocumentoCompra <= 0
    ) {
      return NextResponse.json(
        { error: 'Ingresa punto de venta y numero de comprobante para la factura de compra.' },
        { status: 400 },
      );
    }
  }

  let comprobanteCompraId: string | null = null;
  let movimientoPadre: {
    producto_id: string;
    nombre: string;
    cantidad: number;
    movimiento_id: string | null;
    comprobante_id: string | null;
  } | null = null;

  if (plantilla.producto_padre_id) {
    await session.supabase
      .from('producto')
      .update({
        precio_costo: costoKgPadre,
        es_despiece_padre: true,
        iva_porcentaje: IVA_DESPIECE,
        ...(proveedorId && (registrarIngresoPadre || registrarFacturaCompra) ? { proveedor_id: proveedorId } : {}),
      } as Database['public']['Tables']['producto']['Update'])
      .eq('id', plantilla.producto_padre_id)
      .eq('tenant_id', session.tenantId);

    await recalcularPreciosSucursalConGanancia(session.supabase, {
      tenantId: session.tenantId,
      productoId: plantilla.producto_padre_id,
    });
  }

  if (registrarFacturaCompra && plantilla.producto_padre_id && proveedorId && fechaCompra) {
    const importesCompra = calcularImportes(
      [
        {
          producto_id: plantilla.producto_padre_id,
          cantidad: pesoIngresadoKg,
          precio_unitario: costoKgPadre,
          iva_porcentaje: IVA_DESPIECE,
        },
      ],
      tipoComprobanteCompra,
      IVA_DESPIECE,
      true,
    );
    const compraBody: ConfirmarImportadoBody = {
      log_id: null,
      direccion: 'recibida',
      proveedor_id: proveedorId,
      cliente_id: null,
      crear_proveedor: null,
      crear_cliente: null,
      tipo_comprobante: tipoComprobanteCompra,
      tipo_operacion: 'compra',
      fecha: fechaCompra,
      punto_venta: puntoVentaCompra,
      numero_documento: numeroDocumentoCompra,
      cae: null,
      cae_vencimiento: null,
      items: [
        {
          producto_id: plantilla.producto_padre_id,
          crear_desde_factura: null,
          cantidad: pesoIngresadoKg,
          precio_unitario: costoKgPadre,
          precio_costo: costoKgPadre,
          iva_porcentaje: IVA_DESPIECE,
          unidad_factura: 'kg',
          descripcion_factura: plantilla.producto_padre?.nombre ?? plantilla.nombre,
          codigo_factura: null,
        },
      ],
      subtotal: importesCompra.subtotal,
      iva_monto: importesCompra.iva_monto,
      percepcion_iibb_monto: 0,
      percepcion_iva_monto: 0,
      impuesto_interno_monto: 0,
      total: importesCompra.total,
      actualizar_costos: false,
      afecta_stock: false,
      afecta_cuenta_corriente: true,
      observaciones:
        observacionesCompra ??
        `Compra registrada desde despiece: ${plantilla.nombre}`.slice(0, 500),
      fecha_vencimiento_sugerida: fechaVencimientoCompra ?? fechaCompra,
      pago: fechaVencimientoCompra
        ? { estado: 'pendiente_fecha_custom', vencimiento_at: fechaVencimientoCompra }
        : null,
      importes_manuales: false,
    };

    const compraResult = await ejecutarConfirmacionImportado(
      session.supabase,
      session.tenantId,
      sucursalScope.sucursalId,
      session.userId,
      compraBody,
      'manual',
    );
    if (!compraResult.ok) {
      return NextResponse.json(
        {
          error: compraResult.error,
          ...(compraResult.detalle != null ? { detalle: compraResult.detalle } : {}),
        },
        { status: compraResult.status },
      );
    }
    comprobanteCompraId = compraResult.comprobante_id;
  }

  if (registrarIngresoPadre && plantilla.producto_padre_id && proveedorId) {
    const { data: movPadreRow, error: movPadreErr } = await session.supabase.rpc('registrar_movimiento', {
      p_tenant_id: session.tenantId,
      p_producto_id: plantilla.producto_padre_id,
      p_sucursal_id: sucursalScope.sucursalId,
      p_tipo: 'entrada',
      p_cantidad: pesoIngresadoKg,
      p_motivo: `Ingreso pieza padre por despiece: ${plantilla.nombre}`,
      p_referencia_tipo: comprobanteCompraId ? 'factura_recibida' : 'manual',
      p_referencia_id: comprobanteCompraId,
      p_usuario_id: session.userId,
      p_proveedor_id: proveedorId,
    });
    if (movPadreErr) return NextResponse.json({ error: movPadreErr.message }, { status: 500 });

    const movimientoPadreId = (movPadreRow as { id: string } | null)?.id ?? null;
    await registrarLoteIngreso(session.supabase, {
      tenantId: session.tenantId,
      productoId: plantilla.producto_padre_id,
      sucursalId: sucursalScope.sucursalId,
      proveedorId,
      cantidad: pesoIngresadoKg,
      fechaVencimiento,
      precioCosto: costoKgPadre,
      origen: 'manual',
      movimientoId: movimientoPadreId,
      creadoPor: session.userId,
    });

    movimientoPadre = {
      producto_id: plantilla.producto_padre_id,
      nombre: plantilla.producto_padre?.nombre ?? plantilla.nombre,
      cantidad: pesoIngresadoKg,
      movimiento_id: movimientoPadreId,
      comprobante_id: comprobanteCompraId,
    };
  }

  for (const corte of cortesIngreso) {
    const productoId = corte.producto_id;
    const cantidad = corte.cantidad;
    if (!(cantidad > 0)) continue;

    const precioCalculado = aplicarPrecios ? precioPorProducto.get(productoId) ?? null : null;
    const precioVentaNuevo = preciosEditados.has(productoId) ? preciosEditados.get(productoId)! : precioCalculado;
    const updateProducto: Database['public']['Tables']['producto']['Update'] = {
      precio_costo:
        precioVentaNuevo != null
          ? costoCatalogoDesdePrecioVentaDespiece(
              precioVentaNuevo,
              Number(plantilla.rentabilidad_objetivo_pct ?? 0),
            )
          : costoEfectivoKgCorte,
      iva_porcentaje: IVA_DESPIECE,
    };
    if (precioVentaNuevo != null) updateProducto.precio_venta = precioVentaNuevo;

    const { error: updErr } = await session.supabase
      .from('producto')
      .update(updateProducto)
      .eq('id', productoId)
      .eq('tenant_id', session.tenantId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

    if (precioVentaNuevo != null) {
      try {
        await upsertPrecioSucursalDespiece(session.supabase, {
          tenantId: session.tenantId,
          productoId,
          sucursalId: sucursalScope.sucursalId,
          precioCosto: Number(updateProducto.precio_costo ?? costoEfectivoKgCorte),
          precioVenta: precioVentaNuevo,
        });
      } catch (precioSucursalError) {
        return NextResponse.json(
          {
            error:
              precioSucursalError instanceof Error
                ? precioSucursalError.message
                : 'No se pudo actualizar el precio de la sucursal.',
          },
          { status: 400 },
        );
      }
    }

    await recalcularPreciosSucursalConGanancia(session.supabase, {
      tenantId: session.tenantId,
      productoId,
    });

    const { data: movRow, error: movErr } = await session.supabase.rpc('registrar_movimiento', {
      p_tenant_id: session.tenantId,
      p_producto_id: productoId,
      p_sucursal_id: sucursalScope.sucursalId,
      p_tipo: 'entrada',
      p_cantidad: cantidad,
      p_motivo: `Ingreso por despiece: ${plantilla.nombre}`,
      p_referencia_tipo: 'manual',
      p_referencia_id: null,
      p_usuario_id: session.userId,
      p_proveedor_id: proveedorId,
    });
    if (movErr) return NextResponse.json({ error: movErr.message }, { status: 500 });

    const movimientoId = (movRow as { id: string } | null)?.id ?? null;
    await registrarLoteIngreso(session.supabase, {
      tenantId: session.tenantId,
      productoId,
      sucursalId: sucursalScope.sucursalId,
      proveedorId,
      cantidad,
      fechaVencimiento,
      precioCosto: costoEfectivoKgCorte,
      origen: 'manual',
      movimientoId,
      creadoPor: session.userId,
    });

    movimientos.push({
      producto_id: productoId,
      nombre: corte.nombre,
      cantidad,
      movimiento_id: movimientoId,
      precio_venta_nuevo: precioVentaNuevo,
    });
  }

  return NextResponse.json({
    plantilla_id: plantillaId,
    sucursal_id: sucursalScope.sucursalId,
    peso_ingresado_kg: pesoIngresadoKg,
    costo_kg: costoKgPadre,
    costo_efectivo_kg_corte: costoEfectivoKgCorte,
    kg_vendibles: kgVendiblesIngreso,
    merma_kg: mermaKg,
    merma_pct: mermaPct,
    rendimiento_pct: rendimientoPct,
    movimiento_padre: movimientoPadre,
    comprobante_compra_id: comprobanteCompraId,
    movimientos,
    resultado,
  });
}
