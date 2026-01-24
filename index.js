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

📞 Plaza Cotorreo: 2460-5050
📞 Alpadel: 7131-6051

9️⃣ Volver al menú anterior
0️⃣ Volver al menú principal
`;

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

const PLAZA_MENU_CATEGORIES = [
  {
    key: "CAT_ENTRADAS",
    label: "Entradas",
    number: 1,
    items: [
      { name: "Guacamole", price: 5900 },
      { name: "Caldosa", price: 1700 },
      { name: "Ceviche de chicharrón", price: 4200 },
      { name: "Patacones", price: 3700 },
      { name: "Papa pollo crujiente", price: 3100 },
      { name: "Papa birria", price: 3100 },
      { name: "Surtida mar y tierra", price: 12900 },
      { name: "Surtida botanera", price: 11500 },
      { name: "Molcajete", price: 12500 }
    ]
  },
  {
    key: "CAT_BURGERS_PARRILLADAS",
    label: "Burgers y Parrilladas",
    number: 2,
    items: [
      { name: "Supreme Matt Burger", price: 5900 },
      { name: "BBQ Burger", price: 5900 },
      { name: "Chicken Burger", price: 4600 },
      { name: "Birria Burger", price: 5600 },
      { name: "Parrillada Arrachera", price: 13500 },
      { name: "Parrillada Lomo de res", price: 6200 }
    ]
  },
  {
    key: "CAT_ANTOJITOS",
    label: "Antojitos Mexicanos",
    number: 3,
    items: [
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
    ]
  },
  {
    key: "CAT_TACOS",
    label: "Tacos Mexicanos",
    number: 4,
    items: [
      { name: "Pastor", price: 4000 },
      { name: "Vegetarianos", price: 4000 },
      { name: "Lomito", price: 4900 },
      { name: "Pollo", price: 4000 },
      { name: "Tacos ticos fusión", price: 4700 },
      { name: "Camarón", price: 5700 },
      { name: "Quesabirrias", price: 5000 }
    ]
  },
  {
    key: "CAT_CEVICHES",
    label: "Ceviches y Mariscos",
    number: 5,
    items: [
      { name: "Ceviche tico", price: 2900 },
      { name: "Ceviche peruano", price: 3900 },
      { name: "Ceviche de camarón Cotorreo", price: 5500 },
      { name: "Filete de pescado", price: 4600 },
      { name: "Camarones empanizados", price: 4900 },
      { name: "Salmón a la plancha", price: 9500 },
      { name: "Fajitas mar y tierra", price: 6900 }
    ]
  },
  {
    key: "CAT_SABORES",
    label: "Sabores a lo tico",
    number: 6,
    items: [
      { name: "Cordon bleu", price: 4500 },
      { name: "Chicharrones", price: 4500 },
      { name: "Chifrijo", price: 4500 },
      { name: "Fajitas lomo jalapeño", price: 4700 }
    ]
  },
  {
    key: "CAT_SOPAS",
    label: "Sopas y Caldos",
    number: 7,
    items: [
      { name: "Ramen tonkotsu", price: 5500 },
      { name: "Ramen birria", price: 5300 },
      { name: "Sopa Azteca Pollo", price: 4300 },
      { name: "Sopa Azteca Birria", price: 5200 },
      { name: "Consomé de pollo", price: 4300 }
    ]
  },
  {
    key: "CAT_ARROCES",
    label: "Arroces y Pastas",
    number: 8,
    items: [
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
    ]
  },
  {
    key: "CAT_SUSHI_CRUDO",
    label: "Sushi Crudo",
    number: 10,
    items: [
      { name: "Caterpillar Roll (10 pzas)", price: 5100 },
      { name: "Salmon Lovers Roll (10 pzas)", price: 5900 }
    ]
  },
  {
    key: "CAT_MENU_EJECUTIVO",
    label: "Menú Ejecutivo",
    number: 11,
    items: [
      { name: "Ejecutivo KUMO", price: 3800 },
      { name: "Ejecutivo FISHERS", price: 3800 },
      { name: "Ejecutivo COTORREO", price: 3800 },
      { name: "Ejecutivo PITS", price: 3800 }
    ]
  },
  {
    key: "CAT_SUSHI_COCIDO",
    label: "Sushi Cocido",
    number: 12,
    items: [
      { name: "California Roll (10 pzas)", price: 3000 },
      { name: "Camarón Roll (10 pzas)", price: 4000 },
      { name: "Pollo Teriyaki Roll (10 pzas)", price: 5500 },
      { name: "Tico Roll (10 pzas)", price: 3500 },
      { name: "Tico Especial Roll (10 pzas)", price: 4000 },
      { name: "Rib Eye Teriyaki Roll (10 pzas)", price: 4900 },
      { name: "Crazy Roll (10 pzas)", price: 5900 }
    ]
  },
  {
    key: "CAT_ASIAN",
    label: "Asian Streetfood",
    number: 13,
    items: [
      { name: "Duo coreano", price: 5000 },
      { name: "Teppanyaki Pollo", price: 4750 },
      { name: "Teppanyaki Res", price: 5500 },
      { name: "Teriyaki Pollo", price: 4800 },
      { name: "Teriyaki Res", price: 5500 },
      { name: "Corn Dogs", price: 2500 }
    ]
  },
  {
    key: "CAT_PIZZAS",
    label: "Pizzas",
    number: 14,
    items: [
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
    ]
  },
  {
    key: "CAT_ENSALADAS",
    label: "Ensaladas, Pitas y Poke",
    number: 15,
    items: [
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
    ]
  },
  {
    key: "CAT_INFANTIL",
    label: "Menú Infantil",
    number: 16,
    items: [
      { name: "Dedos de pollo", price: 3900 },
      { name: "Dedos de pescado", price: 3900 },
      { name: "Salchipapas", price: 2900 },
      { name: "Pasta a la mantequilla", price: 2900 },
      { name: "Hamburguesa con queso", price: 4300 },
      { name: "Flautas de jamón con queso", price: 2900 }
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

function getPlazaCategoriesText() {
  let reply = "¡Con gusto! 👇 Aquí tienes nuestro menú completo para que elijas con calma:\n";
  reply += PLAZA_MENU_LINK + "\n\n";
  reply += "¿Se te antoja algo rico hoy? 😋 Tenemos opciones para todos los gustos.\n";
  reply += "Elige tu categoría favorita y arma tu pedido en segundos:\n\n";

  PLAZA_MENU_CATEGORIES.forEach((category, index) => {
    const emojiNumber = category.number === 10
      ? "🔟"
      : (["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣"][index] || `${category.number}.`);
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
  return PLAZA_MENU_CATEGORIES.find((category) => category.key === key);
}

function getCategoryText(categoryKey, hasCartItems) {
  const category = getCategoryByKey(categoryKey);
  if (!category) {
    return getPlazaCategoriesText();
  }

  let reply = `🍽️ ${category.label}\nElige tu favorito y armamos tu pedido en segundos:\n\n`;
  const emojiNumbers = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
  category.items.forEach((item, index) => {
    const emojiNumber = emojiNumbers[index] || `${index + 1}.`;
    reply += `${emojiNumber} ${item.name} - ${formatCRC(item.price)}\n`;
  });

  reply += "\n👉 Para agregar al carrito, escribe el número del platillo.\n";
  if (hasCartItems) {
    reply += "🛒 Escribe 'carrito' para revisar tu carrito.\n";
  }
  reply += "9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal";
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

  const meta = getUserMeta(from);
  const delivery = meta?.orderDelivery ? `\n🚚 Entrega: ${meta.orderDelivery}` : "";
  const payment = meta?.orderPayment ? `\n💰 Pago: ${meta.orderPayment}` : "";

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
  if (["menu", "menú", "inicio", "hola", "0"].includes(text)) {
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
        "🎉 Promociones Plaza Cotorreo\n\nAprovecha nuestras promos especiales y disfruta más por menos. 😋\n\n9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal"
      );
    }

    if (text === "3") {
      userState[from] = "PLAZA_HORARIOS";
      return sendResponse(
        res,
        "⏰ Horarios Plaza Cotorreo\n\nEstamos listos para atenderte. Si necesitas un horario especial, escríbenos. 😊\n\n9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal"
      );
    }

    if (text === "4") {
      userState[from] = "PLAZA_UBICACION";
      return sendResponse(
        res,
        "📍 Ubicación Plaza Cotorreo\n\nTe compartimos la ubicación exacta: https://maps.app.goo.gl/9GcpyAffmQFQU61u9\n¡Te esperamos! 🙌\n\n9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal"
      );
    }

    if (text === "5") {
      userState[from] = "RESERVA_NOMBRE";
      const draft = startReservation(
        from,
        "Plaza Cotorreo",
        "Tipo de mesa",
        "ej: Planta Baja, Planta Alta",
        "PLAZA_MENU"
      );
      return sendResponse(
        res,
        `¡Genial! Reservemos en ${draft.location}.\nNombre para la reserva:`
      );
    }

    if (text === "6") {
      userState[from] = "PLAZA_PAQUETES";
      return sendResponse(
        res,
        "🎈 Paquetes para fiestas Plaza Cotorreo\n\n" +
          "Mira la imagen con los paquetes aquí:\n" +
          "https://drive.google.com/open?id=11xvFT0-drZTnJl_ixFE5FOy8PS_ewnwV\n\n" +
          "Celebra con nosotros. Pregunta por opciones y precios. 🎉\n\n" +
          "9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal"
      );
    }

    if (text === "9") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
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
    if (text === "9") {
      userState[from] = "PLAZA_MENU";
      return sendResponse(res, PLAZA_MENU_TEXT);
    }

    if (text === "0") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

    const choice = parseInt(text, 10);
    if (!Number.isNaN(choice)) {
      const category = PLAZA_MENU_CATEGORIES.find((entry) => entry.number === choice);
      if (category) {
        userState[from] = category.key;
        getUserMeta(from).lastCategory = category.key;
        return sendResponse(res, getCategoryText(category.key, getUserCart(from).length > 0));
      }
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

    if (text === "9") {
      userState[from] = "PLAZA_MENU_CATEGORIES";
      return sendResponse(res, getPlazaCategoriesText());
    }

    if (text === "0") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
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
          "⚠️ El costo mencionado no incluye Express y empaque.\n\n" +
          "1 Seguir viendo el menú\n" +
          "2 Ver carrito\n" +
          "3 Pagar ahora\n" +
          "9 Volver al menú anterior\n" +
          "0 Volver al menú principal"
      );
    }

    return sendResponse(res, getCategoryText(category.key, getUserCart(from).length > 0));
  }

  // ================================
  // CARRITO - ACCION DESPUES DE AGREGAR
  // ================================
  if (userState[from] === "CART_ACTION") {
    if (text === "1") {
      userState[from] = "PLAZA_MENU_CATEGORIES";
      return sendResponse(res, getPlazaCategoriesText());
    }

    if (text === "2") {
      userState[from] = "VIEW_CART";
      return sendResponse(res, getCartText(getUserCart(from)));
    }

    if (text === "3") {
      userState[from] = "CHECKOUT";
      const meta = getUserMeta(from);
      meta.orderDelivery = null;
      meta.orderPayment = null;
      meta.orderFlowOrigin = "CART_ACTION";
      userState[from] = "ORDER_DELIVERY";
      return sendResponse(
        res,
        "¿Como deseas recibir tu pedido?\n1 🚚 Express\n2 🏪 Recoger en restaurante\n\n9 Volver al menú anterior\n0 Volver al menú principal"
      );
    }

    if (text === "9") {
      userState[from] = "PLAZA_MENU_CATEGORIES";
      return sendResponse(res, getPlazaCategoriesText());
    }

    if (text === "0") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

    return sendResponse(
      res,
      "¿Qué deseas hacer ahora?\n1 Seguir viendo el menú\n2 Ver carrito\n3 Pagar ahora\n9 Volver al menú anterior\n0 Volver al menú principal"
    );
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
      return sendResponse(
        res,
        "¿Como deseas recibir tu pedido?\n1 🚚 Express\n2 🏪 Recoger en restaurante\n\n9 Volver al menú anterior\n0 Volver al menú principal"
      );
    }

    if (text === "2") {
      cart.length = 0;
      return sendResponse(res, "Listo, tu carrito quedó en cero. ¿Te muestro el menú? 😋\n\n9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal");
    }

    if (text === "9") {
      userState[from] = "PLAZA_MENU_CATEGORIES";
      return sendResponse(res, getPlazaCategoriesText());
    }

    if (text === "0") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

    return sendResponse(res, getCartText(cart));
  }

  // ================================
  // ENTREGA Y PAGO
  // ================================
  if (userState[from] === "ORDER_DELIVERY") {
    if (text === "9") {
      const origin = getUserMeta(from).orderFlowOrigin;
      if (origin === "CART_ACTION") {
        userState[from] = "CART_ACTION";
        return sendResponse(
          res,
          "¿Qué deseas hacer ahora?\n1 Seguir viendo el menú\n2 Ver carrito\n3 Pagar ahora\n9 Volver al menú anterior\n0 Volver al menú principal"
        );
      }
      userState[from] = "VIEW_CART";
      return sendResponse(res, getCartText(getUserCart(from)));
    }

    if (text === "0") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

    if (text === "1" || text === "express") {
      getUserMeta(from).orderDelivery = "Express";
      userState[from] = "ORDER_PAYMENT";
      return sendResponse(
        res,
        "¿Metodo de pago?\n1 💵 Efectivo\n2 💳 Tarjeta\n3 📲 SINPE\n\n9 Volver al menú anterior\n0 Volver al menú principal"
      );
    }

    if (text === "2" || text === "recoger" || text === "retiro") {
      getUserMeta(from).orderDelivery = "Recoger en restaurante";
      userState[from] = "ORDER_PAYMENT";
      return sendResponse(
        res,
        "¿Metodo de pago?\n1 💵 Efectivo\n2 💳 Tarjeta\n3 📲 SINPE\n\n9 Volver al menú anterior\n0 Volver al menú principal"
      );
    }

    return sendResponse(
      res,
      "Por favor elige una opcion:\n1 🚚 Express\n2 🏪 Recoger en restaurante\n\n9 Volver al menú anterior\n0 Volver al menú principal"
    );
  }

  if (userState[from] === "ORDER_PAYMENT") {
    if (text === "9") {
      userState[from] = "ORDER_DELIVERY";
      return sendResponse(
        res,
        "¿Como deseas recibir tu pedido?\n1 🚚 Express\n2 🏪 Recoger en restaurante\n\n9 Volver al menú anterior\n0 Volver al menú principal"
      );
    }

    if (text === "0") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

    if (text === "1" || text === "efectivo") {
      getUserMeta(from).orderPayment = "Efectivo";
      userState[from] = "CHECKOUT";
      return sendResponse(res, getCheckoutText(from, getUserCart(from)));
    }

    if (text === "2" || text === "tarjeta") {
      getUserMeta(from).orderPayment = "Tarjeta";
      userState[from] = "CHECKOUT";
      return sendResponse(res, getCheckoutText(from, getUserCart(from)));
    }

    if (text === "3" || text === "sinpe") {
      getUserMeta(from).orderPayment = "SINPE";
      userState[from] = "CHECKOUT";
      return sendResponse(res, getCheckoutText(from, getUserCart(from)));
    }

    return sendResponse(
      res,
      "Por favor elige una opcion:\n1 💵 Efectivo\n2 💳 Tarjeta\n3 📲 SINPE\n\n9 Volver al menú anterior\n0 Volver al menú principal"
    );
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
      const payment = meta?.orderPayment ? `\n💰 Pago: ${meta.orderPayment}` : "";
      const summaryText = summaryLines.length
        ? `\n🧾 Detalle de tu pedido:\n${summaryLines.join("\n")}\n\n💳 Total: ${formatCRC(total)}${delivery}${payment}\n`
        : "";
      cart.length = 0;
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(
        res,
        `¡Pedido confirmado${profile.name ? `, ${profile.name}` : ""}! 🙌${summaryText}\nEl costo mencionado no incluye Express y empaque.\nGracias por elegirnos. En breve te contactamos para coordinar.\n\n9 Volver al menú anterior\n0 Volver al menú principal`
      );
    }

    if (text === "2") {
      userState[from] = "VIEW_CART";
      return sendResponse(res, getCartText(cart));
    }

    if (text === "9") {
      userState[from] = "ORDER_PAYMENT";
      return sendResponse(
        res,
        "¿Metodo de pago?\n1 💵 Efectivo\n2 💳 Tarjeta\n3 📲 SINPE\n\n9 Volver al menú anterior\n0 Volver al menú principal"
      );
    }

    if (text === "0") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

    return sendResponse(res, getCheckoutText(from, cart));
  }

  // ================================
  // ALPADEL RESERVA OPCION
  // ================================
  if (userState[from] === "ALPADEL_RESERVA_OPCION") {
    if (text === "1") {
      userState[from] = "RESERVA_NOMBRE";
      const draft = startReservation(
        from,
        "Alpadel",
        "Tipo de cancha",
        "ej: singles, dobles",
        "ALPADEL_MENU"
      );
      return sendResponse(
        res,
        `¡Perfecto! Reservemos en ${draft.location}.\nNombre para la reserva:`
      );
    }

    if (text === "2") {
      return sendResponse(
        res,
        `Reserva en Playtomic aquí:\n${PLAYTOMIC_LINK}\n\n` +
          "Si quieres reservar con nosotros, responde 1.\n\n" +
          "9️⃣ Volver al menú anterior\n" +
          "0️⃣ Volver al menú principal"
      );
    }

    if (text === "9") {
      userState[from] = "ALPADEL_MENU";
      return sendResponse(res, ALPADEL_MENU_TEXT);
    }

    if (text === "0") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

    return sendResponse(
      res,
      "¿Cómo quieres reservar?\n1 ✅ Reservar con nosotros\n2 🌐 Reservar por Playtomic\n\n9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal"
    );
  }

  // ================================
  // RESERVA NOMBRE
  // ================================
  if (userState[from] === "RESERVA_NOMBRE") {
    if (text === "9") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    if (text === "0") {
      clearReservationDraft(from);
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

    if (!rawText) {
      return sendResponse(res, "Nombre para la reserva:");
    }

    const draft = getReservationDraft(from);
    draft.name = rawText;
    userState[from] = "RESERVA_TIPO";
    return sendResponse(
      res,
      `¡Genial! Reservemos en ${draft.location}.\n${draft.kindLabel} (${draft.kindExample}):`
    );
  }

  // ================================
  // RESERVAS GUIADAS
  // ================================
  if (userState[from] === "RESERVA_TIPO") {
    if (text === "9") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    if (text === "0") {
      clearReservationDraft(from);
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
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
    if (text === "9") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    if (text === "0") {
      clearReservationDraft(from);
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
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
    if (text === "9") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    if (text === "0") {
      clearReservationDraft(from);
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
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
    if (text === "9") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    if (text === "0") {
      clearReservationDraft(from);
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
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
    if (text === "9") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    if (text === "0") {
      clearReservationDraft(from);
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

    if (!rawText) {
      return sendResponse(res, "Teléfono de contacto para confirmar: 📱");
    }

    const draft = getReservationDraft(from);
    draft.phone = rawText;
    userState[from] = "RESERVA_CONFIRMAR";

    const summary = getReservationSummary({
      ...draft,
      name: draft.name
    });

    return sendResponse(
      res,
      "Por favor confirma tu reserva: ✅\n\n" + summary + "\n\n1 Confirmar\n2 Cancelar"
    );
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
      clearReservationDraft(from);
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(
        res,
        `¡Reserva confirmada${reservationName ? `, ${reservationName}` : ""}! 🎉\nGracias por elegirnos.\nNúmero: ${reservationId}\n\n9 Volver al menú anterior\n0 Volver al menú principal`
      );
    }

    if (text === "2" || text === "9") {
      const exitText = getReservationExitText(from, profile);
      return sendResponse(res, "Reserva cancelada. Si deseas, podemos agendar otra. 🙌\n\n" + exitText);
    }

    if (text === "0") {
      clearReservationDraft(from);
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

    const draft = getReservationDraft(from);
    const summary = getReservationSummary({
      ...draft,
      name: draft.name
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
    if (text === "9") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

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
    text === "9"
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

9️⃣ Volver al menú anterior
0️⃣ Volver al menú principal`
      );
    }

    if (text === "2") {
      userState[from] = "ALPADEL_RESERVA_OPCION";
      return sendResponse(
        res,
        "¿Cómo quieres reservar? 🎾\n\n" +
          "1 ✅ Reservar con nosotros\n" +
          "2 🌐 Reservar por Playtomic\n\n" +
          "9️⃣ Volver al menú anterior\n" +
          "0️⃣ Volver al menú principal"
      );
    }

    if (text === "3") {
      userState[from] = "ALPADEL_CLASES";
      return sendResponse(
        res,
        "🎾 Clases de pádel con Fran Sanchez\n\n" +
          "Lleva tu juego al siguiente nivel con nuestro único entrenador: Fran Sanchez. 💪\n" +
          "Escríbele directo y agenda tu clase:\n\n" +
          "📲 WhatsApp: https://wa.me/50671316051\n" +
          "📞 Teléfono: 7131 6051\n\n" +
          "9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal"
      );
    }

    if (text === "4") {
      userState[from] = "ALPADEL_PROMOCIONES";
      return sendResponse(
        res,
        "🎾 Promociones en Alpadel\n\n" +
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
          "9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal"
      );
    }

    if (text === "5") {
      userState[from] = "ALPADEL_PAQUETES";
      return sendResponse(
        res,
        "🎈 Paquetes para fiestas Alpadel\n\n" +
          "Mira la imagen con los paquetes aquí:\n" +
          "https://drive.google.com/open?id=11xvFT0-drZTnJl_ixFE5FOy8PS_ewnwV\n\n" +
          "Arma tu evento con cancha incluida. Consúltanos. 🎉\n\n" +
          "9️⃣ Volver al menú anterior\n0️⃣ Volver al menú principal"
      );
    }

    if (text === "9") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
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
    text === "9"
  ) {
    userState[from] = "ALPADEL_MENU";
    return sendResponse(res, ALPADEL_MENU_TEXT);
  }

  // ================================
  // ASESOR
  // ================================
  if (userState[from] === "ASESOR") {
    if (text === "9") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, getMenuPrincipalText(profile.name));
    }

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
