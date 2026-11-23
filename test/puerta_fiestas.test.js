/* Prueba la PUERTA del flujo de fiestas: que los textos que de verdad le
 * llegan al bot entren, y que los que no son de fiesta sigan sin entrar.
 *
 * De donde salen los casos: no me los invente. Son los textos exactos que
 * mandan los botones de wa.me de fiestas.grupocotorreo.com (leidos del
 * index.html del sitio) y el boton de respuesta rapida de la plantilla
 * novedad_cotorreo_v1 de WATI (leido de la API). Esa es la lista completa de
 * maneras en que alguien puede llegar a este flujo.
 *
 * El 23-nov-2026 cuatro de los siete rebotaban, incluidos los tres paquetes
 * de empresa. Esta prueba existe para que no vuelva a pasar en silencio.
 *
 *   node test/puerta_fiestas.test.js
 */
const F = require("../services/fiestasHandler");

const entra = (texto) => {
  const t = F.norm(texto);
  return (F.RE_INTENCION.test(t) || F.RE_BOTON_CAMPANA.test(t.trim())) ||
         (F.RE_AMBIGUA.test(t) && F.RE_APOYO.test(t));
};

const DEBEN_ENTRAR = [
  ["boton de la campana de WhatsApp", "Quiero información"],
  ["landing · boton grande", "Hola, quiero armar una fiesta. ¿Qué fechas tienen?"],
  ["landing · Cierre de Ano", "Hola, quiero info del Cierre de Año para mi empresa"],
  ["landing · Torneo de Cierre", "Hola, quiero info del Torneo de Cierre"],
  ["landing · Brindis", "Hola, quiero info del Brindis"],
  ["landing · fin de curso", "Hola, quiero info para una fiesta de fin de curso"],
  ["landing · generico", "Hola, quiero info de las fiestas"],
  // Como lo escribe la gente de verdad, no como lo manda un boton.
  ["a mano, sin tildes", "quiero info del cierre de ano"],
  ["a mano, cumpleanos", "hola, es para un cumpleaños de mi hijo"],
  ["ambigua + apoyo", "quiero un paquete para la oficina"],
];

// Lo que NO debe entrar: si entra, un cliente que pedia otra cosa termina
// contestando preguntas de fiesta.
const NO_DEBEN_ENTRAR = [
  ["pedido normal", "quiero una parrillada"],
  ["reserva de cancha", "quiero reservar una cancha de padel"],
  ["torneo de padel de verdad", "a que hora es el torneo del sabado"],
  ["info de otra cosa", "quiero informacion de las canchas"],
  ["paquete de sushi", "cuanto vale el paquete de 20 piezas"],
  ["horario", "a que hora abren hoy"],
];

let fallos = 0;
console.log("-- deben ENTRAR al flujo de fiestas");
for (const [de, txt] of DEBEN_ENTRAR) {
  const ok = entra(txt);
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${de.padEnd(32)} "${txt}"`);
}
console.log("\n-- NO deben entrar");
for (const [de, txt] of NO_DEBEN_ENTRAR) {
  const ok = !entra(txt);
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${de.padEnd(32)} "${txt}"`);
}

const total = DEBEN_ENTRAR.length + NO_DEBEN_ENTRAR.length;
console.log(`\n${total - fallos}/${total} casos bien`);
process.exit(fallos ? 1 : 0);
