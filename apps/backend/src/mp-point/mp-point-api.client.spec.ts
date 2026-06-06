import { createMpPointClient, MP_POINT_API_BASE } from './mp-point-api.client';
import { MpPointError } from './errors/mp-point.error';

const TOKEN = 'APP_USR-test-token';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createMpPointClient', () => {
  it('listDevices: mapea respuesta 200', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
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
    const client = createMpPointClient(TOKEN, { fetchImpl: fetchMock });
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
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({ message: 'Invalid access_token', error: 'unauthorized' }, 401),
    );
    const client = createMpPointClient(TOKEN, { fetchImpl: fetchMock });
    await expect(client.listDevices()).rejects.toMatchObject({
      name: 'MpPointError',
      status: 401,
    });
  });

  it('createPaymentIntent: 200 normaliza intent', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
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
    const client = createMpPointClient(TOKEN, { fetchImpl: fetchMock });
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
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Device unavailable', error: 'device_offline' }, 503));
    const client = createMpPointClient(TOKEN, { fetchImpl: fetchMock });
    await expect(
      client.createPaymentIntent('DEV_X', {
        amount: 100,
        additional_info: { external_reference: 'r', print_on_terminal: false },
      }),
    ).rejects.toBeInstanceOf(MpPointError);
  });

  it('getPaymentIntent: Processed se mapea a PROCESSING', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({
        id: 'pi-p',
        state: 'Processed',
        amount: 100,
        additional_info: { external_reference: 'r', print_on_terminal: true },
      }),
    );
    const client = createMpPointClient(TOKEN, { fetchImpl: fetchMock });
    const pi = await client.getPaymentIntent('D1', 'pi-p');
    expect(pi.state).toBe('PROCESSING');
    expect(fetchMock).toHaveBeenCalledWith(
      `${MP_POINT_API_BASE}/payment-intents/pi-p`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('getPaymentIntent: Confirmation_required se mapea a FINISHED', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({
        id: 'pi-cr',
        state: 'Confirmation_required',
        amount: 100,
        payment: { id: '999888777' },
        additional_info: { external_reference: 'r', print_on_terminal: true },
      }),
    );
    const client = createMpPointClient(TOKEN, { fetchImpl: fetchMock });
    const pi = await client.getPaymentIntent('D1', 'pi-cr');
    expect(pi.state).toBe('FINISHED');
    expect(pi.payment?.id).toBe(999888777);
  });

  it('cancelPaymentIntent: DELETE 204', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createMpPointClient(TOKEN, { fetchImpl: fetchMock });
    await client.cancelPaymentIntent('D1', 'pi-1');
    expect(fetchMock).toHaveBeenCalledWith(
      `${MP_POINT_API_BASE}/devices/D1/payment-intents/pi-1`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('codifica deviceId con caracteres especiales en la URL', async () => {
    const fetchMock = jest.fn().mockImplementation((url: string | URL) => {
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
    const client = createMpPointClient(TOKEN, { fetchImpl: fetchMock });
    await client.listDevices();
    await client.createPaymentIntent(id, {
      amount: 1,
      additional_info: { external_reference: 'x', print_on_terminal: false },
    });
    const createUrl = (fetchMock.mock.calls[1]?.[0] as string) ?? '';
    expect(createUrl).toContain(encodeURIComponent(id));
  });
});
