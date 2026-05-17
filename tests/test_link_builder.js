// Test del builder de URLs de reservas (nuevo cambio).
// Correr con: node test_link_builder.js

const fs = require("fs");
const src = fs.readFileSync("./index.js", "utf8");
const start = src.indexOf("const RESERVAS_APP_URL");
const end = src.indexOf("function getCategoryByKey", start) || src.indexOf("// (Categorías", start);
eval(src.slice(start, end));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("✅", name); pass++; }
  catch (e) { console.log("❌", name, "—", e.message); fail++; }
}
function eq(a, b) { if (a !== b) throw new Error(`esperado ${JSON.stringify(b)}, recibido ${JSON.stringify(a)}`); }

t("alpadel + tel numérico → link completo", () => {
  eq(
    buildReservasLink("alpadel", "50688887777"),
    "https://cotorreo-app.onrender.com/cliente.html?tipo=alpadel&tel=50688887777"
  );
});
t("cotorreo + tel con formato WATI (con +) → solo dígitos", () => {
  eq(
    buildReservasLink("cotorreo", "+506 8888 7777"),
    "https://cotorreo-app.onrender.com/cliente.html?tipo=cotorreo&tel=50688887777"
  );
});
t("ambiguo (sin tipo) + tel → solo ?tel", () => {
  eq(
    buildReservasLink(null, "50688887777"),
    "https://cotorreo-app.onrender.com/cliente.html?tel=50688887777"
  );
});
t("sin tipo y sin tel → URL pelada", () => {
  eq(buildReservasLink(null, null), "https://cotorreo-app.onrender.com/cliente.html");
});
t("tel inválido (corto) → omite ?tel", () => {
  eq(buildReservasLink("alpadel", "123"), "https://cotorreo-app.onrender.com/cliente.html?tipo=alpadel");
});
t("alpadel + tel con espacios y guiones", () => {
  eq(
    buildReservasLink("alpadel", "506-8888-7777"),
    "https://cotorreo-app.onrender.com/cliente.html?tipo=alpadel&tel=50688887777"
  );
});

console.log(`\nResultado: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
