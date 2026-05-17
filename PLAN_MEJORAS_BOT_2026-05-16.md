# Plan de Mejoras — Bot WhatsApp Cotorreo

**Fecha:** 2026-05-16
**Autor:** Vicente (con Claude como sparring)
**Versión:** 1.0
**Estado actual del bot:** funcional pero con bugs estructurales + flujos que no convierten

---

## Resumen ejecutivo

El bot lleva un año en producción y hoy hace tres cosas a la vez (pedir comida, reservar, atender consultas) sin hacer ninguna del todo bien. La conversación de Liliana del 2026-05-16 reveló dos clases de problema:

1. **Bug estructural** — el parser solo reconoce los números 0–6 y 9, así que cualquier opción 7, 8 o 10–18 cae al fallback de IA, que alucina.
2. **Diseño de flujo** — la jerarquía mezcla sede (Plaza vs Alpadel) con intención (comer, reservar, hablar), forzando 2–3 clics extra antes de avanzar.

El plan se divide en **4 fases**, priorizadas por matriz ICE (Impact × Confidence × Ease, escala 1–10). La Fase 1 son los quick wins (1–2 días de trabajo, alto retorno). La Fase 4 es estratégica (semanas).

**Recomendación táctica:** ejecutar Fase 1 completa esta semana. Decidir Fase 2 con Lili y Mariela. Fase 3 y 4 entran al roadmap de 90 días.

---

## Estado actual — qué hace el bot hoy

**Flujos activos:**
- Onboarding: pide nombre al primer mensaje (fricción innecesaria, WhatsApp ya lo da)
- Menú principal: 3 opciones → Plaza Cotorreo / Alpadel / Asesor
- Plaza submenú: 6 opciones → Menú+pedido / Promociones / Horarios / Ubicación / Reservas / Paquetes
- Menú comida: 18 categorías con sistema de carrito artesanal + pago SINPE
- Interceptor de palabras clave de reservas → manda link Airtable Form (mi commit del 2026-05-15)
- Handoff a humano: manual (`asesor`) + automático cuando un humano responde por WATI
- AI fallback (OpenAI gpt-4o-mini) con system prompt de 240 líneas (menú completo + reglas)

**Lo que está bien hoy:**
- Tono cálido y razonablemente mexicano-tico
- Reglas de "no inventes platillos" en el prompt (commit 069c80a)
- Detección automática de humano respondiendo (commits del 2026-04-23)
- Interceptor de reservas con Airtable Forms (2026-05-15)
- Persistencia de nombre + estado en Redis

**Lo que está mal:**
- Carrito en WhatsApp tiene altísima fricción y compite contra apps de delivery con tarjeta guardada
- 18 categorías visibles en WhatsApp se truncan ("Read more") — las opciones 10+ son prácticamente invisibles
- IA fallback se activa para CUALQUIER input no reconocido → alucinaciones frecuentes
- System prompt enorme = caro, lento, propenso a confundir al modelo
- No hay métricas: no sabemos dónde abandonan los usuarios
- No hay captura de datos post-conversación → no se construye CRM
- Cotorreo Rewards está enterrado en texto plano, no es consultable

---

## Matriz ICE — Priorización de las 19 mejoras

| # | Mejora | Impact | Confidence | Ease | Score | Fase |
|---|--------|--------|------------|------|-------|------|
| 1 | Fix parser de números 10+ (bug ya identificado) | 9 | 10 | 10 | **29** | F1 |
| 2 | Promo del día como apertura post-saludo | 8 | 8 | 9 | **25** | F1 |
| 3 | Botones interactivos WhatsApp (Reply Buttons + List) | 9 | 8 | 7 | **24** | F1 |
| 4 | Logging básico de drop-off por estado | 9 | 9 | 6 | **24** | F1 |
| 5 | Mensaje post-handoff humano (fix copy línea 106) | 5 | 9 | 10 | **24** | F1 |
| 6 | Reordenar menú principal por intención (no por sede) | 8 | 7 | 8 | **23** | F1 |
| 7 | NPS / "¿qué tal?" post-experiencia | 9 | 8 | 6 | **23** | F2 |
| 8 | Limitar IA a 2 casos: search menú + FAQ atemporal | 8 | 8 | 7 | **23** | F1 |
| 9 | Mensaje "no entendí" re-encauzante | 5 | 8 | 10 | **23** | F1 |
| 10 | Mensaje "estamos cerrados ahora" contextual | 6 | 8 | 8 | **22** | F1 |
| 11 | Quitar paso "decime tu nombre" (usar el de WhatsApp) | 5 | 8 | 9 | **22** | F1 |
| 12 | Interceptor de eventos/fiestas → asesor de Mariela | 7 | 7 | 8 | **22** | F1 |
| 13 | Captura post-pedido + opt-in marketing → CRM | 9 | 7 | 5 | **21** | F2 |
| 14 | Voseo consistente (decidir y aplicar parejo) | 3 | 8 | 9 | **20** | F1 |
| 15 | Cotorreo Rewards consultable ("¿cuántos sellos llevo?") | 7 | 7 | 5 | **19** | F2 |
| 16 | Reemplazar carrito por WhatsApp Catalog/Cart nativo | 8 | 6 | 5 | **19** | F3 |
| 17 | RAG sobre el menú (Airtable como source-of-truth) | 7 | 7 | 4 | **18** | F2 |
| 18 | Re-arquitectura como entry point del ecosistema | 9 | 6 | 3 | **18** | F4 |
| 19 | A/B testing setup (copy + flujos) | 6 | 7 | 5 | **18** | F3 |

---

## FASE 1 — Quick wins (esta semana, ~12–16 horas de trabajo)

Objetivo: tapar el agujero. Quitar bugs, simplificar flujo, instrumentar métricas. Sin reescribir nada.

### F1.1 — Fix parser de números 10+ ⏱️ 1h

**Qué:** ampliar regex `matchesCurrentFlowIntent` para aceptar cualquier número de 1–2 dígitos, y agregar estados de navegación de menú a `hasActiveUserFlow`.

**Por qué:** root cause del bug de Liliana. Sin esto, todo lo demás es decorar paredes con goteras en el techo.

**Cómo medirlo:** después de aplicar, monitorear logs por 48h — la métrica `ai_fallback_triggered_for_numeric_input` debe ir a cero.

### F1.2 — Logging básico de drop-off ⏱️ 2h

**Qué:** instrumentar 5 eventos en cada conversación:
- `conversation_started`
- `entered_state:<STATE>`
- `ai_fallback_triggered`
- `handoff_to_human_triggered`
- `conversation_ended_with_outcome:<order|reservation|info|abandoned>`

Logs a stdout + dump diario a Airtable (vía n8n existente).

**Por qué:** **sin esto, todas las decisiones de optimización son ciegas.** Es la inversión más importante de la fase. Sin métricas, "creo que mejoró" es opinión, no dato.

**Cómo medirlo:** dashboard básico en Airtable o Metabase con: total conversaciones, % que llegan a cada estado, % que terminan en handoff.

### F1.3 — Promo del día como apertura ⏱️ 2h

**Qué:** después del saludo inicial (o del menú principal), agregar 1 línea con la promo del día calculada en código (no en prompt LLM):

```
🎉 Hoy sábado: Domingo familiar mañana ₡6.000 (Alpadel) + Glow Pádel anoche
```

Tabla `PROMOS_POR_DIA` ya está implícita en el código y en el system prompt; solo hay que extraerla a una constante consultable.

**Por qué:** la promo es el principal driver de conversión cruzada. Hoy está enterrada en opción "2" dentro de "1". Inversión 1:1.

**Cómo medirlo:** % de conversaciones que mencionan o eligen la promo del día.

### F1.4 — Botones interactivos WhatsApp ⏱️ 4h

**Qué:** migrar los menús con "escribe el número" a Reply Buttons (3 opciones) y List Messages (hasta 10 con secciones). WATI soporta ambos vía API.

**Aplicar a:**
- Menú principal (3 botones)
- Plaza submenú (List con 6 opciones)
- Selección de categoría comida (List con secciones por familia)
- CART_ACTION (3 botones: Seguir / Ver carrito / Pagar)

**Por qué:** elimina el bug de "10" y "11" porque el cliente toca en lugar de escribir. Reduce drop-off ~20–30% en bots WhatsApp típicos.

**Cómo medirlo:** comparar % de inputs que NO matchean el menú esperado, antes vs después.

### F1.5 — Reordenar menú principal por intención ⏱️ 2h

**Qué:** cambiar de:
```
1️⃣ Comer en Plaza Cotorreo
2️⃣ Jugar pádel en Alpadel
3️⃣ Hablar con un asesor
```

A:
```
1️⃣ 🍽️ Ver menú / pedir
2️⃣ 📅 Reservar (mesa o cancha)
3️⃣ 🎉 Promos de hoy
4️⃣ 👤 Hablar con alguien
```

Dentro de cada opción se pregunta Plaza vs Alpadel **solo cuando aplica**.

**Por qué:** la jerarquía actual asume que el cliente ya sabe a qué sede va. La realidad es que tiene una **intención** (quiere comer / reservar / saber algo) y el bot debe ayudarlo a ejecutarla.

**Cómo medirlo:** reducción en clics promedio hasta acción ejecutada.

### F1.6 — Limitar la IA a 2 casos explícitos ⏱️ 2h

**Qué:** la IA ya no es fallback genérico. Solo se activa cuando:
- (a) el cliente escribe una **pregunta** con signos `?` o palabras `tienen`, `hay`, `puedo`, `qué`, `cómo`, `cuál`, `cuándo`, etc.
- (b) el texto NO es un número y NO es comando conocido

Si el cliente solo escribe `10` o cualquier número/comando no reconocido en su estado actual → mostrar el menú actual + sugerencia, **nunca** ir al LLM.

**Por qué:** el LLM aluciando porque le mandamos `10` solo es la peor experiencia posible. La IA debe responder dudas, no traducir numeritos.

**Cómo medirlo:** % de invocaciones de LLM sobre total de mensajes (debe bajar drásticamente).

### F1.7 — Quick fixes de copy ⏱️ 1h

- **Mensaje post-handoff** ([línea 106](services/index.js:106)): reemplazar "te puedo recomendar algo del menú" por "Listo, ya estás en manos de nuestro equipo. Te contestan aquí en breve 🙌"
- **"No entendí"** ([línea 940](services/index.js:940)): reemplazar genérico por "No te entendí 🤔 ¿Era sobre comida, reservar o hablar con alguien?"
- **Mensaje cerrado**: si la hora actual está fuera de horarios de Plaza, prepender "⏰ Ahorita estamos cerrados — abrimos hoy a las X. Mientras tanto te dejo el menú." al primer mensaje.
- **Voseo consistente**: decidir tú vs vos. Recomendación: usar voseo costarricense en TODOS los mensajes (incluyendo el system prompt) — suena más local y es lo natural en CR. Eliminar la regla "no uses voseo" del prompt.

### F1.8 — Quitar "decime tu nombre" ⏱️ 30min

**Qué:** leer el nombre desde el payload de WATI (`profile.name` del webhook) en lugar de pedirlo. Solo pedirlo si viene vacío.

**Por qué:** el primer mensaje es donde más caro es perder al cliente. Quitar fricción innecesaria.

### F1.9 — Interceptor de eventos/fiestas ⏱️ 1.5h

**Qué:** mismo patrón que el interceptor de reservas (commit 89aa7d2). Keywords: `cumpleaños`, `cumple`, `fiesta`, `evento`, `quinceaños`, `aniversario`, `bautizo`, `graduación`. Respuesta:

```
🎈 ¡Genial! Para fiestas y eventos te conecto directo con Mariela:
👉 WhatsApp Mariela: wa.me/506XXXXXXXX
👉 Catálogo paquetes: <link Drive>
```

**Por qué:** paquetes de eventos es ticket alto (₡100k+). Hoy está oculto en "opción 6 del submenú Plaza con link a Google Drive" — virtualmente invisible.

**Total Fase 1:** ~16 horas. Entregable: bot estable, instrumentado, sin alucinaciones, con UX competitiva.

---

## FASE 2 — Estructural (próximas 2 semanas, ~30–40 horas)

Objetivo: empezar a construir el CRM derivado y bajar el costo operativo del bot.

### F2.1 — Captura post-pedido + opt-in marketing ⏱️ 6h

**Qué:** al final de cada reserva o pedido completado:

```
🙌 Listo. ¿Te puedo agregar a la lista de promos por WhatsApp?
Te avisamos del 2x1 de los lunes, Glow Pádel y novedades.
👉 Botón [Sí, agrégame]  [No gracias]
```

Si dice Sí → grabar en Airtable tabla `marketing_optin` con: teléfono, nombre, fecha opt-in, qué pidió/reservó.

**Por qué:** estás dejando tirado el activo más valioso (la lista). Esto **es** tu CRM mínimo, y conecta con el plan de "integrar ecosistema" de tus 90 días.

### F2.2 — NPS post-experiencia ⏱️ 8h

**Qué:** 30 minutos después de que un pedido sale o una reserva ocurre, n8n dispara:

```
🌮 ¡Esperamos que la hayas pasado bien!
Del 1 al 5, ¿cómo estuvo todo hoy?
[Botones 1️⃣2️⃣3️⃣4️⃣5️⃣]
```

- Respuestas 4–5 → "¿Nos ayudas con una reseña? 👉 [link Google review]"
- Respuestas 1–3 → handoff a Vicente / gerente de sede + grabar feedback en Airtable

**Por qué:** sistema **gratis** para subir tu Google rating (más reseñas, sesgo positivo) y detectar problemas operativos antes de que se vuelvan virales. La inversión se paga sola en 30 días.

### F2.3 — Limitar IA con RAG ⏱️ 10h

**Qué:** en lugar de mandar todo el menú en el system prompt:
1. Indexar PLAZA_MENU_CATEGORIES en embeddings (OpenAI text-embedding-3-small)
2. Almacenar en pgvector / Pinecone / archivo local JSON
3. En cada query de IA: buscar top-5 items relevantes, mandar solo eso al LLM

**Por qué:** baja costo de IA ~80%, mejora la calidad de respuestas, y permite que Lili actualice precios en Airtable sin redeploy del bot.

**Riesgo:** mayor complejidad técnica. Si no se mantiene, el índice se desincroniza. Necesita un cron diario de re-indexación.

### F2.4 — Cotorreo Rewards consultable ⏱️ 6h

**Qué:** agregar opción al menú: `5️⃣ 🏆 Mis sellos`. El bot consulta Airtable tabla `rewards` por teléfono, responde:

```
🏆 ¡Hola Vicente! Llevas 12 sellos.
8 sellos más y canjeas ₡15.000 de crédito.
```

**Pre-requisito:** Lili tiene que pasar de fichero físico a Airtable. Eso lo puede hacer ella en una tarde si le entregas plantilla.

**Por qué:** el programa de lealtad solo funciona si el cliente sabe dónde va. Hoy no lo sabe. Aumentas frecuencia de visita y ticket promedio.

### F2.5 — Dashboard de métricas (continuación de F1.2) ⏱️ 4h

**Qué:** sobre los logs ya instrumentados en F1.2, construir dashboard en Metabase o Airtable Interface:
- Conversaciones por día
- % drop-off por estado
- % handoff humano
- Tiempo promedio hasta acción
- Top 10 inputs no reconocidos (para identificar mejoras)
- Costo OpenAI diario

**Por qué:** este es el panel de control para iterar. Sin él, vuelas a ciegas.

---

## FASE 3 — Reemplazo de flujos (mes 2, ~80–120 horas)

### F3.1 — Reemplazar carrito artesanal por WhatsApp Catalog/Cart ⏱️ 40h

**Qué:** configurar WhatsApp Business Catalog en Meta Business (Lili sube fotos y precios). Bot envía el catálogo en lugar de menú texto. Cliente arma su pedido tocando productos, manda orden, n8n recibe y reenvía a Toteat (o lo que use Plaza Cotorreo para órdenes).

**Por qué:** el carrito actual compite con Glovo / Uber Eats que ya tienen tarjeta guardada. El Catalog nativo de WhatsApp es lo más cercano a competir bien, sin construir tu propia app.

**Riesgo:** depende de Meta aprobar el catálogo (requiere fotos de calidad + descripciones por producto). Lili debe coordinarse con cocina.

**Alternativa más barata:** mantener el link a Linktree y agregar un CTA fuerte "Para ordenar, te conectamos con un asesor" — quita el carrito por completo, no lo reemplaza.

### F3.2 — A/B testing infrastructure ⏱️ 12h

**Qué:** sistema simple de variantes en el código: por teléfono (hash), 50/50 a variante A o B. Mide outcome (conversión / abandono). Logs marcados con variante.

**Pruebas concretas a correr:**
1. Saludo formal vs informal (mexicano vs tico)
2. Promo arriba vs promo abajo del menú
3. Con vs sin emoji en cada opción
4. 3 opciones vs 4 opciones en menú principal

---

## FASE 4 — Estratégico (mes 3+, esfuerzo grande)

### F4.1 — Re-arquitectura como entry point del ecosistema

**Qué:** decidir conscientemente que el bot ES el front de TODO Cotorreo. n8n orquesta. Airtable es el cerebro persistente. El bot conecta con:
- Reservas (ya conectado vía Airtable Form)
- Pedidos (vía Catalog → Toteat)
- Rewards
- Nómina (no, esto no toca al cliente)
- NPS / reseñas
- Marketing (campañas WATI)

Esto **ya está implícito** en tu plan de 90 días y 3 años. Solo falta hacerlo explícito y diseñar el roadmap.

**Decisión clave:** ¿el bot es de WATI siempre, o eventualmente migras a tu propio número de WhatsApp Business API directo con Meta? El segundo te da control total pero requiere mantener infra.

---

## Métricas que necesitamos antes de medir éxito

Estas son las métricas que F1.2 debe instrumentar. Sin ellas, este plan es opinión.

| Métrica | Cómo se mide | Línea base actual |
|---------|--------------|-------------------|
| Conversaciones/día | Contador en log | desconocido |
| Tasa de abandono total | conv. sin outcome / conv. totales | desconocido |
| Drop-off por estado | conv. que entran a estado X / conv. totales | desconocido |
| % handoff humano | conv. con handoff_triggered / conv. totales | desconocido |
| % invocaciones IA | mensajes a IA / mensajes totales | desconocido |
| Costo OpenAI mensual | de dashboard OpenAI | desconocido (deuda de seguridad pendiente: API key en texto plano) |
| Conversaciones → pedido/reserva confirmada | requires match contra Airtable | desconocido |

**Sin línea base, declarar éxito post-cambios es engañarnos.**

---

## Decisiones que necesito de ti

Antes de ejecutar, necesito tu input en 5 puntos:

1. **¿Mantenemos el carrito de WhatsApp o lo quitamos completo?** Mi recomendación: quitarlo en F1, en su lugar "Para ordenar, te conectamos con un asesor" + link a Linktree. En F3 evaluamos Catalog. Pero quizás Lili ya tiene pedidos en marcha por el carrito actual — necesito saberlo.

2. **¿Voseo (costarricense) o tuteo (mexicano) en el copy?** Hoy es inconsistente. Tu marca es mexicana pero estás en CR. Mi recomendación: voseo en el bot, manteniendo identidad mexicana en el producto/menú.

3. **¿Quién es dueño del CRM derivado del bot?** Si es Lili (administración), va a Airtable que ella maneja. Si es Mariela (eventos/marketing), va a su sistema. Si es nadie, no construimos F2.1.

4. **¿Apostamos por WhatsApp Catalog en F3 o quedamos con Linktree?** Catalog es mejor experiencia pero requiere fotos profesionales del menú completo. ¿Tenemos esas fotos o las generamos?

5. **¿Quieres que F1 se haga toda en un branch nuevo con QA antes de mergear, o iterativo con commits a main?** El bot está en producción, prefiero branch + QA antes de cada merge. Pero eso depende de tu apetito de riesgo.

---

## Estimación total

| Fase | Horas estimadas | Esfuerzo calendario | Resultado esperado |
|------|----------------|---------------------|-------------------|
| F1 — Quick wins | 16h | 1 semana | Bot estable, instrumentado, UX competitiva |
| F2 — Estructural | 35h | 2–3 semanas | CRM mínimo + NPS + costo IA bajo |
| F3 — Reemplazo flujos | 50–100h | 1–2 meses | Pedidos por Catalog + A/B testing |
| F4 — Estratégico | semanas | trimestre | Bot como entry point del ecosistema |

**Total realista para que el bot quede "donde debe estar":** ~10 semanas con foco intermitente.

---

## Próximos pasos sugeridos (orden de ejecución F1)

1. **Tú decides los 5 puntos arriba** ↑
2. Aplicamos F1.1 (bug parser) — 1h — **antes** porque está rompiendo el bot ahora
3. Aplicamos F1.2 (logging) — 2h — **antes** porque sin métricas no medimos lo siguiente
4. Aplicamos F1.7 (copy quick fixes) — 1h — sin riesgo
5. Aplicamos F1.3 (promo del día) + F1.5 (reordenar menú) — 4h — juntos
6. Aplicamos F1.4 (botones WhatsApp) — 4h — requiere validación con WATI
7. Aplicamos F1.6 (limitar IA) + F1.8 (quitar nombre) + F1.9 (eventos) — 4h
8. **QA con Lili o Mariela enviando mensajes reales** desde su número personal — 1h
9. Merge a main + monitoreo 48h con logs

Después de eso, conversación con Lili y Mariela para validar Fase 2.
