/* Que cada alerta le llegue a quien le toca y a nadie mas.
 *
 *   node test/ruta_alertas.test.js
 */
const { construir } = require("../services/rutaAlertas");

const LILI = "50660127557";
const VICENTE = "50672882394";
const MARIELA = "50686956389";
const KATI = "50672962242";
// El telefono compartido del local, "Cotorreo Plaza" en WATI. Tiene WhatsApp:
// comprobado el 24-nov-2026, leyo 10 de 10 notificaciones del 21 al 23-nov.
const PISO = "50663038030";

const ENV = {
  HANDOFF_ALERT_NUMBERS: [LILI, VICENTE, MARIELA, KATI].join(","),
  ALERTA_FIESTAS_NUMEROS: [MARIELA, KATI, VICENTE].join(","),
  ALERTA_OPERACION_NUMEROS: [LILI, VICENTE].join(","),
  ALERTA_PISO_NUMEROS: PISO,
};

let fallos = 0;
const igual = (que, dio, esperado) => {
  const ok = JSON.stringify([...dio].sort()) === JSON.stringify([...esperado].sort());
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${que}`);
  if (!ok) console.log(`          dio ${dio}\n          esperaba ${esperado}`);
};

console.log("-- con las dos variables puestas");
let r = construir(ENV);
igual("cotizacion de fiesta -> Mariela, Kati, Vicente",
      r.destinatarios("fiestas"), [MARIELA, KATI, VICENTE]);
igual("pregunta por un pedido -> Lili y Vicente",
      r.destinatarios("operacion"), [LILI, VICENTE]);
igual("grupo desconocido cae en operacion",
      r.destinatarios("loquesea"), [LILI, VICENTE]);
igual("sin grupo cae en operacion",
      r.destinatarios(), [LILI, VICENTE]);

// Lo que de verdad pedia Vicente: que a Kati no le llegue lo de operacion.
const op = r.destinatarios("operacion");
const kati_fuera = !op.includes(KATI);
if (!kati_fuera) fallos++;
console.log(`  ${kati_fuera ? "ok  " : "FALLA"}  Kati NO recibe alertas de operación`);
const kati_dentro = r.destinatarios("fiestas").includes(KATI);
if (!kati_dentro) fallos++;
console.log(`  ${kati_dentro ? "ok  " : "FALLA"}  Kati SÍ recibe las de cotización`);

console.log("\n-- nivel rapido: va SOLO al telefono del piso (24-nov-2026)");
igual("cliente esperando 5 min -> solo el telefono del local",
      r.destinatarios("piso"), [PISO]);
const piso = r.destinatarios("piso");
for (const [quien, num] of [["Vicente", VICENTE], ["Mariela", MARIELA], ["Liliana", LILI]]) {
  const fuera = !piso.includes(num);
  if (!fuera) fallos++;
  console.log(`  ${fuera ? "ok  " : "FALLA"}  ${quien} NO recibe la alerta de 5 min`);
}

// 🔴 Si el telefono del piso NO estuviera en todoElStaff, el vigilante trataria
// las notificaciones que le manda el propio bot como "un cliente esperando" y
// se perseguiria a si mismo.
igual("el vigilante excluye a todo el staff, incluido el telefono del piso",
      r.todoElStaff, [LILI, VICENTE, MARIELA, KATI, PISO]);

console.log("\n-- si manana se agrega un grupo nuevo y nadie toca todoElStaff");
const conNuevo = construir({ ...ENV, ALERTA_COCINA_NUMEROS: "50611112222" });
const sigueCompleto = conNuevo.todoElStaff.includes(PISO);
if (!sigueCompleto) fallos++;
console.log(`  ${sigueCompleto ? "ok  " : "FALLA"}  todoElStaff se arma de los grupos, no de una lista a mano`);

console.log("\n-- sin la variable del piso, el rapido no se queda sin destino");
const sinPiso = construir({
  HANDOFF_ALERT_NUMBERS: [LILI, VICENTE].join(","),
  ALERTA_OPERACION_NUMEROS: [LILI].join(","),
});
igual("cae en la lista vieja, no en vacio", sinPiso.destinatarios("piso"), [LILI, VICENTE]);

console.log("\n-- red de seguridad: si alguien borra las variables de grupo");
r = construir({ HANDOFF_ALERT_NUMBERS: [LILI, VICENTE].join(",") });
igual("fiestas cae en la lista vieja", r.destinatarios("fiestas"), [LILI, VICENTE]);
igual("operacion cae en la lista vieja", r.destinatarios("operacion"), [LILI, VICENTE]);

console.log("\n-- y si no hay NINGUNA variable, queda el default historico");
r = construir({});
igual("default = Liliana", r.destinatarios("fiestas"), [LILI]);

console.log(fallos ? `\n${fallos} FALLOS` : "\ntodo bien");
process.exit(fallos ? 1 : 0);
