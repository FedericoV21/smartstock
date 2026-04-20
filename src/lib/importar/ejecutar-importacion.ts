import type { SupabaseClient } from '@supabase/supabase-js';

import { calcularPrecioVenta } from '@/lib/productos/calcular-precio-venta';
import type { Database } from '@/types/database';

type UnidadMedida = Database['public']['Enums']['unidad_medida'];

const UNIDADES_VALIDAS: UnidadMedida[] = [
  'unidad',
  'kg',
  'litro',
  'metro',
  'caja',
  'pack',
  'gramo',
  'ml',
];

function mapUnidad(s: string | null | undefined): UnidadMedida {
  const v = (s ?? 'unidad').toLowerCase().trim();
  return UNIDADES_VALIDAS.includes(v as UnidadMedida) ? (v as UnidadMedida) : 'unidad';
}

export interface FilaImportacion {
  codigo: string | null;
  nombre: string;
  precio_costo?: number | null;
  precio_venta?: number | null;
  stock_actual?: number | null;
  stock_minimo?: number | null;
  categoria?: string | null;
  unidad?: string | null;
  fecha_vencimiento?: string | null;
  codigo_barras?: string | null;
  rubro?: string | null;
  subrubro?: string | null;
  iva_porcentaje?: number | null;
  porcentaje_ganancia?: number | null;
  ubicacion?: string | null;
  moneda?: string | null;
}

export interface EjecutarImportacionParams {
  filas: FilaImportacion[];
  proveedor_id: string | null;
  archivo_nombre: string;
  origen: 'importacion_excel' | 'ia_pdf';
}

export interface EjecutarImportacionResultado {
  total_filas: number;
  productos_creados: number;
  productos_actualizados: number;
  filas_con_error: number;
  detalle_errores: {
    fila: number;
    campo: string;
    valor_original: string;
    error: string;
  }[];
}

function resumirFilaParaError(fila: FilaImportacion): string {
  const raw = JSON.stringify(fila);
  return raw.length > 500 ? `${raw.slice(0, 497)}...` : raw;
}

export async function ejecutarImportacionFilas(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string; userId: string },
  params: EjecutarImportacionParams,
): Promise<EjecutarImportacionResultado> {
  const { filas, proveedor_id, archivo_nombre, origen } = params;
  const tenantId = ctx.tenantId;

  let productosCreados = 0;
  let productosActualizados = 0;
  let filasConError = 0;
  const detalleErrores: EjecutarImportacionResultado['detalle_errores'] = [];

  const { data: categorias } = await supabase
    .from('categoria')
    .select('id, nombre')
    .eq('activa', true);

  const categoriasMap = new Map((categorias ?? []).map((c) => [c.nombre.toLowerCase(), c.id]));

  const { data: tenantRow } = await supabase
    .from('tenant')
    .select('iva_porcentaje_default')
    .eq('id', tenantId)
    .maybeSingle();
  const ivaDefault = tenantRow?.iva_porcentaje_default ?? 21;

  const codigos = Array.from(
    new Set(
      filas
        .map((fila) => fila.codigo?.trim())
        .filter((codigo): codigo is string => Boolean(codigo))
    )
  );
  const productosPorCodigo = new Map<
    string,
    Pick<
      Database['public']['Tables']['producto']['Row'],
      'id' | 'codigo' | 'precio_costo' | 'precio_venta' | 'stock_actual'
    >
  >();

  if (codigos.length > 0) {
    const { data: productosExistentes } = await supabase
      .from('producto')
      .select('id, codigo, precio_costo, precio_venta, stock_actual')
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .in('codigo', codigos);

    for (const producto of productosExistentes ?? []) {
      productosPorCodigo.set(producto.codigo, producto);
    }
  }

  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];

    try {
      if (!fila.nombre || fila.nombre.trim() === '') {
        throw new Error('Nombre vacío');
      }

      let categoriaId: string | null = null;
      if (fila.categoria) {
        const catNombre = fila.categoria.toLowerCase();
        if (categoriasMap.has(catNombre)) {
          categoriaId = categoriasMap.get(catNombre)!;
        } else {
          const { data: nuevaCat, error: nuevaCatError } = await supabase
            .from('categoria')
            .insert({ tenant_id: tenantId, nombre: fila.categoria })
            .select()
            .single();
          if (nuevaCatError) {
            throw new Error(nuevaCatError.message);
          }
          if (nuevaCat) {
            categoriaId = nuevaCat.id;
            categoriasMap.set(catNombre, nuevaCat.id);
          }
        }
      }

      const codigo = fila.codigo?.trim() || null;
      const productoExistente = codigo ? productosPorCodigo.get(codigo) ?? null : null;

      if (productoExistente) {
        const updates: Database['public']['Tables']['producto']['Update'] = {
          nombre: fila.nombre,
        };
        if (fila.precio_costo != null) updates.precio_costo = fila.precio_costo;
        if (fila.precio_venta != null) updates.precio_venta = fila.precio_venta;
        if (fila.stock_minimo != null) updates.stock_minimo = fila.stock_minimo;
        if (fila.unidad) updates.unidad = mapUnidad(fila.unidad);
        if (fila.fecha_vencimiento) updates.fecha_vencimiento = fila.fecha_vencimiento;
        if (fila.codigo_barras) updates.codigo_barras = fila.codigo_barras;
        if (fila.rubro != null) updates.rubro = fila.rubro || null;
        if (fila.subrubro != null) updates.subrubro = fila.subrubro || null;
        if (fila.iva_porcentaje != null) updates.iva_porcentaje = fila.iva_porcentaje;
        if (fila.porcentaje_ganancia != null) updates.porcentaje_ganancia = fila.porcentaje_ganancia;
        if (fila.ubicacion != null) updates.ubicacion = fila.ubicacion || null;
        if (fila.moneda) updates.moneda = fila.moneda;
        if (categoriaId) updates.categoria_id = categoriaId;
        if (proveedor_id) updates.proveedor_id = proveedor_id;

        if (fila.precio_venta == null && fila.porcentaje_ganancia != null && fila.porcentaje_ganancia > 0) {
          const costo = fila.precio_costo ?? productoExistente.precio_costo;
          if (costo > 0) {
            updates.precio_venta = calcularPrecioVenta(
              costo,
              fila.porcentaje_ganancia,
              fila.iva_porcentaje,
              ivaDefault,
            );
          }
        }

        const { error: updateError } = await supabase
          .from('producto')
          .update(updates)
          .eq('id', productoExistente.id)
          .eq('tenant_id', tenantId);
        if (updateError) {
          throw new Error(updateError.message);
        }

        const costoAnterior = productoExistente.precio_costo;
        const ventaAnterior = productoExistente.precio_venta;
        const costoNuevo = fila.precio_costo ?? costoAnterior;
        const ventaNuevo = updates.precio_venta ?? fila.precio_venta ?? ventaAnterior;

        if (costoAnterior !== costoNuevo || ventaAnterior !== ventaNuevo) {
          const margenAnt =
            costoAnterior > 0 ? ((ventaAnterior - costoAnterior) / costoAnterior) * 100 : 0;
          const margenNuevo = costoNuevo > 0 ? ((ventaNuevo - costoNuevo) / costoNuevo) * 100 : 0;

          const { error: historialError } = await supabase.from('precio_historial').insert({
            tenant_id: tenantId,
            producto_id: productoExistente.id,
            precio_costo_anterior: costoAnterior,
            precio_costo_nuevo: costoNuevo,
            precio_venta_anterior: ventaAnterior,
            precio_venta_nuevo: ventaNuevo,
            margen_anterior: margenAnt,
            margen_nuevo: margenNuevo,
            origen,
          });
          if (historialError) {
            throw new Error(historialError.message);
          }
        }

        if (fila.stock_actual != null && fila.stock_actual !== productoExistente.stock_actual) {
          const { error: movimientoError } = await supabase.rpc('registrar_movimiento', {
            p_tenant_id: tenantId,
            p_producto_id: productoExistente.id,
            p_tipo: 'ajuste',
            p_cantidad: fila.stock_actual,
            p_motivo: `Ajuste por importación: ${archivo_nombre}`,
            p_referencia_tipo: 'importacion',
            p_usuario_id: ctx.userId,
          });
          if (movimientoError) {
            throw new Error(movimientoError.message);
          }
        }

        productosActualizados++;
      } else {
        const codigoInsert = codigo || `AUTO-${Date.now()}-${i}`;

        const insertCosto = fila.precio_costo ?? 0;
        let insertVenta = fila.precio_venta ?? 0;
        if (
          insertVenta === 0 &&
          insertCosto > 0 &&
          fila.porcentaje_ganancia != null &&
          fila.porcentaje_ganancia > 0
        ) {
          insertVenta = calcularPrecioVenta(
            insertCosto,
            fila.porcentaje_ganancia,
            fila.iva_porcentaje,
            ivaDefault,
          );
        }

        const { data: nuevoProducto, error: insertErr } = await supabase
          .from('producto')
          .insert({
            tenant_id: tenantId,
            codigo: codigoInsert,
            nombre: fila.nombre,
            categoria_id: categoriaId,
            proveedor_id: proveedor_id,
            unidad: mapUnidad(fila.unidad),
            precio_costo: insertCosto,
            precio_venta: insertVenta,
            stock_actual: 0,
            stock_minimo: fila.stock_minimo ?? 0,
            fecha_vencimiento: fila.fecha_vencimiento || null,
            codigo_barras: fila.codigo_barras || null,
            rubro: fila.rubro || null,
            subrubro: fila.subrubro || null,
            iva_porcentaje: fila.iva_porcentaje ?? null,
            porcentaje_ganancia: fila.porcentaje_ganancia ?? null,
            ubicacion: fila.ubicacion || null,
            moneda: fila.moneda || '$',
          })
          .select()
          .single();

        if (insertErr) {
          if (insertErr.code === '23505' && insertErr.message.includes('barcode')) {
            throw new Error(`Código de barras duplicado: ${fila.codigo_barras}`);
          }
          throw new Error(insertErr.message);
        }

        if (fila.stock_actual && fila.stock_actual > 0 && nuevoProducto) {
          const { error: movimientoError } = await supabase.rpc('registrar_movimiento', {
            p_tenant_id: tenantId,
            p_producto_id: nuevoProducto.id,
            p_tipo: 'entrada',
            p_cantidad: fila.stock_actual,
            p_motivo: `Stock inicial por importación: ${archivo_nombre}`,
            p_referencia_tipo: 'importacion',
            p_usuario_id: ctx.userId,
          });
          if (movimientoError) {
            throw new Error(movimientoError.message);
          }
        }

        if (codigo && nuevoProducto) {
          productosPorCodigo.set(codigo, {
            id: nuevoProducto.id,
            codigo,
            precio_costo: insertCosto,
            precio_venta: insertVenta,
            stock_actual: fila.stock_actual ?? 0,
          });
        }
        productosCreados++;
      }
    } catch (err) {
      filasConError++;
      detalleErrores.push({
        fila: i + 1,
        campo: 'general',
        valor_original: resumirFilaParaError(fila),
        error: (err as Error).message,
      });
    }
  }

  await supabase.from('importacion_log').insert({
    tenant_id: tenantId,
    proveedor_id: proveedor_id,
    archivo_nombre,
    origen,
    total_filas: filas.length,
    filas_exitosas: productosCreados + productosActualizados,
    filas_con_error: filasConError,
    productos_creados: productosCreados,
    productos_actualizados: productosActualizados,
    detalle_errores: detalleErrores.length > 0 ? detalleErrores : null,
    usuario_id: ctx.userId,
  });

  return {
    total_filas: filas.length,
    productos_creados: productosCreados,
    productos_actualizados: productosActualizados,
    filas_con_error: filasConError,
    detalle_errores: detalleErrores,
  };
}
