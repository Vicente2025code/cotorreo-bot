/* El flujo de fiestas de punta a punta, con las interrupciones que de verdad
 * hace la gente.
 *
 *   node test/flujo_fiestas.test.js
 *
 * Los casos salen de lo que encontro Liliana el 23-nov-2026 probando el bot:
 * escribio "Me pasa el menú" y la ignoro, escribio "Menú" y le BORRO la
 * cotizacion a medias, y a "¿Qué fechas tienen?" contesto con otra pregunta.
 */
const F = require("../services/fiestasHandler");
const { idDeBoton } = require("../services/leerBoton");

let fallos = 0;
const mem = new Map();
const redis = {
  get: async (k) => mem.get(k) ?? null,
  set: async (k, v) => { mem.set(k, v); },
  del: async (k) => { mem.delete(k); },
  setex: async (k, s, v) => { mem.set(k, v); },
};

let salidas = [];
const enviar = async (to, m) => { salidas.push(m); };

async function paso(texto, { continuar = true, esBoton = false } = {}) {
  salidas = [];
  const r = await F.handle({
    from: "50600000001", rawText: texto, profile: { name: "Juan" },
    continuar, esBoton, redis, sendWatiMessage: enviar,
    notifyHandoffAlert: async () => {}, logEvent: () => {},
  });
  return { ...r, msg: salidas.join("\n") };
}

const ok = (que, cond) => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "ok  " : "FALLA"}  ${que}`);
};

(async () => {
  console.log("-- entra por el botón de la campaña");
  const webhook = { buttonReply: { payload: '{"ButtonIndex":0}', text: "Quiero información" } };
  let r = await paso(idDeBoton(webhook), { continuar: false, esBoton: true });
  ok("lo atiende el flujo de fiestas", r.handled && r.dentro);
  ok("saluda por el nombre", /Qué bueno, Juan/.test(r.msg));
  ok("NO le pregunta el tipo: ya sabemos que es de empresa",
     !/tipo de fiesta/.test(r.msg));
  ok("arranca pidiendo cuántas personas", /cuántas personas/.test(r.msg));

  console.log("\n-- el cliente interrumpe con preguntas (caso Liliana)");
  r = await paso("Me pasa el menú");
  ok('"Me pasa el menú" manda el link, ya no lo ignora', /linktr\.ee/.test(r.msg));
  ok("y vuelve a preguntar lo pendiente", /cuántas personas/.test(r.msg));

  r = await paso("¿qué fechas tienen?");
  ok('"¿qué fechas tienen?" se CONTESTA', /todos los días/.test(r.msg));
  ok("y repite la pendiente", /cuántas personas/.test(r.msg));

  r = await paso("y cuanto vale?");
  ok("da los tres precios", /Brindis/.test(r.msg) && /Torneo de Cierre/.test(r.msg));
  ok("con el formato de la casa, ₡7.900 y no ₡7 900", /₡7\.900/.test(r.msg));

  console.log("\n-- lo que antes BORRABA la cotización");
  r = await paso("somos 20");
  ok("anota las 20 personas", /20 personas/.test(r.msg));
  r = await paso("menú");
  ok('"menú" a secas ya NO saca del flujo', r.dentro === true);
  ok("manda el menú", /linktr\.ee/.test(r.msg));
  ok("🔴 y NO perdió las 20 personas", /20 personas/.test(r.msg));

  console.log("\n-- las salidas de verdad siguen sacando");
  r = await paso("asesor");
  ok('"asesor" sí sale del flujo', r.salir === true);

  console.log("\n-- y la cotización completa sigue llegando");
  mem.clear();
  await paso("quiero info del Cierre de Año para mi empresa", { continuar: false });
  await paso("20");
  await paso("el 12 de diciembre");
  r = await paso("en las canchas");
  ok("cierra con la cotización", /Cierre de Año/.test(r.msg) && /Total con IVA/.test(r.msg));
  ok("aplica el recargo de fin de semana (12-dic-2026 es sábado)",
     /recargo/.test(r.msg));
  ok("sale del flujo al cotizar", r.dentro === false);

  console.log(fallos ? `\n${fallos} FALLOS` : "\ntodo bien");
  process.exit(fallos ? 1 : 0);
})();
