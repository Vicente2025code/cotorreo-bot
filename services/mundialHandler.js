// ================================
// MUNDIAL 2026 HANDLER (additive, no toca flujo existente)
// ================================
// Intercepta mensajes de contactos en la lista de campaña Mundial 2026
// y los responde con contexto relevante en lugar del menu principal del bot.
//
// Activacion: si el numero del 'from' esta en data/mundial_2026_recipients.json
// Y el timestamp actual es anterior a `mundial_expires_at` del archivo.
//
// SAFETY NETS:
//   1. Env var MUNDIAL_HANDLER_DISABLED=true -> handler queda completamente
//      desactivado sin necesidad de redeploy. Pone false / borra para activar.
//   2. Cooldown 10s por numero (Redis) -> imposible mandarle al mismo numero
//      mas de 1 mensaje cada 10s. Loop protection.
//
// Salida del modo Mundial:
//   - El cliente escribe "menu", "hola", "1", "2", "3" -> devolvemos {handled:false}
//     y el bot principal le da el menu normal
//   - Despues de la fecha de expiracion -> nadie en mundial mode
//   - Cliente escribe BAJA -> WATI maneja opt-out (no respondemos)

const fs = require("fs");
const path = require("path");
const { Redis } = require("@upstash/redis");

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  _redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return _redis;
}

const COOLDOWN_SECONDS = 10;
const ACTIVE_TTL_SECONDS = 48 * 3600; // 48h en modo Mundial despues de recibir el template

// ================================
// NIVEL A: Deteccion por contenido del mensaje
// ================================
// Si el cliente menciona palabras inequivocas del Mundial Cotorreo 2026,
// el handler responde con info de quiniela SIN importar si esta en lista.
// Esto cubre el caso de clientes que recibieron template via script externo
// (no via bot) y por ende no estan marcados en Redis ni en JSON.
//
// REGLA: solo activamos con palabras que NO se usen en flujo normal del bot.
// "registrar" o "premio" sueltos NO activan (son ambiguos).
function tieneSeñalDefinitivaDeMundial(text) {
  const t = (text || "").toLowerCase();
  if (!t || t.length < 3) return false;
  const patrones = [
    /\bmundial(es)?\b/,                  // "mundial" o "mundiales"
    /\bquiniel/,                          // "quiniela", "quinielera", etc.
    /cotorreo\s*2026/,                   // "Cotorreo 2026"
    /\bfifa\b/,                           // "FIFA"
    /partido\s*inaugural/,                // "partido inaugural"
    /\b11\s*de\s*junio/,                  // "11 de junio"
    /jugar.{0,15}mundial/,                // "jugar el mundial", "jugar al mundial"
    /apuesta.{0,10}mundial/,              // "apuesta del mundial"
    /pronostico.{0,15}(partido|mundial)/, // "pronostico de partidos"
  ];
  return patrones.some(p => p.test(t));
}

// Activar modo Mundial para un contacto especifico (llamado cuando WATI envia
// el template del Mundial vía sessionMessageSent)
async function activateForContact(from) {
  const r = getRedis();
  if (!r) return false;
  const clean = String(from || "").replace(/\D/g, "");
  if (!clean) return false;
  try {
    await r.set(`mundial:active:${clean}`, "1", { ex: ACTIVE_TTL_SECONDS });
    console.log(`mundialHandler: ACTIVADO para ${clean.slice(-4)} (48h)`);
    return true;
  } catch (e) {
    console.log("mundialHandler: error activando", e.message);
    return false;
  }
}

// Verificar si un contacto esta en modo Mundial activo (recibio el template
// recientemente y aun esta dentro del window de 48h)
async function isRecipientActive(from) {
  const r = getRedis();
  if (!r) return false;
  const clean = String(from || "").replace(/\D/g, "");
  if (!clean) return false;
  try {
    const v = await r.get(`mundial:active:${clean}`);
    return !!v;
  } catch (e) {
    return false;
  }
}

async function isInCooldown(from) {
  const r = getRedis();
  if (!r) return false; // si Redis no esta, no bloqueamos
  try {
    const v = await r.get(`mundial:cooldown:${from}`);
    return !!v;
  } catch (e) {
    return false;
  }
}

async function setCooldown(from) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(`mundial:cooldown:${from}`, "1", { ex: COOLDOWN_SECONDS });
  } catch (e) {
    // best-effort
  }
}

const DATA_PATH = path.join(__dirname, "..", "data", "mundial_2026_recipients.json");

let cache = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60 * 1000; // recargar cada 60s

function loadRecipients() {
  const now = Date.now();
  if (cache && (now - cacheLoadedAt) < CACHE_TTL_MS) return cache;
  try {
    if (!fs.existsSync(DATA_PATH)) {
      cache = { recipients: [], mundial_expires_at: 0 };
      cacheLoadedAt = now;
      return cache;
    }
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    cache = JSON.parse(raw);
    cacheLoadedAt = now;
    return cache;
  } catch (e) {
    console.log("mundialHandler: error leyendo recipients", e.message);
    cache = { recipients: [], mundial_expires_at: 0 };
    cacheLoadedAt = now;
    return cache;
  }
}

function isRecipient(from) {
  const data = loadRecipients();
  if (Date.now() > (data.mundial_expires_at || 0)) return false;
  // normalizar a solo digitos
  const cleaned = String(from || "").replace(/\D/g, "");
  return Array.isArray(data.recipients) && data.recipients.includes(cleaned);
}

const EXIT_WORDS = new Set([
  "menu", "menú", "inicio", "0", "1", "2", "3", "9", "asesor",
  "reservas", "carrito", "pedido", "orden", "plaza", "alpadel"
]);

const BAJA_WORDS = ["baja", "stop", "remover", "borrar", "unsubscribe", "salir lista"];

function classify(text) {
  const t = (text || "").toLowerCase().trim();
  if (!t) return "vacio";
  if (BAJA_WORDS.some(k => t === k || t.startsWith(k + " "))) return "baja";
  if (EXIT_WORDS.has(t)) return "exit_to_main_menu";
  // hola es ambigua: si es solo "hola" probablemente quiere menu normal
  if (t === "hola") return "exit_to_main_menu";

  if (/(c[oó]mo|donde|d[oó]nde).{0,20}(registr|entr|jug|empez|inscrib)/.test(t)) return "como_registro";
  if (/(no.{0,8}(puedo|s[eé])|ayuda|no me entra|no carga|atascad|error)/.test(t)) return "ayuda_tecnica";
  if (/(premio|gan|canje|recompens|punto)/.test(t)) return "premios";
  if (/(costo|precio|gratis|cu[aá]nto cuesta|cuanto vale)/.test(t)) return "costo";
  if (/(cu[aá]ndo|hasta cu[aá]ndo|fecha|empieza|inaugural|inicia|cu[aá]nto dura)/.test(t)) return "cuando";
  if (/(gracias|gracias!|🙏|👏|🙌|👍|👌|excelente|perfecto|buenas|qu[eé] bueno|qu[eé] chiva)/.test(t)) return "agradece";
  if (/(amigo|amig|invit|compart|grupo)/.test(t)) return "invitar_amigos";
  return "otro";
}

// =========== respuestas (texto plano, en voseo CR) ===========
const REPLY = {
  como_registro:
    "Solo dale al botón *Jugar ahora* del mensaje que te llegó, o entrá a 👉 mundial.grupocotorreo.com\n\n" +
    "Te registrás en 2 minutos, solo necesitás tu celular.",

  ayuda_tecnica:
    "Disculpá! ¿Me podés mandar un screenshot de lo que ves? Así lo reviso con el equipo y te ayudo.\n\n" +
    "O si preferís hablar con humano, escribí *asesor*.",

  premios:
    "Acertás partidos del Mundial, ganás puntos, y los canjeás por:\n\n" +
    "🍔 Comida en Plaza Cotorreo\n" +
    "🎮 Sesiones en Bebros\n" +
    "🎾 Canchas en Alpadel\n\n" +
    "La tabla completa la ves cuando entrás a 👉 mundial.grupocotorreo.com",

  costo:
    "100% gratis. Solo te tomás 2 min en registrarte.\n\n👉 mundial.grupocotorreo.com",

  cuando:
    "El partido inaugural es el *11 de junio*. La quiniela corre todo el Mundial hasta la final.\n\n" +
    "Quien arranque hoy lleva ventaja sobre los demás.",

  agradece:
    "Gracias a vos por estar con Cotorreo 🙏 Si necesitás ayuda con el registro, mandame screenshot y te ayudo.",

  invitar_amigos:
    "¡Por supuesto! Cuanto más gente, más interesante.\n\n" +
    "Compartile el link 👉 mundial.grupocotorreo.com — ellos se registran igual que vos.",

  otro:
    "Hola 👋 Veo que respondiste a la quiniela del Mundial.\n\n" +
    "El link para registrarte es 👉 mundial.grupocotorreo.com\n\n" +
    "¿Pudiste registrarte? Si necesitás ayuda contame qué pasa, o escribí *asesor* para hablar con humano.",

  vacio: null, // no respondemos a mensajes vacios
};

async function handle({ from, text, sendWatiMessage }) {
  // Safety net 1: kill switch via env var
  if (process.env.MUNDIAL_HANDLER_DISABLED === "true") {
    return { handled: false };
  }

  // NIVEL A: Palabras inequivocas del Mundial en el texto -> SIEMPRE activa
  const señalA = tieneSeñalDefinitivaDeMundial(text);

  // NIVEL B: V2 detectar si esta en modo Mundial activo (Redis-based, marcado
  // cuando recibio el template, no por estar en una lista pre-cargada)
  const activoEnRedis = await isRecipientActive(from);

  // NIVEL C: Fallback al JSON (legacy) — debe tener mundial_expires_at > now()
  const enListaJSON = isRecipient(from);

  // Si NINGUN nivel aplica, devolver { handled: false } y dejar pasar al
  // flujo normal del bot sin afectarlo.
  if (!señalA && !activoEnRedis && !enListaJSON) {
    return { handled: false };
  }

  // Log de diagnostico para saber por que nivel se activo
  if (señalA) console.log(`mundialHandler: activado via NIVEL A (texto) para ${from.slice(-4)}`);

  // Safety net 2: cooldown anti-loop (10s por contacto)
  if (await isInCooldown(from)) {
    console.log(`mundialHandler: COOLDOWN bloqueo respuesta a ${from.slice(-4)}`);
    return { handled: true }; // bloqueamos respuesta y NO dejamos pasar al bot principal
  }

  const kind = classify(text);

  if (kind === "baja") {
    // WATI procesa opt-out, no respondemos
    return { handled: true };
  }

  if (kind === "exit_to_main_menu") {
    // Devolvemos handled:false para que el bot principal le mande el menu normal
    return { handled: false };
  }

  const reply = REPLY[kind];
  if (!reply) {
    return { handled: true }; // mensaje vacio, no respondemos
  }

  try {
    await sendWatiMessage(from, reply);
    await setCooldown(from); // activamos cooldown 10s para este numero
    console.log(`mundialHandler: respondio a ${from.slice(-4)} (kind=${kind})`);
    return { handled: true };
  } catch (e) {
    console.log("mundialHandler: error enviando reply", e.message);
    return { handled: false }; // dejamos que el flujo normal intente
  }
}

module.exports = { handle, isRecipient, classify, activateForContact, isRecipientActive };
