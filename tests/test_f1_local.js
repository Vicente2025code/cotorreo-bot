// Test local de las funciones clave de F1 — sin tocar WATI ni Redis.
// Correr con: node test_f1_local.js

// Mock minimal del entorno para que index.js cargue sin crashear
process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "fake";

// Stub de Redis para no llamar a la red
require.cache[require.resolve("@upstash/redis")] = {
  exports: {
    Redis: class { async get() { return null; } async set() { return null; } }
  }
};

// Extraemos las funciones directo del archivo sin levantar el servidor
const fs = require("fs");
const src = fs.readFileSync("./index.js", "utf8");

// Aislamos solo las funciones puras que queremos probar
const slice = src.slice(
  src.indexOf("function hasActiveUserFlow"),
  src.indexOf("function getMenuPrincipalText")
);
const getPlazaSliceStart = src.indexOf("function getPlazaSchedule");
const getPlazaSliceEnd = src.indexOf("function getMenuPrincipalText", getPlazaSliceStart);
const plazaSlice = src.slice(getPlazaSliceStart, getPlazaSliceEnd);

eval(slice);
eval(plazaSlice);

// ───────────── tests ─────────────
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("✅", name); pass++; }
  catch (e) { console.log("❌", name, "—", e.message); fail++; }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`esperado ${JSON.stringify(b)}, recibido ${JSON.stringify(a)} ${msg||""}`);
}

const profile = { name: "Liliana" };

// F1.1 — hasActiveUserFlow
t("PLAZA_MENU_CATEGORIES cuenta como flujo activo (antes no)", () => {
  eq(hasActiveUserFlow("PLAZA_MENU_CATEGORIES", profile), true);
});
t("CAT_SUSHI_CRUDO cuenta como flujo activo (antes no)", () => {
  eq(hasActiveUserFlow("CAT_SUSHI_CRUDO", profile), true);
});
t("PLAZA_MENU cuenta como flujo activo", () => {
  eq(hasActiveUserFlow("PLAZA_MENU", profile), true);
});
t("MENU_PRINCIPAL NO cuenta como flujo activo (correcto)", () => {
  eq(hasActiveUserFlow("MENU_PRINCIPAL", profile), false);
});
t("Sin nombre cuenta como flujo activo (onboarding)", () => {
  eq(hasActiveUserFlow("MENU_PRINCIPAL", {}), true);
});

// F1.1 — matchesCurrentFlowIntent
t("matchesCurrentFlowIntent acepta '10' (BUG ANTERIOR)", () => {
  eq(matchesCurrentFlowIntent("10"), true);
});
t("matchesCurrentFlowIntent acepta '11' (BUG ANTERIOR)", () => {
  eq(matchesCurrentFlowIntent("11"), true);
});
t("matchesCurrentFlowIntent acepta '8' (BUG ANTERIOR)", () => {
  eq(matchesCurrentFlowIntent("8"), true);
});
t("matchesCurrentFlowIntent acepta '18'", () => {
  eq(matchesCurrentFlowIntent("18"), true);
});
t("matchesCurrentFlowIntent rechaza '100' (>2 dígitos, va a IA)", () => {
  eq(matchesCurrentFlowIntent("100"), false);
});
t("matchesCurrentFlowIntent rechaza 'hola que tal' (frase libre, va a IA)", () => {
  eq(matchesCurrentFlowIntent("hola que tal"), false);
});
t("matchesCurrentFlowIntent acepta 'hola'", () => {
  eq(matchesCurrentFlowIntent("hola"), true);
});
t("matchesCurrentFlowIntent acepta 'carrito'", () => {
  eq(matchesCurrentFlowIntent("carrito"), true);
});

// F1.7 — getPlazaSchedule + getClosedNotice
t("getPlazaSchedule retorna estructura válida", () => {
  const s = getPlazaSchedule();
  if (typeof s.isOpen !== "boolean") throw new Error("isOpen no es boolean");
  if (typeof s.openHour !== "number") throw new Error("openHour no es number");
});
t("getClosedNotice vacío si abierto, texto si cerrado", () => {
  const n = getClosedNotice();
  if (n === "") { console.log("   (ahora Plaza está abierto, notice vacío)"); }
  else { if (!n.includes("cerrado")) throw new Error("notice sin palabra 'cerrado'"); }
});

console.log(`\nResultado: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
