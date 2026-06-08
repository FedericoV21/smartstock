-- V01-DB-005: datos de prueba para 2 tenants (RLS / desarrollo).
-- Requisitos: migraciones aplicadas y función public.registrar_movimiento.
-- Si ya existen estos UUIDs, borrar datos de esos tenants antes de re-ejecutar.

BEGIN;

-- ========== Tenant A: plan base — Almacén Don Pedro ==========
INSERT INTO public.tenant (
  id, nombre, razon_social, cuit, domicilio, telefono, email,
  condicion_iva, plan, activo
) VALUES (
  'f0000001-0000-4000-8000-000000000001',
  'Almacén Don Pedro',
  'Don Pedro S.R.L.',
  '30-70851439-9',
  'Av. San Martín 1450, Rosario, Santa Fe',
  '0341-5550142',
  'contacto@almacendonpedro.test',
  'monotributista',
  'base',
  true
);

INSERT INTO public.modulo_config (
  tenant_id,
  stock, importador_excel, facturador_simple, facturador_arca, facturador_pos,
  pedidos, presupuestos, ia_precios, analizador_rentabilidad, lector_facturas
) VALUES (
  'f0000001-0000-4000-8000-000000000001',
  true, true, true, true, true,
  true, false, false, false, false
);

INSERT INTO public.categoria (id, tenant_id, nombre, descripcion) VALUES
  ('f0000001-0000-4000-8000-000000000011', 'f0000001-0000-4000-8000-000000000001', 'Almacén', 'Fiambres, lácteos y despensa'),
  ('f0000001-0000-4000-8000-000000000012', 'f0000001-0000-4000-8000-000000000001', 'Bebidas', 'Gaseosas, jugos y agua'),
  ('f0000001-0000-4000-8000-000000000013', 'f0000001-0000-4000-8000-000000000001', 'Limpieza', 'Detergentes y papel');

INSERT INTO public.proveedor (id, tenant_id, nombre, cuit, telefono, email, direccion) VALUES
  ('f0000001-0000-4000-8000-000000000021', 'f0000001-0000-4000-8000-000000000001', 'Distribuidora Norte S.A.', '30-71111222-3', '011-4444-9000', 'ventas@distnorte.test', 'Av. Corrientes 3200, CABA'),
  ('f0000001-0000-4000-8000-000000000022', 'f0000001-0000-4000-8000-000000000001', 'Mayorista Sur', '27-55666777-4', '0221-5557788', 'pedidos@mayorsur.test', 'Calle Mitre 890, La Plata');

INSERT INTO public.producto (
  id, tenant_id, codigo, nombre, descripcion, categoria_id, proveedor_id,
  unidad, precio_costo, precio_venta, stock_actual, stock_minimo, activo
) VALUES
  ('f0000001-0000-4000-8000-000000000031', 'f0000001-0000-4000-8000-000000000001', 'ADP-001', 'Yerba Amanda 1 kg', 'Yerba mate con palo', 'f0000001-0000-4000-8000-000000000011', 'f0000001-0000-4000-8000-000000000021', 'unidad', 2800.00, 4200.00, 0, 12, true),
  ('f0000001-0000-4000-8000-000000000032', 'f0000001-0000-4000-8000-000000000001', 'ADP-002', 'Dulce de leche Havanna 450g', 'Dulce de leche repostero', 'f0000001-0000-4000-8000-000000000011', 'f0000001-0000-4000-8000-000000000021', 'unidad', 2100.00, 3490.00, 0, 8, true),
  ('f0000001-0000-4000-8000-000000000033', 'f0000001-0000-4000-8000-000000000001', 'ADP-003', 'Aceite girasol Natura 900 ml', 'Aceite de girasol', 'f0000001-0000-4000-8000-000000000011', 'f0000001-0000-4000-8000-000000000022', 'unidad', 1650.00, 2590.00, 0, 10, true),
  ('f0000001-0000-4000-8000-000000000034', 'f0000001-0000-4000-8000-000000000001', 'ADP-004', 'Arroz gallo Oro 1 kg', 'Arroz blanco largo fino', 'f0000001-0000-4000-8000-000000000011', 'f0000001-0000-4000-8000-000000000022', 'unidad', 980.00, 1590.00, 0, 15, true),
  ('f0000001-0000-4000-8000-000000000035', 'f0000001-0000-4000-8000-000000000001', 'ADP-005', 'Fideos Matarazzo mostachol 500g', 'Fideos secos', 'f0000001-0000-4000-8000-000000000011', 'f0000001-0000-4000-8000-000000000021', 'unidad', 620.00, 990.00, 0, 20, true),
  ('f0000001-0000-4000-8000-000000000036', 'f0000001-0000-4000-8000-000000000001', 'ADP-006', 'Coca-Cola 1,5 L', 'Gaseosa cola', 'f0000001-0000-4000-8000-000000000012', 'f0000001-0000-4000-8000-000000000021', 'unidad', 1450.00, 2290.00, 0, 24, true),
  ('f0000001-0000-4000-8000-000000000037', 'f0000001-0000-4000-8000-000000000001', 'ADP-007', 'Agua Villavicencio 2 L', 'Agua sin gas', 'f0000001-0000-4000-8000-000000000012', 'f0000001-0000-4000-8000-000000000022', 'unidad', 520.00, 890.00, 0, 30, true),
  ('f0000001-0000-4000-8000-000000000038', 'f0000001-0000-4000-8000-000000000001', 'ADP-008', 'Lavandina Ayudín 1 L', 'Lavandina tradicional', 'f0000001-0000-4000-8000-000000000013', 'f0000001-0000-4000-8000-000000000022', 'unidad', 480.00, 790.00, 0, 15, true),
  ('f0000001-0000-4000-8000-000000000039', 'f0000001-0000-4000-8000-000000000001', 'ADP-009', 'Papel higiénico Felpita 4 rollos', 'Papel higiénico doble hoja', 'f0000001-0000-4000-8000-000000000013', 'f0000001-0000-4000-8000-000000000021', 'pack', 1100.00, 1890.00, 0, 10, true),
  ('f0000001-0000-4000-8000-00000000003a', 'f0000001-0000-4000-8000-000000000001', 'ADP-010', 'Mermelada light BC 390g', 'Mermelada de frutos rojos', 'f0000001-0000-4000-8000-000000000011', 'f0000001-0000-4000-8000-000000000021', 'unidad', 950.00, 1590.00, 0, 8, true);

SELECT public.registrar_movimiento('f0000001-0000-4000-8000-000000000001', 'f0000001-0000-4000-8000-000000000031', (SELECT sucursal_id FROM public.producto WHERE id = 'f0000001-0000-4000-8000-000000000031'), 'entrada'::public.tipo_movimiento, 48, 'Ingreso inicial', 'importacion', NULL, NULL, NULL);
SELECT public.registrar_movimiento('f0000001-0000-4000-8000-000000000001', 'f0000001-0000-4000-8000-000000000032', (SELECT sucursal_id FROM public.producto WHERE id = 'f0000001-0000-4000-8000-000000000032'), 'entrada'::public.tipo_movimiento, 36, 'Ingreso inicial', 'importacion', NULL, NULL, NULL);
SELECT public.registrar_movimiento('f0000001-0000-4000-8000-000000000001', 'f0000001-0000-4000-8000-000000000033', (SELECT sucursal_id FROM public.producto WHERE id = 'f0000001-0000-4000-8000-000000000033'), 'entrada'::public.tipo_movimiento, 60, 'Ingreso inicial', 'importacion', NULL, NULL, NULL);
SELECT public.registrar_movimiento('f0000001-0000-4000-8000-000000000001', 'f0000001-0000-4000-8000-000000000034', (SELECT sucursal_id FROM public.producto WHERE id = 'f0000001-0000-4000-8000-000000000034'), 'entrada'::public.tipo_movimiento, 80, 'Ingreso inicial', 'importacion', NULL, NULL, NULL);
SELECT public.registrar_movimiento('f0000001-0000-4000-8000-000000000001', 'f0000001-0000-4000-8000-000000000035', (SELECT sucursal_id FROM public.producto WHERE id = 'f0000001-0000-4000-8000-000000000035'), 'entrada'::public.tipo_movimiento, 100, 'Ingreso inicial', 'importacion', NULL, NULL, NULL);
SELECT public.registrar_movimiento('f0000001-0000-4000-8000-000000000001', 'f0000001-0000-4000-8000-000000000036', (SELECT sucursal_id FROM public.producto WHERE id = 'f0000001-0000-4000-8000-000000000036'), 'entrada'::public.tipo_movimiento, 80, 'Ingreso inicial bebidas', 'importacion', NULL, NULL, NULL);
SELECT public.registrar_movimiento('f0000001-0000-4000-8000-000000000001', 'f0000001-0000-4000-8000-000000000036', (SELECT sucursal_id FROM public.producto WHERE id = 'f0000001-0000-4000-8000-000000000036'), 'salida'::public.tipo_movimiento, 12, 'Venta mostrador', 'manual', NULL, NULL, NULL);

-- ========== Tenant B: plan completo — Distribuidora López ==========
INSERT INTO public.tenant (
  id, nombre, razon_social, cuit, domicilio, telefono, email,
  condicion_iva, plan, activo
) VALUES (
  'f0000002-0000-4000-8000-000000000001',
  'Distribuidora López',
  'López Hnos. S.A.',
  '30-59998888-7',
  'Ruta 9 km 234, San Francisco, Córdoba',
  '03564-421900',
  'admin@distribuidoralopez.test',
  'responsable_inscripto',
  'completo',
  true
);

INSERT INTO public.modulo_config (
  tenant_id,
  stock, importador_excel, facturador_simple, facturador_arca, facturador_pos,
  pedidos, presupuestos, ia_precios, analizador_rentabilidad, lector_facturas
) VALUES (
  'f0000002-0000-4000-8000-000000000001',
  true, true, true, true, true,
  true, true, true, true, true
);

INSERT INTO public.categoria (id, tenant_id, nombre, descripcion) VALUES
  ('f0000002-0000-4000-8000-000000000011', 'f0000002-0000-4000-8000-000000000001', 'Abarrotes', 'Despensa y almacén'),
  ('f0000002-0000-4000-8000-000000000012', 'f0000002-0000-4000-8000-000000000001', 'Bebidas', 'Con y sin alcohol'),
  ('f0000002-0000-4000-8000-000000000013', 'f0000002-0000-4000-8000-000000000001', 'Frescos', 'Lácteos y fiambres'),
  ('f0000002-0000-4000-8000-000000000014', 'f0000002-0000-4000-8000-000000000001', 'Limpieza', 'Químicos e higiene'),
  ('f0000002-0000-4000-8000-000000000015', 'f0000002-0000-4000-8000-000000000001', 'Descartables', 'Vasos, cubiertos, film');

INSERT INTO public.proveedor (id, tenant_id, nombre, cuit, telefono, email, direccion) VALUES
  ('f0000002-0000-4000-8000-000000000021', 'f0000002-0000-4000-8000-000000000001', 'Arcor Distribución', '30-70000001-8', '0351-4990000', 'logistica@arcor.test', 'Arroyito, Córdoba'),
  ('f0000002-0000-4000-8000-000000000022', 'f0000002-0000-4000-8000-000000000001', 'Molinos Río de la Plata', '30-50001111-2', '011-4340-5000', 'mayoristas@molinosp.test', 'Av. del Libertador 1850, Vicente López'),
  ('f0000002-0000-4000-8000-000000000023', 'f0000002-0000-4000-8000-000000000001', 'Papelera del Plata', '30-63334444-1', '03491-432100', 'ventas@papelera.test', 'Zona industrial Río Tercero');

INSERT INTO public.producto (
  id, tenant_id, codigo, nombre, descripcion, categoria_id, proveedor_id,
  unidad, precio_costo, precio_venta, stock_actual, stock_minimo, activo
) VALUES
  ('f0000002-0000-4000-8000-000000000031', 'f0000002-0000-4000-8000-000000000001', 'DLZ-001', 'Alfajor Jorgito triple chocolate', 'Caja x 6 unidades', 'f0000002-0000-4000-8000-000000000011', 'f0000002-0000-4000-8000-000000000021', 'caja', 4200.00, 6890.00, 0, 10, true),
  ('f0000002-0000-4000-8000-000000000032', 'f0000002-0000-4000-8000-000000000001', 'DLZ-002', 'Galletitas Oreo 118g', 'Galletitas rellenas', 'f0000002-0000-4000-8000-000000000011', 'f0000002-0000-4000-8000-000000000021', 'unidad', 890.00, 1490.00, 0, 40, true),
  ('f0000002-0000-4000-8000-000000000033', 'f0000002-0000-4000-8000-000000000001', 'DLZ-003', 'Puré de tomate Arcor 520g', 'Puré listo', 'f0000002-0000-4000-8000-000000000011', 'f0000002-0000-4000-8000-000000000021', 'unidad', 550.00, 920.00, 0, 30, true),
  ('f0000002-0000-4000-8000-000000000034', 'f0000002-0000-4000-8000-000000000001', 'DLZ-004', 'Sal fina Celusal 500g', 'Sal de mesa', 'f0000002-0000-4000-8000-000000000011', 'f0000002-0000-4000-8000-000000000022', 'unidad', 380.00, 650.00, 0, 25, true),
  ('f0000002-0000-4000-8000-000000000035', 'f0000002-0000-4000-8000-000000000001', 'DLZ-005', 'Azúcar Ledesma 1 kg', 'Azúcar blanca', 'f0000002-0000-4000-8000-000000000011', 'f0000002-0000-4000-8000-000000000022', 'unidad', 920.00, 1550.00, 0, 20, true),
  ('f0000002-0000-4000-8000-000000000036', 'f0000002-0000-4000-8000-000000000001', 'DLZ-006', 'Cerveza Quilmes 1 L', 'Cerveza rubia', 'f0000002-0000-4000-8000-000000000012', 'f0000002-0000-4000-8000-000000000021', 'unidad', 980.00, 1650.00, 0, 48, true),
  ('f0000002-0000-4000-8000-000000000037', 'f0000002-0000-4000-8000-000000000001', 'DLZ-007', 'Vino Toro tinto 750 ml', 'Mesa tinto', 'f0000002-0000-4000-8000-000000000012', 'f0000002-0000-4000-8000-000000000022', 'unidad', 1100.00, 1890.00, 0, 24, true),
  ('f0000002-0000-4000-8000-000000000038', 'f0000002-0000-4000-8000-000000000001', 'DLZ-008', 'Leche La Serenísima 1 L', 'Leche entera larga vida', 'f0000002-0000-4000-8000-000000000013', 'f0000002-0000-4000-8000-000000000022', 'litro', 980.00, 1650.00, 0, 60, true),
  ('f0000002-0000-4000-8000-000000000039', 'f0000002-0000-4000-8000-000000000001', 'DLZ-009', 'Queso cremoso La Paulina 1 kg', 'Queso barra', 'f0000002-0000-4000-8000-000000000013', 'f0000002-0000-4000-8000-000000000022', 'kg', 8500.00, 12990.00, 0, 8, true),
  ('f0000002-0000-4000-8000-00000000003a', 'f0000002-0000-4000-8000-000000000001', 'DLZ-010', 'Jamón cocido Paladini 200g', 'Fiambre refrigerado', 'f0000002-0000-4000-8000-000000000013', 'f0000002-0000-4000-8000-000000000021', 'unidad', 3200.00, 4990.00, 0, 15, true),
  ('f0000002-0000-4000-8000-00000000003b', 'f0000002-0000-4000-8000-000000000001', 'DLZ-011', 'Detergente Magistral limón 750 ml', 'Lavavajillas', 'f0000002-0000-4000-8000-000000000014', 'f0000002-0000-4000-8000-000000000023', 'unidad', 1200.00, 1990.00, 0, 18, true),
  ('f0000002-0000-4000-8000-00000000003c', 'f0000002-0000-4000-8000-000000000001', 'DLZ-012', 'Limpiador Cif multisuperficie', 'Limpiador líquido', 'f0000002-0000-4000-8000-000000000014', 'f0000002-0000-4000-8000-000000000023', 'unidad', 1400.00, 2290.00, 0, 12, true),
  ('f0000002-0000-4000-8000-00000000003d', 'f0000002-0000-4000-8000-000000000001', 'DLZ-013', 'Film adherente 30 m', 'Rollo cocina', 'f0000002-0000-4000-8000-000000000015', 'f0000002-0000-4000-8000-000000000023', 'unidad', 900.00, 1550.00, 0, 20, true),
  ('f0000002-0000-4000-8000-00000000003e', 'f0000002-0000-4000-8000-000000000001', 'DLZ-014', 'Vasos plástico 220 ml x 50', 'Descartables', 'f0000002-0000-4000-8000-000000000015', 'f0000002-0000-4000-8000-000000000023', 'pack', 650.00, 1150.00, 0, 15, true),
  ('f0000002-0000-4000-8000-00000000003f', 'f0000002-0000-4000-8000-000000000001', 'DLZ-015', 'Servilletas Elegante 150u', 'Papel servilletas', 'f0000002-0000-4000-8000-000000000015', 'f0000002-0000-4000-8000-000000000023', 'pack', 720.00, 1250.00, 0, 15, true);

SELECT public.registrar_movimiento('f0000002-0000-4000-8000-000000000001', 'f0000002-0000-4000-8000-000000000031', (SELECT sucursal_id FROM public.producto WHERE id = 'f0000002-0000-4000-8000-000000000031'), 'entrada'::public.tipo_movimiento, 24, 'Recepción depósito', 'importacion', NULL, NULL, NULL);
SELECT public.registrar_movimiento('f0000002-0000-4000-8000-000000000001', 'f0000002-0000-4000-8000-000000000032', (SELECT sucursal_id FROM public.producto WHERE id = 'f0000002-0000-4000-8000-000000000032'), 'entrada'::public.tipo_movimiento, 120, 'Recepción depósito', 'importacion', NULL, NULL, NULL);
SELECT public.registrar_movimiento('f0000002-0000-4000-8000-000000000001', 'f0000002-0000-4000-8000-000000000033', (SELECT sucursal_id FROM public.producto WHERE id = 'f0000002-0000-4000-8000-000000000033'), 'entrada'::public.tipo_movimiento, 90, 'Recepción depósito', 'importacion', NULL, NULL, NULL);
SELECT public.registrar_movimiento('f0000002-0000-4000-8000-000000000001', 'f0000002-0000-4000-8000-000000000036', (SELECT sucursal_id FROM public.producto WHERE id = 'f0000002-0000-4000-8000-000000000036'), 'entrada'::public.tipo_movimiento, 200, 'Recepción depósito', 'importacion', NULL, NULL, NULL);
SELECT public.registrar_movimiento('f0000002-0000-4000-8000-000000000001', 'f0000002-0000-4000-8000-000000000038', (SELECT sucursal_id FROM public.producto WHERE id = 'f0000002-0000-4000-8000-000000000038'), 'entrada'::public.tipo_movimiento, 300, 'Recepción depósito lácteos', 'importacion', NULL, NULL, NULL);
SELECT public.registrar_movimiento('f0000002-0000-4000-8000-000000000001', 'f0000002-0000-4000-8000-000000000038', (SELECT sucursal_id FROM public.producto WHERE id = 'f0000002-0000-4000-8000-000000000038'), 'salida'::public.tipo_movimiento, 24, 'Remito mayorista', 'manual', NULL, NULL, NULL);
SELECT public.registrar_movimiento('f0000002-0000-4000-8000-000000000001', 'f0000002-0000-4000-8000-000000000039', (SELECT sucursal_id FROM public.producto WHERE id = 'f0000002-0000-4000-8000-000000000039'), 'ajuste'::public.tipo_movimiento, 40, 'Ajuste inventario anual', 'ajuste_inventario', NULL, NULL, NULL);

COMMIT;
