import { describe, expect, it, vi } from 'vitest';

import {
  getMpPointClient,
  MP_POINT_API_BASE,
  MpPointError,
} from '@/lib/mp-point/client';

const TOKEN = 'APP_USR-test-token';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getMpPointClient', () => {
  it('listDevices: mapea respuesta 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        devices: [
          {
            id: 'PAX_A910__ABC',
            pos_id: 1,
            store_id: 47792478,
            external_pos_id: 'SUC01',
            operating_mode: 'PDV',
          },
        ],
        paging: { total: 1, offset: 0, limit: 50 },
      }),
    );
    const client = getMpPointClient(TOKEN, { fetchImpl: fetchMock });
    const devices = await client.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      id: 'PAX_A910__ABC',
      operating_mode: 'PDV',
      store_id: '47792478',
      external_pos_id: 'SUC01',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${MP_POINT_API_BASE}/devices`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${TOKEN}`,
        }),
      }),
    );
  });

  it('listDevices: 401 lanza MpPointError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ message: 'Invalid access_token', error: 'unauthorized' }, 401),
    );
    const client = getMpPointClient(TOKEN, { fetchImpl: fetchMock });
    await expect(client.listDevices()).rejects.toMatchObject({
      name: 'MpPointError',
      status: 401,
    });
  });

  it('createPaymentIntent: 200 normaliza intent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'intent-1',
        state: 'OPEN',
        amount: 1500,
        additional_info: {
          external_reference: 'comp-uuid',
          print_on_terminal: true,
        },
      }),
    );
    const client = getMpPointClient(TOKEN, { fetchImpl: fetchMock });
    const intent = await client.createPaymentIntent('DEV_1', {
      amount: 1500,
      additional_info: {
        external_reference: 'comp-uuid',
        print_on_terminal: true,
      },
    });
    expect(intent.id).toBe('intent-1');
    expect(intent.state).toBe('OPEN');
    expect(fetchMock).toHaveBeenCalledWith(
      `${MP_POINT_API_BASE}/devices/DEV_1/payment-intents`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('createPaymentIntent: 503 dispositivo offline', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Device unavailable', error: 'device_offline' }, 503));
    const client = getMpPointClient(TOKEN, { fetchImpl: fetchMock });
    try {
      await client.createPaymentIntent('DEV_X', {
        amount: 100,
        additional_info: { external_reference: 'r', print_on_terminal: false },
      });
      expect.fail('debería lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(MpPointError);
      expect((e as MpPointError).status).toBe(503);
    }
  });

  it('createPaymentIntent: 422 modo STANDALONE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { message: 'Operating mode must be PDV', error: 'invalid_operating_mode' },
        422,
      ),
    );
    const client = getMpPointClient(TOKEN, { fetchImpl: fetchMock });
    await expect(
      client.createPaymentIntent('DEV_S', {
        amount: 100,
        additional_info: { external_reference: 'r', print_on_terminal: true },
      }),
    ).rejects.toMatchObject({ status: 422, code: expect.any(String) });
  });

  it('setDeviceMode: PATCH con operating_mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = getMpPointClient(TOKEN, { fetchImpl: fetchMock });
    await client.setDeviceMode('DEV_1', 'PDV');
    expect(fetchMock).toHaveBeenCalledWith(
      `${MP_POINT_API_BASE}/devices/DEV_1`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ operating_mode: 'PDV' }),
      }),
    );
  });

  it('getPaymentIntent: devuelve estado FINISHED y payment approved', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'pi-1',
        state: 'FINISHED',
        amount: 2000,
        payment: { id: 12345678901234, state: 'approved', type: 'credit_card' },
        additional_info: { external_reference: 'c1', print_on_terminal: true },
      }),
    );
    const client = getMpPointClient(TOKEN, { fetchImpl: fetchMock });
    const pi = await client.getPaymentIntent('D1', 'pi-1');
    expect(pi.state).toBe('FINISHED');
    expect(pi.payment?.state).toBe('approved');
    expect(pi.payment?.type).toBe('credit_card');
  });

  it('cancelPaymentIntent: DELETE 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = getMpPointClient(TOKEN, { fetchImpl: fetchMock });
    await client.cancelPaymentIntent('D1', 'pi-1');
    expect(fetchMock).toHaveBeenCalledWith(
      `${MP_POINT_API_BASE}/devices/D1/payment-intents/pi-1`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('cancelPaymentIntent: 422 ya cancelado', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Already canceled', error: 'conflict' }, 422));
    const client = getMpPointClient(TOKEN, { fetchImpl: fetchMock });
    await expect(client.cancelPaymentIntent('D1', 'pi-1')).rejects.toMatchObject({
      status: 422,
    });
  });

  it('cancelPaymentIntent: 409 en proceso', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Processing', error: 'in_progress' }, 409));
    const client = getMpPointClient(TOKEN, { fetchImpl: fetchMock });
    await expect(client.cancelPaymentIntent('D1', 'pi-1')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('500 genérico', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'Internal' }, 500));
    const client = getMpPointClient(TOKEN, { fetchImpl: fetchMock });
    await expect(client.listDevices()).rejects.toMatchObject({ status: 500 });
  });

  it('codifica deviceId con caracteres especiales en la URL', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
      const s = String(url);
      if (s.includes('/payment-intents') && s.includes('/devices/')) {
        return jsonResponse({
          id: 'pi',
          state: 'OPEN',
          amount: 1,
          additional_info: { external_reference: 'x', print_on_terminal: false },
        });
      }
      return jsonResponse({ devices: [], paging: {} });
    });
    const id = 'PAX/A910__x';
    const client = getMpPointClient(TOKEN, { fetchImpl: fetchMock });
    await client.listDevices();
    await client.createPaymentIntent(id, {
      amount: 1,
      additional_info: { external_reference: 'x', print_on_terminal: false },
    });
    const createUrl = (fetchMock.mock.calls[1]?.[0] as string) ?? '';
    expect(createUrl).toContain(encodeURIComponent(id));
  });
});
