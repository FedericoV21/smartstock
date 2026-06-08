---

estado: 🟡 En progreso

version: backend-nest

ultima_actualizacion: 2026-06-08

---



# SmartStock — Contexto activo



## Qué estamos construyendo ahora



**Línea principal: Backend NestJS + PostgreSQL** (`apps/backend`)



El frontend Next (`apps/frontend`) es la **especificación de producto** (254 rutas API). El objetivo actual es **paridad backend** probada con Postman/Swagger **sin cutover de UI**.



### Avance global (2026-06-08)



| Métrica | Valor |

|---------|-------|

| Backlog crítico Fases 0–7 | **~99%** (69/70 tickets — NB-ARC-106 toolkit listo; falta corrida manual AFIP) |

| Paridad rutas front (funcional) | **254/254 (~100%)** |

| Fase 8 verticales | **NB-TUR-001 ✅** · **NB-WA-001 🟡** (Phase C MVP ✅) · **NB-LEC-001 ✅** · **NB-DES-001 ✅** · **NB-NEX-001 ✅** · **NB-PUB-001 ✅** |

| Migraciones Nest | **57** |



**Rama de trabajo backend:** `feature/nest-backend`



**Doc nuevo:** [`backend-frontend-gaps.md`](backend-frontend-gaps.md) — inventario ruta a ruta de lo que falta para cubrir el front.



---



## Próximos pasos sugeridos

1. **NB-WA-001 Phase D** — agente LLM completo (30+ report tools), action-handler mutating, `whatsapp_conversation_state`, PDF report generation
2. **NB-ARC-106** — Homologación ARCA manual AFIP + evidencia
3. **NB-ARC-106** — homologación AFIP manual + evidencia



---



## Fase 7b — gaps principales (resumen)



| Área | Rutas front faltantes | Ticket |

|------|----------------------|--------|

| Reportes | — | *(NB-RPT-003 done)* |

| CC / clientes / proveedores | — | *(NB-CC-003, NB-CLI-002, NB-PROV-011 done)* |

| Productos / import | — | *(NB-PRD-015, NB-IMP-014 done)* |

| Facturación | — | *(NB-FAC-016 done)* |

| Cuentas por pagar | — | *(NB-PF-001 done)* |

| Órdenes | — | *(NB-ORD-001 done)* |

| Cron ARCA | — | *(NB-CRON-001 done)* |



Detalle completo en `backend-frontend-gaps.md`.



---



## Fase 8 (opcional, ~50 rutas)



WhatsApp, turnos, lector-facturas, nexus-dashboard, API pública. *(NB-DES-001 despiece done)*



---



## Última actualización



**Fecha:** 2026-06-08  

**Último trabajo:** **NB-WA-001 Phase C** — sandbox chat/facturas/tickets, read-only agent MVP (greeting, help, stock, deuda, resumen), `GET /whatsapp/report/download`, migración `1750120000000`, e2e `whatsapp.e2e-spec.ts` (13 tests)  

**Siguiente:** NB-WA-001 Phase D (agente completo + PDF reports + conversation state)


