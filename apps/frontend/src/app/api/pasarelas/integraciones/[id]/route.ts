import { NextResponse } from 'next/server';

import {
  DELETE as deleteIntegracion,
  GET as listIntegraciones,
  PATCH as patchIntegracion,
} from '@/app/api/pasarelas/integraciones/route';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  const source = new URL(request.url);
  const url = new URL('/api/pasarelas/integraciones', source.origin);
  if (source.searchParams.get('sucursal_id')) {
    url.searchParams.set('sucursal_id', source.searchParams.get('sucursal_id') ?? '');
  }
  const response = await listIntegraciones(new Request(url, { headers: request.headers }));
  if (!response.ok) return response;
  const payload = (await response.json()) as { integraciones?: Array<{ id?: string }> };
  const integracion = (payload.integraciones ?? []).find((row) => row.id === id);
  if (!integracion) return NextResponse.json({ error: 'Integracion no encontrada' }, { status: 404 });
  return NextResponse.json({ integracion });
}

export async function PATCH(request: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const next = new Request(request.url, {
    method: 'PATCH',
    headers: request.headers,
    body: JSON.stringify({ ...body, id }),
  });
  return patchIntegracion(next);
}

export async function DELETE(request: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  url.searchParams.set('id', id);
  return deleteIntegracion(new Request(url, { method: 'DELETE', headers: request.headers }));
}
