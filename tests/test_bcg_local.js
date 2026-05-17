// Tests locales para B (promo del día), G (auto-nombre del payload).
// El interceptor de eventos (C) es lógica de webhook que se valida en producción.

const fs = require("fs");
const src = fs.readFileSync("./index.js", "utf8");

// Aislar funciones relevantes
const helpersStart = src.indexOf("function getPlazaSchedule");
const helpersEnd = src.indexOf("function getReservationDraft");
eval(src.slice(helpersStart, helpersEnd));

const normalizeStart = src.indexOf("function normalizeWatiPayload");
const normalizeEnd = src.indexOf("// =====", normalizeStart);
eval(src.slice(normalizeStart, normalizeEnd));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("✅", name); pass++; }
  catch (e) { console.log("❌", name, "—", e.message); fail++; }
}
function eq(a, b) { if (a !== b) throw new Error(`esperado ${JSON.stringify(b)}, recibido ${JSON.stringify(a)}`); }

// B — Promo del día
t("getPromoDelDia retorna string no vacío para cualquier día", () => {
  const p = getPromoDelDia();
  if (typeof p !== "string" || p.length === 0) throw new Error("vacío o no-string");
});
t("getPromoNotice vacío si plaza está cerrada", () => {
  // No podemos forzar hora, pero el código lo gobierna. Validamos lógica:
  const notice = getPromoNotice();
  // si está abierto debe tener promo, si está cerrado debe ser ""
  const isOpen = getPlazaSchedule().isOpen;
  if (isOpen) {
    if (!notice.includes("Hoy")) throw new Error("debería traer 'Hoy:' si está abierto");
  } else {
    if (notice !== "") throw new Error(`esperado "" cuando cerrado, recibido ${JSON.stringify(notice)}`);
  }
});
// G — Auto-nombre del payload
t("normalizeWatiPayload lee senderName", () => {
  const r = normalizeWatiPayload({ senderName: "Liliana", from: "50688887777" });
  eq(r.senderName, "Liliana");
});
t("normalizeWatiPayload lee contact.profile.name (WhatsApp Cloud API)", () => {
  const r = normalizeWatiPayload({
    contacts: [{ profile: { name: "Mariela Garcia" } }],
    waId: "50688887777"
  });
  eq(r.senderName, "Mariela Garcia");
});
t("normalizeWatiPayload sin nombre retorna null", () => {
  const r = normalizeWatiPayload({ from: "50688887777", text: "hola" });
  eq(r.senderName, null);
});

console.log(`\nResultado: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
