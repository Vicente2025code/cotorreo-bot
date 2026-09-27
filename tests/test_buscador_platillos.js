// Prueba del buscador de platillos contra los mensajes REALES que el bot
// falló el 27-sep-2026, más casos de control que NO deben matchear.
const fs = require("fs");
const path = require("path");
const { crearBuscador } = require("../services/catalogoBuscador");

// El catálogo vive dentro de index.js, que levanta el servidor al requerirlo.
// Lo extraemos como dato, sin ejecutar el módulo.
const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const bloque = src.match(/const PLAZA_MENU_CATEGORIES = (\[[\s\S]*?\n\]);/)[1];
const CATEGORIAS = eval(bloque);

const {
  buscarPlatillos, respuestaPlatillos, niegaPlatilloReal, contextoPlatillos, _catalogo
} = crearBuscador(CATEGORIAS);

let fallos = 0;
const nombres = (t) => buscarPlatillos(t).map((h) => h.nombre);

function debe(texto, esperados) {
  const hits = nombres(texto);
  const ok = esperados.length === hits.length &&
             esperados.every((e) => hits.includes(e));
  if (!ok) fallos++;
  console.log(`  ${ok ? "OK   " : "FALLA"} ${JSON.stringify(texto).slice(0, 72)}`);
  if (!ok) {
    console.log(`         esperado: ${esperados.join(", ") || "(nada)"}`);
    console.log(`         obtenido: ${hits.join(", ") || "(nada)"}`);
  }
}
const noDebe = (t) => debe(t, []);

console.log(`catálogo cargado: ${_catalogo.length} platillos\n`);

console.log("=== LOS CASOS REALES QUE EL BOT FALLÓ (27-sep-2026) ===");
debe("Pueden preparme un duo coreano y una orden de California rolls? Yo llego a recoger",
     ["California Roll (10 pzas)", "Duo coreano"]);
// la clienta escribió "delitos" por "deditos": typo real
debe("Buenas para ordenar unos delitos de pollo con papitas con exprés y que no estén picantes es para niños",
     ["Dedos de pollo"]);

console.log("\n=== OTRAS FORMAS DE PEDIR LO MISMO ===");
debe("tienen deditos de pollo?", ["Dedos de pollo"]);
debe("quiero un california roll", ["California Roll (10 pzas)"]);
debe("me das 2 quesabirrias", ["Quesabirrias"]);
debe("una pizza pepperoni familiar porfa", ["Pepperoni Familiar"]);
debe("hay chifrijo?", ["Chifrijo"]);
debe("cuanto vale el ramen tonkotsu", ["Ramen tonkotsu"]);
debe("un arroz con camarones y un ceviche peruano",
     ["Arroz con camarones", "Ceviche peruano"]);
debe("tacos de pastor", ["Pastor"]);
debe("salchipapas para llevar", ["Salchipapas"]);
debe("me mandas un molcajete", ["Molcajete"]);
debe("tienen caterpillar roll?", ["Caterpillar Roll (10 pzas)"]);

console.log("\n=== NO DEBEN MATCHEAR (control) ===");
noDebe("a que hora abren");
noDebe("quiero reservar cancha de padel");
noDebe("me pasas la ubicacion");
noDebe("gracias, buenas noches");
noDebe("tienen pollo?");            // sin "taco" es demasiado genérico
noDebe("cuanto cuesta el parqueo");

console.log("\n=== RED DE SEGURIDAD: cazar que la IA negó algo real ===");
const hitsDaya = buscarPlatillos("duo coreano y California rolls");
function chk(desc, cond) {
  if (!cond) fallos++;
  console.log(`  ${cond ? "OK   " : "FALLA"} ${desc}`);
}
chk("detecta la negación falsa de Daya", niegaPlatilloReal(
  "No tenemos *Duo Coreano* ni *California Rolls* para llevar. 🥺 Pero podés ver el menú.",
  hitsDaya));
chk("detecta la negación falsa de Ele", niegaPlatilloReal(
  "Por el momento no tenemos *dedos de pollo* en el menú, pero sí tenemos Chicken Burger.",
  buscarPlatillos("deditos de pollo")));
chk("NO se activa cuando el bot recomienda tras un \"pero\"", !niegaPlatilloReal(
  "No tenemos fajitas empanizadas, pero sí tenemos *Fajitas mar y tierra*.",
  buscarPlatillos("fajitas mar y tierra")));
chk("NO se activa en una respuesta normal", !niegaPlatilloReal(
  "¡Claro! El California Roll cuesta ₡3.000 😊", hitsDaya));

console.log("\n=== LO QUE SE LE INYECTA A LA IA ===");
console.log("  " + contextoPlatillos(hitsDaya));
console.log("\n=== RESPUESTA DE RESPALDO SI LA IA IGUAL NIEGA ===");
console.log(respuestaPlatillos(hitsDaya));

console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLAS"}`);
process.exit(fallos === 0 ? 0 : 1);
