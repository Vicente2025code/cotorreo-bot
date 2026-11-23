/* Que cada alerta le llegue a quien le toca y a nadie mas.
 *
 *   node test/ruta_alertas.test.js
 */
const { construir } = require("../services/rutaAlertas");

const LILI = "50660127557";
const VICENTE = "50672882394";
const MARIELA = "50686956389";
const KATI = "50672962242";

const ENV = {
  HANDOFF_ALERT_NUMBERS: [LILI, VICENTE, MARIELA, KATI].join(","),
  ALERTA_FIESTAS_NUMEROS: [MARIELA, KATI, VICENTE].join(","),
  ALERTA_OPERACION_NUMEROS: [LILI, VICENTE].join(","),
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

igual("el vigilante excluye a todo el staff, de los dos grupos",
      r.todoElStaff, [LILI, VICENTE, MARIELA, KATI]);

console.log("\n-- red de seguridad: si alguien borra las variables de grupo");
r = construir({ HANDOFF_ALERT_NUMBERS: [LILI, VICENTE].join(",") });
igual("fiestas cae en la lista vieja", r.destinatarios("fiestas"), [LILI, VICENTE]);
igual("operacion cae en la lista vieja", r.destinatarios("operacion"), [LILI, VICENTE]);

console.log("\n-- y si no hay NINGUNA variable, queda el default historico");
r = construir({});
igual("default = Liliana", r.destinatarios("fiestas"), [LILI]);

console.log(fallos ? `\n${fallos} FALLOS` : "\ntodo bien");
process.exit(fallos ? 1 : 0);
