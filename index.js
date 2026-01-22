// ================================
// DEPENDENCIAS
// ================================
const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// ================================
// ESTADO GLOBAL POR USUARIO
// ================================
const userState = {};
const userCart = {};
const userMeta = {};
const userProfile = {};
const userReservations = {};
const userReservationDraft = {};

// ================================
// TEXTOS (FÁCILES DE EDITAR)
// ================================
const MENU_PRINCIPAL_TEXT = `
👋 ¡Bienvenido a *Grupo Cotorreo*!
¿Qué te gustaría hacer hoy? escribe el número 👇

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

0️⃣ Volver
9️⃣ Inicio
`;

const ALPADEL_MENU_TEXT = `
🎾 *Alpadel*
¿Qué te gustaría hacer hoy? 😊

1️⃣ 💰 Precios
2️⃣ ✅ Reservar cancha
3️⃣ 🎾 Clases
4️⃣ 🎉 Promociones
5️⃣ 🎈 Paquetes para fiestas

0️⃣ Volver
9️⃣ Inicio
`;

const ASESOR_TEXT = `
👤 ¡Estamos para ayudarte! Un asesor te atenderá en un momento.
Si prefieres, también puedes llamarnos:

📞 Plaza Cotorreo: 2460-5050
📞 Alpadel: 7131-6051

0️⃣ Volver
9️⃣ Inicio
`;

function getUserProfile(from) {
  if (!userProfile[from]) {
    userProfile[from] = { name: null };
  }
  return userProfile[from];
}

function isGlobalCommand(text) {
  return ["menu", "menú", "inicio", "hola", "9", "asesor", "carrito", "reservas"].includes(text);
}

function getNamePrompt() {
  return "¡Hola! Para brindarte un mejor servicio, dime tu nombre.";
}

function getMenuPrincipalText(name) {
  if (!name) {
    return MENU_PRINCIPAL_TEXT;
  }

  return MENU_PRINCIPAL_TEXT.replace(
    "¡Bienvenido a *Grupo Cotorreo*!",
    `Hola ${name}! ¡Bienvenido a *Grupo Cotorreo*!`
  );
}

function getUserReservation(from) {
  return userReservations[from] || null;
}

function getReservationDraft(from) {
  if (!userReservationDraft[from]) {
    userReservationDraft[from] = {
      location: null,
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
  if (reservation.id) {
    reply += `Número de reserva: ${reservation.id}\n`;
  }
  reply += `Nombre: ${reservation.name || ""}\n`;
  reply += `${reservation.kindLabel}: ${reservation.type}\n`;
  reply += `Personas: ${reservation.people}\n`;
  reply += `Fecha: ${reservation.date}\n`;
  reply += `Hora: ${reservation.time}\n`;
  reply += `Teléfono: ${reservation.phone}`;
  return reply;
}

function getReservationDetailsText(reservation) {
  if (!reservation) {
    return "Aún no tienes reservas registradas. ¿Te ayudamos a reservar? ✨\n\n0️⃣ Volver\n9️⃣ Inicio";
  }

  let reply = "Resumen de tu última reserva 📌\n\n";
  reply += `${getReservationSummary(reservation)}\n\n`;
  reply += "0️⃣ Volver\n9️⃣ Inicio";
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

const PLAZA_MENU_CATEGORIES = [
  {
    key: "CAT_ENTRADAS",
    label: "Entradas",
    items: [
      { name: "Guacamole", price: 3500 },
      { name: "Caldos", price: 2800 },
      { name: "Ceviche de chicharrón", price: 4200 },
      { name: "Patacones", price: 3200 },
      { name: "Molcajete", price: 6500 }
    ]
  },
  {
    key: "CAT_TACOS",
    label: "Tacos",
    items: [
      { name: "Tacos Pastor", price: 1800 },
      { name: "Tacos Birria", price: 2200 },
      { name: "Tacos Camarón", price: 2500 },
      { name: "Tacos Vegetarianos", price: 1600 }
    ]
  },
  {
    key: "CAT_BURGERS",
    label: "Hamburguesas",
    items: [
      { name: "Supreme", price: 5500 },
      { name: "BBQ", price: 5000 },
      { name: "Chicken", price: 4800 },
      { name: "Birria", price: 6000 },
      { name: "Parrillada", price: 7500 }
    ]
  },
  {
    key: "CAT_SUSHI",
    label: "Sushi",
    items: [
      { name: "California Roll", price: 4500 },
      { name: "Tico Roll", price: 5000 },
      { name: "Crazy Roll", price: 5500 },
      { name: "Teriyaki Roll", price: 4800 }
    ]
  },
  {
    key: "CAT_PIZZAS",
    label: "Pizzas",
    items: [
      { name: "Jamón y queso", price: 6500 },
      { name: "Pepperoni", price: 7000 },
      { name: "Birria", price: 8000 },
      { name: "Hawaiana", price: 6800 }
    ]
  },
  {
    key: "CAT_ENSALADAS",
    label: "Ensaladas",
    items: [
      { name: "Cotorreo verde", price: 4200 },
      { name: "Poke bowl", price: 5500 },
      { name: "Pita", price: 4800 },
      { name: "Bruschetta", price: 3900 }
    ]
  },
  {
    key: "CAT_SOPAS",
    label: "Sopas",
    items: [
      { name: "Ramen Tonkotsu", price: 6500 },
      { name: "Ramen Birria", price: 7000 },
      { name: "Sopa Azteca", price: 4500 }
    ]
  },
  {
    key: "CAT_ARROCES",
    label: "Arroces y Pastas",
    items: [
      { name: "Arroz con camarón", price: 7500 },
      { name: "Arroz con pollo", price: 6800 },
      { name: "Pasta enchilada", price: 6200 }
    ]
  },
  {
    key: "CAT_INFANTIL",
    label: "Menú Infantil",
    items: [
      { name: "Dedos de pollo", price: 3500 },
      { name: "Dedos de pescado", price: 3800 },
      { name: "Hamburguesa infantil", price: 3200 }
    ]
  }
];

function getUserCart(from) {
  if (!userCart[from]) {
    userCart[from] = [];
  }
  return userCart[from];
}

function getUserMeta(from) {
  if (!userMeta[from]) {
    userMeta[from] = { lastCategory: null };
  }
  return userMeta[from];
}

function formatCRC(amount) {
  return "₡" + amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function getPlazaCategoriesText() {
  let reply = "¡Con gusto! 👇 Aquí tienes nuestro menú completo para que elijas con calma:\n";
  reply += PLAZA_MENU_LINK + "\n\n";
  reply += "¿Se te antoja algo rico hoy? 😋 Tenemos opciones para todos los gustos.\n";
  reply += "Elige tu categoría favorita y arma tu pedido en segundos:\n\n";

  PLAZA_MENU_CATEGORIES.forEach((category, index) => {
    const emojiNumber = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"][index] || `${index + 1}`;
    const emojiByLabel = {
      Entradas: "🥑",
      Tacos: "🌮",
      Hamburguesas: "🍔",
      Sushi: "🍣",
      Pizzas: "🍕",
      Ensaladas: "🥗",
      Sopas: "🍲",
      "Arroces y Pastas": "🍝",
      "Menú Infantil": "👧🧒"
    };
    const emoji = emojiByLabel[category.label] || "🍽️";
    reply += `${emojiNumber} ${emoji} ${category.label}\n`;
  });

  reply += "\n0️⃣ Volver\n9️⃣ Inicio";
  return reply;
}

function getCategoryByKey(key) {
  return PLAZA_MENU_CATEGORIES.find((category) => category.key === key);
}

function getCategoryText(categoryKey, hasCartItems) {
  const category = getCategoryByKey(categoryKey);
  if (!category) {
    return getPlazaCategoriesText();
  }

  if (category.label === "Entradas") {
    const prices = category.items.reduce((acc, item) => {
      acc[item.name] = formatCRC(item.price);
      return acc;
    }, {});
    return (
      "😎 *Entradas que hacen feliz al estómago*\n\n" +
      "Dime… ¿cuál te guiña el ojo hoy? 👀🍴\n\n" +
      `1️⃣ Guacamole — ${prices.Guacamole}\n` +
      `2️⃣ Caldos — ${prices.Caldos}\n` +
      `3️⃣ Ceviche de chicharrón — ${prices["Ceviche de chicharrón"]}\n` +
      `4️⃣ Patacones — ${prices.Patacones}\n` +
      `5️⃣ Molcajete — ${prices.Molcajete} (nivel pro 😏)\n\n` +
      "🛒 Para mandarlo directo al carrito, escribe el número\n" +
      "(no muerde, lo prometo)\n\n" +
      "0️⃣ Volver\n" +
      "9️⃣ Inicio"
    );
  }

  if (category.label === "Tacos") {
    const prices = category.items.reduce((acc, item) => {
      acc[item.name] = formatCRC(item.price);
      return acc;
    }, {});
    return (
      "🌮 *Tacos que hacen historia*\n\n" +
      "Aquí no hay decisiones malas… solo tacos increíbles 😋\n" +
      "¿Cuál se te antoja hoy?\n\n" +
      `1️⃣ Tacos Pastor — ${prices["Tacos Pastor"]} 🔥\n` +
      `2️⃣ Tacos Birria — ${prices["Tacos Birria"]} ⭐\n` +
      `3️⃣ Tacos Camarón — ${prices["Tacos Camarón"]} 🦐\n` +
      `4️⃣ Tacos Vegetarianos — ${prices["Tacos Vegetarianos"]} 🌱\n\n` +
      "👉 *Para agregar al carrito*, escribe el número del taco\n" +
      "🛒 (tranquilo, después puedes pedir más 😉)\n\n" +
      "0️⃣ Volver\n" +
      "9️⃣ Inicio"
    );
  }

  if (category.label === "Hamburguesas") {
    const prices = category.items.reduce((acc, item) => {
      acc[item.name] = formatCRC(item.price);
      return acc;
    }, {});
    return (
      "🍔 *Hamburguesas para caer rendido*\n\n" +
      "Jugosas, poderosas y con mucho sabor 😍\n" +
      "¿Cuál te vas a pedir hoy?\n\n" +
      `1️⃣ Supreme — ${prices.Supreme} 👑\n` +
      `2️⃣ BBQ — ${prices.BBQ} 🔥\n` +
      `3️⃣ Chicken — ${prices.Chicken} 🍗\n` +
      `4️⃣ Birria — ${prices.Birria} 🌮\n` +
      `5️⃣ Parrillada — ${prices.Parrillada} 🥩\n\n` +
      "👉 Para agregar al carrito, escribe el número\n" +
      "🛒 (si quieres combo, dímelo y te ayudamos)\n\n" +
      "0️⃣ Volver\n" +
      "9️⃣ Inicio"
    );
  }

  if (category.label === "Sushi") {
    const prices = category.items.reduce((acc, item) => {
      acc[item.name] = formatCRC(item.price);
      return acc;
    }, {});
    return (
      "🍣 *Sushi que enamora a primera mordida*\n\n" +
      "Fresco, balanceado y con sabor top ✨\n" +
      "¿Cuál roll te vas a dar hoy?\n\n" +
      `1️⃣ California Roll — ${prices["California Roll"]} 🥢\n` +
      `2️⃣ Tico Roll — ${prices["Tico Roll"]} 🌴\n` +
      `3️⃣ Crazy Roll — ${prices["Crazy Roll"]} 🤯\n` +
      `4️⃣ Teriyaki Roll — ${prices["Teriyaki Roll"]} 🍱\n\n` +
      "👉 Para agregar al carrito, escribe el número\n" +
      "🛒 (si quieres recomendación, dímelo 😉)\n\n" +
      "0️⃣ Volver\n" +
      "9️⃣ Inicio"
    );
  }

  if (category.label === "Pizzas") {
    const prices = category.items.reduce((acc, item) => {
      acc[item.name] = formatCRC(item.price);
      return acc;
    }, {});
    return (
      "🍕 *Pizzas que alegran cualquier plan*\n\n" +
      "Crujientes, generosas y llenas de sabor 😍\n" +
      "¿Cuál te vas a pedir hoy?\n\n" +
      `1️⃣ Jamón y queso — ${prices["Jamón y queso"]} 🧀\n` +
      `2️⃣ Pepperoni — ${prices.Pepperoni} 🌶️\n` +
      `3️⃣ Birria — ${prices.Birria} 🔥\n` +
      `4️⃣ Hawaiana — ${prices.Hawaiana} 🍍\n\n` +
      "👉 Para agregar al carrito, escribe el número\n" +
      "🛒 (si quieres extra queso, dímelo 😉)\n\n" +
      "0️⃣ Volver\n" +
      "9️⃣ Inicio"
    );
  }

  if (category.label === "Ensaladas") {
    const prices = category.items.reduce((acc, item) => {
      acc[item.name] = formatCRC(item.price);
      return acc;
    }, {});
    return (
      "🥗 *Ensaladas frescas para sentirte ligero*\n\n" +
      "Color, sabor y frescura en cada bocado ✨\n" +
      "¿Cuál se te antoja hoy?\n\n" +
      `1️⃣ Cotorreo verde — ${prices["Cotorreo verde"]} 🥬\n` +
      `2️⃣ Poke bowl — ${prices["Poke bowl"]} 🐟\n` +
      `3️⃣ Pita — ${prices.Pita} 🫓\n` +
      `4️⃣ Bruschetta — ${prices.Bruschetta} 🍅\n\n` +
      "👉 Para agregar al carrito, escribe el número\n" +
      "🛒 (si quieres algo más ligero o más completo, te ayudo)\n\n" +
      "0️⃣ Volver\n" +
      "9️⃣ Inicio"
    );
  }

  if (category.label === "Sopas") {
    const prices = category.items.reduce((acc, item) => {
      acc[item.name] = formatCRC(item.price);
      return acc;
    }, {});
    return (
      "🍲 *Sopas que reconfortan el alma*\n\n" +
      "Calientitas, sabrosas y perfectas para antojo 😌\n" +
      "¿Cuál te apetece hoy?\n\n" +
      `1️⃣ Ramen Tonkotsu — ${prices["Ramen Tonkotsu"]} 🍜\n` +
      `2️⃣ Ramen Birria — ${prices["Ramen Birria"]} 🔥\n` +
      `3️⃣ Sopa Azteca — ${prices["Sopa Azteca"]} 🌶️\n\n` +
      "👉 Para agregar al carrito, escribe el número\n" +
      "🛒 (si quieres algo más suave o más picante, dime)\n\n" +
      "0️⃣ Volver\n" +
      "9️⃣ Inicio"
    );
  }

  if (category.label === "Arroces y Pastas") {
    const prices = category.items.reduce((acc, item) => {
      acc[item.name] = formatCRC(item.price);
      return acc;
    }, {});
    return (
      "🍝 *Arroces y pastas que llenan el alma*\n\n" +
      "Sabrosos, completos y perfectos para quedar feliz 😋\n" +
      "¿Cuál se te antoja hoy?\n\n" +
      `1️⃣ Arroz con camarón — ${prices["Arroz con camarón"]} 🦐\n` +
      `2️⃣ Arroz con pollo — ${prices["Arroz con pollo"]} 🍗\n` +
      `3️⃣ Pasta enchilada — ${prices["Pasta enchilada"]} 🌶️\n\n` +
      "👉 Para agregar al carrito, escribe el número\n" +
      "🛒 (si quieres algo más suave o más picante, te ayudo)\n\n" +
      "0️⃣ Volver\n" +
      "9️⃣ Inicio"
    );
  }

if (category.label === "Menú Infantil") {
    const prices = category.items.reduce((acc, item) => {
      acc[item.name] = formatCRC(item.price);
      return acc;
    }, {});
    return (
      "👧🧒 *Menú infantil para sonrisas felices*\n\n" +
      "Rico, divertido y perfecto para los peques 😄\n" +
      "¿Cuál eliges hoy?\n\n" +
      `1️⃣ Dedos de pollo — ${prices["Dedos de pollo"]} 🍗\n` +
      `2️⃣ Dedos de pescado — ${prices["Dedos de pescado"]} 🐟\n` +
      `3️⃣ Hamburguesa infantil — ${prices["Hamburguesa infantil"]} 🍔\n\n` +
      "👉 Para agregar al carrito, escribe el número\n" +
      "🛒 (si quieres bebida para niños, dímelo y te ayudo)\n\n" +
      "0️⃣ Volver\n" +
      "9️⃣ Inicio"
    );
  }

  let reply = `🍽️ Menú ${category.label}\nElige tu favorito y armamos tu pedido en segundos:\n\n`;
  const emojiNumbers = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
  category.items.forEach((item, index) => {
    const emojiNumber = emojiNumbers[index] || `${index + 1}.`;
    reply += `${emojiNumber} ${item.name} - ${formatCRC(item.price)}\n`;
  });

  reply += "\n👉 Para agregar al carrito, escribe el número del platillo.\n";
  if (hasCartItems) {
    reply += "🛒 Escribe 'carrito' para revisar tu carrito.\n";
  }
  reply += "0️⃣ Volver\n9️⃣ Inicio";
  return reply;
}

function addItemToCart(cart, item) {
  const existing = cart.find((entry) => entry.name === item.name);
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
    return "Tu carrito está vacío por ahora. ¿Quieres ver el menú? 😋\n\n0️⃣ Volver\n9️⃣ Inicio";
  }

  let reply = "🛒 Tu carrito, listo para ti:\n\n";
  let total = 0;
  cart.forEach((item, index) => {
    const subtotal = item.price * item.quantity;
    total += subtotal;
    reply += `${index + 1}. ${item.name} x${item.quantity} - ${formatCRC(subtotal)}\n`;
  });

  reply += `\nTotal: ${formatCRC(total)}\n\n`;
  reply += "1 ✅ Confirmar y pagar\n";
  reply += "2 🧹 Vaciar carrito\n";
  reply += "0️⃣ Volver\n9️⃣ Inicio";
  return reply;
}

function getCheckoutText(cart) {
  if (!cart.length) {
    return getCartText(cart);
  }

  let total = 0;
  const summaryLines = [];
  cart.forEach((item) => {
    total += item.price * item.quantity;
    const subtotal = item.price * item.quantity;
    summaryLines.push(`✅ ${item.name} x${item.quantity} - ${formatCRC(subtotal)}`);
  });

  let reply = "¿Listo para confirmar tu pedido? 🙌\n\n";
  reply += "🧾 Detalle de tu pedido:\n";
  reply += summaryLines.join("\n") + "\n\n";
  reply += `💳 Total: ${formatCRC(total)}\n\n`;
  reply += "1 ✅ Confirmar pedido\n";
  reply += "2 🛒 Volver al carrito\n";
  reply += "0️⃣ Volver";
  return reply;
}

// ================================
// FUNCIÓN ÚNICA PARA RESPONDER
// ================================
function sendResponse(res, message) {
  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(`
<Response>
  <Message>${message}</Message>
</Response>
`);
}

// ================================
// WEBHOOK WHATSAPP
// ================================
app.post("/whatsapp", (req, res) => {
  const from = req.body.From;
  const rawText = (req.body.Body || "").trim();
  const text = rawText.toLowerCase();

  // ================================
  // INICIALIZAR ESTADO
  // ================================
  if (!userState[from]) {
    userState[from] = "MENU_PRINCIPAL";
  }
  getUserCart(from);
  getUserMeta(from);
  const profile = getUserProfile(from);

  // ================================
  // ONBOARDING NOMBRE
  // ================================
  if (userState[from] === "ASK_NAME") {
    if (!rawText || isGlobalCommand(text)) {
      return sendResponse(res, getNamePrompt());
    }

    profile.name = rawText;
    userState[from] = "MENU_PRINCIPAL";
    return sendResponse(res, getMenuPrincipalText(profile.name));
  }

  if (!profile.name) {
    userState[from] = "ASK_NAME";
    return sendResponse(res, getNamePrompt());
  }

  // ================================
  // COMANDOS GLOBALES
  // ================================
  if (["menu", "menú", "inicio", "hola", "9"].includes(text)) {
    userState[from] = "MENU_PRINCIPAL";
    return sendResponse(res, getMenuPrincipalText(profile.name));
  }

  if (text === "asesor") {
    userState[from] = "ASESOR";
    return sendResponse(res, ASESOR_TEXT);
  }

  if (text === "carrito") {
    userState[from] = "VIEW_CART";
    return sendResponse(res, getCartText(getUserCart(from)));
  }

  if (text === "reservas") {
    userState[from] = "VIEW_RESERVATIONS";
    return sendResponse(res, getReservationDetailsText(getUserReservation(from)));
  }

  // ================================
  // MENU PRINCIPAL
  // ================================
  if (userState[from] === "MENU_PRINCIPAL") {
    if (text === "1") {
      userState[from] = "PLAZA_MENU";
      return sendResponse(res, PLAZA_MENU_TEXT);
    }

    if (text === "2") {
      userState[from] = "ALPADEL_MENU";
      return sendResponse(res, ALPADEL_MENU_TEXT);
    }

    if (text === "3") {
      userState[from] = "ASESOR";
      return sendResponse(res, ASESOR_TEXT);
    }

    if (text === "4") {
      userState[from] = "VIEW_RESERVATIONS";
      return sendResponse(res, getReservationDetailsText(getUserReservation(from)));
    }

    return sendResponse(res, getMenuPrincipalText(profile.name));
  }

  // ================================
  // PLAZA COTORREO MENU
  // ================================
  if (userState[from] === "PLAZA_MENU") {
    if (text === "1") {
      userState[from] = "PLAZA_MENU_CATEGORIES";
      return sendResponse(res, getPlazaCategoriesText());
    }

    if (text === "2") {
      userState[from] = "PLAZA_PROMOCIONES";
      return sendResponse(
        res,
        "🎉 Promociones Plaza Cotorreo\n\nAprovecha nuestras promos especiales y disfruta más por menos. 😋\n\n0️⃣ Volver\n9️⃣ Inicio"
      );
    }

    if (text === "3") {
      userState[from] = "PLAZA_HORARIOS";
      return sendResponse(
        res,
        "⏰ Horarios Plaza Cotorreo\n\nEstamos listos para atenderte. Si necesitas un horario especial, escríbenos. 😊\n\n0️⃣ Volver\n9️⃣ Inicio"
      );
    }

    if (text === "4") {
      userState[from] = "PLAZA_UBICACION";
      return sendResponse(
        res,
        "📍 Ubicación Plaza Cotorreo\n\nTe compartimos la ubicación exacta: https://maps.app.goo.gl/9GcpyAffmQFQU61u9\n¡Te esperamos! 🙌\n\n0️⃣ Volver\n9️⃣ Inicio"
      );
    }

    if (text === "5") {
      userState[from] = "RESERVA_TIPO";
      const draft = startReservation(
        from,
        "Plaza Cotorreo",
        "Tipo de mesa",
        "ej: Planta Baja, Planta Alta",
        "PLAZA_MENU"
      );
      return sendResponse(
        res,
        `¡Genial! Reservemos en ${draft.location}.\n${draft.kindLabel} (${draft.kindExample}):`
      );
    }

    if (text === "6") {
      userState[from] = "PLAZA_PAQUETES";
      return sendResponse(
        res,
        "🎈 Paquetes para fiestas Plaza Cotorreo\n\nCelebra con nosotros. Pregunta por opciones y precios. 🎉\n\n0️⃣ Volver\n9️⃣ Inicio"
      );
    }

    if (text === "0") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

    return sendResponse(res, PLAZA_MENU_TEXT);
  }

  // ================================
  // PLAZA COTORREO CATEGORIES
  // ================================
  if (userState[from] === "PLAZA_MENU_CATEGORIES") {
    if (text === "0") {
      userState[from] = "PLAZA_MENU";
      return sendResponse(res, PLAZA_MENU_TEXT);
    }

    const choice = parseInt(text, 10);
    if (!Number.isNaN(choice) && choice >= 1 && choice <= PLAZA_MENU_CATEGORIES.length) {
      const categoryKey = PLAZA_MENU_CATEGORIES[choice - 1].key;
      userState[from] = categoryKey;
      getUserMeta(from).lastCategory = categoryKey;
      return sendResponse(res, getCategoryText(categoryKey, getUserCart(from).length > 0));
    }

    return sendResponse(res, getPlazaCategoriesText());
  }

  // ================================
  // PLAZA COTORREO CATEGORY ITEMS
  // ================================
  if (userState[from].startsWith("CAT_")) {
    if (text === "carrito" && getUserCart(from).length > 0) {
      userState[from] = "VIEW_CART";
      return sendResponse(res, getCartText(getUserCart(from)));
    }

    if (text === "0") {
      userState[from] = "PLAZA_MENU_CATEGORIES";
      return sendResponse(res, getPlazaCategoriesText());
    }

    const category = getCategoryByKey(userState[from]);
    if (!category) {
      userState[from] = "PLAZA_MENU_CATEGORIES";
      return sendResponse(res, getPlazaCategoriesText());
    }

    const itemNumber = parseInt(text, 10);
    if (!Number.isNaN(itemNumber) && itemNumber >= 1 && itemNumber <= category.items.length) {
      const cart = getUserCart(from);
      const item = category.items[itemNumber - 1];
      addItemToCart(cart, item);
      userState[from] = "CART_ACTION";
      getUserMeta(from).lastCategory = category.key;
      return sendResponse(
        res,
        "¡Listo! Agregamos a tu carrito:\n" +
          `${item.name} - ${formatCRC(item.price)}\n\n` +
          "1 Seguir viendo el menú\n" +
          "2 Ver carrito\n" +
          "3 Pagar ahora\n" +
          "0 Volver\n" +
          "9 Inicio"
      );
    }

    return sendResponse(res, getCategoryText(category.key, getUserCart(from).length > 0));
  }

  // ================================
  // CARRITO - ACCION DESPUES DE AGREGAR
  // ================================
  if (userState[from] === "CART_ACTION") {
    if (text === "1") {
      const lastCategory = getUserMeta(from).lastCategory;
      if (lastCategory) {
        userState[from] = lastCategory;
        return sendResponse(res, getCategoryText(lastCategory, getUserCart(from).length > 0));
      }
      userState[from] = "PLAZA_MENU_CATEGORIES";
      return sendResponse(res, getPlazaCategoriesText());
    }

    if (text === "2") {
      userState[from] = "VIEW_CART";
      return sendResponse(res, getCartText(getUserCart(from)));
    }

    if (text === "3") {
      userState[from] = "CHECKOUT";
      return sendResponse(res, getCheckoutText(getUserCart(from)));
    }

    if (text === "0") {
      userState[from] = "PLAZA_MENU_CATEGORIES";
      return sendResponse(res, getPlazaCategoriesText());
    }

    return sendResponse(
      res,
      "¿Qué deseas hacer ahora?\n1 Seguir viendo el menú\n2 Ver carrito\n3 Pagar ahora\n0 Volver\n9 Inicio"
    );
  }

  // ================================
  // VER CARRITO
  // ================================
  if (userState[from] === "VIEW_CART") {
    const cart = getUserCart(from);

    if (text === "1") {
      userState[from] = "CHECKOUT";
      return sendResponse(res, getCheckoutText(cart));
    }

    if (text === "2") {
      cart.length = 0;
      return sendResponse(res, "Listo, tu carrito quedó en cero. ¿Te muestro el menú? 😋\n\n0️⃣ Volver\n9️⃣ Inicio");
    }

    if (text === "0") {
      userState[from] = "PLAZA_MENU_CATEGORIES";
      return sendResponse(res, getPlazaCategoriesText());
    }

    return sendResponse(res, getCartText(cart));
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
      const summaryText = summaryLines.length
        ? `\n🧾 Detalle de tu pedido:\n${summaryLines.join("\n")}\n\n💳 Total: ${formatCRC(total)}\n`
        : "";
      cart.length = 0;
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(
        res,
        `¡Pedido confirmado${profile.name ? `, ${profile.name}` : ""}! 🙌${summaryText}\nEl costo mencionado no incluye Express y empaque.\nGracias por elegirnos. En breve te contactamos para coordinar.\n\n9️⃣ Inicio`
      );
    }

    if (text === "2" || text === "0") {
      userState[from] = "VIEW_CART";
      return sendResponse(res, getCartText(cart));
    }

    return sendResponse(res, getCheckoutText(cart));
  }

  // ================================
  // RESERVAS GUIADAS
  // ================================
  if (userState[from] === "RESERVA_TIPO") {
    if (text === "0") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    const draft = getReservationDraft(from);
    if (!rawText) {
      return sendResponse(
        res,
        `¡Genial! Reservemos en ${draft.location}.\n${draft.kindLabel} (${draft.kindExample}):`
      );
    }

    draft.type = rawText;
    userState[from] = "RESERVA_PERSONAS";
    return sendResponse(res, "¿Para cuántas personas es la reserva? 👥");
  }

  if (userState[from] === "RESERVA_PERSONAS") {
    if (text === "0") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    const count = parseInt(text, 10);
    if (Number.isNaN(count) || count < 1 || count > 20) {
      return sendResponse(res, "Por favor ingresa un número válido (1-20).");
    }

    const draft = getReservationDraft(from);
    draft.people = count;
    userState[from] = "RESERVA_FECHA";
    return sendResponse(res, "¿Qué fecha prefieres? 📅 (ej: 15 de diciembre)");
  }

  if (userState[from] === "RESERVA_FECHA") {
    if (text === "0") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    if (!rawText) {
      return sendResponse(res, "¿Qué fecha prefieres? 📅 (ej: 15 de diciembre)");
    }

    const draft = getReservationDraft(from);
    draft.date = rawText;
    userState[from] = "RESERVA_HORA";
    return sendResponse(res, "¿A qué hora? ⏰ (ej: 7:00 PM)");
  }

  if (userState[from] === "RESERVA_HORA") {
    if (text === "0") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    if (!rawText) {
      return sendResponse(res, "¿A qué hora? ⏰ (ej: 7:00 PM)");
    }

    const draft = getReservationDraft(from);
    draft.time = rawText;
    userState[from] = "RESERVA_TELEFONO";
    return sendResponse(res, "Teléfono de contacto para confirmar: 📱");
  }

  if (userState[from] === "RESERVA_TELEFONO") {
    if (text === "0") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    if (!rawText) {
      return sendResponse(res, "Teléfono de contacto para confirmar: 📱");
    }

    const draft = getReservationDraft(from);
    draft.phone = rawText;
    userState[from] = "RESERVA_CONFIRMAR";

    const summary = getReservationSummary({
      ...draft,
      name: profile.name
    });

    return sendResponse(
      res,
      "Por favor confirma tu reserva: ✅\n\n" + summary + "\n\n1 Confirmar\n2 Cancelar"
    );
  }

  if (userState[from] === "RESERVA_CONFIRMAR") {
    if (text === "1") {
      const draft = getReservationDraft(from);
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
        name: profile.name
      };
      clearReservationDraft(from);
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(
        res,
        `¡Reserva confirmada${profile.name ? `, ${profile.name}` : ""}! 🎉\nGracias por elegirnos.\nNúmero: ${reservationId}\n\n9️⃣ Inicio`
      );
    }

    if (text === "2" || text === "0") {
      const exitText = getReservationExitText(from, profile);
      return sendResponse(res, "Reserva cancelada. Si deseas, podemos agendar otra. 🙌\n\n" + exitText);
    }

    const draft = getReservationDraft(from);
    const summary = getReservationSummary({
      ...draft,
      name: profile.name
    });
    return sendResponse(
      res,
      "Por favor confirma tu reserva: ✅\n\n" + summary + "\n\n1 Confirmar\n2 Cancelar"
    );
  }

  // ================================
  // CONSULTA DE RESERVAS
  // ================================
  if (userState[from] === "VIEW_RESERVATIONS") {
    if (text === "0") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

    return sendResponse(res, getReservationDetailsText(getUserReservation(from)));
  }

  // ================================
  // SUBMENÚS PLAZA
  // ================================
  if (
    userState[from].startsWith("PLAZA_") &&
    text === "0"
  ) {
    userState[from] = "PLAZA_MENU";
    return sendResponse(res, PLAZA_MENU_TEXT);
  }

  // ================================
  // ALPADEL MENU
  // ================================
  if (userState[from] === "ALPADEL_MENU") {
    if (text === "1") {
      userState[from] = "ALPADEL_PRECIOS";
      return sendResponse(
        res,
        `💰 Precios Alpadel

🕖 7am – 3pm
• Dobles: ₡6.000
• Singles: ₡4.000

🕓 4pm – 10pm
• Dobles: ₡12.000
• Singles: ₡6.000

☀️ Domingos: ₡6.000 todo el día

📌 Para reservar, vuelve y elige “Reservar”.

0️⃣ Volver
9️⃣ Inicio`
      );
    }

    if (text === "2") {
      userState[from] = "RESERVA_TIPO";
      const draft = startReservation(
        from,
        "Alpadel",
        "Tipo de cancha",
        "ej: singles, dobles",
        "ALPADEL_MENU"
      );
      return sendResponse(
        res,
        `¡Perfecto! Reservemos en ${draft.location}.\n${draft.kindLabel} (${draft.kindExample}):`
      );
    }

    if (text === "3") {
      userState[from] = "ALPADEL_CLASES";
      return sendResponse(
        res,
        "🎾 Clases de pádel\n\nMejora tu juego con nuestros entrenadores. Pregunta por horarios. 💪\n\n0️⃣ Volver\n9️⃣ Inicio"
      );
    }

    if (text === "4") {
      userState[from] = "ALPADEL_PROMOCIONES";
      return sendResponse(
        res,
        "🎉 Promociones Alpadel\n\nAprovecha nuestras promos y reserva tu cancha. ✅\n\n0️⃣ Volver\n9️⃣ Inicio"
      );
    }

    if (text === "5") {
      userState[from] = "ALPADEL_PAQUETES";
      return sendResponse(
        res,
        "🎈 Paquetes para fiestas Alpadel\n\nArma tu evento con cancha incluida. Consúltanos. 🎉\n\n0️⃣ Volver\n9️⃣ Inicio"
      );
    }

    if (text === "0") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

    return sendResponse(res, ALPADEL_MENU_TEXT);
  }

  // ================================
  // SUBMENÚS ALPADEL
  // ================================
  if (
    userState[from].startsWith("ALPADEL_") &&
    text === "0"
  ) {
    userState[from] = "ALPADEL_MENU";
    return sendResponse(res, ALPADEL_MENU_TEXT);
  }

  // ================================
  // ASESOR
  // ================================
  if (userState[from] === "ASESOR") {
    if (text === "0") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

    return sendResponse(res, ASESOR_TEXT);
  }

  // ================================
  // FALLBACK ABSOLUTO
  // ================================
  userState[from] = "MENU_PRINCIPAL";
  return sendResponse(res, getMenuPrincipalText(profile.name));
});

// ================================
// SERVIDOR
// ================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor WhatsApp activo en puerto " + PORT);
});
