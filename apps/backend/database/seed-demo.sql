-- Datos demo para SmartStock API (Nest + Postgres).
-- Tenant fijo: pon├® el mismo UUID en app_metadata / user_metadata del JWT (tenant_id).
-- Idempotente: borra filas de este tenant y vuelve a insertar.

BEGIN;

DO $seed$
DECLARE
  demo_tenant uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  demo_user   uuid := '33333333-3333-4333-8333-333333333333'::uuid;
  demo_local  uuid := '55555555-5555-4555-8555-555555555555'::uuid;
BEGIN
  DELETE FROM public.arca_job j
    USING public.comprobante c
   WHERE j.comprobante_id = c.id AND c.tenant_id = demo_tenant;

  DELETE FROM public.arca_log WHERE tenant_id = demo_tenant;
  DELETE FROM public.comprobante_item WHERE comprobante_id IN (SELECT id FROM public.comprobante WHERE tenant_id = demo_tenant);
  DELETE FROM public.pedido_item WHERE pedido_id IN (SELECT id FROM public.pedido WHERE tenant_id = demo_tenant);
  DELETE FROM public.pedido WHERE tenant_id = demo_tenant;
  DELETE FROM public.movimiento WHERE tenant_id = demo_tenant;
  DELETE FROM public.precio_historial WHERE tenant_id = demo_tenant;
  DELETE FROM public.producto_promocion WHERE tenant_id = demo_tenant;
  DELETE FROM public.promocion_combo_item WHERE tenant_id = demo_tenant;
  DELETE FROM public.promocion_sucursal WHERE tenant_id = demo_tenant;
  DELETE FROM public.promocion WHERE tenant_id = demo_tenant;
  DELETE FROM public.producto_barcode WHERE tenant_id = demo_tenant;
  DELETE FROM public.comprobante WHERE tenant_id = demo_tenant;
  DELETE FROM public.importacion_log WHERE tenant_id = demo_tenant;
  DELETE FROM public.idempotency_request WHERE tenant_id = demo_tenant;
  DELETE FROM public.pasarela_transaccion WHERE tenant_id = demo_tenant;
  DELETE FROM public.pasarela_webhook_log WHERE tenant_id = demo_tenant;
  DELETE FROM public.pasarela_caja WHERE tenant_id = demo_tenant;
  DELETE FROM public.pasarela_integracion WHERE tenant_id = demo_tenant;
  DELETE FROM public.mp_qr_webhook_log WHERE tenant_id = demo_tenant;
  DELETE FROM public.mp_transferencia_movimiento WHERE tenant_id = demo_tenant;
  DELETE FROM public.mp_transferencia_reporte WHERE tenant_id = demo_tenant;
  DELETE FROM public.mp_qr_config WHERE tenant_id = demo_tenant;
  DELETE FROM public.mp_point_config WHERE tenant_id = demo_tenant;
  DELETE FROM public.caja_turno WHERE tenant_id = demo_tenant;
  DELETE FROM public.cierre_z_medio_pago WHERE tenant_id = demo_tenant;
  DELETE FROM public.cierre_z WHERE tenant_id = demo_tenant;
  DELETE FROM public.caja_apertura WHERE tenant_id = demo_tenant;
  DELETE FROM public.caja_usuario WHERE tenant_id = demo_tenant;
  DELETE FROM public.caja WHERE tenant_id = demo_tenant;
  DELETE FROM public.stock_transferencia_sucursal WHERE tenant_id = demo_tenant;
  DELETE FROM public.usuario_sucursal us
    USING public.usuario u
   WHERE us.usuario_id = u.id AND u.tenant_id = demo_tenant;
  DELETE FROM public.usuario_credencial_local WHERE tenant_id = demo_tenant;
  DELETE FROM public.usuario_rol ur
    USING public.usuario u
   WHERE ur.usuario_id = u.id AND u.tenant_id = demo_tenant;
  DELETE FROM public.usuario_permiso up
    USING public.usuario u
   WHERE up.usuario_id = u.id AND u.tenant_id = demo_tenant;
  DELETE FROM public.usuario_pedido_workflow_estado WHERE tenant_id = demo_tenant;
  DELETE FROM public.usuario WHERE tenant_id = demo_tenant;
  DELETE FROM public.stock_sucursal WHERE tenant_id = demo_tenant;
  DELETE FROM public.producto_variante_stock_sucursal WHERE tenant_id = demo_tenant;
  DELETE FROM public.producto_variante WHERE tenant_id = demo_tenant;
  DELETE FROM public.producto WHERE tenant_id = demo_tenant;
  DELETE FROM public.arca_config WHERE tenant_id = demo_tenant;
  DELETE FROM public.sucursal WHERE tenant_id = demo_tenant;
  DELETE FROM public.pago_proveedor_movimiento WHERE tenant_id = demo_tenant;
  DELETE FROM public.pago_proveedor_factura WHERE tenant_id = demo_tenant;
  DELETE FROM public.pago WHERE tenant_id = demo_tenant;
  DELETE FROM public.cuenta_corriente WHERE tenant_id = demo_tenant;
  DELETE FROM public.cliente WHERE tenant_id = demo_tenant;
  DELETE FROM public.proveedor WHERE tenant_id = demo_tenant;
  DELETE FROM public.categoria WHERE tenant_id = demo_tenant;
  DELETE FROM public.medio_pago_rapido WHERE tenant_id = demo_tenant;
  DELETE FROM public.medio_pago WHERE tenant_id = demo_tenant;
  DELETE FROM public.modulo_config WHERE tenant_id = demo_tenant;
  DELETE FROM public.tenant WHERE id = demo_tenant;

  INSERT INTO public.tenant (id, nombre, razon_social, cuit, activo, domicilio, telefono, email, condicion_iva, plan, codigo_acceso)
  VALUES (
    demo_tenant,
    'Demo Kiosco',
    'Demo Kiosco SRL',
    '20123456789',
    true,
    'Av. Demo 123, CABA',
    '011-5555-0100',
    'demo@kiosco.test',
    'monotributista',
    'base',
    'demo'
  );

  INSERT INTO public.modulo_config (
    tenant_id, stock, importador_excel, facturador_simple, facturador_arca, facturador_pos,
    pedidos, presupuestos, ia_precios, turnos, analizador_rentabilidad, lector_facturas,
    despiece_carniceria
  ) VALUES (
    demo_tenant, true, true, true, true, true, true, false, true, true, false, true, true
  );

  UPDATE public.tenant
  SET business_prefs = COALESCE(business_prefs, '{}'::jsonb) || '{"despieceCarniceriaHabilitado": true}'::jsonb
  WHERE id = demo_tenant;

  INSERT INTO public.rol (tenant_id, slug, nombre, descripcion, es_base, activo)
  VALUES
    (demo_tenant, 'admin', 'Administrador', 'Acceso total al negocio', true, true),
    (demo_tenant, 'operador', 'Operador', 'Operación diaria', true, true),
    (demo_tenant, 'visor', 'Visor', 'Solo lectura', true, true);

  INSERT INTO public.medio_pago (id, tenant_id, nombre, activo, orden)
  VALUES ('90000001-0001-4001-8001-000000000001', demo_tenant, 'Tarjeta cr├®dito', true, 0);

  INSERT INTO public.medio_pago_opcion (id, medio_pago_id, cuotas, recargo_porcentaje)
  VALUES
    ('90000001-0001-4001-8001-000000000011', '90000001-0001-4001-8001-000000000001', 1, 0),
    ('90000001-0001-4001-8001-000000000012', '90000001-0001-4001-8001-000000000001', 3, 12.5),
    ('90000001-0001-4001-8001-000000000013', '90000001-0001-4001-8001-000000000001', 6, 18);

  INSERT INTO public.medio_pago_rapido (tenant_id, codigo, recargo_porcentaje)
  VALUES (demo_tenant, 'credito', 5);

  INSERT INTO public.sucursal (
    id, tenant_id, codigo, nombre, direccion, activa, es_principal, hereda_datos_ticket
  ) VALUES (
    'd0000001-0001-4001-8001-000000000001',
    demo_tenant,
    'CASA',
    'Sucursal Principal',
    'Av. Demo 123, CABA',
    true,
    true,
    true
  );

  INSERT INTO public.usuario (
    id, tenant_id, nombre, apellido, email, rol, activo, es_super_admin, sucursal_default_id
  ) VALUES (
    demo_user,
    demo_tenant,
    'Admin',
    'Demo',
    'demo@kiosco.test',
    'admin',
    true,
    false,
    'd0000001-0001-4001-8001-000000000001'
  );

  INSERT INTO public.usuario_sucursal (usuario_id, sucursal_id)
  VALUES (demo_user, 'd0000001-0001-4001-8001-000000000001');

  INSERT INTO public.usuario_rol (usuario_id, rol_id)
  SELECT demo_user, r.id
    FROM public.rol r
   WHERE r.tenant_id = demo_tenant AND r.slug = 'admin';

  INSERT INTO public.usuario (
    id, tenant_id, nombre, apellido, email, rol, activo, es_super_admin, sucursal_default_id
  ) VALUES (
    demo_local,
    demo_tenant,
    'Cajero',
    'Demo',
    'l7abce93aa66af36de2022c94224a840a@example.invalid',
    'operador',
    true,
    false,
    'd0000001-0001-4001-8001-000000000001'
  );

  INSERT INTO public.usuario_sucursal (usuario_id, sucursal_id)
  VALUES (demo_local, 'd0000001-0001-4001-8001-000000000001');

  INSERT INTO public.usuario_credencial_local (
    usuario_id, tenant_id, username_local, pin_hash, pin_temporal, activo, intentos_fallidos
  ) VALUES (
    demo_local,
    demo_tenant,
    'cajero',
    's1$demo_seed_salt_001$2c0256918519ca3d93253c45945e774181669d7bf67e4f39717dd67e9bfaaedb80ab4ba5fc91d41550b704a87830d57617c991541fbb2a92d154d971187f6e34',
    false,
    true,
    0
  );

  INSERT INTO public.usuario_rol (usuario_id, rol_id)
  SELECT demo_local, r.id
    FROM public.rol r
   WHERE r.tenant_id = demo_tenant AND r.slug = 'operador';

  INSERT INTO public.caja (
    id, tenant_id, sucursal_id, numero, nombre, usuario_default_id, activa
  ) VALUES (
    'c0000001-0001-4001-8001-000000000001',
    demo_tenant,
    'd0000001-0001-4001-8001-000000000001',
    1,
    'Caja 01',
    demo_user,
    true
  );

  INSERT INTO public.caja_usuario (tenant_id, caja_id, usuario_id)
  VALUES (demo_tenant, 'c0000001-0001-4001-8001-000000000001', demo_user);

  INSERT INTO public.categoria (id, tenant_id, nombre, descripcion, activa) VALUES
    ('e0000001-0001-4001-8001-000000000001', demo_tenant, 'Almac├®n', 'Despensa', true),
    ('e0000001-0001-4001-8001-000000000002', demo_tenant, 'Bebidas', NULL, true);

  INSERT INTO public.proveedor (id, tenant_id, nombre, cuit, telefono, email, activo) VALUES
    ('f0000001-0001-4001-8001-000000000001', demo_tenant, 'Distribuidora Norte', '30711112223', '011-4444-9000', 'ventas@distnorte.test', true);

  INSERT INTO public.cuenta_corriente (tenant_id, cliente_id, proveedor_id, saldo, tipo_cuenta)
  VALUES (demo_tenant, NULL, 'f0000001-0001-4001-8001-000000000001', 5000.00, 'proveedor');

  INSERT INTO public.pago_proveedor_factura (
    id, tenant_id, comprobante_id, proveedor_id, monto_original, saldo_pendiente,
    vencimiento_at, condicion_pago, estado, origen, referencia
  ) VALUES (
    '0f000001-0001-4001-8001-000000000001',
    demo_tenant,
    NULL,
    'f0000001-0001-4001-8001-000000000001',
    5000.00,
    5000.00,
    now() + interval '30 days',
    'dias',
    'pendiente',
    'import_lista',
    'Factura demo importada'
  );

  INSERT INTO public.cliente (id, tenant_id, nombre, cuit_dni, condicion_iva, activo) VALUES
    ('a0000001-0001-4001-8001-000000000001', demo_tenant, 'Consumidor final mostrador', NULL, 'consumidor_final', true);

  INSERT INTO public.arca_config (tenant_id, sucursal_id, punto_de_venta, ambiente, cuit_emisor)
  VALUES (demo_tenant, 'd0000001-0001-4001-8001-000000000001', 3, 'homologacion', '20123456789');

  INSERT INTO public.producto (
    id, tenant_id, codigo, nombre, descripcion, categoria_id, proveedor_id, sucursal_id,
    unidad, precio_costo, precio_venta, stock_actual, stock_minimo,
    codigo_barras, plu, es_pesable, fecha_vencimiento, imagen_url, activo
  ) VALUES
    ('b0000001-0001-4001-8001-000000000001', demo_tenant, 'YER-001', 'Yerba mate 1 kg', 'Ejemplo con EAN13', NULL, NULL,
     'd0000001-0001-4001-8001-000000000001',
     'kg', 2800.00, 4200.00, 120.000, 24.000,
     '5901234123457', NULL, false, NULL, NULL, true),
    ('b0000001-0001-4001-8001-000000000002', demo_tenant, 'LEC-001', 'Leche entera 1 L', NULL, NULL, NULL,
     'd0000001-0001-4001-8001-000000000001',
     'litro', 450.00, 890.00, 48.000, 12.000,
     '4006381333931', NULL, false, (CURRENT_DATE + 10), NULL, true),
    ('b0000001-0001-4001-8001-000000000003', demo_tenant, 'PAN-001', 'Pan lactal', NULL, NULL, NULL,
     'd0000001-0001-4001-8001-000000000001',
     'unidad', 320.00, 650.00, 30.000, 5.000,
     '012345678905', NULL, false, CURRENT_DATE, NULL, true),
    ('b0000001-0001-4001-8001-000000000004', demo_tenant, 'ACE-900', 'Aceite girasol 900 ml', NULL, NULL, NULL,
     'd0000001-0001-4001-8001-000000000001',
     'ml', 1100.00, 1890.00, 36.000, 8.000,
     NULL, NULL, false, NULL, NULL, true),
    ('b0000001-0001-4001-8001-000000000005', demo_tenant, 'GAS-225', 'Gaseosa cola 2,25 L', NULL, NULL, NULL,
     'd0000001-0001-4001-8001-000000000001',
     'litro', 980.00, 1650.00, 24.000, 6.000,
     '7613035205178', NULL, false, NULL, NULL, true),
    ('b0000001-0001-4001-8001-000000000006', demo_tenant, 'FRU-KG', 'Fruta variada (balanza)', 'Pesable PLU', NULL, NULL,
     'd0000001-0001-4001-8001-000000000001',
     'kg', 800.00, 1490.00, 0.000, 0.000,
     NULL, '4012', true, NULL, NULL, true),
    ('b0000001-0001-4001-8001-000000000007', demo_tenant, 'CAJ-001', 'Caja six pack', NULL, NULL, NULL,
     'd0000001-0001-4001-8001-000000000001',
     'caja', 2100.00, 3490.00, 15.000, 3.000,
     NULL, NULL, false, NULL, NULL, true),
    ('b0000001-0001-4001-8001-000000000008', demo_tenant, 'PAC-002', 'Pack snacks x10', NULL, NULL, NULL,
     'd0000001-0001-4001-8001-000000000001',
     'pack', 1500.00, 2590.00, 40.000, 10.000,
     NULL, NULL, false, NULL, NULL, true),
    ('b0000001-0001-4001-8001-000000000009', demo_tenant, 'MET-001', 'Film PVC 30 cm', NULL, NULL, NULL,
     'd0000001-0001-4001-8001-000000000001',
     'metro', 120.00, 280.00, 200.000, 50.000,
     NULL, NULL, false, NULL, NULL, true),
    ('b0000001-0001-4001-8001-00000000000a', demo_tenant, 'GRA-500', 'Az├║car 500 g', NULL, NULL, NULL,
     'd0000001-0001-4001-8001-000000000001',
     'gramo', 350.00, 620.00, 80.000, 20.000,
     NULL, NULL, false, NULL, NULL, true),
    ('b0000001-0001-4001-8001-00000000000b', demo_tenant, 'DES-001', 'Producto desactivado', 'Para probar includeInactive', NULL, NULL,
     'd0000001-0001-4001-8001-000000000001',
     'unidad', 100.00, 199.00, 0.000, 0.000,
     NULL, NULL, false, NULL, NULL, false),
    ('b0000001-0001-4001-8001-00000000000c', demo_tenant, 'REM-001', 'Remera b├ísica', 'Producto con variantes S/M/L', NULL, NULL,
     'd0000001-0001-4001-8001-000000000001',
     'unidad', 500.00, 1200.00, 0.000, 0.000,
     NULL, NULL, false, NULL, NULL, true);

  UPDATE public.producto
     SET usa_variantes = true
   WHERE id = 'b0000001-0001-4001-8001-00000000000c' AND tenant_id = demo_tenant;

  INSERT INTO public.producto_variante (
    id, tenant_id, producto_id, codigo, codigo_barras, atributos, etiqueta, activo, orden
  ) VALUES
    ('c1000001-0001-4001-8001-000000000001', demo_tenant, 'b0000001-0001-4001-8001-00000000000c', 'REM-S', NULL,
     '{"talle":"S","color":"Negro"}'::jsonb, NULL, true, 0),
    ('c1000001-0001-4001-8001-000000000002', demo_tenant, 'b0000001-0001-4001-8001-00000000000c', 'REM-M', NULL,
     '{"talle":"M","color":"Negro"}'::jsonb, NULL, true, 1),
    ('c1000001-0001-4001-8001-000000000003', demo_tenant, 'b0000001-0001-4001-8001-00000000000c', 'REM-L', NULL,
     '{"talle":"L","color":"Negro"}'::jsonb, NULL, true, 2);

  INSERT INTO public.producto_variante_stock_sucursal (
    tenant_id, producto_id, variante_id, sucursal_id, stock_actual, stock_minimo, ubicacion
  ) VALUES
    (demo_tenant, 'b0000001-0001-4001-8001-00000000000c', 'c1000001-0001-4001-8001-000000000001',
     'd0000001-0001-4001-8001-000000000001', 8.000, 2.000, 'Estante A1'),
    (demo_tenant, 'b0000001-0001-4001-8001-00000000000c', 'c1000001-0001-4001-8001-000000000002',
     'd0000001-0001-4001-8001-000000000001', 12.000, 3.000, 'Estante A1'),
    (demo_tenant, 'b0000001-0001-4001-8001-00000000000c', 'c1000001-0001-4001-8001-000000000003',
     'd0000001-0001-4001-8001-000000000001', 6.000, 2.000, 'Estante A1');

  INSERT INTO public.producto_barcode (id, tenant_id, producto_id, tipo, valor, es_principal, activo)
  VALUES
    (gen_random_uuid(), demo_tenant, 'b0000001-0001-4001-8001-000000000001', 'EAN13', '5901234123457', true, true),
    (gen_random_uuid(), demo_tenant, 'b0000001-0001-4001-8001-000000000002', 'EAN13', '4006381333931', true, true),
    (gen_random_uuid(), demo_tenant, 'b0000001-0001-4001-8001-000000000005', 'EAN13', '7613035205178', true, true),
    (gen_random_uuid(), demo_tenant, 'b0000001-0001-4001-8001-000000000003', 'UPCA', '012345678905', true, true),
    (gen_random_uuid(), demo_tenant, 'b0000001-0001-4001-8001-000000000007', 'ITF14', '04601234567893', true, true);

  INSERT INTO public.comprobante (
    id, tenant_id, tipo, numero, fecha, cliente_id,
    subtotal, iva_monto, iva_porcentaje, total, estado,
    metodo_pago, metodo_pago_detalle, caja_id, cae, cae_vencimiento, pdf_url, notas, usuario_id
  ) VALUES
    ('c0000001-0001-4001-8001-000000000001', demo_tenant, 'presupuesto', 1, CURRENT_DATE, NULL,
     4200.00, 0, 0, 4200.00, 'borrador',
     NULL, NULL, NULL, NULL, NULL, NULL, 'Presupuesto demo', demo_user),
    ('c0000001-0001-4001-8001-000000000002', demo_tenant, 'factura_b', 2, CURRENT_DATE, NULL,
     10000.00, 2100.00, 21, 12100.00, 'emitido',
     'efectivo', '{"caja": "1"}'::jsonb, 'CAJA-01', '70123456789012', CURRENT_DATE + 10, NULL, 'Factura emitida demo', demo_user),
    ('c0000001-0001-4001-8001-000000000003', demo_tenant, 'factura_a', NULL, CURRENT_DATE, NULL,
     5000.00, 1050.00, 21, 6050.00, 'pendiente_arca',
     'transferencia', NULL, NULL, NULL, NULL, NULL, 'Pendiente AFIP simulado', demo_user),
    ('c0000001-0001-4001-8001-000000000004', demo_tenant, 'ticket', 4, CURRENT_DATE, NULL,
     890.00, 0, 0, 890.00, 'error_arca',
     'tarjeta', NULL, NULL, NULL, NULL, NULL, 'Error CAE de prueba', demo_user),
    ('c0000001-0001-4001-8001-000000000005', demo_tenant, 'nota_credito_b', 5, CURRENT_DATE, NULL,
     500.00, 0, 0, 500.00, 'anulado',
     NULL, NULL, NULL, NULL, NULL, NULL, 'NC anulada', demo_user),
    ('c0000001-0001-4001-8001-000000000006', demo_tenant, 'factura_c', 6, CURRENT_DATE, NULL,
     1200.00, 0, 0, 1200.00, 'error_arca',
     'efectivo', NULL, NULL, NULL, NULL, NULL, 'Factura C rechazada ARCA demo', demo_user);

  UPDATE public.comprobante SET
    numero_orden = COALESCE(numero, 3),
    sucursal_id = 'd0000001-0001-4001-8001-000000000001'
  WHERE tenant_id = demo_tenant;

  UPDATE public.comprobante SET numero_orden = 3
  WHERE id = 'c0000001-0001-4001-8001-000000000003';

  UPDATE public.comprobante SET
    intentos_arca = 1,
    ultimo_error_arca_codigo = 'NETWORK',
    ultimo_error_arca_mensaje = 'Timeout WSFE simulado',
    ultimo_intento_arca_at = now() - interval '1 hour'
  WHERE id = 'c0000001-0001-4001-8001-000000000003';

  UPDATE public.comprobante SET
    intentos_arca = 2,
    ultimo_error_arca_codigo = '6001',
    ultimo_error_arca_mensaje = 'Homologaci├│n: error simulado',
    ultimo_intento_arca_at = now() - interval '30 minutes'
  WHERE id IN (
    'c0000001-0001-4001-8001-000000000004',
    'c0000001-0001-4001-8001-000000000006'
  );

  INSERT INTO public.comprobante_item (comprobante_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
  VALUES
    ('c0000001-0001-4001-8001-000000000001', 'b0000001-0001-4001-8001-000000000001', 1.000, 4200.00, 2800.00, 4200.00),
    ('c0000001-0001-4001-8001-000000000002', 'b0000001-0001-4001-8001-000000000001', 2.000, 4200.00, 2800.00, 8400.00),
    ('c0000001-0001-4001-8001-000000000002', 'b0000001-0001-4001-8001-000000000002', 4.000, 890.00, 450.00, 3560.00),
    ('c0000001-0001-4001-8001-000000000003', 'b0000001-0001-4001-8001-000000000005', 3.000, 1650.00, 980.00, 4950.00),
    ('c0000001-0001-4001-8001-000000000004', 'b0000001-0001-4001-8001-000000000002', 1.000, 890.00, 450.00, 890.00),
    ('c0000001-0001-4001-8001-000000000006', 'b0000001-0001-4001-8001-000000000002', 1.000, 1200.00, 450.00, 1200.00);

  INSERT INTO public.arca_job (id, tenant_id, comprobante_id, status, attempts, max_attempts, next_attempt_at, last_error)
  VALUES (
    gen_random_uuid(),
    demo_tenant,
    'c0000001-0001-4001-8001-000000000003',
    'pending',
    0,
    5,
    now(),
    NULL
  );

  INSERT INTO public.arca_log (tenant_id, servicio, operacion, request_xml, response_xml, exitoso, error_codigo, error_mensaje, comprobante_id)
  VALUES
    (demo_tenant, 'WSFE', 'FECAESolicitar', '<req/>', '<resp/>', false, '6001', 'Homologaci├│n: error simulado', 'c0000001-0001-4001-8001-000000000004'),
    (demo_tenant, 'WSFE', 'FECAESolicitar', '<req/>', '<resp/>', false, '6001', 'Homologaci├│n: error simulado', 'c0000001-0001-4001-8001-000000000006'),
    (demo_tenant, 'WSAA', 'loginCms', NULL, NULL, true, NULL, NULL, NULL);

  INSERT INTO public.pedido (id, tenant_id, cliente_id, estado, fecha, total, notas, comprobante_id, usuario_id)
  VALUES
    ('d0000001-0001-4001-8001-000000000001', demo_tenant, NULL, 'borrador', CURRENT_DATE, 2590.00, 'Pedido borrador', NULL, demo_user),
    ('d0000001-0001-4001-8001-000000000002', demo_tenant, NULL, 'confirmado', CURRENT_DATE - 1, 4200.00, 'Pedido confirmado', NULL, demo_user),
    ('d0000001-0001-4001-8001-000000000003', demo_tenant, NULL, 'entregado', CURRENT_DATE - 2, 12100.00, 'Entregado con factura', 'c0000001-0001-4001-8001-000000000002', demo_user),
    ('d0000001-0001-4001-8001-000000000004', demo_tenant, NULL, 'cancelado', CURRENT_DATE - 3, 650.00, 'Cancelado', NULL, demo_user);

  INSERT INTO public.pedido_item (pedido_id, producto_id, cantidad, precio_unitario, subtotal)
  VALUES
    ('d0000001-0001-4001-8001-000000000001', 'b0000001-0001-4001-8001-000000000008', 1.000, 2590.00, 2590.00),
    ('d0000001-0001-4001-8001-000000000002', 'b0000001-0001-4001-8001-000000000001', 1.000, 4200.00, 4200.00),
    ('d0000001-0001-4001-8001-000000000003', 'b0000001-0001-4001-8001-000000000001', 2.000, 4200.00, 8400.00),
    ('d0000001-0001-4001-8001-000000000003', 'b0000001-0001-4001-8001-000000000002', 4.000, 890.00, 3560.00),
    ('d0000001-0001-4001-8001-000000000004', 'b0000001-0001-4001-8001-000000000003', 1.000, 650.00, 650.00);

  UPDATE public.pedido SET numero_orden = 2
  WHERE id = 'd0000001-0001-4001-8001-000000000003';

  INSERT INTO public.movimiento (tenant_id, producto_id, tipo, cantidad, stock_anterior, stock_posterior, motivo, referencia_tipo, referencia_id, usuario_id)
  VALUES
    (demo_tenant, 'b0000001-0001-4001-8001-000000000001', 'entrada', 50.000, 70.000, 120.000, 'Ingreso proveedor', 'importacion', NULL, demo_user),
    (demo_tenant, 'b0000001-0001-4001-8001-000000000002', 'salida', 4.000, 52.000, 48.000, 'Venta mostrador', 'manual', NULL, demo_user),
    (demo_tenant, 'b0000001-0001-4001-8001-000000000003', 'ajuste', -2.000, 32.000, 30.000, 'Merma', 'ajuste_inventario', NULL, demo_user);

  INSERT INTO public.precio_historial (
    tenant_id, producto_id,
    precio_costo_anterior, precio_costo_nuevo, precio_venta_anterior, precio_venta_nuevo,
    margen_anterior, margen_nuevo, origen
  ) VALUES
    (demo_tenant, 'b0000001-0001-4001-8001-000000000005',
     900.000000, 980.000000, 1550.000000, 1650.000000,
     0.420000, 0.406000, 'lista_precios'),
    (demo_tenant, 'b0000001-0001-4001-8001-000000000001',
     2600.000000, 2800.000000, 4000.000000, 4200.000000,
     0.350000, 0.333333, 'manual');

  INSERT INTO public.importacion_log (
    tenant_id, proveedor_id, archivo_nombre, origen, total_filas, filas_exitosas, filas_con_error,
    productos_creados, productos_actualizados, detalle_errores, usuario_id
  ) VALUES
    (demo_tenant, NULL, 'precios_demo.xlsx', 'importacion_excel', 120, 115, 5, 10, 105, '{"fila_3":"codigo duplicado"}'::jsonb, demo_user),
    (demo_tenant, NULL, 'lista_mayo.pdf', 'ia_pdf', 40, 38, 2, 5, 33, NULL, demo_user);

  INSERT INTO public.promocion (
    id, tenant_id, sucursal_id, nombre, tipo, porcentaje, activa
  ) VALUES (
    'e0000001-0001-4001-8001-000000000001',
    demo_tenant,
    'd0000001-0001-4001-8001-000000000001',
    '10% off Yerba demo',
    'porcentaje_off',
    10.00,
    true
  );

  INSERT INTO public.producto_promocion (tenant_id, promocion_id, producto_id)
  VALUES (
    demo_tenant,
    'e0000001-0001-4001-8001-000000000001',
    'b0000001-0001-4001-8001-000000000002'
  );

  INSERT INTO public.promocion_sucursal (tenant_id, promocion_id, sucursal_id)
  VALUES (
    demo_tenant,
    'e0000001-0001-4001-8001-000000000001',
    'd0000001-0001-4001-8001-000000000001'
  );

  INSERT INTO public.idempotency_request (tenant_id, endpoint, idempotency_key, request_hash, status, response_json)
  VALUES
    (demo_tenant, 'POST /api/v1/products', 'key-demo-1', 'sha256:abc123', 'completed', '{"id":"b0000001-0001-4001-8001-000000000001"}'::jsonb),
    (demo_tenant, 'POST /api/v1/products', 'key-demo-2', 'sha256:def456', 'processing', NULL);
END;
$seed$;

COMMIT;
