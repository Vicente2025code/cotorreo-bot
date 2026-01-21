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

// ================================
// TEXTOS (FÁCILES DE EDITAR)
// ================================
const MENU_PRINCIPAL_TEXT = `
👋 Bienvenido a *Grupo Cotorreo*

1️⃣ Plaza Cotorreo
2️⃣ Alpadel
3️⃣ Hablar con un asesor
`;

const PLAZA_MENU_TEXT = `
🏢 *Plaza Cotorreo*

1️⃣ Menú
2️⃣ Promociones
3️⃣ Horarios
4️⃣ Ubicación
5️⃣ Reservas
6️⃣ Paquetes para fiestas

0️⃣ Volver
`;

const ALPADEL_MENU_TEXT = `
🎾 *Alpadel*

1️⃣ Precios
2️⃣ Reservar cancha
3️⃣ Clases
4️⃣ Promociones
5️⃣ Paquetes para fiestas

0️⃣ Volver
`;

const ASESOR_TEXT = `
👤 Un asesor te atenderá pronto:

📞 Plaza Cotorreo: 2460-5050
📞 Alpadel: 7131-6051

0️⃣ Volver
`;

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
  const text = (req.body.Body || "").trim().toLowerCase();

  // ================================
  // INICIALIZAR ESTADO
  // ================================
  if (!userState[from]) {
    userState[from] = "MENU_PRINCIPAL";
  }

  // ================================
  // COMANDOS GLOBALES
  // ================================
  if (["menu", "menú", "inicio", "hola", "9"].includes(text)) {
    userState[from] = "MENU_PRINCIPAL";
    return sendResponse(res, MENU_PRINCIPAL_TEXT);
  }

  if (text === "asesor") {
    userState[from] = "ASESOR";
    return sendResponse(res, ASESOR_TEXT);
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

    return sendResponse(res, MENU_PRINCIPAL_TEXT);
  }

  // ================================
  // PLAZA COTORREO MENU
  // ================================
  if (userState[from] === "PLAZA_MENU") {
    if (text === "1") {
      userState[from] = "PLAZA_MENU";
      return sendResponse(res, "📋 Menú Plaza Cotorreo\n\n0️⃣ Volver");
    }

    if (text === "2") {
      userState[from] = "PLAZA_PROMOCIONES";
      return sendResponse(res, "🎉 Promociones Plaza Cotorreo\n\n0️⃣ Volver");
    }

    if (text === "3") {
      userState[from] = "PLAZA_HORARIOS";
      return sendResponse(res, "⏰ Horarios Plaza Cotorreo\n\n0️⃣ Volver");
    }

    if (text === "4") {
      userState[from] = "PLAZA_UBICACION";
      return sendResponse(res, "📍 Ubicación Plaza Cotorreo\n\n0️⃣ Volver");
    }

    if (text === "5") {
      userState[from] = "PLAZA_RESERVAS";
      return sendResponse(res, "📅 Reservas Plaza Cotorreo\n\n0️⃣ Volver");
    }

    if (text === "6") {
      userState[from] = "PLAZA_PAQUETES";
      return sendResponse(res, "🎈 Paquetes para fiestas Plaza Cotorreo\n\n0️⃣ Volver");
    }

    if (text === "0") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, MENU_PRINCIPAL_TEXT);
    }

    return sendResponse(res, PLAZA_MENU_TEXT);
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
      return sendResponse(res, "💰 Precios Alpadel\n\n0️⃣ Volver");
    }

    if (text === "2") {
      userState[from] = "ALPADEL_RESERVAS";
      return sendResponse(res, "📅 Reservar cancha\n\n0️⃣ Volver");
    }

    if (text === "3") {
      userState[from] = "ALPADEL_CLASES";
      return sendResponse(res, "🎾 Clases de pádel\n\n0️⃣ Volver");
    }

    if (text === "4") {
      userState[from] = "ALPADEL_PROMOCIONES";
      return sendResponse(res, "🎉 Promociones Alpadel\n\n0️⃣ Volver");
    }

    if (text === "5") {
      userState[from] = "ALPADEL_PAQUETES";
      return sendResponse(res, "🎈 Paquetes para fiestas Alpadel\n\n0️⃣ Volver");
    }

    if (text === "0") {
      userState[from] = "MENU_PRINCIPAL";
      return sendResponse(res, MENU_PRINCIPAL_TEXT);
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
      return sendResponse(res, MENU_PRINCIPAL_TEXT);
    }

    return sendResponse(res, ASESOR_TEXT);
  }

  // ================================
  // FALLBACK ABSOLUTO
  // ================================
  userState[from] = "MENU_PRINCIPAL";
  return sendResponse(res, MENU_PRINCIPAL_TEXT);
});

// ================================
// SERVIDOR
// ================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor WhatsApp activo en puerto " + PORT);
});
