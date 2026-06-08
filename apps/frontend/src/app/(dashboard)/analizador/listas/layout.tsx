import { requireModulo } from '@/lib/modulos/page-guard';

export default async function AnalizadorListasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModulo('importador_excel');
  return <>{children}</>;
}
