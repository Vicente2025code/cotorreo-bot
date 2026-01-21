// index.js
// Webhook WhatsApp con Node.js + Express + Twilio (State Machine puro)

const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// ==============================
// Estado global por usuario
// ==============================
const userState = {};

// ==============================
// Constantes de estados
// ==============================
const STATES = {
  MENU_PRINCIPAL: 'MENU_PRINCIPAL',

  PLAZA_MENU: 'PLAZA_MENU',
  PLAZA_MENU_INFO: 'PLAZA_MENU_INFO',
  PLAZA_PROMOCIONES: 'PLAZA_PROMOCIONES',
  PLAZA_HORARIOS: 'PLAZA_HORARIOS',
  PLAZA_UBICACION: 'PLAZA_UBICACION',
  PLAZA_RESERVAS: 'PLAZA_RESERVAS',
  PLAZA_PAQUETES: 'PLAZA_PAQUETES',

  ALPADEL_MENU: 'ALPADEL_MENU',
  ALPADEL_PRECIOS: 'ALPADEL_PRECIOS',
  ALPADEL_RESERVAS: 'ALPADEL_RESERVAS',
  ALPADEL_CLASES: 'ALPADEL_CLASES',
  ALPADEL_PROMOCIONES: 'ALPADEL_PROMOCIONES',
  ALPADEL_PAQUETES: 'ALPADEL_PAQUETES',

  ASESOR: 'ASESOR',
};

// ==============================
// Textos (fácil de modificar)
// ==============================
const TEXTOS = {
  MENU_PRINCIPAL: `👋 Bienvenido a *Grupo Cotorreo*

1️⃣ Plaza Cotorreo
2️⃣ Alpadel
3️⃣ Hablar con un asesor`,

  PLAZA_MENU: `🏢 *Plaza Cotorreo*

1️⃣ Menú
2️⃣ Promociones
3️⃣ Horarios
4️⃣ Ubicación
5️⃣ Reservas
6️⃣ Paquetes para fiestas

9️⃣ Volver
0️⃣ Menú principal`,

  ALPADEL_MENU: `🎾 *Alpadel*

1️⃣ Precios
2️⃣ Reservar
3️⃣ Clases
4️⃣ Promociones
5️⃣ Paquetes para fiestas

9️⃣ Volver
0️⃣ Menú principal`,

  ASESOR: `👤 Un asesor te atenderá pronto:

📞 Plaza Cotorreo: 2460-5050
📞 Alpadel: 7131-6051

0️⃣ Menú principal`,
};

// ==============================
// Utilidades
// ==============================
function getUserState(from) {
  if (!userState[from]) {
    userState[from] = STATES.MENU_PRINCIPAL;
  }
  return userState[from];
}

function setUserState(from, state) {
  userState[from] = state;
}

function twimlResponse(message) {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(message);
  return twiml.toString();
}

// ==============================
// Webhook WhatsApp
// ==============================
app.post('/whatsapp', (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || '').trim().toLowerCase();

  let estadoActual = getUserState(from);
  let respuesta = '';

  // ==============================
  // COMANDOS GLOBALES (PRIORIDAD)
  // ==============================
  if (['menu', 'menú', 'inicio', 'hola'].includes(body)) {
    setUserState(from, STATES.MENU_PRINCIPAL);
    return res.send(twimlResponse(TEXTOS.MENU_PRINCIPAL));
  }

  if (body === 'asesor') {
    setUserState(from, STATES.ASESOR);
    return res.send(twimlResponse(TEXTOS.ASESOR));
  }

  // 0 = SIEMPRE menú principal
  if (body === '0') {
    setUserState(from, STATES.MENU_PRINCIPAL);
    return res.send(twimlResponse(TEXTOS.MENU_PRINCIPAL));
  }

  // 9 = volver al menú anterior
  if (body === '9') {
    if (estadoActual.startsWith('PLAZA_') && estadoActual !== STATES.PLAZA_MENU) {
      setUserState(from, STATES.PLAZA_MENU);
      return res.send(twimlResponse(TEXTOS.PLAZA_MENU));
    }
    if (estadoActual.startsWith('ALPADEL_') && estadoActual !== STATES.ALPADEL_MENU) {
      setUserState(from, STATES.ALPADEL_MENU);
      return res.send(twimlResponse(TEXTOS.ALPADEL_MENU));
    }
    setUserState(from, STATES.MENU_PRINCIPAL);
    return res.send(twimlResponse(TEXTOS.MENU_PRINCIPAL));
  }

  // ==============================
  // LÓGICA POR ESTADO
  // ==============================
  switch (estadoActual) {
    case STATES.MENU_PRINCIPAL:
      if (body === '1') {
        setUserState(from, STATES.PLAZA_MENU);
        respuesta = TEXTOS.PLAZA_MENU;
      } else if (body === '2') {
        setUserState(from, STATES.ALPADEL_MENU);
        respuesta = TEXTOS.ALPADEL_MENU;
      } else if (body === '3') {
        setUserState(from, STATES.ASESOR);
        respuesta = TEXTOS.ASESOR;
      } else {
        respuesta = TEXTOS.MENU_PRINCIPAL;
      }
      break;

    case STATES.PLAZA_MENU:
      if (body === '1') {
        setUserState(from, STATES.PLAZA_MENU_INFO);
        respuesta = `📋 *Menú Plaza Cotorreo*

Información disponible.

9️⃣ Volver
0️⃣ Menú principal`;
      } else if (body === '2') {
        setUserState(from, STATES.PLAZA_PROMOCIONES);
        respuesta = `🎉 *Promociones Plaza Cotorreo*

Información disponible.

9️⃣ Volver
0️⃣ Menú principal`;
      } else if (body === '3') {
        setUserState(from, STATES.PLAZA_HORARIOS);
        respuesta = `⏰ *Horarios Plaza Cotorreo*

Información disponible.

9️⃣ Volver
0️⃣ Menú principal`;
      } else if (body === '4') {
        setUserState(from, STATES.PLAZA_UBICACION);
        respuesta = `📍 *Ubicación Plaza Cotorreo*

Información disponible.

9️⃣ Volver
0️⃣ Menú principal`;
      } else if (body === '5') {
        setUserState(from, STATES.PLAZA_RESERVAS);
        respuesta = `📅 *Reservas Plaza Cotorreo*

Información disponible.

9️⃣ Volver
0️⃣ Menú principal`;
      } else if (body === '6') {
        setUserState(from, STATES.PLAZA_PAQUETES);
        respuesta = `🎂 *Paquetes para fiestas*

Información disponible.

9️⃣ Volver
0️⃣ Menú principal`;
      } else {
        respuesta = TEXTOS.PLAZA_MENU;
      }
      break;

    case STATES.ALPADEL_MENU:
      if (body === '1') {
        setUserState(from, STATES.ALPADEL_PRECIOS);
        respuesta = `💰 *Precios Alpadel*

Información disponible.

9️⃣ Volver
0️⃣ Menú principal`;
      } else if (body === '2') {
        setUserState(from, STATES.ALPADEL_RESERVAS);
        respuesta = `📅 *Reservas Alpadel*

Información disponible.

9️⃣ Volver
0️⃣ Menú principal`;
      } else if (body === '3') {
        setUserState(from, STATES.ALPADEL_CLASES);
        respuesta = `🎓 *Clases Alpadel*

Información disponible.

9️⃣ Volver
0️⃣ Menú principal`;
      } else if (body === '4') {
        setUserState(from, STATES.ALPADEL_PROMOCIONES);
        respuesta = `🎉 *Promociones Alpadel*

Información disponible.

9️⃣ Volver
0️⃣ Menú principal`;
      } else if (body === '5') {
        setUserState(from, STATES.ALPADEL_PAQUETES);
        respuesta = `🎾 *Paquetes para fiestas*

Información disponible.

9️⃣ Volver
0️⃣ Menú principal`;
      } else {
        respuesta = TEXTOS.ALPADEL_MENU;
      }
      break;

    case STATES.ASESOR:
      respuesta = TEXTOS.ASESOR;
      break;

    default:
      setUserState(from, STATES.MENU_PRINCIPAL);
      respuesta = TEXTOS.MENU_PRINCIPAL;
      break;
  }

  // ==============================
  // RESPUESTA FINAL (UNA SOLA)
  // ==============================
  res.send(twimlResponse(respuesta));
});

// ==============================
// Servidor
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor WhatsApp activo en puerto ${PORT}`);
});
