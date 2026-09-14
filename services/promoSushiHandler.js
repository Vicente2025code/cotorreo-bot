// promoSushiHandler.js
// Responde automáticamente sobre el 2x1 de Sushi cuando el cliente pregunta.
// Ventana: desde el 14-sep-2026 hasta el 21-sep-2026 23:59 CR (UTC-6).
// El martes 22 la promo vuelve, entonces el handler se apaga solo.
//
// Estilo: marketing + vendedor tico.
// Anti-spam: 1 vez cada 24 h por número.

const RE_KEYS = /\b(sushi|2\s*x\s*1\s*sushi|martes\s*sushi|martes\s*de\s*sushi|kumo|rollos?|promo\s*sushi|2\s*x\s*1|dos\s*por\s*uno)\b/i;

// Fecha límite: 21 sep 2026 23:59 CR (UTC-6 → 22 sep 05:59 UTC)
const FECHA_LIMITE_UTC = new Date("2026-09-22T05:59:00Z").getTime();

const respondidos = new Map(); // tel -> timestamp
const TTL_MS = 24 * 60 * 60 * 1000;

function shouldRespond(from) {
  const now = Date.now();
  const last = respondidos.get(from);
  if (last && (now - last) < TTL_MS) return false;
  for (const [k, ts] of respondidos.entries()) {
    if (now - ts > TTL_MS) respondidos.delete(k);
  }
  return true;
}

async function handle({ from, text, sendWatiMessage }) {
  if (!from || !text) return { handled: false };

  // Ventana temporal — si ya paso el 22 sep, el handler no responde
  if (Date.now() > FECHA_LIMITE_UTC) return { handled: false };

  const t = text.toLowerCase().trim();
  const esCorto = t.length < 120;
  const matchea = RE_KEYS.test(t);
  if (!(esCorto && matchea)) return { handled: false };

  if (!shouldRespond(from)) return { handled: false };

  const respuesta =
    "¡Hola! 🍣\n\n" +
    "Qué bueno que nos preguntás por el *2x1 en Sushi* — sos de las personas que no se pierden un martes con nosotros 🙌\n\n" +
    "*Esta semana el 2x1 le da descanso.* Este martes 15 de septiembre NO habrá 2x1.\n\n" +
    "📆 *Regresa el martes 22 de septiembre* en Kumo (Plaza Cotorreo) con los mismos rollos de siempre y esa misma promo que amás.\n\n" +
    "Mientras tanto, si te agarran ganas de venir esta semana:\n" +
    "🌮 *Lunes* – 2x1 Tacos al Pastor\n" +
    "🌮 *Miércoles* – 2x1 Quesabirrias\n" +
    "🍔 *Jueves* – 3x2 Hamburguesas Pits\n" +
    "🍽️ *L a V* – Menú Ejecutivo ₡3.800 (11:30 am a 2 pm)\n\n" +
    "¿Querés que te aparte mesa para el martes 22 desde ya? Contame para cuántos.";

  try {
    await sendWatiMessage(from, respuesta);
    respondidos.set(from, Date.now());
    console.log(`✅ promoSushiHandler → respuesta enviada a ${from.slice(-4)}`);
    return { handled: true, via: "promo_sushi" };
  } catch (e) {
    console.log("⚠️ promoSushiHandler send error:", e?.message);
    return { handled: false };
  }
}

module.exports = { handle };
