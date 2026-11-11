// Pruebas de intencionMensaje.js
//
// Tabla de frases en español de verdad, no payloads inventados. Las 12 primeras
// son las que usé el 10-nov-2026 para medir el interceptor viejo: 7 salían mal.

const {
  preguntaPorRollos2x1, esEstadoDePedido, esQueja, requiereHumano,
} = require("../services/intencionMensaje");

let pass = 0, fail = 0;
function t(nombre, fn) {
  try { fn(); console.log("✅", nombre); pass++; }
  catch (e) { console.log("❌", nombre, "—", e.message); fail++; }
}
function eq(a, b, ctx = "") {
  if (a !== b) throw new Error(`${ctx} esperado ${JSON.stringify(b)}, recibido ${JSON.stringify(a)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SÍ debe soltar la lista de rollos
// ─────────────────────────────────────────────────────────────────────────────
const SI = [
  "Cuáles sushis aplican al 2x1?",
  "En qué rollos aplica la promo?",
  "menu de sushi",
  "¿Qué sushis tienen?",
  "Cuál es la promo de sushi?",
  "2x1 sushi",
  "dos por uno de rollos",
  "cuales rollos entran en la promo",
  "tienen sushi?",
  "la lista de sushis por favor",
  "que rollos incluye el 2x1",
  "el 2x1 sirve para el caterpillar?",
];

t("las 12 frases que SÍ deben soltar la lista, la sueltan", () => {
  for (const f of SI) eq(preguntaPorRollos2x1(f), true, `"${f}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// NO debe soltar la lista — las 7 que salían mal, más otras
// ─────────────────────────────────────────────────────────────────────────────
const NO = [
  // Las 7 regresiones medidas el 10-nov
  "El sushi que pedi ya esta listo?",
  "Ya esta lista mi orden de sushi?",
  "Porque el sushi estaba frio",
  "No queria sushi, queria tacos",
  // 2x1 de OTRO día: debe NO soltar la lista de sushi
  "cuales tacos entran en el 2x1 del lunes",
  "el 2x1 de quesabirrias cuantas son",
  "Que rico el sushi, gracias",
  "Me gusto el rollo que me trajeron",
  "El rollo venia sin salsa, que hago?",
  // Las que ya salían bien y no se pueden romper
  "Cuanto le falta al sushi!",
  "Quien hace el sushi aqui?",
  // Más casos del mismo tipo
  "cuanto falta para mi rollo",
  "el rollo llego quemado",
  "mi pedido de sushi no llego completo",
  "paso a retirar el sushi en 20 min",
  "cuando sale el rollo",
  "quiero un reclamo, el sushi estaba crudo",
];

t("las frases que NO deben soltar la lista, no la sueltan", () => {
  for (const f of NO) eq(preguntaPorRollos2x1(f), false, `"${f}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Estado del pedido → persona
// ─────────────────────────────────────────────────────────────────────────────
t("el caso exacto de Alejandra se detecta como estado de pedido", () => {
  // Textual, de WATI, 10-nov 19:49:59
  eq(esEstadoDePedido("Maso menos cuanto falta?"), true);
  // 19:53:49
  eq(esEstadoDePedido("Cuánto le falta al sushi!"), true);
});

t("variantes de estado de pedido", () => {
  for (const f of [
    "ya esta mi orden?", "ya salio el express?", "esta listo?",
    "cuanto tarda", "cuanto mas falta", "va en camino?",
    "cuando llega mi pedido", "mi pedido por favor", "ya mero?",
    "paso a recoger", "cuanto demora la comida",
  ]) eq(esEstadoDePedido(f), true, `"${f}"`);
});

t("no confunde cosas normales con estado de pedido", () => {
  for (const f of [
    "hola", "cuales sushis aplican", "tienen parqueo?",
    "que horario tienen", "quiero reservar mesa para 6",
    "cuanto cuesta el ramen", "menu de sushi", "donde estan ubicados",
  ]) eq(esEstadoDePedido(f), false, `"${f}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Quejas → persona
// ─────────────────────────────────────────────────────────────────────────────
t("detecta quejas", () => {
  for (const f of [
    "el sushi estaba frio", "llego crudo", "la hamburguesa venia quemada",
    "falto el aguacate", "me dieron el pedido equivocado",
    "quiero un reembolso", "vino sin salsa", "no me trajeron la bebida",
    "tardaron muchisimo", "pesimo servicio",
  ]) eq(esQueja(f), true, `"${f}"`);
});

t("no confunde elogios con quejas", () => {
  for (const f of [
    "que rico todo, gracias", "excelente servicio", "me encanto el sushi",
    "muy buena atencion", "todo perfecto",
  ]) eq(esQueja(f), false, `"${f}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// requiereHumano: la puerta que usa el handler
// ─────────────────────────────────────────────────────────────────────────────
t("requiereHumano clasifica y nombra el motivo", () => {
  eq(requiereHumano("Maso menos cuanto falta?"), "estado_pedido");
  eq(requiereHumano("el sushi estaba frio"), "queja");
  eq(requiereHumano("cuales sushis aplican al 2x1"), null);
  eq(requiereHumano("hola"), null);
  eq(requiereHumano(""), null);
  eq(requiereHumano(null), null);
});

t("el veto gana: estado de pedido con palabra de sushi no cotiza", () => {
  // Esta es la combinación que costaba plata: tiene las dos cosas.
  const f = "ya esta lista mi orden de sushi?";
  eq(requiereHumano(f), "estado_pedido");
  eq(preguntaPorRollos2x1(f), false);
});

t("texto vacío o basura no dispara nada", () => {
  for (const f of ["", "   ", null, undefined, "???", "..."]) {
    eq(preguntaPorRollos2x1(f), false, JSON.stringify(f));
    eq(esEstadoDePedido(f), false, JSON.stringify(f));
    eq(esQueja(f), false, JSON.stringify(f));
  }
});

console.log(`\nResultado: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
