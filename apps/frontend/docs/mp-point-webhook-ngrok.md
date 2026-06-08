# Probar el webhook de Mercado Pago Point con ngrok (local)

Sirve para que **Mercado Pago** pueda enviar `POST` a tu máquina mientras desarrollás, sin publicar a Vercel en cada prueba.

## Requisitos

1. Cuenta en [ngrok](https://ngrok.com/) (plan free alcanza).
2. [Instalar ngrok](https://ngrok.com/download) o usar `npx` (más lento al arrancar).
3. En la raíz del proyecto: `.env.local` con al menos:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (el handler del webhook lo usa vía `createServiceRoleClient()`)
   - Las demás variables que ya uses para el POS (p. ej. `ARCA_ENCRYPTION_KEY` si aplica a otros flujos en la misma sesión)
4. **Misma base** que usás en Vercel (o un proyecto de Supabase de prueba), y en `mp_point_config` el `webhook_secret` que luego configuras en el panel de Mercado Pago (debe **coincider** con la verificación de firma).

## Pasos

### 1. Levantar Next en el puerto por defecto

```bash
npm run dev
```

Confirmá que responde en `http://localhost:3000`.

### 2. Túnel HTTPS con ngrok

En **otra terminal** (misma PC):

```bash
ngrok http 3000
```

O sin instalarlo global:

```bash
npx --yes ngrok@latest http 3000
```

ngrok muestra una URL pública, por ejemplo:

`https://abc123.ngrok-free.app`  
(o dominio fijo si lo tenés en plan pago).

### 3. URL del webhook a registrar en Mercado Pago

La ruta de tu app es fija:

```
https://<SUBDOMINIO_NGROK>/api/pagos/mp-point/webhook
```

Ejemplo:

```
https://abc123.ngrok-free.app/api/pagos/mp-point/webhook
```

Esa URL la cargás en el panel de **Mercado Pago Developers** donde configures las **notificaciones / webhooks** de la integración de **Point** (el mismo `webhook_secret` que guardaste en `mp_point_config` del tenant que estás probando).

**Nota:** Cada vez que reiniciás ngrok **free**, el subdominio cambia. Tenés que **actualizar** la URL en MP o usar un túnel con dominio reservado.

### 4. Probar

1. Desde el POS en `http://localhost:3000/...` iniciá un cobro con MP Point.
2. Completá o simulá el pago en la terminal según tu entorno.
3. Revisá en la terminal de **Next** y en [ngrok dashboard](https://dashboard.ngrok.com/) (o la UI de `ngrok` en consola) el `POST` entrante.
4. Revisá logs de la función del webhook y el estado del `comprobante` en Supabase.

### 5. Free tier y avisos de ngrok

- El plan gratuito a veces muestra **intersticial** en el **navegador**; las peticiones **server-to-server** de MP al webhook suelen **no** ver ese HTML. Si fallara algo, probá túnel de pago o otra herramienta (Cloudflare Tunnel, etc.).
- Si ngrok pide `authtoken`, corré: `ngrok config add-authtoken <TOKEN>` (token desde el dashboard de ngrok).

## Qué no resuelve ngrok

- Sigue haciendo falta **dispositivo Point / flujo real de MP** para crear intents y notificaciones reales, salvo que inyectes eventos a mano (p. ej. un `POST` firmado a tu propia URL, más avanzado).
- La URL de la app pública (p. ej. `NEXT_PUBLIC_APP_URL`) en local no tiene por qué ser la de ngrok salvo que uses enlaces absolutos a tu host en el mismo flujo; el webhook solo necesita alcanzar **esta** ruta.

## Alternativa sin ngrok: seguir desplegando en Vercel (preview)

Un **Preview Deployment** de Vercel ya expone `https` público. Podés poner en MP:

```
https://<tu-proyecto>-<hash>.vercel.app/api/pagos/mp-point/webhook
```

y probar con la misma app en esa URL, sin túnel local.
