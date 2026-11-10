// canalDetector.js — ¿este mensaje vino por WhatsApp o por otra puerta?
//
// CONTEXTO (10-nov-2026)
// Vicente conectó Instagram y Facebook Messenger a WATI. El problema es que la
// API REST de WATI NO puede responder por esos canales. Su propia documentación:
//   · "Two channels live: WhatsApp and Instagram today.
//      TikTok and Messenger are coming soon."
//   · Instagram: "Reply to comments with the REST API.
//      Answer DMs through the MCP server."
//   · FAQ: "Not in the API yet. Both are coming soon."
// O sea: los DM de Instagram solo salen por el servidor MCP (que el bot no usa)
// y Messenger no existe en la API.
//
// Y sendWatiMessage() está clavado a WhatsApp de todas formas:
//   const whatsappNumber = String(to).replace(/\D/g, "");
//   channelPhoneNumber: "50683436583"
//
// Entonces, si entra un DM de Instagram, el bot le intenta mandar un WhatsApp a
// un ID de 17 dígitos, WATI lo rechaza, y el cliente NO RECIBE NADA. Falla
// callado — el peor modo de falla posible, porque nadie se entera.
//
// Este módulo detecta esos mensajes para que el bot avise al staff en vez de
// perder al cliente. Al 10-nov-2026 no había entrado ninguno todavía (los 400
// contactos de la cuenta son de WhatsApp), así que esto es un seguro preventivo.
//
// REGLA DE ORO: ante la duda, devolver "whatsapp"/"desconocido" y dejar que el
// bot se comporte como hoy. Un falso positivo callaría al bot en WhatsApp, que
// es el canal que de verdad factura.

// Máximo de dígitos de un número telefónico según E.164. Arriba de eso no es un
// teléfono: los IDs de Instagram (IGSID, ~17) y de Messenger (PSID, ~16) pasan
// ese techo. No se puede distinguir IG de Messenger solo por el ID, así que en
// ese caso devolvemos "otro_canal" y la alerta dice "Instagram o Messenger".
const MAX_DIGITOS_E164 = 15;

const CAMPOS_REMITENTE = [
  "waId", "wa_id", "whatsappNumber", "from", "sender", "senderId",
];

function remitenteDe(b) {
  for (const campo of CAMPOS_REMITENTE) {
    if (b[campo]) return String(b[campo]);
  }
  if (b.contact?.waId) return String(b.contact.waId);
  if (b.contact?.wa_id) return String(b.contact.wa_id);
  if (b.contacts?.[0]?.wa_id) return String(b.contacts[0].wa_id);
  if (b.messages?.[0]?.from) return String(b.messages[0].from);
  return null;
}

// Marcas de canal. OJO: estas marcas se usan SOLO para ponerle nombre al canal
// cuando ya sabemos que el remitente no es un teléfono. NUNCA para decidir si el
// bot puede responder — ver el invariante de abajo.
//
// Se excluyen a propósito `source`, `platform` y `contact.source`: en WATI esos
// campos son el ORIGEN DE ADQUISICIÓN del contacto, no el canal. Los valores
// reales que devuelve la cuenta hoy son "Wati", "WhatsApp", "CTWA" y null, y
// CTWA es Click-to-WhatsApp Ads, o sea anuncios que corren EN Facebook e
// Instagram. Si WATI escribiera ahí "Instagram Ads" o "Facebook Ads" —
// perfectamente plausible — y esa marca decidiera el canal, el bot se quedaría
// mudo en WhatsApp con ese cliente de forma permanente.
const CAMPOS_CANAL = ["channel", "channelType", "channel_type", "messageChannel", "sourceChannel"];

function marcasDe(b) {
  const marcas = CAMPOS_CANAL.map((c) => String(b[c] ?? "").toLowerCase().trim());
  return marcas.filter(Boolean);
}

// Le pone nombre al canal cuando el remitente NO es un teléfono. Si no hay
// marca que lo diga, queda "otro_canal" y la alerta dirá "Instagram o
// Messenger", que es lo único honesto: un IGSID (~17 dígitos) y un PSID (~16)
// no se distinguen entre sí por el ID.
function etiquetarPorMarcas(b) {
  const marcas = marcasDe(b);
  const alguna = (frags) => marcas.some((m) => frags.some((f) => m.includes(f)));
  if (alguna(["instagram"]) || b.igPhoneSource) return "instagram";
  if (alguna(["messenger", "facebook"]) || b.mgPhoneSource) return "messenger";
  return "otro_canal";
}

function detectarCanal(body) {
  const b = body || {};
  const remitente = remitenteDe(b);
  if (!remitente) return "desconocido";

  // Las sesiones del simulador (/demo) usan el prefijo "demo:" — traen letras y
  // dos puntos, así que la heurística de dígitos las marcaría como otro canal
  // y rompería el simulador. Se revisan primero.
  if (remitente.startsWith("demo:")) return "demo";

  // ── INVARIANTE ───────────────────────────────────────────────────────────
  // Si el remitente es un número que cabe en E.164, el bot PUEDE responderle
  // por la API REST de WATI. Punto. Esto se decide ANTES que cualquier marca
  // de canal, y ninguna marca lo revierte.
  //
  // El orden importa: un falso positivo acá no es un bug cualquiera, es el bot
  // mudo en WhatsApp con un cliente real, de forma persistente y silenciosa
  // (una sola alerta al staff por día y nada más). WhatsApp es el canal que
  // factura. Los IDs de Instagram (IGSID, ~17 dígitos) y de Messenger (PSID,
  // ~16) pasan el techo de 15, así que la detección de verdad no se pierde.
  const limpio = remitente.trim();
  if (!/^\+?[\d\s()-]+$/.test(limpio)) return "desconocido";

  const digitos = limpio.replace(/\D/g, "");
  if (!digitos) return "desconocido";
  if (digitos.length <= MAX_DIGITOS_E164) return "whatsapp";

  // Acá ya sabemos que no es un teléfono. Recién ahora las marcas sirven, y
  // solo para decidir cómo se llama el canal en la alerta.
  return etiquetarPorMarcas(b);
}

// Canales por los que el bot SÍ puede responder.
// "desconocido" entra a propósito: si no logramos clasificar el payload,
// preferimos el comportamiento de hoy antes que callar al bot en WhatsApp.
const RESPONDIBLES = new Set(["whatsapp", "demo", "desconocido"]);

function esWhatsApp(canal) {
  return RESPONDIBLES.has(canal);
}

// Nombre para mostrarle al staff en la alerta.
const ETIQUETAS = {
  instagram: "Instagram",
  messenger: "Facebook Messenger",
  otro_canal: "Instagram o Messenger",
};

function etiquetaCanal(canal) {
  return ETIQUETAS[canal] || canal;
}

module.exports = { detectarCanal, esWhatsApp, etiquetaCanal, MAX_DIGITOS_E164 };
