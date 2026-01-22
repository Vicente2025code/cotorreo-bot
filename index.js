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
¿Que te gustaria hacer hoy? 👇

1️⃣ 🍽️ Comer en Plaza Cotorreo
2️⃣ 🎾 Jugar padel en Alpadel
3️⃣ 👤 Hablar con un asesor
4️⃣ 📅 Mis reservas
`;

const PLAZA_MENU_TEXT = `
🏢 *Plaza Cotorreo*
¿En que te apetece hoy?

1️⃣ Menú
2️⃣ Promociones
3️⃣ Horarios
4️⃣ Ubicación
5️⃣ Reservas
6️⃣ Paquetes para fiestas

0️⃣ Volver
9️⃣ Inicio
`;

const ALPADEL_MENU_TEXT = `
🎾 *Alpadel*
¿Que te gustaria hacer?

1️⃣ Precios
2️⃣ Reservar cancha
3️⃣ Clases
4️⃣ Promociones
5️⃣ Paquetes para fiestas

0️⃣ Volver
9️⃣ Inicio
`;

const ASESOR_TEXT = `
👤 Un asesor te atendera en un momento. Si prefieres, tambien puedes llamarnos:

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
  return "Hola! Para brindarte un mejor servicio, dime tu nombre.";
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
    reply += `Numero de reserva: ${reservation.id}\n`;
  }
  reply += `Nombre: ${reservation.name || ""}\n`;
  reply += `${reservation.kindLabel}: ${reservation.type}\n`;
  reply += `Personas: ${reservation.people}\n`;
  reply += `Fecha: ${reservation.date}\n`;
  reply += `Hora: ${reservation.time}\n`;
  reply += `Telefono: ${reservation.phone}`;
  return reply;
}

function getReservationDetailsText(reservation) {
  if (!reservation) {
    return "Aun no tienes reservas registradas. ¿Te ayudamos a reservar?\n\n0 Volver\n9 Inicio";
  }

  let reply = "Resumen de tu ultima reserva\n\n";
  reply += `${getReservationSummary(reservation)}\n\n`;
  reply += "0 Volver\n9 Inicio";
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
      { name: "Ceviche de chicharron", price: 4200 },
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
      { name: "Tacos Camaron", price: 2500 },
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
      { name: "Jamon y queso", price: 6500 },
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
      { name: "Brusheta", price: 3900 }
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
      { name: "Arroz con camaron", price: 7500 },
      { name: "Arroz con pollo", price: 6800 },
      { name: "Pasta enchilada", price: 6200 }
    ]
  },
  {
    key: "CAT_INFANTIL",
    label: "Menu Infantil",
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
  let reply = "Con gusto! Aqui tienes nuestro menu completo para que elijas con tranquilidad:\n";
  reply += PLAZA_MENU_LINK + "\n\n";
  reply += "¿Que categoria se te antoja hoy?\n\n";

  PLAZA_MENU_CATEGORIES.forEach((category, index) => {
    reply += `${index + 1} - ${category.label}\n`;
  });

  reply += "\n0 Volver\n9 Inicio";
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

  let reply = `Menu ${category.label}\nElige tu favorito:\n\n`;
  category.items.forEach((item, index) => {
    reply += `${index + 1}. ${item.name} - ${formatCRC(item.price)}\n`;
  });

  reply += "\nPara agregar al carrito, escribe el numero del platillo.\n";
  if (hasCartItems) {
    reply += "Escribe 'carrito' para revisar tu carrito.\n";
  }
  reply += "0 Volver\n9 Inicio";
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
    return "Tu carrito esta vacio por ahora. ¿Quieres ver el menu?\n\n0 Volver\n9 Inicio";
  }

  let reply = "Tu carrito, listo para ti:\n\n";
  let total = 0;
  cart.forEach((item, index) => {
    const subtotal = item.price * item.quantity;
    total += subtotal;
    reply += `${index + 1}. ${item.name} x${item.quantity} - ${formatCRC(subtotal)}\n`;
  });

  reply += `\nTotal: ${formatCRC(total)}\n\n`;
  reply += "1 Confirmar y pagar\n";
  reply += "2 Vaciar carrito\n";
  reply += "0 Volver\n9 Inicio";
  return reply;
}

function getCheckoutText(cart) {
  if (!cart.length) {
    return getCartText(cart);
  }

  let total = 0;
  cart.forEach((item) => {
    total += item.price * item.quantity;
  });

  let reply = "¿Listo para confirmar tu pedido?\n\n";
  reply += `Total: ${formatCRC(total)}\n\n`;
  reply += "1 Confirmar pedido\n";
  reply += "2 Volver al carrito\n";
  reply += "0 Volver";
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
        "🎉 Promociones Plaza Cotorreo\n\nDescubre nuestras promos especiales y disfruta mas por menos.\n\n0️⃣ Volver\n9️⃣ Inicio"
      );
    }

    if (text === "3") {
      userState[from] = "PLAZA_HORARIOS";
      return sendResponse(
        res,
        "⏰ Horarios Plaza Cotorreo\n\nEstamos listos para atenderte. Escribe si necesitas un horario especial.\n\n0️⃣ Volver\n9️⃣ Inicio"
      );
    }

    if (text === "4") {
      userState[from] = "PLAZA_UBICACION";
      return sendResponse(
        res,
        "📍 Ubicación Plaza Cotorreo\n\nTe compartimos la ubicacion exacta cuando gustes.\n\n0️⃣ Volver\n9️⃣ Inicio"
      );
    }

    if (text === "5") {
      userState[from] = "RESERVA_TIPO";
      const draft = startReservation(
        from,
        "Plaza Cotorreo",
        "Tipo de mesa",
        "ej: interior, terraza",
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
        "🎈 Paquetes para fiestas Plaza Cotorreo\n\nCelebra con nosotros. Pregunta por opciones y precios.\n\n0️⃣ Volver\n9️⃣ Inicio"
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
          "1 Seguir viendo el menu\n" +
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
      "¿Que deseas hacer ahora?\n1 Seguir viendo el menu\n2 Ver carrito\n3 Pagar ahora\n0 Volver\n9 Inicio"
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
      return sendResponse(res, "Listo, vaciamos tu carrito.\n\n0 Volver\n9 Inicio");
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
      cart.length = 0;
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(
        res,
        `¡Pedido confirmado${profile.name ? `, ${profile.name}` : ""}! Gracias por elegirnos. En breve te contactamos para coordinar.\n\n9 Inicio`
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
    return sendResponse(res, "¿Para cuantas personas es la reserva?");
  }

  if (userState[from] === "RESERVA_PERSONAS") {
    if (text === "0") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    const count = parseInt(text, 10);
    if (Number.isNaN(count) || count < 1 || count > 20) {
      return sendResponse(res, "Por favor ingresa un numero valido (1-20).");
    }

    const draft = getReservationDraft(from);
    draft.people = count;
    userState[from] = "RESERVA_FECHA";
    return sendResponse(res, "¿Que fecha prefieres? (ej: 15 de diciembre)");
  }

  if (userState[from] === "RESERVA_FECHA") {
    if (text === "0") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    if (!rawText) {
      return sendResponse(res, "¿Que fecha prefieres? (ej: 15 de diciembre)");
    }

    const draft = getReservationDraft(from);
    draft.date = rawText;
    userState[from] = "RESERVA_HORA";
    return sendResponse(res, "¿A que hora? (ej: 7:30 PM)");
  }

  if (userState[from] === "RESERVA_HORA") {
    if (text === "0") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    if (!rawText) {
      return sendResponse(res, "¿A que hora? (ej: 7:30 PM)");
    }

    const draft = getReservationDraft(from);
    draft.time = rawText;
    userState[from] = "RESERVA_TELEFONO";
    return sendResponse(res, "Telefono de contacto para confirmar:");
  }

  if (userState[from] === "RESERVA_TELEFONO") {
    if (text === "0") {
      return sendResponse(res, getReservationExitText(from, profile));
    }

    if (!rawText) {
      return sendResponse(res, "Telefono de contacto para confirmar:");
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
      "Por favor confirma tu reserva:\n\n" + summary + "\n\n1 Confirmar\n2 Cancelar"
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
        `¡Reserva confirmada${profile.name ? `, ${profile.name}` : ""}! Gracias por elegirnos.\nNumero: ${reservationId}\n\n9 Inicio`
      );
    }

    if (text === "2" || text === "0") {
      const exitText = getReservationExitText(from, profile);
      return sendResponse(res, "Reserva cancelada. Si deseas, podemos agendar otra.\n\n" + exitText);
    }

    const draft = getReservationDraft(from);
    const summary = getReservationSummary({
      ...draft,
      name: profile.name
    });
    return sendResponse(
      res,
      "Por favor confirma tu reserva:\n\n" + summary + "\n\n1 Confirmar\n2 Cancelar"
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
        "💰 Precios Alpadel\n\nTenemos opciones para cada necesidad. Consultanos por la tarifa ideal.\n\n0️⃣ Volver\n9️⃣ Inicio"
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
        "🎾 Clases de pádel\n\nMejora tu juego con nuestros entrenadores. Pregunta por horarios.\n\n0️⃣ Volver\n9️⃣ Inicio"
      );
    }

    if (text === "4") {
      userState[from] = "ALPADEL_PROMOCIONES";
      return sendResponse(
        res,
        "🎉 Promociones Alpadel\n\nAprovecha nuestras promos y reserva tu cancha.\n\n0️⃣ Volver\n9️⃣ Inicio"
      );
    }

    if (text === "5") {
      userState[from] = "ALPADEL_PAQUETES";
      return sendResponse(
        res,
        "🎈 Paquetes para fiestas Alpadel\n\nArma tu evento con cancha incluida. Consultanos.\n\n0️⃣ Volver\n9️⃣ Inicio"
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
