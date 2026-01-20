const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

/* ===============================
   SESIONES SIMPLES (12 HORAS)
================================ */
const sessions = {};
const SESSION_TTL = 12 * 60 * 60 * 1000;

function getSession(from) {
  const now = Date.now();
  if (!sessions[from] || now - sessions[from].last > SESSION_TTL) {
    sessions[from] = {
      step: "START",
      history: [],
      last: now
    };
  }
  sessions[from].last = now;
  return sessions[from];
}

function goTo(session, next) {
  session.history.push(session.step);
  session.step = next;
}

function goBack(session) {
  session.step = session.history.pop() || "START";
}

function reset(session) {
  session.step = "START";
  session.history = [];
}

/* ===============================
   WEBHOOK WHATSAPP
================================ */
app.post("/whatsapp", (req, res) => {
  const from = req.body.From;
  const msgRaw = (req.body.Body || "").trim();
  const msg = msgRaw.toLowerCase();
  const session = getSession(from);

  /* ========= HUMANO ========= */
  if (msg.includes("asesor") || msg.includes("humano")) {
    return send(res,
      "🙋‍♂️ Claro, un asesor te atenderá pronto.\n\n" +
      "📞 Plaza Cotorreo: 2460-5050\n" +
      "📱 Alpadel: 7131-6051\n\n" +
      "9️⃣ Volver al inicio"
    );
  }

  /* ========= NAVEGACIÓN ========= */
  if (msg === "0") {
    goBack(session);
  }
  if (msg === "9") {
    reset(session);
  }

  let reply = "";

  /* ===============================
     START
  ================================ */
  if (session.step === "START") {
    reply =
      "👋 *Bienvenido a Grupo Cotorreo*\n\n" +
      "¿Qué deseas consultar?\n\n" +
      "1️⃣ Plaza Cotorreo\n" +
      "2️⃣ Alpadel";
    session.step = "MAIN_MENU";
    return send(res, reply);
  }

  /* ===============================
     MENÚ PRINCIPAL
  ================================ */
  if (session.step === "MAIN_MENU") {
    if (msg === "1") goTo(session, "PLAZA_MENU");
    else if (msg === "2") goTo(session, "ALPADEL_MENU");
    else {
      return send(res,
        "Elige una opción válida 🙂\n\n" +
        "1️⃣ Plaza Cotorreo\n2️⃣ Alpadel"
      );
    }
  }

  /* ===============================
     PLAZA COTORREO
  ================================ */
  if (session.step === "PLAZA_MENU") {
    reply =
      "🏙️ *Plaza Cotorreo*\n\n" +
      "1️⃣ Menú\n" +
      "2️⃣ Promociones\n" +
      "3️⃣ Ubicación\n" +
      "4️⃣ Horarios\n" +
      "5️⃣ Reservas / Eventos\n\n" +
      "0️⃣ Volver | 9️⃣ Inicio";

    if (msg === "1") goTo(session, "PLAZA_MENU_LISTA");
    if (msg === "2") goTo(session, "PLAZA_PROMOS");
    if (msg === "3") goTo(session, "PLAZA_UBICACION");
    if (msg === "4") goTo(session, "PLAZA_HORARIOS");
    if (msg === "5") goTo(session, "PLAZA_RESERVAS");

    return send(res, reply);
  }

  if (session.step === "PLAZA_MENU_LISTA") {
    return send(res,
      "📖 *Menú Plaza Cotorreo*\n\n" +
      "Consulta todos los platillos aquí:\n" +
      "👉 https://linktr.ee/elcotorreocr\n\n" +
      "Incluye:\n" +
      "• Entradas\n• Tacos\n• Hamburguesas\n• Sushi\n• Pizzas\n• Bowls\n• Sopas\n• Menú infantil\n\n" +
      "0️⃣ Volver | 9️⃣ Inicio"
    );
  }

  if (session.step === "PLAZA_PROMOS") {
    return send(res,
      "🔥 *Promociones*\n\n" +
      "🟢 Lunes: 2x1 Tacos\n" +
      "🟢 Martes: 2x1 Sushi\n" +
      "🟢 Miércoles: Quesabirrias\n" +
      "🟢 Jueves: 3x2 Hamburguesas\n\n" +
      "0️⃣ Volver | 9️⃣ Inicio"
    );
  }

  if (session.step === "PLAZA_UBICACION") {
    return send(res,
      "📍 *Ubicación*\n\n" +
      "Costado norte del Registro Civil\nCiudad Quesada\n\n" +
      "https://maps.app.goo.gl/gjHqX1eifNHcywAdA\n\n" +
      "0️⃣ Volver | 9️⃣ Inicio"
    );
  }

  if (session.step === "PLAZA_HORARIOS") {
    return send(res,
      "⏰ *Horarios*\n\n" +
      "L–J: 11:30am – 10:00pm\n" +
      "Sáb: 11:30am – 12:00am\n" +
      "Dom: 9:00am – 10:00pm\n\n" +
      "0️⃣ Volver | 9️⃣ Inicio"
    );
  }

  if (session.step === "PLAZA_RESERVAS") {
    return send(res,
      "🎉 *Reservas y Eventos*\n\n" +
      "Envíanos:\n" +
      "• Nombre\n• Fecha\n• Cantidad de personas\n\n" +
      "Un asesor te confirmará 🙌\n\n" +
      "0️⃣ Volver | 9️⃣ Inicio"
    );
  }

  /* ===============================
     ALPADEL
  ================================ */
  if (session.step === "ALPADEL_MENU") {
    reply =
      "🎾 *Alpadel*\n\n" +
      "1️⃣ Precios\n" +
      "2️⃣ Reservar cancha\n" +
      "3️⃣ Clases\n" +
      "4️⃣ Promociones\n" +
      "5️⃣ Ubicación\n\n" +
      "0️⃣ Volver | 9️⃣ Inicio";

    if (msg === "1") goTo(session, "ALPADEL_PRECIOS");
    if (msg === "2") goTo(session, "ALPADEL_RESERVA");
    if (msg === "3") goTo(session, "ALPADEL_CLASES");
    if (msg === "4") goTo(session, "ALPADEL_PROMOS");
    if (msg === "5") goTo(session, "ALPADEL_UBICACION");

    return send(res, reply);
  }

  if (session.step === "ALPADEL_PRECIOS") {
    return send(res,
      "💰 *Precios Alpadel*\n\n" +
      "7am–3pm\n• Dobles ₡6.000\n• Singles ₡4.000\n\n" +
      "4pm–10pm\n• Dobles ₡12.000\n• Singles ₡6.000\n\n" +
      "Domingos ₡6.000 todo el día\n\n" +
      "0️⃣ Volver | 9️⃣ Inicio"
    );
  }

  if (session.step === "ALPADEL_RESERVA") {
    return send(res,
      "📅 *Reservar cancha*\n\n" +
      "Playtomic:\n" +
      "https://playtomic.io/tenant/a621d2de-72ad-4b8b-8913-a54e071f6f77\n\n" +
      "O envíanos:\n• Fecha\n• Hora\n• Singles o Dobles\n\n" +
      "Un humano confirmará 🙌\n\n" +
      "0️⃣ Volver | 9️⃣ Inicio"
    );
  }

  if (session.step === "ALPADEL_CLASES") {
    return send(res,
      "🎾 *Clases de Pádel*\n\n" +
      "Fran Sánchez\n📱 7131 6051\n\n" +
      "0️⃣ Volver | 9️⃣ Inicio"
    );
  }

  if (session.step === "ALPADEL_PROMOS") {
    return send(res,
      "🎁 *Promociones*\n\n" +
      "🎂 Cumpleañeros gratis\n" +
      "🏢 Empresas/colegios (4): 50%\n" +
      "🎫 ASTEC: 20%\n\n" +
      "0️⃣ Volver | 9️⃣ Inicio"
    );
  }

  if (session.step === "ALPADEL_UBICACION") {
    return send(res,
      "📍 *Ubicación Alpadel*\n\n" +
      "https://maps.app.goo.gl/gjHqX1eifNHcywAdA\n\n" +
      "0️⃣ Volver | 9️⃣ Inicio"
    );
  }

  return send(res, "Escribe una opción válida 🙂\n\n0️⃣ Volver | 9️⃣ Inicio");
});

/* ===============================
   RESPUESTA TWILIO
================================ */
function send(res, message) {
  res.set("Content-Type", "text/xml");
  res.send(`<Response><Message>${message}</Message></Response>`);
}

app.listen(3000, () => {
  console.log("🚀 Servidor activo en http://localhost:3000");
});
