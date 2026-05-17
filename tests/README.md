# Tests locales

Scripts de validación rápida para tandas de cambios. Cada uno se corre con `node`, sin framework.

| Archivo | Cubre |
|---|---|
| `test_f1_local.js` | Parser de números 10+ (F1.1) y helpers de horario/promo |
| `test_link_builder.js` | `buildReservasLink()` — URLs con `?tipo` y `?tel` |
| `test_bcg_local.js` | Promo del día (B/F1.3) y auto-nombre desde payload (G/F1.8) |
| `test_alert_local.js` | Payload del alert de handoff y parseo de `HANDOFF_ALERT_NUMBERS` |

## Cómo correrlos

Desde la raíz del repo:

```bash
node tests/test_f1_local.js
node tests/test_link_builder.js
node tests/test_bcg_local.js
node tests/test_alert_local.js
```

Cada script imprime `✅` / `❌` por test y sale con código `1` si algo falla.

## Convención

Cuando agregues una mejora al bot, deja un test acá que valide la lógica clave de ese cambio.
Mínimo 1 test por commit grande.

Los tests son "ligeros": evalúan funciones puras o simulan payloads. NO hacen llamadas reales a WATI, OpenAI o Redis.
