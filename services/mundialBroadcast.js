// ================================
// MUNDIAL 2026 BROADCAST AUTOMATIZADO
// ================================
// Cron diario que filtra contactos, manda template con firstName personalizado,
// y los tagea para que no reciban en proximas oleadas.

const TENANT_ID = "1085608";
const WATI_BASE = process.env.WATI_ENDPOINT || "https://live-mt-server.wati.io";
const TEMPLATE_NAME = "cotorreo_invitacion_mundial";
const MAX_POR_OLEADA = parseInt(process.env.MUNDIAL_MAX_POR_OLEADA || "250", 10);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// =====================================================
// Redis helpers (usa el mismo cliente Upstash del bot)
// =====================================================
let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  const { Redis } = require("@upstash/redis");
  _redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return _redis;
}

// =====================================================
// HTTP helpers
// =====================================================
async function watiGet(path) {
  const url = `${WATI_BASE}/${TENANT_ID}${path}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.WATI_TOKEN}`,
      Accept: "application/json",
      "User-Agent": UA,
    },
  });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; }
  catch { return { status: r.status, body: text }; }
}

async function watiPost(path, body) {
  const url = `${WATI_BASE}/${TENANT_ID}${path}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WATI_TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; }
  catch { return { status: r.status, body: text }; }
}

// =====================================================
// Logica de oleada
// =====================================================

async function getNumeroOleada() {
  const r = getRedis();
  if (!r) return 2; // fallback
  const v = await r.get("mundial:next_oleada");
  return v ? parseInt(v, 10) : 2;
}

async function setNumeroOleada(n) {
  const r = getRedis();
  if (!r) return;
  await r.set("mundial:next_oleada", String(n));
}

async function yaEjecutadoHoy() {
  const r = getRedis();
  if (!r) return false;
  const v = await r.get("mundial:last_run_date");
  const hoy = new Date().toISOString().slice(0, 10);
  return v === hoy;
}

async function marcarEjecutadoHoy() {
  const r = getRedis();
  if (!r) return;
  const hoy = new Date().toISOString().slice(0, 10);
  await r.set("mundial:last_run_date", hoy);
}

// Pagina WATI y devuelve contactos elegibles (filtrando los que ya recibieron)
async function obtenerContactosElegibles(numOleadaActual) {
  const elegibles = [];
  const phonesVistos = new Set();
  let page = 0;
  const SIZE = 100;

  // Tags de exclusion: multi_negocio (oleada 1) + todas las oleadas previas
  // E INCLUIDA la oleada actual — porque puede haber tageados de tests/manual
  // a quienes ya les mandamos algo de esta misma oleada.
  const tagsExcluir = ["multi_negocio"];
  for (let i = 2; i <= numOleadaActual; i++) {
    tagsExcluir.push(`mundial_oleada_${i}`);
  }

  while (page < 50) {
    const r = await watiGet(`/api/v1/getContacts?pageSize=${SIZE}&pageNumber=${page}`);
    if (!r.body || !r.body.contact_list) break;
    const items = r.body.contact_list;
    if (items.length === 0) break;

    let nuevosEnPagina = 0;
    for (const c of items) {
      const wa = c.wAid || "";
      if (phonesVistos.has(wa)) continue;
      phonesVistos.add(wa);
      nuevosEnPagina++;

      const cp = c.customParams || [];
      const attrs = new Set(cp.map((p) => p?.name).filter(Boolean));
      const allowBC = c.allowBroadcast !== false;
      const esCotorreoCRM = attrs.has("cotorreo_crm");
      const tieneExcluido = tagsExcluir.some((t) => attrs.has(t));

      if (allowBC && esCotorreoCRM && !tieneExcluido) {
        // Limpiar firstName: si es solo numeros, vacio, o solo emojis -> fallback "familia"
        const raw = (c.firstName || c.fullName || "").trim().split(" ")[0] || "";
        // Quitar emojis y caracteres no-letra para limpiar nombres tipo "Yency🖤😘"
        const cleaned = raw.replace(/[^\p{L}\s'-]/gu, "").trim();
        // Validar: debe tener >=2 letras y no ser solo numeros
        const firstName = (cleaned && cleaned.length >= 2 && /[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(cleaned))
          ? cleaned
          : "familia";
        elegibles.push({ wAid: wa, firstName });
      }
    }

    if (nuevosEnPagina === 0) break;
    page++;
  }

  return elegibles;
}

async function mandarTemplateA(wAid, firstName, broadcastName) {
  return watiPost(
    `/api/v1/sendTemplateMessage?whatsappNumber=${wAid}`,
    {
      template_name: TEMPLATE_NAME,
      broadcast_name: broadcastName,
      parameters: [{ name: "1", value: firstName }],
    }
  );
}

async function tagear(wAid, tagName) {
  return watiPost(
    `/api/v1/addContact/${wAid}`,
    {
      customParams: [{ name: tagName, value: "true" }],
      allowBroadcast: true,
    }
  );
}

async function notificarVicente(mensaje) {
  const VICENTE = process.env.MUNDIAL_NOTIFY_TO || "50672882394";
  try {
    await watiPost(
      `/api/v1/sendSessionMessage/${VICENTE}`,
      { messageText: mensaje }
    );
  } catch (e) {
    console.log("notificarVicente falló:", e.message);
  }
}

// =====================================================
// FUNCION PRINCIPAL
// =====================================================
async function ejecutarOleada({ force = false } = {}) {
  if (!process.env.WATI_TOKEN) {
    return { ok: false, error: "WATI_TOKEN no configurado" };
  }

  // Safety: pausa para fechas especificas (cuando se manda otra campana
  // del grupo el mismo dia y se quiere preservar cupo WATI).
  // Combina lista hardcoded + env var MUNDIAL_CRON_PAUSE_DATE.
  const FECHAS_PAUSA_HARDCODED = [
    "2026-06-06", // Sabado: dia de Alpadel nueva app
  ];
  const fechaPausaEnv = (process.env.MUNDIAL_CRON_PAUSE_DATE || "").trim();
  const fechasPausa = new Set([...FECHAS_PAUSA_HARDCODED]);
  if (fechaPausaEnv) fechasPausa.add(fechaPausaEnv);

  if (!force) {
    const hoyCR = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Costa_Rica"
    }); // formato YYYY-MM-DD
    if (fechasPausa.has(hoyCR)) {
      console.log(`[Mundial] CRON pausado para hoy (${hoyCR})`);
      return { ok: false, skip: `pausado para fecha ${hoyCR}` };
    }
  }

  if (!force && (await yaEjecutadoHoy())) {
    return { ok: false, skip: "ya ejecutado hoy" };
  }

  const numOleada = await getNumeroOleada();
  const tagOleada = `mundial_oleada_${numOleada}`;
  console.log(`[Mundial] Iniciando oleada ${numOleada} (max ${MAX_POR_OLEADA})`);

  // 1. Obtener elegibles
  const elegibles = await obtenerContactosElegibles(numOleada);
  console.log(`[Mundial] Elegibles detectados: ${elegibles.length}`);

  if (elegibles.length === 0) {
    await marcarEjecutadoHoy();
    await notificarVicente(
      `📊 Mundial — oleada ${numOleada}\n\nNo hay contactos elegibles. ` +
      `Probablemente ya terminamos de cubrir la base.`
    );
    return { ok: true, oleada: numOleada, elegibles: 0, enviados: 0 };
  }

  // 2. Mandar a los primeros MAX_POR_OLEADA
  const targets = elegibles.slice(0, MAX_POR_OLEADA);
  const broadcastName = `mundial_oleada_${numOleada}_${Date.now()}`;
  let ok = 0, fallos = 0;
  const fallidos = [];

  for (let i = 0; i < targets.length; i++) {
    const { wAid, firstName } = targets[i];
    try {
      const r = await mandarTemplateA(wAid, firstName, broadcastName);
      if (r.status >= 200 && r.status < 300) {
        ok++;
        // Tagear (con pausa pequeña)
        await tagear(wAid, tagOleada);
      } else {
        fallos++;
        fallidos.push({ wAid, status: r.status });
      }
    } catch (e) {
      fallos++;
      fallidos.push({ wAid, error: e.message });
    }
    // throttle 1.2s para no superar rate limit
    await new Promise((r) => setTimeout(r, 1200));
  }

  // 3. Avanzar contador
  await setNumeroOleada(numOleada + 1);
  await marcarEjecutadoHoy();

  // 4. Notificar a Vicente
  const resumen =
    `📊 *Mundial — oleada ${numOleada} completada*\n\n` +
    `✅ Enviados: ${ok}\n` +
    `❌ Fallos: ${fallos}\n` +
    `📥 Quedan elegibles para próximas oleadas: ${elegibles.length - targets.length}\n` +
    `🔖 Tageados con: ${tagOleada}\n\n` +
    `Mañana 6pm sale la oleada ${numOleada + 1}.`;
  await notificarVicente(resumen);

  console.log(`[Mundial] Oleada ${numOleada} terminada. OK=${ok} FAIL=${fallos}`);
  return { ok: true, oleada: numOleada, enviados: ok, fallos, restantes: elegibles.length - targets.length };
}

module.exports = { ejecutarOleada, getNumeroOleada, setNumeroOleada };
