// Tests para F1.4 — payload de Interactive Buttons + lectura de buttonReply.
// No hace llamadas reales a WATI.

const fs = require("fs");
const src = fs.readFileSync("./index.js", "utf8");

// normalizeWatiPayload depende de textoDeBotonAId, que traduce la etiqueta
// de un botón ("🎾 Jugar pádel") a su id cuando WATI la manda como texto plano.
eval(src.match(/const MENU_PRINCIPAL_BUTTONS = \[[\s\S]*?\];/)[0].replace("const ", "var "));
eval(src.match(/function textoDeBotonAId[\s\S]*?return null;\s*\}/)[0]);

// Aislar normalizeWatiPayload
const normalizeStart = src.indexOf("function normalizeWatiPayload");
const normalizeEnd = src.indexOf("// =====", normalizeStart);
eval(src.slice(normalizeStart, normalizeEnd));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("✅", name); pass++; }
  catch (e) { console.log("❌", name, "—", e.message); fail++; }
}
function eq(a, b) { if (a !== b) throw new Error(`esperado ${JSON.stringify(b)}, recibido ${JSON.stringify(a)}`); }

// normalizeWatiPayload con buttonReply
t("normalizeWatiPayload lee buttonReply.id (WATI shape simple)", () => {
  const r = normalizeWatiPayload({
    from: "50688887777",
    buttonReply: { id: "1", title: "🍽️ Comer en Plaza" }
  });
  eq(r.rawText, "1");
});

t("normalizeWatiPayload lee interactive.button_reply.id (WhatsApp Cloud API shape)", () => {
  const r = normalizeWatiPayload({
    from: "50688887777",
    messages: [{
      interactive: { button_reply: { id: "2", title: "🎾 Jugar pádel" } }
    }]
  });
  eq(r.rawText, "2");
});

t("normalizeWatiPayload lee interactive.list_reply.id (List Message)", () => {
  const r = normalizeWatiPayload({
    from: "50688887777",
    messages: [{
      interactive: { list_reply: { id: "3", title: "Hablar con asesor" } }
    }]
  });
  eq(r.rawText, "3");
});

t("normalizeWatiPayload: buttonReply tiene prioridad sobre text crudo", () => {
  const r = normalizeWatiPayload({
    from: "50688887777",
    text: "texto que el usuario tipeó",
    buttonReply: { id: "1", title: "Opción 1" }
  });
  eq(r.rawText, "1");
});

t("normalizeWatiPayload: si no hay botón, usa text normal", () => {
  const r = normalizeWatiPayload({
    from: "50688887777",
    text: "hola"
  });
  eq(r.rawText, "hola");
});

// Validar shape del payload de Interactive Buttons (replica lógica)
function buildInteractivePayload({ header, body, footer, buttons }) {
  return {
    header: { type: "Text", text: String(header || "").slice(0, 60) },
    body: String(body || "").slice(0, 1024),
    footer: footer ? String(footer).slice(0, 60) : undefined,
    buttons: buttons.map(b => ({
      id: String(b.id),
      text: String(b.text).slice(0, 20)
    }))
  };
}

t("payload interactive: trunca header a 60 chars", () => {
  const p = buildInteractivePayload({
    header: "X".repeat(100),
    body: "test",
    buttons: [{ id: "1", text: "ok" }]
  });
  if (p.header.text.length !== 60) throw new Error(`header debería ser 60, es ${p.header.text.length}`);
});

t("payload interactive: trunca botón a 20 chars", () => {
  const p = buildInteractivePayload({
    header: "h",
    body: "b",
    buttons: [{ id: "1", text: "X".repeat(50) }]
  });
  if (p.buttons[0].text.length !== 20) throw new Error(`botón debería ser 20, es ${p.buttons[0].text.length}`);
});

t("payload interactive: header/body/buttons presentes", () => {
  const p = buildInteractivePayload({
    header: "🏢 Grupo Cotorreo",
    body: "¿Qué te late?",
    buttons: [
      { id: "1", text: "🍽️ Comer" },
      { id: "2", text: "🎾 Pádel" },
      { id: "3", text: "👤 Asesor" }
    ]
  });
  if (p.header.type !== "Text") throw new Error("type debe ser Text");
  if (p.buttons.length !== 3) throw new Error("deberían ser 3 botones");
  if (p.buttons[0].id !== "1") throw new Error("id mal");
});

// ─── Toque de botón que llega como TEXTO PLANO (medido 27-sep-2026) ───
// WATI a veces no manda el shape de botón sino la etiqueta. Antes el bot se
// quedaba mudo: 5 toques sin respuesta, 3 de ellos "Hablar asesor", o sea
// clientes pidiendo un humano sin que se disparara la alerta al staff.
t("botón como texto plano: '👤 Hablar asesor' → '3'", () => {
  const r = normalizeWatiPayload({ waId: "506", text: "👤 Hablar asesor" });
  if (r.rawText !== "3") throw new Error("dio " + JSON.stringify(r.rawText));
});

t("botón como texto plano: '🎾 Jugar pádel' → '2'", () => {
  const r = normalizeWatiPayload({ waId: "506", text: "🎾 Jugar pádel" });
  if (r.rawText !== "2") throw new Error("dio " + JSON.stringify(r.rawText));
});

t("botón como texto plano: '🍽️ Comer en Plaza' → '1'", () => {
  const r = normalizeWatiPayload({ waId: "506", text: "🍽️ Comer en Plaza" });
  if (r.rawText !== "1") throw new Error("dio " + JSON.stringify(r.rawText));
});

t("texto normal NO se confunde con un botón", () => {
  const r = normalizeWatiPayload({ waId: "506", text: "quiero jugar padel el sabado" });
  if (r.rawText !== "quiero jugar padel el sabado") throw new Error("dio " + r.rawText);
});

console.log(`\nResultado: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
