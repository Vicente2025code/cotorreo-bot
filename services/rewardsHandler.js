// rewardsHandler.js
// Auto-responde con el link de la app cuando el cliente pregunta por Rewards.
// Activado 2026-08-19 despues del comunicado de migracion sin link.
//
// Trigger: keywords que suelen usar los clientes preguntando por la app nueva.
// No interfiere con el flujo normal — solo dispara si el mensaje MATCHEA claramente.

const RE_KEYS = /\b(rewards?|link|app|aplicaci[oó]n|no me lleg[oó]|d[oó]nde entro|c[oó]mo entro|c[oó]mo ingreso|no entiendo|no puedo ver|d[oó]nde veo|d[oó]nde consulto|d[oó]nde reviso|c[oó]mo me registro|link nuevo|programa|sellos|puntos|c[oó]mo veo|d[oó]nde est[aá]|cual es|donde busco)\b/i;

const APP_URL = "https://rewards.grupocotorreo.com";

// Cache en memoria para no responder mas de 1 vez a cada numero en 24h.
// (Airtable seria mejor pero es un handler simple.)
const respondidos = new Map(); // tel -> timestamp
const TTL_MS = 24 * 60 * 60 * 1000;

function shouldRespond(from) {
  const now = Date.now();
  const last = respondidos.get(from);
  if (last && (now - last) < TTL_MS) return false;
  // Limpiar entries viejos
  for (const [k, ts] of respondidos.entries()) {
    if (now - ts > TTL_MS) respondidos.delete(k);
  }
  return true;
}

async function handle({ from, text, sendWatiMessage }) {
  if (!from || !text) return { handled: false };
  const t = text.toLowerCase().trim();

  // Solo reaccionar si es un mensaje corto (probablemente pregunta) o si tiene keywords claros
  const esCorto = t.length < 80;
  const matchea = RE_KEYS.test(t);
  if (!(esCorto && matchea)) return { handled: false };

  // No spamear al mismo numero
  if (!shouldRespond(from)) return { handled: false };

  const respuesta =
    "¡Hola! 👋\n\n" +
    "Entrá a tu app Cotorreo Rewards acá:\n\n" +
    APP_URL + "\n\n" +
    "Ahí ves tus sellos, el menú del grupo, y podés canjear tu crédito de ₡15.000 cuando llegues a 20 sellos. 🎁\n\n" +
    "Si algo no cuadra o querés ayuda, contame y te resuelvo.";

  try {
    await sendWatiMessage(from, respuesta);
    respondidos.set(from, Date.now());
    console.log(`✅ rewardsHandler → link enviado a ${from.slice(-4)}`);
    return { handled: true, via: "rewards_link" };
  } catch (e) {
    console.log("⚠️ rewardsHandler send error:", e?.message);
    return { handled: false };
  }
}

module.exports = { handle };
