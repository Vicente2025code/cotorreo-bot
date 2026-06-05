// ================================
// ALPADEL — campaña one-shot: nueva app de reservas
// ================================
// Cron programado para mañana sábado 6 jun 2026 a las 12:00 PM CR.
// Verifica que el template alpadel_nueva_app_v1 este APROBADO antes
// de mandar. Si no esta aprobado, notifica a Vicente y aborta.

const fs = require("fs");
const path = require("path");

const TENANT_ID = "1085608";
const WATI_BASE = process.env.WATI_ENDPOINT || "https://live-mt-server.wati.io";
const TEMPLATE_NAME = "alpadel_nueva_app_v1";
const TAG_RECIBIDO = "alpadel_nueva_app_recibido";
const VICENTE_NUM = "50672882394";
const THROTTLE_MS = 1500;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DATA_PATH = path.join(__dirname, "..", "data", "alpadel_recipients.json");

// --- Redis (opcional, para no doble-disparo)
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

async function yaEjecutado() {
  const r = getRedis();
  if (!r) return false;
  return !!(await r.get("alpadel:nueva_app_ejecutado"));
}

async function marcarEjecutado() {
  const r = getRedis();
  if (!r) return;
  await r.set("alpadel:nueva_app_ejecutado", "1");
}

// --- HTTP helpers
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

async function notificar(msg) {
  try {
    await watiPost(`/api/v1/sendSessionMessage/${VICENTE_NUM}`, { messageText: msg });
  } catch (e) {
    console.log("[Alpadel] notificar fallo:", e.message);
  }
}

// --- Verificar template aprobado
async function templateAprobado() {
  const r = await watiGet("/api/v1/getMessageTemplates");
  if (!r.body || !r.body.messageTemplates) return null;
  const t = r.body.messageTemplates.find((x) => x.elementName === TEMPLATE_NAME);
  if (!t) return { found: false };
  const status = (t.status || "").toUpperCase();
  return { found: true, status, approved: status === "APPROVED" };
}

// --- Logica principal
async function ejecutarAlpadel({ force = false } = {}) {
  if (!process.env.WATI_TOKEN) {
    return { ok: false, error: "WATI_TOKEN no configurado" };
  }

  // Anti-doble-disparo
  if (!force && (await yaEjecutado())) {
    console.log("[Alpadel] Ya ejecutado, skip.");
    return { ok: false, skip: "ya ejecutado" };
  }

  // Verificar template aprobado
  const tplStatus = await templateAprobado();
  if (!tplStatus || !tplStatus.found) {
    const msg = `⚠️ Alpadel: template '${TEMPLATE_NAME}' NO existe en WATI. ` +
                `No se mando la campaña. Revisa.`;
    console.log("[Alpadel]", msg);
    await notificar(msg);
    return { ok: false, error: "template no existe" };
  }
  if (!tplStatus.approved) {
    const msg = `⚠️ Alpadel: template '${TEMPLATE_NAME}' aun NO esta APPROVED ` +
                `(status: ${tplStatus.status}). Reagenda manual cuando lo aprueben.`;
    console.log("[Alpadel]", msg);
    await notificar(msg);
    return { ok: false, error: "template no aprobado" };
  }

  // Cargar recipients
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  } catch (e) {
    const msg = `❌ Alpadel: no pude leer ${DATA_PATH}. ${e.message}`;
    await notificar(msg);
    return { ok: false, error: e.message };
  }
  const recipients = data.recipients || [];
  console.log(`[Alpadel] ${recipients.length} recipients cargados`);

  // Enviar
  const broadcastName = `alpadel_nueva_app_${Date.now()}`;
  let ok = 0, fallos = 0;
  for (let i = 0; i < recipients.length; i++) {
    const { wAid, firstName } = recipients[i];
    try {
      const r = await watiPost(
        `/api/v1/sendTemplateMessage?whatsappNumber=${wAid}`,
        {
          template_name: TEMPLATE_NAME,
          broadcast_name: broadcastName,
          parameters: [{ name: "1", value: firstName }],
        }
      );
      if (r.status >= 200 && r.status < 300) {
        ok++;
        // Tagear
        await watiPost(`/api/v1/addContact/${wAid}`, {
          customParams: [{ name: TAG_RECIBIDO, value: "true" }],
          allowBroadcast: true,
        });
      } else {
        fallos++;
        console.log(`[Alpadel] FAIL ${wAid}: ${r.status}`);
      }
    } catch (e) {
      fallos++;
      console.log(`[Alpadel] ERROR ${wAid}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }

  await marcarEjecutado();
  const resumen =
    `📊 *Alpadel — nueva app enviada*\n\n` +
    `✅ Enviados: ${ok}\n` +
    `❌ Fallos: ${fallos}\n` +
    `🔖 Tageados con: ${TAG_RECIBIDO}\n\n` +
    `Broadcast: ${broadcastName}`;
  await notificar(resumen);

  console.log(`[Alpadel] Terminado. OK=${ok} FAIL=${fallos}`);
  return { ok: true, enviados: ok, fallos };
}

module.exports = { ejecutarAlpadel, templateAprobado };
