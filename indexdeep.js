const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

/* ===============================
   SESIONES MEJORADAS CON VALIDACIÓN
================================ */
const sessions = {};
const SESSION_TTL = 12 * 60 * 60 * 1000;

function getSession(from) {
  const now = Date.now();
  if (!sessions[from] || now - sessions[from].last > SESSION_TTL) {
    sessions[from] = {
      step: "START",
      history: [],
      last: now,
      data: {
        name: null,
        cart: [],
        tempReservation: null,
        reservation: null,
        preferences: {},
        interactionHistory: [],
        customerType: "new"
      }
    };
  }
  sessions[from].last = now;
  return sessions[from];
}

function goTo(session, nextStep, skipHistory = false) {
  // Solo guardar en historial si no estamos en un paso transitorio
  if (!skipHistory && session.step !== "START") {
    session.history.push(session.step);
  }
  session.step = nextStep;
  return session;
}

function goBack(session) {
  if (session.history.length > 0) {
    // Obtener el último paso válido (no transitorio)
    const validSteps = session.history.filter(step => 
      !step.startsWith("ADDED_") && 
      !step.startsWith("RESERVA_") &&
      !step.startsWith("ASK_")
    );
    
    if (validSteps.length > 0) {
      session.step = validSteps.pop();
      // Limpiar historial después de este punto
      const index = session.history.indexOf(session.step);
      session.history = session.history.slice(0, index + 1);
    } else {
      session.step = "START";
      session.history = [];
    }
  } else {
    session.step = "START";
  }
  return session;
}

function resetToStart(session) {
  session.step = "START";
  session.history = [];
  return session;
}

/* ===============================
   MANEJADOR CENTRALIZADO DE MENSAJES
================================ */
class MessageHandler {
  constructor(session, msg, rawMsg) {
    this.session = session;
    this.msg = msg;
    this.rawMsg = rawMsg;
    this.reply = "";
  }

  // 🔴 SOLUCIÓN 1: Eliminar doble interpretación
  // Un solo lugar donde se procesan los mensajes
  async process() {
    // 1. Comandos universales (siempre se procesan primero)
    if (await this.handleUniversalCommands()) {
      return this.reply;
    }

    // 2. Procesar según el paso actual
    switch (this.session.step) {
      case "START": return this.handleStart();
      case "ASK_NAME": return this.handleAskName();
      case "MAIN_MENU": return this.handleMainMenu();
      case "PLAZA_MENU": return this.handlePlazaMenu();
      case "MENU_CATEGORIAS": return this.handleMenuCategorias();
      case "VIEW_CART": return this.handleViewCart();
      case "CHECKOUT": return this.handleCheckout();
      case "CONFIRM_ORDER": return this.handleConfirmOrder();
      case "VIEW_RESERVATIONS": return this.handleViewReservations();
      case "PLAZA_PROMOS": return this.handlePlazaPromos();
      case "PLAZA_UBICACION": return this.handlePlazaUbicacion();
      case "PLAZA_HORARIOS": return this.handlePlazaHorarios();
      case "PLAZA_RESERVAS": return this.handlePlazaReservas();
      case "ALPADEL_MENU": return this.handleAlpadelMenu();
      case "ALPADEL_PRECIOS": return this.handleAlpadelPrecios();
      case "ALPADEL_RESERVA": return this.handleAlpadelReserva();
      case "ALPADEL_CLASES": return this.handleAlpadelClases();
      case "ALPADEL_PROMOS": return this.handleAlpadelPromos();
      case "ALPADEL_UBICACION": return this.handleAlpadelUbicacion();
      
      // Pasos de flujos especiales (no guardan historial)
      case "ADDED_TO_CART": return this.handleAddedToCart();
      case "RESERVA_PERSONAS": return this.handleReservaPersonas();
      case "RESERVA_FECHA": return this.handleReservaFecha();
      case "RESERVA_HORA": return this.handleReservaHora();
      case "RESERVA_CONFIRMAR": return this.handleReservaConfirmar();
      
      // Categorías del menú
      default:
        if (this.session.step.startsWith("CAT_")) {
          return this.handleCategory();
        }
        return "Lo siento, no entendí. Escribe '9' para volver al inicio.";
    }
  }

  async handleUniversalCommands() {
    const commands = {
      "0": () => {
        goBack(this.session);
        this.reply = this.getCurrentStepMessage();
        return true;
      },
      "9": () => {
        resetToStart(this.session);
        this.reply = this.handleStart();
        return true;
      },
      "inicio": () => {
        resetToStart(this.session);
        this.reply = this.handleStart();
        return true;
      },
      "menu": () => {
        if (this.session.history.includes("PLAZA_MENU")) {
          goTo(this.session, "PLAZA_MENU");
        } else if (this.session.history.includes("ALPADEL_MENU")) {
          goTo(this.session, "ALPADEL_MENU");
        } else {
          goTo(this.session, "MAIN_MENU");
        }
        this.reply = this.getCurrentStepMessage();
        return true;
      },
      "ayuda": () => {
        this.reply = this.showHelp();
        return true;
      },
      "carrito": () => {
        goTo(this.session, "VIEW_CART");
        this.reply = this.handleViewCart();
        return true;
      },
      "reservas": () => {
        goTo(this.session, "VIEW_RESERVATIONS");
        this.reply = this.handleViewReservations();
        return true;
      }
    };

    if (commands[this.msg]) {
      return commands[this.msg]();
    }
    
    // Comandos con palabras clave
    for (const [keyword, action] of Object.entries(commands)) {
      if (this.msg.includes(keyword)) {
        return action();
      }
    }
    
    return false;
  }

  getCurrentStepMessage() {
    // Método auxiliar para obtener el mensaje del paso actual
    const handler = new MessageHandler(this.session, "", "");
    handler.session = this.session;
    return handler.process();
  }

  /* ===============================
     MANEJADORES DE PASOS PRINCIPALES
  ================================ */
  handleStart() {
    if (!this.session.data.name) {
      goTo(this.session, "ASK_NAME", true);
      return "👋 ¡Hola! Bienvenido a *Grupo Cotorreo*\n\n¿Cuál es tu nombre?";
    }
    
    let reply = `¡Hola ${this.session.data.name}! 👋\n\n`;
    reply += "¿Sobre qué deseas información?\n\n";
    reply += "1️⃣ Plaza Cotorreo\n";
    reply += "2️⃣ Alpadel\n";
    reply += "3️⃣ 🛒 Ver mi carrito\n";
    reply += "4️⃣ 📅 Mis reservas";
    
    goTo(this.session, "MAIN_MENU", true);
    return reply;
  }

  handleAskName() {
    this.session.data.name = this.rawMsg.trim();
    goTo(this.session, "MAIN_MENU", true);
    return this.handleMainMenu();
  }

  handleMainMenu() {
    switch (this.msg) {
      case "1":
        goTo(this.session, "PLAZA_MENU");
        return this.handlePlazaMenu();
      case "2":
        goTo(this.session, "ALPADEL_MENU");
        return this.handleAlpadelMenu();
      case "3":
        goTo(this.session, "VIEW_CART");
        return this.handleViewCart();
      case "4":
        goTo(this.session, "VIEW_RESERVATIONS");
        return this.handleViewReservations();
      default:
        return "Por favor, selecciona una opción válida:\n\n1️⃣ Plaza Cotorreo\n2️⃣ Alpadel\n3️⃣ 🛒 Carrito\n4️⃣ 📅 Reservas";
    }
  }

  /* ===============================
     PLAZA COTORREO
  ================================ */
  handlePlazaMenu() {
    if (this.msg && this.msg !== "") {
      switch (this.msg) {
        case "1":
          goTo(this.session, "MENU_CATEGORIAS");
          return this.handleMenuCategorias();
        case "2":
          goTo(this.session, "PLAZA_PROMOS");
          return this.handlePlazaPromos();
        case "3":
          goTo(this.session, "PLAZA_UBICACION");
          return this.handlePlazaUbicacion();
        case "4":
          goTo(this.session, "PLAZA_HORARIOS");
          return this.handlePlazaHorarios();
        case "5":
          goTo(this.session, "PLAZA_RESERVAS");
          return this.handlePlazaReservas();
        default:
          // Si no es una opción válida, mostrar el menú nuevamente
          break;
      }
    }
    
    let reply = "🏙️ *Plaza Cotorreo*\n\n";
    reply += "1️⃣ 📖 Menú completo\n";
    reply += "2️⃣ 🔥 Promociones\n";
    reply += "3️⃣ 📍 Ubicación\n";
    reply += "4️⃣ ⏰ Horarios\n";
    reply += "5️⃣ 📅 Reservas / Eventos\n\n";
    reply += "0️⃣ Volver | 9️⃣ Inicio";
    
    return reply;
  }

  handleMenuCategorias() {
    const categories = {
      "1": "CAT_ENTRADAS",
      "2": "CAT_TACOS", 
      "3": "CAT_BURGERS",
      "4": "CAT_SUSHI",
      "5": "CAT_PIZZAS",
      "6": "CAT_ENSALADAS",
      "7": "CAT_SOPAS",
      "8": "CAT_ARROCES",
      "9": "CAT_INFANTIL"
    };

    if (categories[this.msg]) {
      goTo(this.session, categories[this.msg]);
      return this.handleCategory();
    }
    
    let reply = "📖 *Menú Plaza Cotorreo*\n\n";
    reply += "1️⃣ Entradas\n";
    reply += "2️⃣ Tacos\n";
    reply += "3️⃣ Hamburguesas\n";
    reply += "4️⃣ Sushi\n";
    reply += "5️⃣ Pizzas\n";
    reply += "6️⃣ Ensaladas\n";
    reply += "7️⃣ Sopas\n";
    reply += "8️⃣ Arroces y Pastas\n";
    reply += "9️⃣ Menú Infantil\n\n";
    reply += "0️⃣ Volver | 9️⃣ Inicio";
    
    return reply;
  }

  handleCategory() {
    const categoryContent = {
      "CAT_ENTRADAS": "• Guacamole - ₡3,500\n• Caldos - ₡2,800\n• Ceviche de chicharrón - ₡4,200\n• Patacones - ₡3,200\n• Molcajete - ₡6,500",
      "CAT_TACOS": "• Tacos Pastor - ₡1,800\n• Tacos Birria - ₡2,200\n• Tacos Camarón - ₡2,500\n• Tacos Vegetarianos - ₡1,600",
      "CAT_BURGERS": "• Supreme - ₡5,500\n• BBQ - ₡5,000\n• Chicken - ₡4,800\n• Birria - ₡6,000\n• Parrillada - ₡7,500",
      "CAT_SUSHI": "• California Roll - ₡4,500\n• Tico Roll - ₡5,000\n• Crazy Roll - ₡5,500\n• Teriyaki Roll - ₡4,800",
      "CAT_PIZZAS": "• Jamón y queso - ₡6,500\n• Pepperoni - ₡7,000\n• Birria - ₡8,000\n• Hawaiana - ₡6,800",
      "CAT_ENSALADAS": "• Cotorreo verde - ₡4,200\n• Poke bowl - ₡5,500\n• Pita - ₡4,800\n• Brusheta - ₡3,900",
      "CAT_SOPAS": "• Ramen Tonkotsu - ₡6,500\n• Ramen Birria - ₡7,000\n• Sopa Azteca - ₡4,500",
      "CAT_ARROCES": "• Arroz con camarón - ₡7,500\n• Arroz con pollo - ₡6,800\n• Pasta enchilada - ₡6,200",
      "CAT_INFANTIL": "• Dedos de pollo - ₡3,500\n• Dedos de pescado - ₡3,800\n• Hamburguesa infantil - ₡3,200"
    };

    const content = categoryContent[this.session.step] || "Categoría no encontrada";
    
    // Manejar agregar al carrito
    if (this.msg.match(/^\d+$/)) {
      const itemNumber = parseInt(this.msg);
      const items = content.split('\n');
      
      if (itemNumber >= 1 && itemNumber <= items.length) {
        const item = items[itemNumber - 1].trim();
        this.session.data.cart.push({
          name: item.split(' - ')[0].replace('• ', ''),
          price: parseInt(item.split('₡')[1]?.replace(',', '')) || 0,
          quantity: 1
        });
        
        // 🔴 SOLUCIÓN 2: Usar paso transitorio sin guardar en historial
        goTo(this.session, "ADDED_TO_CART", true);
        return `✅ ¡Agregado al carrito!\n\n${item}\n\n¿Qué deseas hacer?\n1️⃣ Seguir viendo\n2️⃣ Ver carrito\n3️⃣ Pagar ahora`;
      }
    }
    
    let reply = `🍽️ *${this.session.step.replace('CAT_', '')}*\n\n`;
    reply += `${content}\n\n`;
    reply += "💡 *Para agregar:* Escribe el número del platillo\n\n";
    reply += "0️⃣ Volver | 9️⃣ Inicio";
    
    return reply;
  }

  /* ===============================
     FLUJO DEL CARRITO (CORREGIDO)
  ================================ */
  handleAddedToCart() {
    switch (this.msg) {
      case "1":
        // Volver a la categoría anterior
        goBack(this.session);
        return this.handleCategory();
      case "2":
        goTo(this.session, "VIEW_CART");
        return this.handleViewCart();
      case "3":
        goTo(this.session, "CHECKOUT");
        return this.handleCheckout();
      default:
        return "Por favor selecciona:\n1️⃣ Seguir viendo\n2️⃣ Ver carrito\n3️⃣ Pagar ahora";
    }
  }

  handleViewCart() {
    if (!this.session.data.cart || this.session.data.cart.length === 0) {
      return "🛒 Tu carrito está vacío.\n\n0️⃣ Volver | 9️⃣ Inicio";
    }
    
    let reply = "🛒 *Tu Carrito*\n\n";
    let total = 0;
    
    this.session.data.cart.forEach((item, index) => {
      const subtotal = item.price * item.quantity;
      reply += `${index + 1}. ${item.name} x${item.quantity} - ₡${subtotal.toLocaleString()}\n`;
      total += subtotal;
    });
    
    reply += `\n💰 *Total: ₡${total.toLocaleString()}*\n\n`;
    reply += "1️⃣ Proceder al pago\n";
    reply += "2️⃣ Vaciar carrito\n";
    reply += "0️⃣ Volver | 9️⃣ Inicio";
    
    if (this.msg === "1") {
      goTo(this.session, "CHECKOUT");
      return this.handleCheckout();
    } else if (this.msg === "2") {
      this.session.data.cart = [];
      return "✅ Carrito vaciado.\n\n0️⃣ Volver | 9️⃣ Inicio";
    }
    
    return reply;
  }

  handleCheckout() {
    if (!this.session.data.cart || this.session.data.cart.length === 0) {
      goTo(this.session, "VIEW_CART");
      return this.handleViewCart();
    }
    
    let total = 0;
    this.session.data.cart.forEach(item => {
      total += item.price * item.quantity;
    });
    
    let reply = "💰 *Finalizar Pedido*\n\n";
    reply += `Total: ₡${total.toLocaleString()}\n\n`;
    reply += "Selecciona método de pago:\n";
    reply += "1️⃣ 💳 Tarjeta\n";
    reply += "2️⃣ 💵 Efectivo\n";
    reply += "3️⃣ 📱 Sinpe móvil\n\n";
    reply += "0️⃣ Volver al carrito";
    
    if (["1", "2", "3"].includes(this.msg)) {
      this.session.data.paymentMethod = ["Tarjeta", "Efectivo", "Sinpe"][parseInt(this.msg) - 1];
      goTo(this.session, "CONFIRM_ORDER", true);
      return this.handleConfirmOrder();
    }
    
    return reply;
  }

  handleConfirmOrder() {
    let total = 0;
    this.session.data.cart.forEach(item => {
      total += item.price * item.quantity;
    });
    
    let reply = "✅ *Confirmar Pedido*\n\n";
    reply += `Método: ${this.session.data.paymentMethod}\n`;
    reply += `Total: ₡${total.toLocaleString()}\n\n`;
    reply += "¿Confirmar pedido?\n";
    reply += "1️⃣ Sí, confirmar\n";
    reply += "2️⃣ No, volver atrás";
    
    if (this.msg === "1") {
      const orderId = "ORD" + Date.now().toString().slice(-6);
      this.session.data.cart = [];
      resetToStart(this.session);
      return `🎉 *¡Pedido Confirmado!*\n\nNúmero: ${orderId}\n\nTe contactaremos pronto.`;
    } else if (this.msg === "2") {
      goBack(this.session);
      return this.handleCheckout();
    }
    
    return reply;
  }

  /* ===============================
     RESERVAS (FLUJO CORREGIDO)
  ================================ */
  handlePlazaReservas() {
    // 🔴 SOLUCIÓN 3: Flujo aislado sin interferencias
    if (!this.msg || this.msg === "") {
      let reply = "📅 *Reservas Plaza Cotorreo*\n\n";
      reply += "Elige una opción:\n\n";
      reply += "1️⃣ Reservar mesa\n";
      reply += "2️⃣ Consultar disponibilidad\n";
      reply += "0️⃣ Volver";
      return reply;
    }
    
    if (this.msg === "1") {
      this.session.data.tempReservation = { type: "mesa" };
      goTo(this.session, "RESERVA_PERSONAS", true);
      return "👥 ¿Para cuántas personas?";
    } else if (this.msg === "2") {
      return "📅 *Disponibilidad actual:*\n\nHoy:\n• 6:00 PM - 2 mesas\n• 7:30 PM - 4 mesas\n• 9:00 PM - 3 mesas\n\n0️⃣ Volver";
    }
    
    return this.handlePlazaReservas();
  }

  handleReservaPersonas() {
    const num = parseInt(this.msg);
    if (isNaN(num) || num < 1 || num > 20) {
      return "Por favor, ingresa un número válido (1-20):";
    }
    
    this.session.data.tempReservation.people = num;
    goTo(this.session, "RESERVA_FECHA", true);
    return "📅 ¿Para qué fecha? (Ej: 15 de diciembre)";
  }

  handleReservaFecha() {
    this.session.data.tempReservation.date = this.rawMsg;
    goTo(this.session, "RESERVA_HORA", true);
    return "⏰ ¿A qué hora? (Ej: 7:30 PM)";
  }

  handleReservaHora() {
    this.session.data.tempReservation.time = this.rawMsg;
    goTo(this.session, "RESERVA_CONFIRMAR", true);
    
    const r = this.session.data.tempReservation;
    let reply = "✅ *Confirmar Reserva*\n\n";
    reply += `👥 Personas: ${r.people}\n`;
    reply += `📅 Fecha: ${r.date}\n`;
    reply += `⏰ Hora: ${r.time}\n\n`;
    reply += "¿Confirmar reserva?\n";
    reply += "1️⃣ Sí, confirmar\n";
    reply += "2️⃣ No, cancelar";
    
    return reply;
  }

  handleReservaConfirmar() {
    if (this.msg === "1") {
      const reservationId = "RES" + Date.now().toString().slice(-6);
      this.session.data.reservation = {
        ...this.session.data.tempReservation,
        id: reservationId
      };
      delete this.session.data.tempReservation;
      resetToStart(this.session);
      return `🎉 *¡Reserva Confirmada!*\n\nNúmero: ${reservationId}\n\nTe esperamos.`;
    } else {
      delete this.session.data.tempReservation;
      goTo(this.session, "PLAZA_MENU");
      return "❌ Reserva cancelada.";
    }
  }

  /* ===============================
     ALPADEL
  ================================ */
  handleAlpadelMenu() {
    if (this.msg && this.msg !== "") {
      switch (this.msg) {
        case "1":
          goTo(this.session, "ALPADEL_PRECIOS");
          return this.handleAlpadelPrecios();
        case "2":
          goTo(this.session, "ALPADEL_RESERVA");
          return this.handleAlpadelReserva();
        case "3":
          goTo(this.session, "ALPADEL_CLASES");
          return this.handleAlpadelClases();
        case "4":
          goTo(this.session, "ALPADEL_PROMOS");
          return this.handleAlpadelPromos();
        case "5":
          goTo(this.session, "ALPADEL_UBICACION");
          return this.handleAlpadelUbicacion();
        default:
          break;
      }
    }
    
    let reply = "🎾 *Alpadel*\n\n";
    reply += "1️⃣ 💰 Precios\n";
    reply += "2️⃣ 📅 Reservar cancha\n";
    reply += "3️⃣ 🎓 Clases\n";
    reply += "4️⃣ 🎁 Promociones\n";
    reply += "5️⃣ 📍 Ubicación\n\n";
    reply += "0️⃣ Volver | 9️⃣ Inicio";
    
    return reply;
  }

  handleAlpadelPrecios() {
    return "💰 *Precios Alpadel*\n\n7am-3pm:\n• Dobles ₡6,000\n• Singles ₡4,000\n\n4pm-10pm:\n• Dobles ₡12,000\n• Singles ₡6,000\n\nDomingos: ₡6,000 todo el día\n\n0️⃣ Volver";
  }

  handleAlpadelReserva() {
    return "📅 *Reservar Cancha*\n\nEnvíanos:\n• Fecha y hora\n• Singles o Dobles\n• Tu nombre\n\nO reserva en Playtomic:\nhttps://playtomic.io/...\n\n0️⃣ Volver";
  }

  handleAlpadelClases() {
    return "🎓 *Clases de Pádel*\n\nFran Sánchez:\n📱 7131-6051\n\n0️⃣ Volver";
  }

  handleAlpadelPromos() {
    return "🎁 *Promociones*\n\n🎂 Cumpleañeros: Gratis todo el mes\n🏢 Grupos empresariales: 50%\n🎫 ASTEC: 20%\n🎾 Padelband gratis\n\n0️⃣ Volver";
  }

  handleAlpadelUbicacion() {
    return "📍 *Ubicación*\n\nhttps://maps.app.goo.gl/...\n\n0️⃣ Volver";
  }

  /* ===============================
     OTRAS SECCIONES
  ================================ */
  handleViewReservations() {
    if (!this.session.data.reservation) {
      return "📅 No tienes reservas activas.\n\n0️⃣ Volver | 9️⃣ Inicio";
    }
    
    const r = this.session.data.reservation;
    let reply = `📅 *Tu Reserva*\n\n`;
    reply += `👥 Personas: ${r.people}\n`;
    reply += `📅 Fecha: ${r.date}\n`;
    reply += `⏰ Hora: ${r.time}\n\n`;
    reply += "1️⃣ Modificar\n2️⃣ Cancelar\n0️⃣ Volver";
    
    if (this.msg === "1") {
      return "Para modificar, contacta al 2460-5050";
    } else if (this.msg === "2") {
      this.session.data.reservation = null;
      return "✅ Reserva cancelada.\n\n0️⃣ Volver";
    }
    
    return reply;
  }

  handlePlazaPromos() {
    return "🔥 *Promociones*\n\nLunes: 2x1 Tacos\nMartes: 2x1 Sushi\nMiércoles: Quesabirrias\nJueves: 3x2 Hamburguesas\n\n0️⃣ Volver";
  }

  handlePlazaUbicacion() {
    return "📍 *Ubicación*\n\nCostado norte del Registro Civil\nCiudad Quesada\n\nhttps://maps.app.goo.gl/...\n\n0️⃣ Volver";
  }

  handlePlazaHorarios() {
    return "⏰ *Horarios*\n\nL-J: 11:30am - 10:00pm\nSáb: 11:30am - 12:00am\nDom: 9:00am - 10:00pm\n\n0️⃣ Volver";
  }

  showHelp() {
    return "🆘 *Ayuda*\n\nComandos:\n• 0: Volver\n• 9: Inicio\n• menu: Ver menú\n• carrito: Ver carrito\n• reservas: Ver reservas\n• ayuda: Esta ayuda\n\n📞 Soporte: 2460-5050";
  }
}

/* ===============================
   WEBHOOK WHATSAPP (SIMPLIFICADO)
================================ */
app.post("/whatsapp", async (req, res) => {
  try {
    const from = req.body.From;
    const rawMsg = (req.body.Body || "").trim();
    const msg = rawMsg.toLowerCase();
    
    const session = getSession(from);
    const handler = new MessageHandler(session, msg, rawMsg);
    const reply = await handler.process();
    
    // 🔴 SOLUCIÓN 1 y 2: Solo un lugar de salida
    res.set("Content-Type", "text/xml");
    res.send(`<Response><Message><![CDATA[${reply}]]></Message></Response>`);
    
  } catch (error) {
    console.error("Error:", error);
    res.set("Content-Type", "text/xml");
    res.send(`<Response><Message><![CDATA[❌ Error interno. Escribe '9' para reiniciar.]]></Message></Response>`);
  }
});

/* ===============================
   ENDPOINTS DE DIAGNÓSTICO
================================ */
app.get("/debug/sessions", (req, res) => {
  const debug = Object.entries(sessions).map(([key, session]) => ({
    user: key,
    step: session.step,
    history: session.history,
    cart: session.data.cart?.length || 0,
    reservation: !!session.data.reservation
  }));
  res.json(debug);
});

app.get("/debug/reset/:user", (req, res) => {
  const user = req.params.user;
  if (sessions[user]) {
    delete sessions[user];
    res.json({ success: true, message: "Sesión reseteada" });
  } else {
    res.json({ success: false, message: "Usuario no encontrado" });
  }
});

/* ===============================
   INICIAR SERVIDOR
================================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en http://localhost:${PORT}`);
  console.log(`🐛 Debug: http://localhost:${PORT}/debug/sessions`);
});