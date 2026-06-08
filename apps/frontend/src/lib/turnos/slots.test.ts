import { describe, expect, it } from 'vitest';

import { calcularExtraHorario, estaDisponible, generarSlotsParaFecha, rangesOverlap } from './slots';

const disponibilidad = [
  { dia_semana: 1, hora_inicio: '09:00', hora_fin: '12:00' },
];

describe('turnos slots', () => {
  it('genera slots por hora dentro de la disponibilidad semanal', () => {
    const slots = generarSlotsParaFecha({
      fecha: '2026-05-11',
      duracionMinutos: 60,
      disponibilidad,
      bloqueos: [],
      reservas: [],
    });

    expect(slots.map((s) => [s.hora_inicio, s.hora_fin, s.estado])).toEqual([
      ['09:00', '10:00', 'disponible'],
      ['10:00', '11:00', 'disponible'],
      ['11:00', '12:00', 'disponible'],
    ]);
  });

  it('marca reservas y bloqueos sobre slots existentes', () => {
    const slots = generarSlotsParaFecha({
      fecha: '2026-05-11',
      duracionMinutos: 60,
      disponibilidad,
      bloqueos: [{ id: 'b1', fecha: '2026-05-11', hora_inicio: '10:00', hora_fin: '11:00' }],
      reservas: [{ id: 'r1', fecha: '2026-05-11', hora_inicio: '11:00', hora_fin: '12:00', estado: 'reservado' }],
    });

    expect(slots.map((s) => s.estado)).toEqual(['disponible', 'bloqueado', 'reservado']);
    expect(slots[1].bloqueo_id).toBe('b1');
    expect(slots[2].reserva_id).toBe('r1');
  });

  it('valida disponibilidad contra rango semanal, reservas y cancelaciones', () => {
    expect(
      estaDisponible({
        fecha: '2026-05-11',
        hora_inicio: '09:00',
        hora_fin: '10:00',
        disponibilidad,
        bloqueos: [],
        reservas: [{ id: 'r1', fecha: '2026-05-11', hora_inicio: '09:00', hora_fin: '10:00', estado: 'cancelado' }],
      }),
    ).toBe(true);

    expect(
      estaDisponible({
        fecha: '2026-05-11',
        hora_inicio: '09:00',
        hora_fin: '10:00',
        disponibilidad,
        bloqueos: [],
        reservas: [{ id: 'r2', fecha: '2026-05-11', hora_inicio: '09:00', hora_fin: '10:00', estado: 'reservado' }],
      }),
    ).toBe(false);
  });

  it('mantiene los slots de madrugada en el dia operativo de la agenda', () => {
    const nocturna = [{ dia_semana: 1, hora_inicio: '21:00', hora_fin: '02:00' }];

    expect(
      generarSlotsParaFecha({
        fecha: '2026-05-11',
        duracionMinutos: 60,
        disponibilidad: nocturna,
        bloqueos: [],
        reservas: [],
      }).map((s) => [s.fecha, s.hora_inicio, s.hora_fin]),
    ).toEqual([
      ['2026-05-11', '21:00', '22:00'],
      ['2026-05-11', '22:00', '23:00'],
      ['2026-05-11', '23:00', '00:00'],
      ['2026-05-11', '00:00', '01:00'],
      ['2026-05-11', '01:00', '02:00'],
    ]);

    expect(
      generarSlotsParaFecha({
        fecha: '2026-05-12',
        duracionMinutos: 60,
        disponibilidad: nocturna,
        bloqueos: [],
        reservas: [],
      }).map((s) => [s.fecha, s.hora_inicio, s.hora_fin]),
    ).toEqual([]);
  });

  it('valida disponibilidad y solapamientos que cruzan medianoche', () => {
    const nocturna = [{ dia_semana: 1, hora_inicio: '22:00', hora_fin: '02:00' }];

    expect(
      estaDisponible({
        fecha: '2026-05-11',
        hora_inicio: '00:00',
        hora_fin: '01:00',
        disponibilidad: nocturna,
        bloqueos: [],
        reservas: [],
      }),
    ).toBe(true);

    expect(
      estaDisponible({
        fecha: '2026-05-12',
        hora_inicio: '00:00',
        hora_fin: '01:00',
        disponibilidad: nocturna,
        bloqueos: [],
        reservas: [],
      }),
    ).toBe(false);

    expect(
      estaDisponible({
        fecha: '2026-05-11',
        hora_inicio: '00:00',
        hora_fin: '01:00',
        disponibilidad: nocturna,
        bloqueos: [{ id: 'b1', fecha: '2026-05-11', hora_inicio: '23:30', hora_fin: '00:30' }],
        reservas: [],
      }),
    ).toBe(false);

    expect(rangesOverlap('23:00', '00:00', '23:30', '00:30')).toBe(true);
    expect(rangesOverlap('23:00', '00:00', '00:00', '01:00')).toBe(false);
  });

  it('marca reservas fijas semanales como ocupadas', () => {
    const reservasFijas = [
      { id: 'rf1', dia_semana: 1, hora_inicio: '10:00', hora_fin: '11:00', nombre: 'Cliente fijo' },
    ];
    const slots = generarSlotsParaFecha({
      fecha: '2026-05-11',
      duracionMinutos: 60,
      disponibilidad,
      bloqueos: [],
      reservas: [],
      reservasFijas,
    });

    expect(slots.map((s) => [s.hora_inicio, s.estado, s.reserva_fija_id])).toEqual([
      ['09:00', 'disponible', null],
      ['10:00', 'reservado', 'rf1'],
      ['11:00', 'disponible', null],
    ]);
    expect(
      estaDisponible({
        fecha: '2026-05-11',
        hora_inicio: '10:00',
        hora_fin: '11:00',
        disponibilidad,
        bloqueos: [],
        reservas: [],
        reservasFijas,
      }),
    ).toBe(false);
  });

  it('aplica extras horarios al precio efectivo del slot', () => {
    const slots = generarSlotsParaFecha({
      fecha: '2026-05-11',
      duracionMinutos: 60,
      disponibilidad: [{ dia_semana: 1, hora_inicio: '21:00', hora_fin: '23:00' }],
      bloqueos: [],
      reservas: [],
      precioBase: 8000,
      extrasHorarios: [{ dia_semana: 1, hora_inicio: '21:00', hora_fin: '23:00', extra_monto: 2500 }],
    });

    expect(slots.map((s) => [s.hora_inicio, s.precio_extra, s.precio_total])).toEqual([
      ['21:00', 2500, 10500],
      ['22:00', 2500, 10500],
    ]);
  });

  it('calcula extras sobre rangos nocturnos del mismo dia operativo', () => {
    expect(
      calcularExtraHorario({
        fecha: '2026-05-11',
        hora_inicio: '00:00',
        hora_fin: '01:00',
        extrasHorarios: [{ dia_semana: 1, hora_inicio: '23:00', hora_fin: '01:00', extra_monto: 1200 }],
      }),
    ).toBe(1200);
  });
});
