// vigilanteEspera.js — avisa cuando un cliente lleva rato esperando respuesta.
//
// POR QUÉ EXISTE
// Medición del 9-nov-2026 sobre 100 conversaciones reales de WATI: en 3 de cada
// 100 el cliente habló de último y NADIE le contestó nunca. Las 3 siguieron el
// mismo patrón — el cliente pidió asesor, un humano entró, preguntó algo, el
// cliente respondió en un minuto... y nadie volvió:
//   · Luisa   66 h   "si nos sirve el precio yo haría una lista"  → ~₡87.500
//   · Karol  137 h   "Ha enviado 12.200 colones por SINPE Móvil"  → YA PAGÓ
//   · Daniela 109 h  "Gracias"                                    → no requería
//
// El bot no abandona conversaciones: se calla cuando un humano toma el control
// (index.js, isHandoffActive) y ahí se corta la cadena. Este vigilante cierra
// ese hueco.
//
// Y pesa más desde el 10-nov, cuando se conectaron Instagram y Messenger: Lili
// pasó de una bandeja a tres.
//
// POR QUÉ DOS NIVELES
// WhatsApp cierra la ventana a las 24 h del último mensaje del cliente. Pasado
// eso ya no se puede escribir libre: hay que mandar una plantilla aprobada por
// Meta para que el cliente responda y la ventana se reabra. Eso fue exactamente
// lo que costó el caso de Luisa. Entonces:
//   · aviso   (20 min por defecto) — todavía es una conversación normal
//   · urgente (20 h por defecto)   — quedan ~4 h antes de que se cierre la puerta
//
// COSTO EN LLAMADAS A LA API DE WATI: CERO.
// No consulta nada. El bot ya recibe por webhook los mensajes entrantes y los
// sessionMessageSent (salientes, de bot y de humano), así que el reloj se lleva
// en Redis. Solo gasta cuando efectivamente manda una alerta. Esto importa: el
// plan tiene 10.000 llamadas al mes y andar preguntándole a WATI cada 10 minutos
// se las comería enteras.

const MIN_MS = 60 * 1000;
const H_MS = 60 * MIN_MS;

// Ventana de WhatsApp. Más allá no tiene sentido avisar: ya no se puede escribir
// libre, así que no hay nada que correr a hacer.
const VENTANA_MAX_MS = 24 * H_MS;

const ZSET = "espera_zset";
const claveCtx = (tel) => `espera_ctx:${tel}`;
const claveAvisado = (tel, nivel) => `espera_avisado:${tel}:${nivel}`;

// El contexto vive un poco más que la ventana, para que la alerta urgente
// todavía tenga el texto a mano.
const TTL_CTX_S = 26 * 60 * 60;
const TTL_AVISADO_S = 26 * 60 * 60;

// ─────────────────────────────────────────────────────────────────────────────
// ¿Este mensaje pide una respuesta?
// ─────────────────────────────────────────────────────────────────────────────
// Lista corta y conservadora, a propósito. Se prefiere avisar de más: el staff
// descarta un aviso en dos segundos, mientras que un aviso que no suena costó
// ₡87.500. Por eso NO están aquí palabras como "buenas" (el 27-sep un cliente
// escribió "Buenas?" y se quedó sin respuesta) ni "sí" (contestar "sí" a una
// pregunta del staff casi siempre necesita seguimiento).
const CIERRES = new Set([
  "gracias", "grasias", "ok", "oki", "okey", "listo", "perfecto",
  "excelente", "genial", "buenisimo", "dale", "vale", "claro", "bueno",
  "muchas", "mucha", "mil", "igualmente", "saludos", "bendiciones",
  "y", "de", "por", "muy",
]);

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    // Rango de diacríticos combinantes escrito con escapes a propósito: con los
    // caracteres literales es invisible en un diff y lo rompe cualquier
    // reencode del archivo.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "graciaaas" → "gracias". Colapsa letras repetidas para que el alargue no se
// escape de la lista de cierres.
function colapsar(palabra) {
  return palabra.replace(/(.)\1+/g, "$1");
}

function requiereRespuesta(texto) {
  const limpio = normalizar(texto);
  if (!limpio) return false;
  const palabras = limpio.split(" ").filter(Boolean);
  if (!palabras.length) return false;
  return palabras.some((p) => !CIERRES.has(colapsar(p)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Adjuntos
// ─────────────────────────────────────────────────────────────────────────────
// Tipos de mensaje que traen un adjunto en vez de texto. Para el vigilante son
// mensajes que SÍ piden respuesta, aunque el texto venga vacío. No es un
// detalle: el caso Karol era un comprobante de SINPE, y lo normal es que el
// cliente mande la CAPTURA del SINPE o una nota de voz. Sin esto, los mensajes
// de más valor eran justo los invisibles.
const TIPOS_ADJUNTO = [
  "image", "video", "audio", "voice", "ptt",
  "document", "sticker", "location", "contacts",
];

// Devuelve el tipo de adjunto ("image", "audio"…) o null si no hay.
function tipoDeAdjunto(body, eventType) {
  const b = body || {};
  const m = b.messages?.[0] || {};

  // `type` es el tipo del MENSAJE ("image", "audio"…); `eventType` es el tipo
  // de EVENTO ("message", "sessionMessageSent"…). Hay que mirarlos por
  // separado. La primera versión hacía `eventType || b.type` y el "message"
  // que manda WATI tapaba el "image": los adjuntos quedaban invisibles. Lo
  // cazó la prueba end-to-end del 10-nov con un payload real de foto.
  const candidatos = [b.type, m.type, eventType, b.messageType, b.message?.type];
  for (const c of candidatos) {
    const t = String(c || "").toLowerCase();
    if (TIPOS_ADJUNTO.includes(t)) return t;
  }

  // Shape de WhatsApp Cloud: el adjunto viene anidado (messages[0].image).
  // Se prueba SOLO ahí y no en la raíz, porque en la raíz del webhook de WATI
  // `contacts` y `location` significan otra cosa (el perfil del remitente),
  // y daría un falso positivo en cada mensaje de texto.
  for (const k of TIPOS_ADJUNTO) {
    if (m[k]) return k;
  }

  if (b.mediaUrl || m.mediaUrl) return "adjunto";
  return null;
}

// Texto con el que el vigilante debe evaluar el mensaje: el texto real si hay,
// y si no una marca del adjunto ("[image]") para que no se pierda.
function textoParaVigilante(body, eventType, rawText) {
  const texto = (rawText && String(rawText).trim()) || "";
  if (texto) return texto;
  const adjunto = tipoDeAdjunto(body, eventType);
  return adjunto ? `[${adjunto}]` : "";
}

// `Number(x) || porDefecto` se traga el 0, y 0 es una hora válida (medianoche):
// ESPERA_HORA_INICIO=0 se convertiría en 8 sin avisar. Se valida explícito.
function numEnv(valor, porDefecto) {
  if (valor === undefined || valor === null || String(valor).trim() === "") return porDefecto;
  const n = Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
}

// ─────────────────────────────────────────────────────────────────────────────
function crearVigilante({
  redis,
  ahora = () => Date.now(),
  avisoMin = numEnv(process.env.ESPERA_AVISO_MIN, 20),
  urgenteH = numEnv(process.env.ESPERA_URGENTE_H, 20),
  horaInicio = numEnv(process.env.ESPERA_HORA_INICIO, 8),
  horaFin = numEnv(process.env.ESPERA_HORA_FIN, 22),
  maxPorCorrida = numEnv(process.env.ESPERA_MAX_POR_CORRIDA, 10),
  excluidos = [],
  // Logger inyectable. Sin esto, un cliente que esperó 24 h y nunca fue
  // atendido desaparecía de Redis sin dejar rastro, y no habría forma de medir
  // si el vigilante bajó el 3% de conversaciones abandonadas — que es la razón
  // por la que existe.
  registrar = () => {},
} = {}) {
  const excluidosSet = new Set(excluidos.map((n) => String(n).replace(/\D/g, "")));

  // El miembro del ZSET se normaliza a dígitos puros, igual que la lista de
  // excluidos. Si un camino futuro pasara "+506 8855-1308" y otro
  // "50688551308", quedarían dos relojes para el mismo cliente y uno moriría
  // solo a las 24 h generando una alerta de alguien ya atendido.
  function normalizarTel(tel) {
    const s = String(tel || "");
    return s.startsWith("demo:") ? s : s.replace(/\D/g, "");
  }

  function esIgnorado(tel) {
    const s = String(tel || "");
    if (!s) return true;
    if (s.startsWith("demo:")) return true;
    return excluidosSet.has(s.replace(/\D/g, ""));
  }

  // Hora local de Costa Rica. No se usa un offset fijo aunque CR esté en UTC-6
  // todo el año: si algún día cambia, Intl lo sabe y un -6 a mano no.
  function horaCR(ms) {
    try {
      const txt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Costa_Rica",
        hour: "numeric",
        hourCycle: "h23",
      }).format(new Date(ms));
      const h = parseInt(txt, 10);
      return Number.isFinite(h) ? h : 12;
    } catch (_) {
      return 12; // si Intl falla, asumir horario hábil (mejor avisar que callar)
    }
  }

  // No despertar a nadie a las 2 a.m. El reloj sigue corriendo: cuando abre, la
  // alerta sale con todas las horas acumuladas encima.
  function enHorario(ms) {
    const h = horaCR(ms);
    return h >= horaInicio && h < horaFin;
  }

  // Arranca el reloj. Usa NX: si ya había uno corriendo NO se reinicia, porque
  // la espera se cuenta desde el PRIMER mensaje sin contestar. Luisa escribió a
  // las 22:55 y otra vez a las 22:56 — el reloj debe marcar desde 22:55.
  async function marcarEspera(tel, { nombre = "", texto = "" } = {}) {
    if (esIgnorado(tel)) return false;
    if (!requiereRespuesta(texto)) return false;

    const id = normalizarTel(tel);
    const t = ahora();
    try {
      const puesto = await redis.zadd(ZSET, { nx: true }, { score: t, member: id });
      if (puesto) {
        await redis.set(
          claveCtx(id),
          JSON.stringify({ nombre, texto: String(texto).slice(0, 160), desde: t }),
          { ex: TTL_CTX_S }
        );
      }
      return !!puesto;
    } catch (e) {
      // Si Redis falla preferimos seguir sin vigilante antes que tumbar el
      // webhook: WATI tiene que recibir 200 siempre.
      console.log("⚠️ vigilante marcarEspera:", e?.message);
      return false;
    }
  }

  // Apaga el reloj. Se llama cuando alguien de la casa ATIENDE al cliente.
  //
  // `tsSaliente` (ms) es cuándo salió el mensaje de la casa. Si se pasa y el
  // reloj es MÁS NUEVO que ese mensaje, no se apaga: significa que el cliente
  // volvió a escribir después y sigue esperando.
  //
  // El caso que esto evita (WATI reintenta webhooks y no garantiza orden):
  //   10:00:00  el bot responde → WATI encola el sessionMessageSent
  //   10:00:04  el cliente escribe "¿y para 20 personas?" → reloj en 10:00:04
  //   10:00:06  llega atrasado el sessionMessageSent de las 10:00:00
  // Sin la comparación, ese evento viejo borraba el reloj de la pregunta nueva
  // y esa pregunta no generaba alerta nunca.
  async function limpiarEspera(tel, tsSaliente = null) {
    if (!tel) return false;
    const id = normalizarTel(tel);
    try {
      if (tsSaliente) {
        const desde = await redis.zscore(ZSET, id);
        if (desde && Number(desde) > Number(tsSaliente)) return false;
      }
      await redis.zrem(ZSET, id);
      await redis.del(claveCtx(id));
      await redis.del(claveAvisado(id, "aviso"));
      await redis.del(claveAvisado(id, "urgente"));
      return true;
    } catch (e) {
      console.log("⚠️ vigilante limpiarEspera:", e?.message);
      return false;
    }
  }

  // Deshace la marca de "ya avisé". La usa quien manda las alertas cuando WATI
  // rechaza el envío, para que el próximo tick lo reintente en vez de dar por
  // enviada una alerta que nunca llegó.
  async function desmarcarAviso(tel, nivel) {
    try {
      await redis.del(claveAvisado(normalizarTel(tel), nivel));
    } catch (_) {}
  }

  async function contextoDe(tel) {
    try {
      const crudo = await redis.get(claveCtx(tel));
      if (!crudo) return {};
      return typeof crudo === "string" ? JSON.parse(crudo) : crudo;
    } catch (_) {
      return {};
    }
  }

  // Saca de la lista lo que ya pasó la ventana de 24 h: no hay nada que avisar
  // y si no se limpia el ZSET crece para siempre.
  //
  // Deja rastro de cada uno: un cliente que esperó 24 h sin ser atendido es
  // precisamente el evento que hay que poder contar para saber si esto sirve.
  async function purgarVencidos(t) {
    try {
      const vencidos = await redis.zrange(ZSET, 0, t - VENTANA_MAX_MS, { byScore: true });
      for (const tel of vencidos) {
        const ctx = await contextoDe(tel);
        const avisado = await redis.get(claveAvisado(normalizarTel(tel), "urgente"));
        registrar("espera_vencida", {
          from: String(tel),
          horas: ctx.desde ? Math.floor((t - Number(ctx.desde)) / H_MS) : null,
          se_alerto_urgente: !!avisado,
          texto_preview: String(ctx.texto || "").slice(0, 60),
        });
        await limpiarEspera(tel);
      }
      return vencidos.length;
    } catch (_) {
      return 0;
    }
  }

  // Devuelve las alertas que hay que mandar AHORA. No manda nada: de eso se
  // encarga quien la llama (index.js), que es el que tiene sendWatiTemplate.
  async function revisarEsperas() {
    const t = ahora();
    const habil = enHorario(t);

    const techo = t - avisoMin * MIN_MS;   // más viejo que esto, ya toca avisar
    const piso = t - VENTANA_MAX_MS;       // más viejo que esto, ya no sirve

    let pendientes = [];
    try {
      pendientes = await redis.zrange(ZSET, piso, techo, { byScore: true });
    } catch (e) {
      console.log("⚠️ vigilante revisarEsperas:", e?.message);
      return [];
    }

    const alertas = [];
    for (const tel of pendientes) {
      // Tope por corrida. Lo que no entre no se marca como avisado, así que
      // sale en el siguiente tick. Evita la ráfaga de decenas de plantillas
      // tras un downtime de Render, que daría 429 de WATI y quemaría cuota.
      if (alertas.length >= maxPorCorrida) break;
      if (esIgnorado(tel)) continue;

      let desde;
      try {
        desde = await redis.zscore(ZSET, tel);
      } catch (_) {
        continue;
      }
      if (!desde) continue;

      const edad = t - Number(desde);
      const nivel = edad >= urgenteH * H_MS ? "urgente" : "aviso";

      // El aviso de 20 min respeta el horario del local: no hay por qué
      // despertar a nadie. El URGENTE no, y es a propósito.
      //
      // Con el horario aplicado a los dos, había un hueco de 6 horas: un
      // cliente que escribía entre las 02:00 y las 08:00 nunca recibía el
      // urgente. Ejemplo — escribe a las 03:00; a las 08:00 sale el aviso
      // (5 h); el urgente tocaría a las 23:00, fuera de horario; y a las 08:00
      // del día siguiente ya tiene 29 h y se purga sin haberse evaluado. O sea
      // justo la alerta que vale ₡87.500 no sonaba nunca, y de madrugada es
      // cuando más se olvidan los chats.
      if (nivel === "aviso" && !habil) continue;

      // Una alerta por nivel y por cliente. Si ya se avisó el "aviso", todavía
      // puede escalar a "urgente" más tarde porque la clave es distinta.
      // Si el envío falla, quien lo manda llama a desmarcarAviso() y el
      // próximo tick lo reintenta.
      let primeraVez;
      try {
        primeraVez = await redis.set(claveAvisado(tel, nivel), "1", {
          nx: true,
          ex: TTL_AVISADO_S,
        });
      } catch (_) {
        continue;
      }
      if (!primeraVez) continue;

      const ctx = await contextoDe(tel);
      alertas.push({
        telefono: String(tel),
        nombre: ctx.nombre || "",
        texto: ctx.texto || "",
        nivel,
        minutos: Math.floor(edad / MIN_MS),
        horas: Math.floor(edad / H_MS),
      });
    }

    // El purgado va al FINAL, nunca antes de evaluar: si corriera primero, una
    // entrada a punto de cumplir las 24 h se borraría sin haber tenido su
    // oportunidad de alerta.
    await purgarVencidos(t);

    return alertas;
  }

  return {
    marcarEspera,
    limpiarEspera,
    desmarcarAviso,
    revisarEsperas,
    requiereRespuesta,
    _claves: { ZSET, claveCtx, claveAvisado },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Texto de la alerta al staff
// ─────────────────────────────────────────────────────────────────────────────
// Va por la plantilla "staff_alerta", ya aprobada en WATI:
//   "🔔 Notificación de Grupo Cotorreo / Tipo de alerta: {{1}} /
//    Detalle completo: {{2}} / Podés ver más información en Airtable..."
// Los parámetros de plantilla de WATI no admiten saltos de línea ni tabs, y el
// cliente SÍ puede escribir en varias líneas (Luisa mandó un párrafo largo).
// Sin esto, la alerta de un mensaje multilínea se rechazaría — justo el caso que
// más importa avisar.
function enUnaLinea(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// Mismo criterio de datos personales que notifyHandoffAlert: se manda la cola
// de 8 dígitos, no el número completo. En Costa Rica esos 8 dígitos SON el
// número local, así que el staff igual encuentra el chat buscándolo en WATI, y
// el número completo no queda guardado en el histórico de broadcasts.
function colaTel(tel) {
  const d = String(tel || "").replace(/\D/g, "");
  return d ? `***${d.slice(-8)}` : "desconocido";
}

function textoAlerta({ nivel, nombre, telefono, texto, minutos, horas }) {
  const quien = nombre ? `${enUnaLinea(nombre)} ` : "";
  const cita = texto ? ` Dijo: "${enUnaLinea(texto).slice(0, 90)}".` : "";
  telefono = colaTel(telefono);

  if (nivel === "urgente") {
    const restantes = Math.max(0, 24 - Number(horas || 0));
    return {
      tipo: "URGENTE - se cierra la ventana de WhatsApp",
      detalle:
        `${quien}(${telefono}) lleva ${horas} horas sin respuesta.${cita} ` +
        `Quedan ~${restantes} h antes de que WhatsApp cierre el chat: despues de eso ` +
        `ya NO se le puede escribir libre, solo plantilla. Contestar en WATI ya.`,
    };
  }

  const espera = minutos >= 60
    ? `${Math.floor(minutos / 60)} h ${minutos % 60} min`
    : `${minutos} min`;
  return {
    tipo: "Cliente esperando respuesta",
    detalle:
      `${quien}(${telefono}) lleva ${espera} sin respuesta.${cita} ` +
      `Contestar en la bandeja de WATI.`,
  };
}

// Alerta de canal no soportado (Instagram / Messenger).
// La API REST de WATI no puede responder por esos canales, asi que lo unico que
// se puede hacer es avisarle a una persona.
function textoAlertaCanal({ canalEtiqueta, remitente, texto }) {
  const cita = texto ? ` Dijo: "${enUnaLinea(texto).slice(0, 90)}".` : "";
  return {
    tipo: `Mensaje por ${canalEtiqueta} - el bot no puede responder`,
    detalle:
      `Te escribieron por ${canalEtiqueta} (${colaTel(remitente)}).${cita} ` +
      `El bot solo responde WhatsApp, asi que esta conversacion necesita una persona: ` +
      `abrir la bandeja de WATI y contestar ahi.`,
  };
}

module.exports = {
  crearVigilante,
  requiereRespuesta,
  textoAlerta,
  textoAlertaCanal,
  tipoDeAdjunto,
  textoParaVigilante,
  numEnv,
  TIPOS_ADJUNTO,
  VENTANA_MAX_MS,
};
