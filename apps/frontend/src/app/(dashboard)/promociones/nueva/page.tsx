'use client';

import { PromocionForm } from '@/components/promociones/promocion-form';

export default function NuevaPromocionPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nueva promoción</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Definí el tipo de descuento, vigencia y los productos incluidos.
        </p>
      </div>
      <PromocionForm cancelHref="/promociones" />
    </div>
  );
}
