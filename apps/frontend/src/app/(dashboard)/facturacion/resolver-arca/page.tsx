import { BandejaArcaClient } from './resolver-arca-client';

export default function ResolverArcaPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Centro de errores de factura</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Facturas con estado fiscal pendiente o rechazado. Desde acá podés ver diagnóstico humano,
          corregir CUIT/DNI del receptor con validación en tiempo real, autorizar de nuevo y pasar de
          estado rojo a verde cuando el CAE se obtiene.
        </p>
      </div>
      <BandejaArcaClient />
    </div>
  );
}
