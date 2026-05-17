// ================================
// DEPENDENCIAS
// ================================
const express = require("express");
const fs = require("fs");
const { Redis } = require("@upstash/redis");
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const HANDOFF_FILE = "./handoff_state.json";

const bodyParser = require("body-parser");
const fetch = global.fetch || require("node-fetch");
const { getSimpleAIReply } = require("./services/aiFallbackService");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ extended: false }));



// ================================
// ESTADO GLOBAL POR USUARIO
// ================================
const userState = {};
const processedMessages = {};
const userCart = {};
const userMeta = {};
const userProfile = {};
const userReservations = {};
const userReservationDraft = {};
const userHandoff = {};

async function loadHandoffState() {
  try {
    const data = await redis.get("handoff_state");
    if (data) {
      Object.assign(userHandoff, data);
    }
  } catch (e) {
    console.log("Error cargando handoff state:", e.message);
  }
}

async function saveHandoffState() {
  try {
    await redis.set("handoff_state", JSON.stringify(userHandoff));
  } catch (e) {
    console.log("Error guardando handoff state:", e.message);
  }
}

// ================================
// LOGGING ESTRUCTURADO (F1.2)
// Emite JSON-line a stdout para que cualquier colector (Railway, n8n, etc.)
// pueda agregarlos. Eventos clave:
//   - message_received      → cada mensaje entrante con su estado actual
//   - ai_fallback_triggered → cuando el LLM toma control (debe ser raro)
//   - handoff_triggered     → cuando un humano se hace cargo
//   - reservation_link_sent → interceptor de reservas disparó
//   - state_transition      → cambio de estado relevante (entrada a flujos críticos)
// ================================
function logEvent(event, payload = {}) {
  try {
    const safePayload = { ...payload };
    if (safePayload.from && typeof safePayload.from === "string") {
      safePayload.from = safePayload.from.slice(-4); // últimos 4 dígitos para privacidad
    }
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...safePayload
    }));
  } catch (err) {
    console.log("logEvent_failed", event, err?.message);
  }
}

// ================================
// TEXTOS (FÁCILES DE EDITAR)
// ================================
const MENU_PRINCIPAL_TEXT = `
👋 ¡Bienvenido a *Grupo Cotorreo*!
¿Qué te late hacer hoy? Escribí el número 👇

1️⃣ 🍽️ Comer en Plaza Cotorreo
2️⃣ 🎾 Jugar pádel en Alpadel
3️⃣ 👤 Hablar con un asesor
`;

const PLAZA_MENU_TEXT = `
🏢 *Plaza Cotorreo*
¿En qué te podemos ayudar hoy? 😊

1️⃣ 🍽️ Menú y realizar pedido
2️⃣ 🎉 Promociones
3️⃣ ⏰ Horarios
4️⃣ 📍 Ubicación
5️⃣ 📅 Reservas
6️⃣ 🎈 Paquetes para fiestas

9️⃣ Volver al menú anterior
0️⃣ Volver al menú principal
`;

const ALPADEL_MENU_TEXT = `
🎾 *Alpadel*
¿Qué te gustaría hacer hoy? 😊

1️⃣ 💰 Precios
2️⃣ ✅ Reservar cancha
3️⃣ 🎾 Clases
4️⃣ 🎉 Promociones
5️⃣ 🎈 Paquetes para fiestas

9️⃣ Volver al menú anterior
0️⃣ Volver al menú principal
`;

const ASESOR_TEXT = `
👤 ¡Estamos para ayudarte! Un asesor te atenderá en un momento.
Si prefieres, también puedes llamarnos:

📞 Llamadas: 63038030
💬 WhatsApp: https://wa.me/50683436583

9️⃣ Volver al menú anterior
0️⃣ Volver al menú principal
`;

const HANDOFF_MESSAGE = `👋 ¡Listo!

Ya estás en manos de nuestro equipo 💚

Te contestan por acá en breve. Si es urgente, también podés llamar al 6303 8030.`;

const HANDOFF_DURATION_MS = 15 * 60 * 1000;

function getUserProfile(from) {
  if (!userProfile[from]) {
    userProfile[from] = { name: null };
  }
  return userProfile[from];
}

function isGlobalCommand(text) {
  return ["menu", "menú", "inicio", "hola", "0", "9", "asesor", "carrito", "reservas"].includes(text);
}

function getNamePrompt() {
  return "👋 ¡Hola! Bienvenido a Grupo Cotorreo\n\nPara darte una atención más rápida y personalizada,\n¿me compartís tu nombre, por favor? 😊";
}

function getUserHandoff(from) {
  if (!userHandoff[from]) {
    userHandoff[from] = {
      active: false,
      until: 0,
      notified: false
    };
  }
  return userHandoff[from];
}

function clearUserHandoff(from) {
  const handoff = getUserHandoff(from);
  handoff.active = false;
  handoff.until = 0;
  handoff.notified = false;
  saveHandoffState();
}

function isHandoffActive(from) {
  const handoff = getUserHandoff(from);
  if (!handoff.active) return false;
  if (handoff.until && Date.now() > handoff.until) {
    clearUserHandoff(from);
    return false;
  }
  return true;
}

function routeMessage(messageText, hasHumanHandoff, hasActiveFlow, matchedFlowIntent) {
  if (hasHumanHandoff) return { route: "human" };
  if (hasActiveFlow && matchedFlowIntent) return { route: "flow" };
  if (matchedFlowIntent) return { route: "flow" };
  return { route: "candidate_for_ai" };
}

function hasActiveUserFlow(state, profile) {
  if (!profile?.name) return true;
  if (state === "MENU_PRINCIPAL") return false;
  // Estados donde el bot espera respuesta específica del usuario.
  // Incluye estados de navegación de menú: cualquier número escrito
  // ahí debe ir al handler de estado, nunca al fallback de IA.
  const strictStates = [
    "ASK_NAME",
    "RESERVA_NOMBRE",
    "RESERVA_TIPO",
    "RESERVA_DURACION",
    "RESERVA_PERSONAS",
    "RESERVA_FECHA",
    "RESERVA_HORA",
    "RESERVA_TELEFONO",
    "RESERVA_CONFIRMAR",
    "ORDER_DELIVERY",
    "ORDER_PAYMENT",
    "CHECKOUT",
    "VIEW_CART",
    "CART_ACTION",
    "PLAZA_MENU",
    "PLAZA_MENU_CATEGORIES",
    "PLAZA_PROMOCIONES",
    "PLAZA_HORARIOS",
    "PLAZA_UBICACION",
    "PLAZA_PAQUETES",
    "ALPADEL_MENU",
    "ASESOR",
    "VIEW_RESERVATIONS"
  ];
  if (state && typeof state === "string" && state.startsWith("CAT_")) return true;
  return strictStates.includes(state);
}

function matchesCurrentFlowIntent(text) {
  const normalizedText = (text || "")
    .trim()
    .toLowerCase()
    .replace(/[¡!¿?]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (!normalizedText) return false;

  // Acepta cualquier número de 1 o 2 dígitos. Los handlers de estado deciden
  // si ese número aplica a su menú actual. Si no aplica, repiten el menú,
  // pero ya nunca cae al fallback de IA por escribir "10" u "11".
  return /^(\d{1,2}|menu|menú|pedido|orden|reservar|reserva|asesor|plaza|alpadel|carrito|reservas|hola|inicio)$/.test(normalizedText);
}

function containsBlockedAIIntent(text) {
  const normalizedText = (text || "")
    .trim()
    .toLowerCase()
    .replace(/[¡!¿?]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return [
   "reservar",
    "reserva",
    "clases",
    "entrenador",
    "profesor",
    "hablar con una persona",
    "quiero hablar con una persona",
    "hablar con alguien",
    "quiero hablar con alguien",
    "quiero hablar con un asesor"
  ].some((intent) => normalizedText.includes(intent));
}

// Horarios Plaza Cotorreo (zona Costa Rica)
//   Lun-Jue: 11:00 - 22:00
//   Vie-Sab: 11:00 - 24:00 (medianoche)
//   Dom:     09:00 - 22:00
function getPlazaSchedule() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Costa_Rica" }));
  const dow = now.getDay(); // 0 = domingo
  const hour = now.getHours() + now.getMinutes() / 60;
  let openHour, closeHour;
  if (dow === 0)            { openHour = 9;  closeHour = 22; } // domingo
  else if (dow >= 1 && dow <= 4) { openHour = 11; closeHour = 22; } // lunes a jueves
  else                       { openHour = 11; closeHour = 24; } // viernes y sábado
  const isOpen = hour >= openHour && hour < closeHour;
  return { isOpen, openHour, closeHour, dow };
}

function getClosedNotice() {
  const { isOpen, openHour } = getPlazaSchedule();
  if (isOpen) return "";
  const openLabel = `${Math.floor(openHour)}:00 ${openHour < 12 ? "am" : "pm"}`;
  return `⏰ *Plaza Cotorreo está cerrado ahora.* Abrimos hoy a las ${openLabel}.\nMientras tanto, te dejo el menú para que vayás viendo 👇\n\n`;
}

// F1.3 — Promo del día. Calculada en código (no en prompt LLM) para evitar
// alucinaciones. Fuente: system prompt del aiFallbackService + sección
// "PROMOCIONES" del README operativo.
function getPromoDelDia() {
  const dow = getPlazaSchedule().dow; // 0=domingo … 6=sábado
  // Copy de marketing: voseo CR, beneficio claro, gancho emocional.
  // Se ven arriba del menú principal cuando Plaza está abierta.
  const promos = {
    0: "🌅 *Domingo de familia*: cancha de pádel ₡6.000 todo el día en Alpadel + *Desayuno + Pádel* a ₡20.000 (1h cancha, 4 desayunos y palas, 8am–12md). Mañana o tarde, vení sin apuro 💛",
    1: "🌮 *Lunes al pastor*: pedís 4 tacos y *te llevás 8*. Trompo, piña y limón — la cura para empezar la semana 💪",
    2: "🍣 *Martes sushiero*: rollo + rollo gratis. Pedís 1 y *te llevás 2* — perfecto para vos y un cómplice 🤝",
    3: "🥩 *Miércoles de birria*: 2x1 en quesabirrias. Pedís 5, *te llevás 10*, con consomé bien caliente para hundir 🔥",
    4: "🍔 *Jueves burger*: 3x2 en hamburguesas. Pedís 2, *llegan 3 a la mesa*. La excusa perfecta para llamar al trío 👊",
    5: "🎾 *Viernes Glow Pádel*: cancha en luz negra ₡5.000 p/p (1.5h + bebida + pala, reservá ya — cupo limitado) 🌟  ·  🍺 *Baldazo Nacional*: 6 cervezas a ₡6.000 para arrancar el finde frío ❄️",
    6: "🌃 *Sábado sin reglas*: cocina abierta hasta medianoche. Vení a comer, quedate a tomar — menú completo, birra fría, y el ambiente que sabés 🍻"
  };
  return promos[dow] || "";
}

function getPromoNotice() {
  // Solo mostrar si Plaza está abierto. Si está cerrado, el aviso de cerrado
  // ya tiene la atención — no queremos saturar al cliente con info simultánea.
  if (!getPlazaSchedule().isOpen) return "";
  const promo = getPromoDelDia();
  if (!promo) return "";
  return `🎉 *Hoy:* ${promo}\n\n`;
}

function getMenuPrincipalText(name) {
  const notice = getClosedNotice() || getPromoNotice();
  if (!name) return notice + MENU_PRINCIPAL_TEXT;
  return notice + MENU_PRINCIPAL_TEXT.replace(
    "¡Bienvenido a *Grupo Cotorreo*!",
    `¡Hola ${name}! Bienvenido/a a *Grupo Cotorreo*`
  );
}

function getUserReservation(from) {
  return userReservations[from] || null;
}

function getReservationDraft(from) {
  if (!userReservationDraft[from]) {
    userReservationDraft[from] = {
      location: null,
      name: null,
      kindLabel: null,
      kindExample: null,
      type: null,
      people: null,
      date: null,
      time: null,
      phone: null,
      origin: null
    };
  }
  return userReservationDraft[from];
}

function clearReservationDraft(from) {
  delete userReservationDraft[from];
}

function startReservation(from, location, kindLabel, kindExample, origin) {
  const draft = getReservationDraft(from);
  draft.location = location;
  draft.name = null;
  draft.kindLabel = kindLabel;
  draft.kindExample = kindExample;
  draft.type = null;
  draft.people = null;
  draft.date = null;
  draft.time = null;
  draft.phone = null;
  draft.origin = origin;
  return draft;
}

function getReservationSummary(reservation) {
  let reply = `Lugar elegido: ${reservation.location}\n`;
  if (reservation.id) reply += `Número de reserva: ${reservation.id}\n`;
  reply += `Nombre: ${reservation.name || ""}\n`;
  reply += `${reservation.kindLabel}: ${reservation.type}\n`;
  if (reservation.duration) reply += `Duración: ${reservation.duration}\n`;
  reply += `Personas: ${reservation.people}\n`;
  reply += `Fecha: ${reservation.date}\n`;
  reply += `Hora: ${reservation.time}\n`;
  reply += `Teléfono: ${reservation.phone}`;
  return reply;
}

function getReservationDetailsText(reservation) {
  if (!reservation) {
    return "Aún no tienes reservas registradas. ¿Te ayudamos a reservar? ✨\n\n9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal";
  }
  let reply = "Resumen de tu última reserva 📌\n\n";
  reply += `${getReservationSummary(reservation)}\n\n`;
  reply += "9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal";
  return reply;
}

function getReservationExitText(from, profile) {
  const draft = getReservationDraft(from);
  const origin = draft.origin;
  clearReservationDraft(from);

  if (origin === "PLAZA_MENU") {
    userState[from] = "PLAZA_MENU";
    return PLAZA_MENU_TEXT;
  }
  if (origin === "ALPADEL_MENU") {
    userState[from] = "ALPADEL_MENU";
    return ALPADEL_MENU_TEXT;
  }

  userState[from] = "MENU_PRINCIPAL";
  return getMenuPrincipalText(profile.name);
}

// ================================
// MENU Y CARRITO
// ================================
const PLAZA_MENU_LINK = "https://linktr.ee/elcotorreocr";
const PLAYTOMIC_LINK = "https://playtomic.com/clubs/alpadel-club";
const SINPE_NUMBER = "63038030";

// App de reservas (cotorreo-app en Render). Soporta deep-link via query params:
//   ?tipo=alpadel|cotorreo  → preselecciona el form
//   ?tel=506XXXXXXXX        → pre-llena teléfono y avanza directo al form
// El bot construye el link con ambos para que el cliente entre directo al lugar correcto.
const RESERVAS_APP_URL = "https://cotorreo-app.onrender.com/cliente.html";

function buildReservasLink(tipo, fromPhone) {
  const params = new URLSearchParams();
  if (tipo) params.set("tipo", tipo);
  const tel = (fromPhone || "").replace(/[^0-9]/g, "");
  if (tel.length >= 8) params.set("tel", tel);
  const qs = params.toString();
  return qs ? `${RESERVAS_APP_URL}?${qs}` : RESERVAS_APP_URL;
}

// (Categorías: las dejé idénticas a lo que pegaste)
const PLAZA_MENU_CATEGORIES = [
  { key: "CAT_ENTRADAS", label: "Entradas", number: 1, items: [
    { name: "Guacamole", price: 5900 },
    { name: "Caldosa", price: 1700 },
    { name: "Ceviche de chicharrón", price: 4200 },
    { name: "Patacones", price: 3700 },
    { name: "Papa pollo crujiente", price: 3100 },
    { name: "Papa birria", price: 3100 },
    { name: "Surtida mar y tierra", price: 12900 },
    { name: "Surtida botanera", price: 11500 },
    { name: "Molcajete", price: 12500 }
  ]},
  { key: "CAT_BURGERS_PARRILLADAS", label: "Burgers y Parrilladas", number: 2, items: [
    { name: "Supreme Matt Burger", price: 5900 },
    { name: "BBQ Burger", price: 5900 },
    { name: "Chicken Burger", price: 4600 },
    { name: "Birria Burger", price: 5600 },
    { name: "Parrillada Arrachera", price: 13500 },
    { name: "Parrillada Lomo de res", price: 6200 }
  ]},
  { key: "CAT_ANTOJITOS", label: "Antojitos Mexicanos", number: 3, items: [
    { name: "Esquite", price: 3100 },
    { name: "Nachos Pollo", price: 3900 },
    { name: "Nachos Birria", price: 4500 },
    { name: "Nachos Pastor", price: 4500 },
    { name: "Nachos Mixto", price: 4500 },
    { name: "Burrito Pollo Crispy", price: 4200 },
    { name: "Burrito Pollo Teriyaki", price: 4200 },
    { name: "Burrito Birria", price: 4700 },
    { name: "Burrito Pastor", price: 4500 },
    { name: "Quesadilla Pollo", price: 2900 },
    { name: "Quesadilla Birria", price: 4300 },
    { name: "Quesadilla Pastor", price: 4300 },
    { name: "Chilaquiles enchipotlados Pollo", price: 5000 },
    { name: "Chilaquiles enchipotlados Pastor", price: 5500 },
    { name: "Chifrimex", price: 4500 }
  ]},
  { key: "CAT_TACOS", label: "Tacos Mexicanos", number: 4, items: [
    { name: "Pastor", price: 4000 },
    { name: "Vegetarianos", price: 4000 },
    { name: "Lomito", price: 4900 },
    { name: "Pollo", price: 4000 },
    { name: "Tacos ticos fusión", price: 4700 },
    { name: "Camarón", price: 5700 },
    { name: "Quesabirrias", price: 5000 }
  ]},
  { key: "CAT_CEVICHES", label: "Ceviches y Mariscos", number: 5, items: [
    { name: "Ceviche tico", price: 2900 },
    { name: "Ceviche peruano", price: 3900 },
    { name: "Ceviche de camarón Cotorreo", price: 5500 },
    { name: "Filete de pescado", price: 4600 },
    { name: "Camarones empanizados", price: 4900 },
    { name: "Salmón a la plancha", price: 9500 },
    { name: "Fajitas mar y tierra", price: 6900 }
  ]},
  { key: "CAT_SABORES", label: "Sabores a lo tico", number: 6, items: [
    { name: "Cordon bleu", price: 4500 },
    { name: "Chicharrones", price: 4500 },
    { name: "Chifrijo", price: 4500 },
    { name: "Fajitas lomo jalapeño", price: 4700 }
  ]},
  { key: "CAT_SOPAS", label: "Sopas y Caldos", number: 7, items: [
    { name: "Ramen tonkotsu", price: 5500 },
    { name: "Ramen birria", price: 5300 },
    { name: "Sopa Azteca Pollo", price: 4300 },
    { name: "Sopa Azteca Birria", price: 5200 },
    { name: "Consomé de pollo", price: 4300 }
  ]},
  { key: "CAT_ARROCES", label: "Arroces y Pastas", number: 8, items: [
    { name: "Arroz con camarones", price: 5500 },
    { name: "Arroz con pollo", price: 4900 },
    { name: "Arroz cantonés", price: 4900 },
    { name: "Pasta enchipotlada Lomo", price: 5900 },
    { name: "Pasta enchipotlada Pollo", price: 5200 },
    { name: "Pasta enchipotlada Camarón", price: 6500 },
    { name: "Pasta morrón Lomo", price: 5900 },
    { name: "Pasta morrón Pollo", price: 5100 },
    { name: "Pasta morrón Camarón", price: 6500 },
    { name: "Pasta a la bolognesa", price: 3500 }
  ]},
  { key: "CAT_SUSHI_CRUDO", label: "Sushi Crudo", number: 10, items: [
    { name: "Caterpillar Roll (10 pzas)", price: 5100 },
    { name: "Salmon Lovers Roll (10 pzas)", price: 5900 }
  ]},
  { key: "CAT_MENU_EJECUTIVO", label: "Menú Ejecutivo", number: 11, items: [
    { name: "Ejecutivo KUMO", price: 3800 },
    { name: "Ejecutivo FISHERS", price: 3800 },
    { name: "Ejecutivo COTORREO", price: 3800 },
    { name: "Ejecutivo PITS", price: 3800 }
  ]},
  { key: "CAT_SUSHI_COCIDO", label: "Sushi Cocido", number: 12, items: [
    { name: "California Roll (10 pzas)", price: 3000 },
    { name: "Camarón Roll (10 pzas)", price: 4000 },
    { name: "Pollo Teriyaki Roll (10 pzas)", price: 5500 },
    { name: "Tico Roll (10 pzas)", price: 3500 },
    { name: "Tico Especial Roll (10 pzas)", price: 4000 },
    { name: "Rib Eye Teriyaki Roll (10 pzas)", price: 4900 },
    { name: "Crazy Roll (10 pzas)", price: 5900 }
  ]},
  { key: "CAT_ASIAN", label: "Asian Streetfood", number: 13, items: [
    { name: "Duo coreano", price: 5000 },
    { name: "Teppanyaki Pollo", price: 4750 },
    { name: "Teppanyaki Res", price: 5500 },
    { name: "Teriyaki Pollo", price: 4800 },
    { name: "Teriyaki Res", price: 5500 },
    { name: "Corn Dogs", price: 2500 }
  ]},
  { key: "CAT_PIZZAS", label: "Pizzas", number: 14, items: [
    { name: "Jamón y queso Familiar", price: 7900 },
    { name: "Jamón y queso Personal", price: 4500 },
    { name: "Pepperoni Familiar", price: 9500 },
    { name: "Pepperoni Personal", price: 5300 },
    { name: "Birria Familiar", price: 9500 },
    { name: "Birria Personal", price: 5300 },
    { name: "Pastor Familiar", price: 7500 },
    { name: "Pastor Personal", price: 5300 },
    { name: "Margarita Familiar", price: 6500 },
    { name: "Margarita Personal", price: 4500 },
    { name: "Hawaiana Familiar", price: 8500 },
    { name: "Hawaiana Personal", price: 5300 },
    { name: "Suprema Familiar", price: 10500 },
    { name: "Suprema Personal", price: 6500 },
    { name: "BBQ pollo Familiar", price: 8500 },
    { name: "BBQ pollo Personal", price: 4500 },
    { name: "BBQ chicharrón Familiar", price: 9000 },
    { name: "BBQ chicharrón Personal", price: 4900 },
    { name: "Nacho de carne Familiar", price: 9000 },
    { name: "Nacho de carne Personal", price: 4900 }
  ]},
  { key: "CAT_ENSALADAS", label: "Ensaladas, Pitas y Poke", number: 15, items: [
    { name: "Cotorreo verde bowl Pollo", price: 4900 },
    { name: "Cotorreo verde bowl Res", price: 5200 },
    { name: "Poke bowl Salmón shoyu", price: 5700 },
    { name: "Poke bowl Pollo teriyaki", price: 5100 },
    { name: "Pita Pollo", price: 4300 },
    { name: "Pita Pastor", price: 4600 },
    { name: "Pita Camarón", price: 4900 },
    { name: "Brusheta Pollo", price: 4600 },
    { name: "Brusheta Res", price: 5200 },
    { name: "Brusheta Aguacate fresco", price: 3300 }
  ]},
  { key: "CAT_INFANTIL", label: "Menú Infantil", number: 16, items: [
    { name: "Dedos de pollo", price: 3900 },
    { name: "Dedos de pescado", price: 3900 },
    { name: "Salchipapas", price: 2900 },
    { name: "Pasta a la mantequilla", price: 2900 },
    { name: "Hamburguesa con queso", price: 4300 },
    { name: "Flautas de jamón con queso", price: 2900 }
  ]}
];

function getUserCart(from) {
  if (!userCart[from]) userCart[from] = [];
  return userCart[from];
}

function getUserMeta(from) {
  if (!userMeta[from]) {
    userMeta[from] = {
      lastCategory: null,
      orderDelivery: null,
      orderPayment: null,
      orderFlowOrigin: null
    };
  }
  return userMeta[from];
}

function formatCRC(amount) {
  return "₡" + amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function getNumberEmoji(value) {
  const special = {
    10: "🔟",
    11: "1️⃣1️⃣",
    12: "1️⃣2️⃣",
    13: "1️⃣3️⃣",
    14: "1️⃣4️⃣",
    15: "1️⃣5️⃣",
    16: "1️⃣6️⃣",
    17: "1️⃣7️⃣",
    18: "1️⃣8️⃣",
    19: "1️⃣9️⃣",
    20: "2️⃣0️⃣"
  };
  if (special[value]) return special[value];

  const digits = value.toString().split("");
  const map = {
    "0": "0️⃣","1": "1️⃣","2": "2️⃣","3": "3️⃣","4": "4️⃣",
    "5": "5️⃣","6": "6️⃣","7": "7️⃣","8": "8️⃣","9": "9️⃣"
  };
  return digits.map((d) => map[d] || d).join("");
}

function getItemDisplayNumber(index) {
  const base = index + 1;
  return base >= 9 ? base + 1 : base;
}

function getItemIndexFromChoice(choice) {
  if (choice >= 10) return choice - 2;
  return choice - 1;
}

function getPlazaCategoriesText() {
  let reply = "¡Con gusto! 👇 Aquí tienes nuestro menú completo para que elijas con calma:\n";
  reply += PLAZA_MENU_LINK + "\n\n";
  reply += "¿Se te antoja algo rico hoy? 😋 Tenemos opciones para todos los gustos.\n";
  reply += "Elige tu categoría favorita y arma tu pedido en segundos:\n\n";

  PLAZA_MENU_CATEGORIES.forEach((category) => {
    const emojiNumber = getNumberEmoji(category.number);
    const emojiByLabel = {
      Entradas: "🥑",
      "Burgers y Parrilladas": "🍔",
      "Antojitos Mexicanos": "🌮",
      "Tacos Mexicanos": "🌮",
      "Ceviches y Mariscos": "🐟",
      "Sabores a lo tico": "🇨🇷",
      "Sopas y Caldos": "🍲",
      "Arroces y Pastas": "🍝",
      "Sushi Crudo": "🍣",
      "Menú Ejecutivo": "🍽️",
      "Sushi Cocido": "🍣",
      "Asian Streetfood": "🥢",
      Pizzas: "🍕",
      "Ensaladas, Pitas y Poke": "🥗",
      "Menú Infantil": "👧🧒"
    };
    const emoji = emojiByLabel[category.label] || "🍽️";
    reply += `${emojiNumber} ${emoji} ${category.label}\n`;
  });

  reply += "\n9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal";
  return reply;
}

function getCategoryByKey(key) {
  return PLAZA_MENU_CATEGORIES.find((c) => c.key === key);
}

function getCategoryText(categoryKey, hasCartItems) {
  const category = getCategoryByKey(categoryKey);
  if (!category) return getPlazaCategoriesText();

  let reply = `🍽️ ${category.label}\nElige tu favorito y armamos tu pedido en segundos:\n\n`;
  category.items.forEach((item, index) => {
    const emojiNumber = getNumberEmoji(getItemDisplayNumber(index));
    reply += `${emojiNumber} ${item.name} - ${formatCRC(item.price)}\n`;
  });

  reply += "\n👉 Para agregar al carrito, escribe el número del platillo.\n";
  if (hasCartItems) reply += "🛒 Escribe 'carrito' para revisar tu carrito.\n";
  reply += "9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal";
  return reply;
}

function addItemToCart(cart, item) {
  const existing = cart.find((e) => e.name === item.name);
  if (existing) {
    existing.quantity += 1;
    return existing;
  }
  const entry = { name: item.name, price: item.price, quantity: 1 };
  cart.push(entry);
  return entry;
}

function getCartText(cart) {
  if (!cart.length) {
    return "Tu carrito está vacío por ahora. ¿Quieres ver el menú? 😋\n\n9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal";
  }

  let reply = "🛒 Tu carrito, listo para ti:\n\n";
  let total = 0;
  cart.forEach((item, index) => {
    const subtotal = item.price * item.quantity;
    total += subtotal;
    reply += `${index + 1}. ${item.name} x${item.quantity} - ${formatCRC(subtotal)}\n`;
  });

  reply += `\nTotal: ${formatCRC(total)}\n`;
  reply += "⚠️ El costo mencionado no incluye Express y empaque.\n\n";
  reply += "1 ✅ Confirmar y pagar\n";
  reply += "2 🧹 Vaciar carrito\n";
  reply += "9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal";
  return reply;
}

function getCheckoutText(from, cart) {
  if (!cart.length) return getCartText(cart);

  let total = 0;
  const summaryLines = [];
  cart.forEach((item) => {
    const subtotal = item.price * item.quantity;
    total += subtotal;
    summaryLines.push(`✅ ${item.name} x${item.quantity} - ${formatCRC(subtotal)}`);
  });

  const meta = getUserMeta(from);
  const delivery = meta?.orderDelivery ? `\n🚚 Entrega: ${meta.orderDelivery}` : "";
  const payment  = meta?.orderPayment  ? `\n💰 Pago: ${meta.orderPayment}` : "";

  let reply = "¿Listo para confirmar tu pedido? 🙌\n\n";
  reply += "🧾 Detalle de tu pedido:\n";
  reply += summaryLines.join("\n") + "\n\n";
  reply += `💳 Total: ${formatCRC(total)}${delivery}${payment}\n`;
  reply += "⚠️ El costo mencionado no incluye Express y empaque.\n\n";
  reply += "1 ✅ Confirmar pedido\n";
  reply += "2 🛒 Volver al carrito\n";
  reply += "9 Volver al menú anterior\n";
  reply += "0 Volver al menú principal";
  return reply;
}

// ================================
// ENVIO MENSAJES WATI
// ================================
async function sendWatiMessage(to, message) {
  const token = process.env.WATI_TOKEN;          // SOLO el token (sin "Bearer")
  const baseEndpoint = process.env.WATI_ENDPOINT; // Ej: https://live-mt-server.wati.io
  const tenantId = "1085608";

  // Validaciones duras
  if (!token) {
    console.log("⚠️ WATI_TOKEN no configurado. No se enviará mensaje.");
    return;
  }
  if (!baseEndpoint) {
    console.log("⚠️ WATI_ENDPOINT no configurado. No se enviará mensaje.");
    return;
  }

  // Normalizar número: deja solo dígitos (ej: 50663038030)
  const whatsappNumber = String(to).replace(/\D/g, "");

  // Mensaje seguro (evita undefined / vacío)
  const safeMessage = (message === undefined || message === null) ? "" : String(message);
  const trimmed = safeMessage.trim();
  const finalMessage = trimmed.length ? trimmed : "👋 Hola! ¿En qué te puedo ayudar?";

  // ✅ Endpoint correcto: incluye tenantId y whatsappNumber
  const endpoint = `${baseEndpoint}/${tenantId}/api/v1/sendSessionMessage/${whatsappNumber}`;

const payload = new URLSearchParams({
    messageText: finalMessage,
    channelPhoneNumber: "50683436583",
  });


  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });

    const text = await response.text();

    console.log("📨 WATI status:", response.status);
    console.log("📨 WATI response:", text);
  } catch (err) {
    console.log("❌ Error enviando a WATI:", err?.message || err);
  }
}


// ================================
// NORMALIZACIÓN PAYLOAD WATI (OBLIGATORIO)
// ================================
function normalizeWatiPayload(body) {
  const b = body || {};

  // eventType: múltiples variantes posibles
  const eventType =
    b.eventType ||
    b.event_type ||
    b.type ||
    b.event ||
    (b.event && b.event.type) ||
    null;

  // from / waId: múltiples variantes posibles
  const from =
    b.waId ||
    b.wa_id ||
    b.whatsappNumber ||
    b.from ||
    b.sender ||
    b.senderId ||
    b.contact?.waId ||
    b.contact?.wa_id ||
    b.contacts?.[0]?.wa_id ||
    b.contacts?.[0]?.waId ||
    b.messages?.[0]?.from ||
    null;

  // text: múltiples variantes posibles
  const rawText =
    (typeof b.text === "string" ? b.text : null) ||
    b.messageText ||
    b.message?.text ||
    b.message?.body ||
    b.messages?.[0]?.text?.body ||
    b.messages?.[0]?.text ||
    b.messages?.[0]?.body ||
    "";

  // senderName: nombre del contacto desde WhatsApp.
  // Distintos shapes según versión del webhook de WATI / WhatsApp Cloud API.
  const senderName =
    b.senderName ||
    b.sender_name ||
    b.waName ||
    b.wa_name ||
    b.name ||
    b.contact?.name ||
    b.contact?.profile?.name ||
    b.contacts?.[0]?.profile?.name ||
    b.contacts?.[0]?.name ||
    null;

  return {
    eventType: typeof eventType === "string" ? eventType : null,
    from: from ? String(from).trim() : null,
    rawText: (rawText || "").toString(),
    senderName: senderName ? String(senderName).trim() : null
  };
}

// ================================
// WEBHOOK WHATSAPP (WATI)
// ================================
app.post("/whatsapp", async (req, res) => {
  // Regla: WATI debe recibir 200 siempre.
  try {
    console.log("📥 WEBHOOK RAW:", JSON.stringify(req.body, null, 2));
    const { eventType, from, rawText, senderName } = normalizeWatiPayload(req.body);
    const text = rawText.trim().toLowerCase();

    if (!from) return res.sendStatus(200);
    const messageId = req.body?.id || req.body?.messages?.[0]?.id || `${from}_${rawText}_${Math.floor(Date.now() / 5000)}`;
    const isNew = await redis.set(`dedup:${messageId}`, "1", { nx: true, ex: 300 });
    if (!isNew) return res.sendStatus(200);

    // ================================
    // INICIALIZAR ESTADO
    // ================================
    if (!userState[from]) userState[from] = "MENU_PRINCIPAL";
    getUserCart(from);
    getUserMeta(from);
    const profile = getUserProfile(from);
    const handoff = getUserHandoff(from);

    // F1.2 — log de mensaje entrante
    if (eventType === "message_received" || eventType === "message" || !eventType) {
      logEvent("message_received", {
        from,
        state: userState[from],
        text_preview: (rawText || "").slice(0, 60),
        has_name: !!profile.name
      });
    }

    // Eventos de asignación/cierre (si tu WATI los manda así)
    if (eventType === "chat_assigned") {
      handoff.active = true;
      handoff.until = 0;
      handoff.notified = true;
      return res.sendStatus(200);
    }

    if (eventType === "chat_closed" || eventType === "chat_unassigned") {
      clearUserHandoff(from);
      return res.sendStatus(200);
    }

    if (eventType === "sessionMessageSent") {
      const isHuman = req.body?.operatorEmail &&
                      !req.body.operatorEmail.includes("api-token-user");
      if (isHuman && from) {
        const handoff = getUserHandoff(from);
        handoff.active = true;
        handoff.until = Date.now() + HANDOFF_DURATION_MS;
        handoff.notified = true;
        saveHandoffState();
        console.log("👤 Handoff activado:", req.body.operatorName);
        logEvent("handoff_triggered", {
          from,
          mode: "auto_human_response",
          operator: req.body.operatorName || null,
          state_at_handoff: userState[from]
        });
      }
      return res.sendStatus(200);
    }

    // Si viene un eventType diferente a mensaje, ignorar (pero 200)
    if (eventType && eventType !== "message_received" && eventType !== "message") {
      return res.sendStatus(200);
    }

    // ================================
    // HANDOFF MANUAL (ASESOR)
    // ================================
   if (text === "tomar" || rawText.toLowerCase().includes("soy tu asesor de grupo cotorreo")) {
      const wasActive = isHandoffActive(from);
     handoff.active = true;
      handoff.until = Date.now() + HANDOFF_DURATION_MS;
      if (!wasActive) handoff.notified = false;
      saveHandoffState();
      if (!wasActive) {
        logEvent("handoff_triggered", {
          from,
          mode: "manual_tomar",
          state_at_handoff: userState[from]
        });
      }
      return res.sendStatus(200);
    }

    if (text === "/liberar" || text === "liberar") {
      clearUserHandoff(from);
      await sendWatiMessage(from, "✅ Bot reactivado.");
      return res.sendStatus(200);
    }

    // ================================
    // ONBOARDING NOMBRE
    // ================================
    if (userState[from] === "ASK_NAME") {
      if (!rawText || isGlobalCommand(text)) {
        await sendWatiMessage(from, getNamePrompt());
        return res.sendStatus(200);
      }

      const nombreCandidate = rawText.trim();
      const esPedidoOTextoLargo =
        nombreCandidate.length > 40 ||
        /\d{4,}/.test(nombreCandidate) ||
        /(entregar|alistar|promo|pedido|sushi|pizza|orden|para|quiero|pueden|podrán|podr[aá]n)/i.test(nombreCandidate);

      if (esPedidoOTextoLargo) {
        await sendWatiMessage(from, "Solo necesito tu nombre para continuar 😊\n¿Cómo te llamás?");
        return res.sendStatus(200);
      }

      profile.name = nombreCandidate;
      userState[from] = "MENU_PRINCIPAL";
      await sendWatiMessage(from, getMenuPrincipalText(profile.name));
      return res.sendStatus(200);
    }

    if (isHandoffActive(from)) {
      return res.sendStatus(200);
    }

    // F1.8 — Si no tenemos el nombre del cliente, intentar leerlo del payload
    // de WATI (lo trae como senderName / contact.profile.name según versión).
    // Solo si el campo viene vacío caemos al fallback de preguntárselo.
    if (!profile.name && senderName) {
      const candidate = senderName.replace(/\d+/g, "").trim();
      // descartar "WhatsApp User", números puros o cosas raras
      if (candidate && candidate.length >= 2 && candidate.length <= 60 &&
          !/^whatsapp\s*user$/i.test(candidate)) {
        profile.name = candidate.split(" ").slice(0, 3).join(" "); // máx 3 palabras
        logEvent("name_autopopulated", { from, source: "wati_payload" });
      }
    }

    if (!profile.name) {
      userState[from] = "ASK_NAME";
      await sendWatiMessage(from, getNamePrompt());
      return res.sendStatus(200);
    }

    // ================================
    // SHORTCUT RESERVAS — mandar link de form
    // (Reemplaza el flujo conversacional viejo de reservas que no funcionaba.
    //  Solo intercepta si NO hay flujo activo crítico — para no romper carrito,
    //  onboarding, ni mensajes en curso.)
    // ================================
    {
      const normalizedRes = (text || "")
        .trim()
        .toLowerCase()
        .replace(/[¡!¿?]/g, "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");

      const wantsAlpadel = /(\balpadel\b|\bcancha\b|\bcanchas\b|\bpadel\b|\bpaddle\b|\bjugar padel\b|\bjugar paddle\b)/.test(normalizedRes);
      const wantsCotorreo = /(\bmesa\b|\bmesas\b|\breservar mesa\b|\balmorzar\b|\bcenar\b|\bcomer en cotorreo\b|\bplaza cotorreo\b)/.test(normalizedRes);
      const wantsGeneric = /(\breservar\b|\breserva\b|\breservacion\b|\bquiero reservar\b)/.test(normalizedRes);

      if (!hasActiveUserFlow(userState[from], profile) && (wantsAlpadel || wantsCotorreo || wantsGeneric)) {
        const firstName = (profile.name || "").split(" ")[0];

        if (wantsAlpadel && !wantsCotorreo) {
          const link = buildReservasLink("alpadel", from);
          await sendWatiMessage(from,
            `🎾 ¡Dale, ${firstName}! Reservá tu cancha acá:\n\n` +
            `👉 ${link}\n\n` +
            `Ya te identificamos por tu WhatsApp — entrás directo al form. Llenalo y te confirmamos por este chat.\n\n` +
            `Si preferís que te atienda una persona, escribí *asesor*.`
          );
          userState[from] = "MENU_PRINCIPAL";
          logEvent("reservation_link_sent", { from, kind: "alpadel" });
          return res.sendStatus(200);
        }

        if (wantsCotorreo && !wantsAlpadel) {
          const link = buildReservasLink("cotorreo", from);
          await sendWatiMessage(from,
            `🍽️ ¡Dale, ${firstName}! Reservá tu mesa acá:\n\n` +
            `👉 ${link}\n\n` +
            `Ya te identificamos por tu WhatsApp — entrás directo al form. Llenalo y te confirmamos por este chat.\n\n` +
            `Si preferís que te atienda una persona, escribí *asesor*.`
          );
          userState[from] = "MENU_PRINCIPAL";
          logEvent("reservation_link_sent", { from, kind: "cotorreo" });
          return res.sendStatus(200);
        }

        // Ambiguo: solo dijo "reservar" sin contexto, o mencionó ambos.
        // Mandamos link sin tipo para que el cliente elija dentro de la app.
        const linkAmbiguo = buildReservasLink(null, from);
        await sendWatiMessage(from,
          `👋 ¡Hola ${firstName}! Reservá acá y elegís dentro entre cancha o mesa:\n\n` +
          `👉 ${linkAmbiguo}\n\n` +
          `Si preferís hablar con una persona, escribí *asesor*.`
        );
        userState[from] = "MENU_PRINCIPAL";
        logEvent("reservation_link_sent", { from, kind: "ambiguous" });
        return res.sendStatus(200);
      }
    }

    // ================================
    // F1.9 — INTERCEPTOR DE EVENTOS / FIESTAS
    // Paquetes de eventos son ticket alto (~₡100k+). Antes estaban
    // escondidos en opción 6 del submenú Plaza con link a Drive.
    // Ahora detectamos keywords y mandamos handoff directo + catálogo.
    // ================================
    {
      const normalizedEv = (text || "")
        .trim()
        .toLowerCase()
        .replace(/[¡!¿?]/g, "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");

      const wantsEvento = /(\bcumple\b|\bcumpleanos\b|\bcumpleaños\b|\bfiesta\b|\bfiestas\b|\bevento\b|\beventos\b|\bquinceanos\b|\bquinceaños\b|\baniversario\b|\bbautizo\b|\bgraduacion\b|\bgraduación\b|\bpaquete\b|\bpaquetes\b)/.test(normalizedEv);

      if (wantsEvento && !hasActiveUserFlow(userState[from], profile)) {
        const firstName = (profile.name || "").split(" ")[0];
        const handoff = getUserHandoff(from);
        handoff.active = true;
        handoff.until = Date.now() + HANDOFF_DURATION_MS;
        handoff.notified = true;
        saveHandoffState();
        userState[from] = "ASESOR";

        await sendWatiMessage(from,
          `🎈 ¡Qué bueno, ${firstName}! Para fiestas y eventos te conecta directo *Sofía* (nuestra encargada de eventos).\n\n` +
          `Mirá el catálogo de paquetes mientras:\n👉 https://drive.google.com/open?id=11xvFT0-drZTnJl_ixFE5FOy8PS_ewnwV\n\n` +
          `En breve te escribe Sofía por este chat. ✨`
        );
        logEvent("event_handoff_triggered", { from, kind: "evento_fiesta" });
        logEvent("handoff_triggered", { from, mode: "auto_event_keyword", state_at_handoff: "ASESOR" });
        return res.sendStatus(200);
      }
    }

    const hasHumanHandoff = isHandoffActive(from);
    const hasActiveFlow = hasActiveUserFlow(userState[from], profile);
    const matchedFlowIntent = matchesCurrentFlowIntent(text);
    const routeDecision = routeMessage(text, hasHumanHandoff, hasActiveFlow, matchedFlowIntent);

    if (routeDecision.route === "human") {
      return res.sendStatus(200);
    }

    if (routeDecision.route === "candidate_for_ai" && !hasActiveFlow && containsBlockedAIIntent(text)) {
      logEvent("ai_blocked_intent_routed_to_menu", { from, text_preview: (text || "").slice(0, 60) });
      await sendWatiMessage(from, "Para ayudarte con información exacta, elegí una opción del menú 👇\n\n1️⃣ 🍽️ Comer en Plaza Cotorreo\n2️⃣ 🎾 Jugar pádel en Alpadel\n3️⃣ 👤 Hablar con un asesor");
      return res.sendStatus(200);
    }

    if (routeDecision.route === "candidate_for_ai" && !hasActiveFlow) {
      try {
        console.log("AI candidate:", text);
        logEvent("ai_fallback_triggered", {
          from,
          state: userState[from],
          text_preview: (text || "").slice(0, 80)
        });

        const aiReply = await getSimpleAIReply(text);

        await sendWatiMessage(from, aiReply);

        return res.sendStatus(200);
      } catch (error) {
        console.error("AI error:", error.message);

        await sendWatiMessage(from,
          "No te entendí 🤔 ¿Era sobre comida, reservar o hablar con alguien?\n\n1️⃣ 🍽️ Comer en Plaza Cotorreo\n2️⃣ 🎾 Jugar pádel en Alpadel\n3️⃣ 👤 Hablar con un asesor"
        );

        return res.sendStatus(200);
      }
    }

    // ================================
    // COMANDOS GLOBALES
    // ================================
    if (["menu", "menú", "inicio", "hola", "0"].includes(text)) {
      userState[from] = "MENU_PRINCIPAL";
      await sendWatiMessage(from, getMenuPrincipalText(profile.name));
      return res.sendStatus(200);
    }

    if (text === "asesor") {
      userState[from] = "ASESOR";
      await sendWatiMessage(from, ASESOR_TEXT);
      return res.sendStatus(200);
    }

    if (text === "carrito") {
      userState[from] = "VIEW_CART";
      await sendWatiMessage(from, getCartText(getUserCart(from)));
      return res.sendStatus(200);
    }

    if (text === "reservas") {
      userState[from] = "VIEW_RESERVATIONS";
      await sendWatiMessage(from, getReservationDetailsText(getUserReservation(from)));
      return res.sendStatus(200);
    }

    // ================================
    // MENU PRINCIPAL
    // ================================
    if (userState[from] === "MENU_PRINCIPAL") {
      if (text === "1") {
        userState[from] = "PLAZA_MENU";
        await sendWatiMessage(from, PLAZA_MENU_TEXT);
        return res.sendStatus(200);
      }
      if (text === "2") {
        userState[from] = "ALPADEL_MENU";
        await sendWatiMessage(from, ALPADEL_MENU_TEXT);
        return res.sendStatus(200);
      }
      if (text === "3") {
        userState[from] = "ASESOR";
        await sendWatiMessage(from, ASESOR_TEXT);
        return res.sendStatus(200);
      }
      if (text === "4") {
        userState[from] = "VIEW_RESERVATIONS";
        await sendWatiMessage(from, getReservationDetailsText(getUserReservation(from)));
        return res.sendStatus(200);
      }

      await sendWatiMessage(from, getMenuPrincipalText(profile.name));
      return res.sendStatus(200);
    }

    // ================================
    // PLAZA COTORREO MENU
    // ================================
    if (userState[from] === "PLAZA_MENU") {
      if (text === "1") {
        // A — Quitar el carrito (2026-05-16). Antes el bot llevaba al
        // cliente por 18 categorías + carrito + SINPE. Decisión de Vicente:
        // reemplazar por link a Linktree (menú completo) + handoff a asesor
        // humano. El cliente ve el menú, decide, y un humano coordina el
        // pedido. Eso reduce abandono y compite mejor contra Glovo/Uber.
        const firstNamePedido = (profile.name || "").split(" ")[0];
        const handoffPedido = getUserHandoff(from);
        handoffPedido.active = true;
        handoffPedido.until = Date.now() + HANDOFF_DURATION_MS;
        handoffPedido.notified = true;
        saveHandoffState();
        userState[from] = "ASESOR";

        await sendWatiMessage(from,
          `🍽️ ¡Dale, ${firstNamePedido}! Acá tenés el menú completo:\n\n` +
          `👉 ${PLAZA_MENU_LINK}\n\n` +
          `Para hacer tu pedido, te conectamos directo con un asesor que te ayuda por este mismo chat 💛\n\n` +
          `En breve te escribe.`
        );
        logEvent("order_handoff_triggered", { from, source: "plaza_menu_option_1" });
        logEvent("handoff_triggered", { from, mode: "auto_order_request", state_at_handoff: "ASESOR" });
        return res.sendStatus(200);
      }

      if (text === "2") {
        userState[from] = "PLAZA_PROMOCIONES";
        await sendWatiMessage(from, "🎉 Promociones Plaza Cotorreo\n\n📅 Lunes a jueves (Plaza Cotorreo y Plaza Encuentro):\n• Lunes: 2x1 Tacos al Pastor (compra 4, lleva 8)\n• Martes: 2x1 Sushi (compra 1 rollo, lleva 2)\n• Miércoles: 2x1 Quesabirrias (compra 5, lleva 10)\n• Jueves: 3x2 Hamburguesas (compra 2, lleva 3)\n\n🍳 Desayuno + Pádel Domingo y L-V: ₡20.000\n(8am-12md, 1h cancha dobles + 4 desayunos + palas y bolas)\n\n🎾 Pádel + Bebidas L-V 4pm-10pm\n(dobles 4 bebidas / singles 2 bebidas)\n\n🌟 Glow Pádel Viernes: ₡5.000 p/p\n(1.5h juego + 1 bebida + pala, requiere reserva)\n\n🍺 Baldazo Nacional Viernes: ₡6.000\n(6 cervezas Nacional)\n\n🍽️ Almuerzo Ejecutivo L-V 11:30am-2pm: ₡3.800\n\n🏆 Cotorreo Rewards: ₡10.000 = 1 sello, 20 sellos = ₡15.000\n(primer registro: 1 bebida por mesa)\n\n9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal");        return res.sendStatus(200);
      }

      if (text === "3") {
        userState[from] = "PLAZA_HORARIOS"
        await sendWatiMessage(from, "⏰ Horarios Plaza Cotorreo\n\n🗓️ Lunes a jueves: 11:00 am – 10:00 pm\n🗓️ Viernes y sábado: 11:00 am – 12:00 md\n🗓️ Domingo: 9:00 am – 10:00 pm\n\n9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal");
        return res.sendStatus(200);
      }

      if (text === "4") {
        userState[from] = "PLAZA_UBICACION";
        await sendWatiMessage(from, "📍 Ubicación Plaza Cotorreo\n\nTe compartimos la ubicación exacta: https://maps.app.goo.gl/9GcpyAffmQFQU61u9\n¡Te esperamos! 🙌\n\n9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal");
        return res.sendStatus(200);
      }

      if (text === "5") {
        userState[from] = "RESERVA_NOMBRE";
        const draft = startReservation(from, "Plaza Cotorreo", "Tipo de mesa", "ej: Planta Baja, Planta Alta", "PLAZA_MENU");
        await sendWatiMessage(from, `¡Genial! Reservemos en ${draft.location}.\nNombre para la reserva:`);
        return res.sendStatus(200);
      }

      if (text === "6") {
        userState[from] = "PLAZA_PAQUETES";
        await sendWatiMessage(
          from,
          "🎈 Paquetes para fiestas Plaza Cotorreo\n\n" +
          "Mira la imagen con los paquetes aquí:\n" +
          "https://drive.google.com/open?id=11xvFT0-drZTnJl_ixFE5FOy8PS_ewnwV\n\n" +
          "Celebra con nosotros. Pregunta por opciones y precios. 🎉\n\n" +
          "9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal"
        );
        return res.sendStatus(200);
      }

      if (text === "9" || text === "0") {
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      await sendWatiMessage(from, PLAZA_MENU_TEXT);
      return res.sendStatus(200);
    }

    // ================================
    // PLAZA COTORREO CATEGORIES
    // ================================
    if (userState[from] === "PLAZA_MENU_CATEGORIES") {
      if (text === "9") {
        userState[from] = "PLAZA_MENU";
        await sendWatiMessage(from, PLAZA_MENU_TEXT);
        return res.sendStatus(200);
      }
      if (text === "0") {
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      const choice = parseInt(text, 10);
      if (!Number.isNaN(choice)) {
        const category = PLAZA_MENU_CATEGORIES.find((e) => e.number === choice);
        if (category) {
          userState[from] = category.key;
          getUserMeta(from).lastCategory = category.key;
          await sendWatiMessage(from, getCategoryText(category.key, getUserCart(from).length > 0));
          return res.sendStatus(200);
        }
      }

      await sendWatiMessage(from, getPlazaCategoriesText());
      return res.sendStatus(200);
    }

    // ================================
    // PLAZA COTORREO CATEGORY ITEMS
    // ================================
    if (userState[from].startsWith("CAT_")) {
      if (text === "carrito" && getUserCart(from).length > 0) {
        userState[from] = "VIEW_CART";
        await sendWatiMessage(from, getCartText(getUserCart(from)));
        return res.sendStatus(200);
      }

      if (text === "9") {
        userState[from] = "PLAZA_MENU_CATEGORIES";
        await sendWatiMessage(from, getPlazaCategoriesText());
        return res.sendStatus(200);
      }

      if (text === "0") {
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      const category = getCategoryByKey(userState[from]);
      if (!category) {
        userState[from] = "PLAZA_MENU_CATEGORIES";
        await sendWatiMessage(from, getPlazaCategoriesText());
        return res.sendStatus(200);
      }

      const itemNumber = parseInt(text, 10);
      const itemIndex = Number.isNaN(itemNumber) ? -1 : getItemIndexFromChoice(itemNumber);

      if (itemIndex >= 0 && itemIndex < category.items.length) {
        const cart = getUserCart(from);
        const item = category.items[itemIndex];
        addItemToCart(cart, item);
        userState[from] = "CART_ACTION";
        getUserMeta(from).lastCategory = category.key;

        await sendWatiMessage(
          from,
          "¡Listo! Agregamos a tu carrito:\n" +
          `${item.name} - ${formatCRC(item.price)}\n\n` +
          "⚠️ El costo mencionado no incluye Express y empaque.\n\n" +
          "1 Seguir viendo el menú\n" +
          "2 Ver carrito\n" +
          "3 Pagar ahora\n" +
          "9 Volver al menú anterior\n" +
          "0 Volver al menú principal"
        );
        return res.sendStatus(200);
      }

      await sendWatiMessage(from, getCategoryText(category.key, getUserCart(from).length > 0));
      return res.sendStatus(200);
    }

    // ================================
    // CARRITO - ACCION DESPUES DE AGREGAR
    // ================================
    if (userState[from] === "CART_ACTION") {
      if (text === "1") {
        userState[from] = "PLAZA_MENU_CATEGORIES";
        await sendWatiMessage(from, getPlazaCategoriesText());
        return res.sendStatus(200);
      }

      if (text === "2") {
        userState[from] = "VIEW_CART";
        await sendWatiMessage(from, getCartText(getUserCart(from)));
        return res.sendStatus(200);
      }

      if (text === "3") {
        const meta = getUserMeta(from);
        meta.orderDelivery = null;
        meta.orderPayment = null;
        meta.orderFlowOrigin = "CART_ACTION";
        userState[from] = "ORDER_DELIVERY";
        await sendWatiMessage(from, "¿Como deseas recibir tu pedido?\n1 🚚 Express\n2 🏪 Recoger en restaurante\n\n9 Volver al menú anterior\n0 Volver al menú principal");
        return res.sendStatus(200);
      }

      if (text === "9") {
        userState[from] = "PLAZA_MENU_CATEGORIES";
        await sendWatiMessage(from, getPlazaCategoriesText());
        return res.sendStatus(200);
      }

      if (text === "0") {
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      await sendWatiMessage(from, "¿Qué deseas hacer ahora?\n1 Seguir viendo el menú\n2 Ver carrito\n3 Pagar ahora\n9 Volver al menú anterior\n0 Volver al menú principal");
      return res.sendStatus(200);
    }

    // ================================
    // VER CARRITO
    // ================================
    if (userState[from] === "VIEW_CART") {
      const cart = getUserCart(from);

      if (text === "1") {
        const meta = getUserMeta(from);
        meta.orderDelivery = null;
        meta.orderPayment = null;
        meta.orderFlowOrigin = "VIEW_CART";
        userState[from] = "ORDER_DELIVERY";
        await sendWatiMessage(from, "¿Como deseas recibir tu pedido?\n1 🚚 Express\n2 🏪 Recoger en restaurante\n\n9 Volver al menú anterior\n0 Volver al menú principal");
        return res.sendStatus(200);
      }

      if (text === "2") {
        cart.length = 0;
        await sendWatiMessage(from, "Listo, tu carrito quedó en cero. ¿Te muestro el menú? 😋\n\n9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal");
        return res.sendStatus(200);
      }

      if (text === "9") {
        userState[from] = "PLAZA_MENU_CATEGORIES";
        await sendWatiMessage(from, getPlazaCategoriesText());
        return res.sendStatus(200);
      }

      if (text === "0") {
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      await sendWatiMessage(from, getCartText(cart));
      return res.sendStatus(200);
    }

    // ================================
    // ENTREGA Y PAGO
    // ================================
    if (userState[from] === "ORDER_DELIVERY") {
      if (text === "9") {
        const origin = getUserMeta(from).orderFlowOrigin;
        if (origin === "CART_ACTION") {
          userState[from] = "CART_ACTION";
          await sendWatiMessage(from, "¿Qué deseas hacer ahora?\n1 Seguir viendo el menú\n2 Ver carrito\n3 Pagar ahora\n9 Volver al menú anterior\n0 Volver al menú principal");
          return res.sendStatus(200);
        }
        userState[from] = "VIEW_CART";
        await sendWatiMessage(from, getCartText(getUserCart(from)));
        return res.sendStatus(200);
      }

      if (text === "0") {
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      if (text === "1" || text === "express") {
        getUserMeta(from).orderDelivery = "Express";
        userState[from] = "ORDER_PAYMENT";
        await sendWatiMessage(from, "¿Metodo de pago?\n1 💵 Efectivo\n2 💳 Tarjeta\n3 📲 SINPE\n\n9 Volver al menú anterior\n0 Volver al menú principal");
        return res.sendStatus(200);
      }

      if (text === "2" || text === "recoger" || text === "retiro") {
        getUserMeta(from).orderDelivery = "Recoger en restaurante";
        userState[from] = "ORDER_PAYMENT";
        await sendWatiMessage(from, "¿Metodo de pago?\n1 💵 Efectivo\n2 💳 Tarjeta\n3 📲 SINPE\n\n9 Volver al menú anterior\n0 Volver al menú principal");
        return res.sendStatus(200);
      }

      await sendWatiMessage(from, "Por favor elige una opcion:\n1 🚚 Express\n2 🏪 Recoger en restaurante\n\n9 Volver al menú anterior\n0 Volver al menú principal");
      return res.sendStatus(200);
    }

    if (userState[from] === "ORDER_PAYMENT") {
      if (text === "9") {
        userState[from] = "ORDER_DELIVERY";
        await sendWatiMessage(from, "¿Como deseas recibir tu pedido?\n1 🚚 Express\n2 🏪 Recoger en restaurante\n\n9 Volver al menú anterior\n0 Volver al menú principal");
        return res.sendStatus(200);
      }

      if (text === "0") {
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      if (text === "1" || text === "efectivo") {
        getUserMeta(from).orderPayment = "Efectivo";
        userState[from] = "CHECKOUT";
        await sendWatiMessage(from, getCheckoutText(from, getUserCart(from)));
        return res.sendStatus(200);
      }

      if (text === "2" || text === "tarjeta") {
        getUserMeta(from).orderPayment = "Tarjeta";
        userState[from] = "CHECKOUT";
        await sendWatiMessage(from, getCheckoutText(from, getUserCart(from)));
        return res.sendStatus(200);
      }

      if (text === "3" || text === "sinpe") {
        getUserMeta(from).orderPayment = "SINPE";
        userState[from] = "CHECKOUT";
        await sendWatiMessage(from, getCheckoutText(from, getUserCart(from)));
        return res.sendStatus(200);
      }

      await sendWatiMessage(from, "Por favor elige una opcion:\n1 💵 Efectivo\n2 💳 Tarjeta\n3 📲 SINPE\n\n9 Volver al menú anterior\n0 Volver al menú principal");
      return res.sendStatus(200);
    }

    // ================================
    // CHECKOUT
    // ================================
    if (userState[from] === "CHECKOUT") {
      const cart = getUserCart(from);

      if (text === "1") {
        const summaryLines = cart.map((item, index) => {
          const subtotal = item.price * item.quantity;
          return `✅ ${index + 1}. ${item.name} x${item.quantity} - ${formatCRC(subtotal)}`;
        });

        const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const meta = getUserMeta(from);
        const delivery = meta?.orderDelivery ? `\n🚚 Entrega: ${meta.orderDelivery}` : "";
        const payment  = meta?.orderPayment  ? `\n💰 Pago: ${meta.orderPayment}` : "";
        const summaryText = summaryLines.length
          ? `\n🧾 Detalle de tu pedido:\n${summaryLines.join("\n")}\n\n💳 Total: ${formatCRC(total)}${delivery}${payment}\n`
          : "";

        cart.length = 0;
        userState[from] = "MENU_PRINCIPAL";

        const who = profile.name ? `, ${profile.name}` : "";
        await sendWatiMessage(
          from,
          `¡Pedido confirmado${who}! 🙌${summaryText}\nEl costo mencionado no incluye Express y empaque.\nGracias por elegirnos. En breve te contactamos para coordinar.\n\n9 Volver al menú anterior\n0 Volver al menú principal`
        );
        return res.sendStatus(200);
      }

      if (text === "2") {
        userState[from] = "VIEW_CART";
        await sendWatiMessage(from, getCartText(cart));
        return res.sendStatus(200);
      }

      if (text === "9") {
        userState[from] = "ORDER_PAYMENT";
        await sendWatiMessage(from, "¿Metodo de pago?\n1 💵 Efectivo\n2 💳 Tarjeta\n3 📲 SINPE\n\n9 Volver al menú anterior\n0 Volver al menú principal");
        return res.sendStatus(200);
      }

      if (text === "0") {
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      await sendWatiMessage(from, getCheckoutText(from, cart));
      return res.sendStatus(200);
    }

    // ================================
    // ALPADEL RESERVA OPCION
    // ================================
    if (userState[from] === "ALPADEL_RESERVA_OPCION") {
      if (text === "1") {
        userState[from] = "RESERVA_NOMBRE";
        const draft = startReservation(from, "Alpadel", "Tipo de cancha", "ej: singles, dobles", "ALPADEL_MENU");
        await sendWatiMessage(from, `¡Perfecto! Reservemos en ${draft.location}.\nNombre para la reserva:`);
        return res.sendStatus(200);
      }

      if (text === "2") {
        await sendWatiMessage(
          from,
          `Reserva en Playtomic aquí:\n${PLAYTOMIC_LINK}\n\n` +
          "Si quieres reservar con nosotros, responde 1.\n\n" +
          "9️⃣ Volver al menú anterior\n" +
          "0️⃣ Volver al menú principal"
        );
        return res.sendStatus(200);
      }

      if (text === "9") {
        userState[from] = "ALPADEL_MENU";
        await sendWatiMessage(from, ALPADEL_MENU_TEXT);
        return res.sendStatus(200);
      }

      if (text === "0") {
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      await sendWatiMessage(from, "¿Cómo quieres reservar?\n1 ✅ Reservar con nosotros\n2 🌐 Reservar por Playtomic\n\n9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal");
      return res.sendStatus(200);
    }

    // ================================
    // RESERVA NOMBRE
    // ================================
    if (userState[from] === "RESERVA_NOMBRE") {
      if (text === "9") {
        await sendWatiMessage(from, getReservationExitText(from, profile));
        return res.sendStatus(200);
      }

      if (text === "0") {
        clearReservationDraft(from);
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      if (!rawText.trim()) {
        await sendWatiMessage(from, "Nombre para la reserva:");
        return res.sendStatus(200);
      }

      const draft = getReservationDraft(from);
      draft.name = rawText.trim();
      userState[from] = "RESERVA_TIPO";
      await sendWatiMessage(from, `¡Genial! Reservemos en ${draft.location}.\n${draft.kindLabel} (${draft.kindExample}):`);
      return res.sendStatus(200);
    }

    // ================================
    // RESERVAS GUIADAS
    // ================================
    if (userState[from] === "RESERVA_TIPO") {
      if (text === "9") {
        await sendWatiMessage(from, getReservationExitText(from, profile));
        return res.sendStatus(200);
      }

      if (text === "0") {
        clearReservationDraft(from);
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      const draft = getReservationDraft(from);
      if (!rawText.trim()) {
        await sendWatiMessage(from, `¡Genial! Reservemos en ${draft.location}.\n${draft.kindLabel} (${draft.kindExample}):`);
        return res.sendStatus(200);
      }

      draft.type = rawText.trim();
      
      if (draft.location === "Alpadel") {
        userState[from] = "RESERVA_DURACION";
        await sendWatiMessage(from, "¿Cuánto tiempo quieres la cancha? ⏱️ (ej: 1 hora, 1.5 horas, 2 horas)");
      } else {
        userState[from] = "RESERVA_PERSONAS";
        await sendWatiMessage(from, "¿Para cuántas personas es la reserva? 👥");
      }
      return res.sendStatus(200);
    }
if (userState[from] === "RESERVA_DURACION") {
      if (text === "9") {
        await sendWatiMessage(from, getReservationExitText(from, profile));
        return res.sendStatus(200);
      }

      if (text === "0") {
        clearReservationDraft(from);
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      if (!rawText.trim()) {
        await sendWatiMessage(from, "¿Cuánto tiempo quieres la cancha? ⏱️ (ej: 1 hora, 1.5 horas, 2 horas)");
        return res.sendStatus(200);
      }

      const draft = getReservationDraft(from);
      draft.duration = rawText.trim();
      userState[from] = "RESERVA_PERSONAS";
      await sendWatiMessage(from, "¿Para cuántas personas es la reserva? 👥");
      return res.sendStatus(200);
    }
    if (userState[from] === "RESERVA_PERSONAS") {
      if (text === "9") {
        await sendWatiMessage(from, getReservationExitText(from, profile));
        return res.sendStatus(200);
      }

      if (text === "0") {
        clearReservationDraft(from);
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      const count = parseInt(text, 10);
      if (Number.isNaN(count) || count < 1 || count > 20) {
        await sendWatiMessage(from, "Por favor ingresa un número válido (1-20).");
        return res.sendStatus(200);
      }

      const draft = getReservationDraft(from);
      draft.people = count;
      userState[from] = "RESERVA_FECHA";
      await sendWatiMessage(from, "¿Qué fecha prefieres? 📅 (ej: 15 de diciembre)");
      return res.sendStatus(200);
    }

    if (userState[from] === "RESERVA_FECHA") {
      if (text === "9") {
        await sendWatiMessage(from, getReservationExitText(from, profile));
        return res.sendStatus(200);
      }

      if (text === "0") {
        clearReservationDraft(from);
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      if (!rawText.trim()) {
        await sendWatiMessage(from, "¿Qué fecha prefieres? 📅 (ej: 15 de diciembre)");
        return res.sendStatus(200);
      }

      const draft = getReservationDraft(from);
      draft.date = rawText.trim();
      userState[from] = "RESERVA_HORA";
      await sendWatiMessage(from, "¿A qué hora? ⏰ (ej: 7:00 PM)");
      return res.sendStatus(200);
    }

    if (userState[from] === "RESERVA_HORA") {
      if (text === "9") {
        await sendWatiMessage(from, getReservationExitText(from, profile));
        return res.sendStatus(200);
      }

      if (text === "0") {
        clearReservationDraft(from);
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      if (!rawText.trim()) {
        await sendWatiMessage(from, "¿A qué hora? ⏰ (ej: 7:00 PM)");
        return res.sendStatus(200);
      }

      const draft = getReservationDraft(from);
      draft.time = rawText.trim();
      userState[from] = "RESERVA_TELEFONO";
      await sendWatiMessage(from, "Teléfono de contacto para confirmar: 📱");
      return res.sendStatus(200);
    }

    if (userState[from] === "RESERVA_TELEFONO") {
      if (text === "9") {
        await sendWatiMessage(from, getReservationExitText(from, profile));
        return res.sendStatus(200);
      }

      if (text === "0") {
        clearReservationDraft(from);
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      if (!rawText.trim()) {
        await sendWatiMessage(from, "Teléfono de contacto para confirmar: 📱");
        return res.sendStatus(200);
      }

      const draft = getReservationDraft(from);
      draft.phone = rawText.trim();
      userState[from] = "RESERVA_CONFIRMAR";

      const summary = getReservationSummary({ ...draft, name: draft.name });
      await sendWatiMessage(from, "Por favor confirma tu reserva: ✅\n\n" + summary + "\n\n1 Confirmar\n2 Cancelar");
      return res.sendStatus(200);
    }

    if (userState[from] === "RESERVA_CONFIRMAR") {
      if (text === "1") {
        const draft = getReservationDraft(from);
        const reservationName = draft.name;
        const reservationId = "RES" + Date.now().toString().slice(-6);

        userReservations[from] = {
          id: reservationId,
          location: draft.location,
          kindLabel: draft.kindLabel,
          type: draft.type,
          people: draft.people,
          date: draft.date,
          time: draft.time,
          phone: draft.phone,
          name: draft.name
        };

        let notificationMessage = 
          `🔔 Nueva solicitud de reserva\n\n` +
          `📍 Lugar: ${draft.location}\n` +
          `👤 Nombre: ${draft.name}\n` +
          `${draft.kindLabel}: ${draft.type}\n` +
          `👥 Personas: ${draft.people}\n` +
          `📅 Fecha: ${draft.date}\n` +
          `⏰ Hora: ${draft.time}\n` +
          `📱 Teléfono: ${draft.phone}\n` +
          `💬 Cliente WhatsApp: ${from}`;
        
        await sendWatiMessage("50663038030", notificationMessage);
        let notificationAlpadel =
          `🔔 Nueva solicitud de reserva\n\n` +
          `📍 Lugar: ${draft.location}\n` +
          `👤 Nombre: ${draft.name}\n` +
          `${draft.kindLabel}: ${draft.type}\n` +
          `👥 Personas: ${draft.people}\n` +
          `📅 Fecha: ${draft.date}\n` +
          `⏰ Hora: ${draft.time}\n` +
          `📱 Teléfono: ${draft.phone}\n` +
          `💬 Cliente WhatsApp: ${from}`;
        
        await sendWatiMessage("50663038030", notificationAlpadel);
        clearReservationDraft(from);
        userState[from] = "MENU_PRINCIPAL";

        const who = reservationName ? `, ${reservationName}` : "";
        await sendWatiMessage(
          from,
`✅ ¡Gracias${who}! Recibimos tu solicitud de reserva.\nUn asesor te contactará pronto para confirmar disponibilidad.\nNúmero de solicitud: ${reservationId}\n\n9 Volver al menú anterior\n0 Volver al menú principal`        );
        return res.sendStatus(200);
      }

      if (text === "2" || text === "9") {
        const exitText = getReservationExitText(from, profile);
        await sendWatiMessage(from, "Reserva cancelada. Si deseas, podemos agendar otra. 🙌\n\n" + exitText);
        return res.sendStatus(200);
      }

      if (text === "0") {
        clearReservationDraft(from);
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      const draft = getReservationDraft(from);
      const summary = getReservationSummary({ ...draft, name: draft.name });
      await sendWatiMessage(from, "Por favor confirma tu reserva: ✅\n\n" + summary + "\n\n1 Confirmar\n2 Cancelar");
      return res.sendStatus(200);
    }

    // ================================
    // CONSULTA DE RESERVAS
    // ================================
    if (userState[from] === "VIEW_RESERVATIONS") {
      if (text === "9" || text === "0") {
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      await sendWatiMessage(from, getReservationDetailsText(getUserReservation(from)));
      return res.sendStatus(200);
    }

    // ================================
    // SUBMENÚS PLAZA
    // ================================
    if (userState[from].startsWith("PLAZA_") && text === "9") {
      userState[from] = "PLAZA_MENU";
      await sendWatiMessage(from, PLAZA_MENU_TEXT);
      return res.sendStatus(200);
    }

    // ================================
    // ALPADEL MENU
    // ================================
    if (userState[from] === "ALPADEL_MENU") {
      if (text === "1") {
        userState[from] = "ALPADEL_PRECIOS";
        await sendWatiMessage(from, `💰 Precios Alpadel

🕖 7am – 3pm
- Dobles: ₡6.000
- Singles: ₡4.000

🕓 4pm – 10pm
- Dobles: ₡12.000
- Singles: ₡6.000

☀️ Domingos: ₡6.000 todo el día

⏰ Horario de canchas:
- Lunes a domingo: 7:00 am – 10:00 pm

📌 Para reservar, vuelve y elige "Reservar".

9️⃣ Volver al menú anterior
0️⃣ Volver al menú principal`);
        return res.sendStatus(200);
      }

      if (text === "2") {
        userState[from] = "ALPADEL_RESERVA_OPCION";
        await sendWatiMessage(from, "¿Cómo quieres reservar? 🎾\n\n" +
          "1 ✅ Reservar con nosotros\n" +
          "2 🌐 Reservar por Playtomic\n\n" +
          "9️⃣ Volver al menú anterior\n" +
          "0️⃣ Volver al menú principal");
        return res.sendStatus(200);
      }

      if (text === "3") {
        userState[from] = "ALPADEL_CLASES";
        await sendWatiMessage(from, "🎾 Clases de pádel con Fran Sanchez\n\n" +
          "Lleva tu juego al siguiente nivel con nuestro único entrenador: Fran Sanchez. 💪\n" +
          "Escríbele directo y agenda tu clase:\n\n" +
          "📲 WhatsApp: https://wa.me/50683436583\n" +
          "📞 Teléfono: 63038030\n\n" +
          "9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal");
        return res.sendStatus(200);
      }

      if (text === "4") {
        userState[from] = "ALPADEL_PROMOCIONES";
        await sendWatiMessage(from, "🎾 Promociones en Alpadel\n\n" +
          "🎂 Cumpleañero del mes\n" +
          "• El cumpleañero juega GRATIS durante su mes\n" +
          "• Presenta identificación\n\n" +
          "🏢 Empresas y colegios\n" +
          "• 50% de descuento\n" +
          "• Aplica para grupos de 4\n\n" +
          "🎫 Miembros ASTEC\n" +
          "• 20% de descuento\n" +
          "• Membresía activa\n\n" +
          "🎁 Padelband gratis\n" +
          "• SIN costo (sujeto a disponibilidad)\n\n" +
          "👨‍👩‍👧‍👦 Domingo familiar o de amigos\n" +
          "• ₡6,000 todo el día\n" +
          "• Sin importar la hora\n\n" +
          "9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal");
        return res.sendStatus(200);
      }

      if (text === "5") {
        userState[from] = "ALPADEL_PAQUETES";
        await sendWatiMessage(from, "🎈 Paquetes para fiestas Alpadel\n\n" +
          "Mira la imagen con los paquetes aquí:\n" +
          "https://drive.google.com/open?id=11xvFT0-drZTnJl_ixFE5FOy8PS_ewnwV\n\n" +
          "Arma tu evento con cancha incluida. Consúltanos. 🎉\n\n" +
          "9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal");
        return res.sendStatus(200);
      }

      if (text === "9" || text === "0") {
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      await sendWatiMessage(from, ALPADEL_MENU_TEXT);
      return res.sendStatus(200);
    }

    // ================================
    // SUBMENÚS ALPADEL
    // ================================
    if (userState[from].startsWith("ALPADEL_") && text === "9") {
      userState[from] = "ALPADEL_MENU";
      await sendWatiMessage(from, ALPADEL_MENU_TEXT);
      return res.sendStatus(200);
    }

    // ================================
    // ASESOR
    // ================================
    if (userState[from] === "ASESOR") {
      if (text === "9" || text === "0") {
        userState[from] = "MENU_PRINCIPAL";
        await sendWatiMessage(from, getMenuPrincipalText(profile.name));
        return res.sendStatus(200);
      }

      return res.sendStatus(200);
    }
    // ================================
    // FALLBACK ABSOLUTO
    // ================================
    userState[from] = "MENU_PRINCIPAL";
    let messageText = getMenuPrincipalText(profile.name);

    if (!messageText || !messageText.trim()) {
      messageText = "✅ TEST FINAL: el bot recibe y envía mensajes correctamente.";
    }

    await sendWatiMessage(from, messageText);
    return res.sendStatus(200);

  } catch (err) {
    console.log("❌ Error en webhook /whatsapp:", err?.stack || err);
    return res.sendStatus(200);
  }
});

// Healthcheck útil para Render
app.get("/tomar/:numero", (req, res) => {
  const numero = req.params.numero;
  const handoff = getUserHandoff(numero);
  handoff.active = true;
  handoff.until = Date.now() + HANDOFF_DURATION_MS;
  handoff.notified = false;
  saveHandoffState();
  res.send("✅ Bot silenciado para " + numero + " por 45 minutos.");
});

app.get("/liberar/:numero", (req, res) => {
  const numero = req.params.numero;
  clearUserHandoff(numero);
  res.send("✅ Bot reactivado para " + numero);
});

app.get("/reset/:numero", async (req, res) => {
  const numero = req.params.numero;
  delete userProfile[numero];
  delete userState[numero];
  delete userCart[numero];
  delete userMeta[numero];
  delete userReservations[numero];
  delete userReservationDraft[numero];
  await clearUserHandoff(numero);
  redis.del("user_profiles").catch(() => {});
  res.send("✅ Perfil resetado para " + numero);
});
app.get("/", (req, res) => res.send("OK"));

// ================================
// SERVIDOR
// ================================
loadHandoffState().catch(e => console.log("Error inicial handoff:", e.message));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor WhatsApp activo en puerto " + PORT);
  if (!process.env.WATI_TOKEN) {
    console.log("⚠️ Falta WATI_TOKEN (Render Env Vars). El bot NO podrá responder.");
  }
});
