/* Que el bot lea lo que el cliente TOCO, no los indices internos de WATI.
 *
 *   node test/leer_boton.test.js
 *
 * El primer caso no esta inventado: es el webhook textual que recibio el bot
 * el 23-nov-2026 a las 20:15:16 cuando Juan Ramirez toco "Quiero información"
 * en la campana de cierres de ano. Hasta ese dia el bot leia el payload, le
 * pasaba un bloque de JSON al cerebro y le contestaba con la promo de tacos.
 */
const { idDeBoton } = require("../services/leerBoton");

let fallos = 0;
const caso = (que, webhook, esperado) => {
  const dio = idDeBoton(webhook);
  const ok = dio === esperado;
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${que}`);
  if (!ok) console.log(`          dio ${JSON.stringify(dio)}, esperaba ${JSON.stringify(esperado)}`);
};

console.log("-- botones de PLANTILLA (los de las campanas): vale el texto");
caso("caso Juan Ramirez, 23-nov 20:15", {
  waId: "50687205465",
  senderName: "Juan Ramirez.",
  listReply: null,
  interactiveButtonReply: null,
  buttonReply: {
    payload: '{"ButtonIndex":0,"CarouselCardIndex":null,"BroadcastLinkId":"6b0484e78455ef8fd966dcef","QuickReplyIndex":0}',
    text: "Quiero información",
  },
}, "Quiero información");

caso("payload JSON con espacios adelante", {
  buttonReply: { payload: '  {"QuickReplyIndex":1}  ', text: "Ver paquetes" },
}, "Ver paquetes");

caso("payload vacio", { buttonReply: { payload: "", text: "Sí, me interesa" } },
     "Sí, me interesa");

console.log("\n-- botones DEL PROPIO BOT: sigue ganando el id, no la etiqueta");
caso("interactivo con id", {
  interactiveButtonReply: { id: "1", text: "🍽️ Comer en Plaza" },
}, "1");
caso("buttonReply con id", { buttonReply: { id: "3", text: "👤 Hablar asesor" } }, "3");
caso("payload util, no JSON", {
  buttonReply: { payload: "menu_comer", text: "🍽️ Comer en Plaza" },
}, "menu_comer");

console.log("\n-- formas viejas que ya funcionaban: no se rompen");
caso("interactive.button_reply", { interactive: { button_reply: { id: "2" } } }, "2");
caso("listReply.rowId", { listReply: { rowId: "fila_7" } }, "fila_7");
caso("Cloud API anidada", { messages: [{ interactive: { button_reply: { id: "9" } } }] }, "9");

console.log("\n-- mensajes que NO son boton");
caso("texto normal", { text: "hola, quiero una parrillada" }, null);
caso("webhook vacio", {}, null);
caso("nulo", null, null);

console.log(fallos ? `\n${fallos} FALLOS` : "\ntodo bien");
process.exit(fallos ? 1 : 0);
