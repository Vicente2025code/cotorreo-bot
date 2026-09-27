// Barrido de cobertura: genera formas realistas de pedir CADA platillo del
// menú y mide cuáles el buscador no encuentra. La idea es no depender de que
// alguien tropiece con el caso en producción.
//
//   node tests/cobertura_menu.js          resumen + fallas
//   node tests/cobertura_menu.js --todo   además lista los OK
const fs = require("fs");
const path = require("path");
const { crearBuscador, normalizarPlato } = require("../services/catalogoBuscador");

const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const CATEGORIAS = eval(src.match(/const PLAZA_MENU_CATEGORIES = (\[[\s\S]*?\n\]);/)[1]);
const P = crearBuscador(CATEGORIAS);

// Palabra de categoría que el cliente suele anteponer. Sirve para desbloquear
// los nombres genéricos ("Pollo" el taco) y para sonar a pedido real.
const PREFIJO_CATEGORIA = {
  "Tacos Mexicanos": "tacos de",
  "Pizzas": "pizza de",
  "Sushi Crudo": "",
  "Sushi Cocido": "",
  "Menú Infantil": "",
  "Menú Ejecutivo": ""
};

function typo(s) {
  // cambia una letra del medio de la palabra más larga: simula dedo gordo
  const ws = s.split(" ");
  let i = 0;
  ws.forEach((w, k) => { if (w.length > ws[i].length) i = k; });
  const w = ws[i];
  if (w.length < 5) return s;
  const p = Math.floor(w.length / 2);
  ws[i] = w.slice(0, p) + (w[p] === "a" ? "e" : "a") + w.slice(p + 1);
  return ws.join(" ");
}

function frases(nombre, categoria) {
  const limpio = nombre.replace(/\(.*?\)/g, "").trim();
  const pre = PREFIJO_CATEGORIA[categoria] === undefined ? "" : PREFIJO_CATEGORIA[categoria];
  const conPre = pre ? `${pre} ${limpio}` : limpio;
  return [
    `tienen ${conPre}?`,
    `quiero ${conPre}`,
    `me das ${conPre} porfa`,
    `cuanto vale ${conPre}`,
    `${conPre} para llevar`,
    `2 ${conPre}`,
    `hay ${conPre}`,
    `${conPre}`,
    `buenas, me preparan ${conPre}`,
    `${conPre.toUpperCase()}`,
    `quiero ${typo(conPre)}`,                       // con typo
    `${conPre.normalize("NFD").replace(/[̀-ͯ]/g, "")}`  // sin tildes
  ];
}

const soloTodo = process.argv.includes("--todo");
let total = 0, ok = 0;
const fallasPorPlato = [];

for (const cat of CATEGORIAS) {
  for (const item of cat.items) {
    const fallas = [];
    let aciertos = 0;
    for (const f of frases(item.name, cat.label)) {
      total++;
      const hits = P.buscarPlatillos(f).map((h) => h.nombre);
      if (hits.includes(item.name)) { ok++; aciertos++; }
      else fallas.push({ f, hits });
    }
    if (fallas.length) fallasPorPlato.push({ item: item.name, cat: cat.label, fallas, aciertos });
    else if (soloTodo) console.log(`  OK  ${item.name}`);
  }
}

console.log("=".repeat(78));
console.log(`COBERTURA: ${ok}/${total} frases (${(100 * ok / total).toFixed(1)}%)`);
console.log(`platillos con alguna falla: ${fallasPorPlato.length} de ` +
            CATEGORIAS.reduce((a, c) => a + c.items.length, 0));
console.log("=".repeat(78));

// ordenar: los que fallan más, primero
fallasPorPlato.sort((a, b) => b.fallas.length - a.fallas.length);
for (const p of fallasPorPlato) {
  console.log(`\n${p.item}  [${p.cat}]  — falla ${p.fallas.length}/12`);
  for (const f of p.fallas.slice(0, 4)) {
    console.log(`    "${f.f}"  ->  ${f.hits.join(", ") || "(nada)"}`);
  }
  if (p.fallas.length > 4) console.log(`    ... y ${p.fallas.length - 4} más`);
}

// --- falsos positivos: mensajes que NO son pedidos de comida ---
const NO_COMIDA = [
  "a que hora abren", "donde estan ubicados", "tienen parqueo",
  "quiero reservar cancha de padel", "cuanto cuesta la cancha",
  "gracias, buenas noches", "hola buenas", "me pasan la ubicacion",
  "hacen eventos de cumpleaños", "tienen wifi", "aceptan tarjeta",
  "a que hora cierran hoy", "necesito hablar con un asesor",
  "cuanto es el delivery", "tienen musica en vivo"
];
console.log("\n" + "=".repeat(78));
console.log("FALSOS POSITIVOS (mensajes que no piden comida)");
console.log("=".repeat(78));
let fp = 0;
for (const m of NO_COMIDA) {
  const hits = P.buscarPlatillos(m).map((h) => h.nombre);
  if (hits.length) { fp++; console.log(`  FALSO  "${m}" -> ${hits.join(", ")}`); }
}
console.log(fp === 0 ? `  ninguno en ${NO_COMIDA.length} mensajes` : `  ${fp} falsos positivos`);
