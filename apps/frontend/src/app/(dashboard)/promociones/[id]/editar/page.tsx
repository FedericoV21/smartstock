'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { PromocionForm, type PromocionFormInitial } from '@/components/promociones/promocion-form';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PromocionTipo, RangoVolumen } from '@/types/promociones';

type ApiProductoPromo = {
  producto_id: string;
  producto_variante_id?: string | null;
  producto: { id: string; nombre: string; codigo: string; precio_venta: number } | null;
};

type ApiComboItem = {
  producto_id: string;
  producto_variante_id?: string | null;
  cantidad: number;
  producto: { id: string; nombre: string; codigo: string } | null;
};

export default function EditarPromocionPage() {
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const [initial, setInitial] = useState<PromocionFormInitial | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await fetch(`/api/promociones/${id}`);
    const json = await res.json();
    if (!res.ok) {
      setNotFound(res.status === 404);
      setInitial(null);
      setLoading(false);
      return;
    }
    const vinculos = (json.producto_promocion ?? []) as ApiProductoPromo[];
    const productos = vinculos.map((v) => ({
      id: v.producto_id,
      nombre: v.producto?.nombre ?? '—',
      codigo: v.producto?.codigo ?? '',
      producto_variante_id: v.producto_variante_id ?? null,
      variante_etiqueta: v.producto_variante_id ? 'Variante' : null,
    }));
    const comboRaw = (json.promocion_combo_item ?? []) as ApiComboItem[];
    const combo_items = comboRaw.map((x) => ({
      producto_id: x.producto_id,
      producto_variante_id: x.producto_variante_id ?? null,
      variante_etiqueta: x.producto_variante_id ? 'Variante' : null,
      cantidad: x.cantidad,
      nombre: x.producto?.nombre ?? '—',
      codigo: x.producto?.codigo ?? '',
    }));
    const siempre_vigente = json.vigente_desde == null && json.vigente_hasta == null;
    setInitial({
      nombre: String(json.nombre ?? ''),
      tipo: json.tipo as PromocionTipo,
      siempre_vigente,
      vigente_desde: json.vigente_desde as string | null,
      vigente_hasta: json.vigente_hasta as string | null,
      dias_semana: json.dias_semana as number[] | null,
      cantidad_lleva: json.cantidad_lleva as number | null,
      cantidad_paga: json.cantidad_paga as number | null,
      unidad_descuento: json.unidad_descuento as number | null,
      porcentaje: json.porcentaje as number | null,
      cantidad_minima: json.cantidad_minima as number | null,
      rangos_volumen: (json.rangos_volumen as RangoVolumen[] | null) ?? null,
      precio_combo: json.precio_combo as number | null,
      combo_items,
      sucursal_ids: Array.isArray(json.sucursal_ids) ? (json.sucursal_ids as string[]) : [],
      productos,
    });
    setNotFound(false);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!id) {
    return <p className="text-sm text-muted-foreground">ID inválido</p>;
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  if (notFound || !initial) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">Promoción no encontrada.</p>
        <Link href="/promociones" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
          Volver al listado
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Editar promoción</h1>
          <p className="mt-1 text-sm text-muted-foreground">{initial.nombre}</p>
        </div>
        <Link href={`/promociones/${id}`} className="shrink-0">
          <Button type="button" variant="outline" size="sm">
            Ver detalle
          </Button>
        </Link>
      </div>
      <PromocionForm promocionId={id} initial={initial} cancelHref={`/promociones/${id}`} />
    </div>
  );
}
