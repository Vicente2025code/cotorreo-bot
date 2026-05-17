// Test de la lógica del payload del alert de handoff.
// Sin cargar el archivo del bot — testeamos la lógica replicada.

const HANDOFF_DURATION_MS = 15 * 60 * 1000;

function buildAlertDetalle({ clientPhone, clientName, originalText }) {
  const fifteenMinFromNow = new Date(Date.now() + HANDOFF_DURATION_MS);
  const hhmm = fifteenMinFromNow.toLocaleTimeString("es-CR", {
    timeZone: "America/Costa_Rica", hour: "2-digit", minute: "2-digit", hour12: true
  });
  const phoneMasked = clientPhone ? `***${String(clientPhone).slice(-8)}` : "desconocido";
  const namePart = clientName ? `${clientName} ` : "";
  const msgPart = originalText ? ` · Mensaje: "${String(originalText).slice(0, 80)}"` : "";
  return `${namePart}(${phoneMasked})${msgPart}. Atender en WATI antes de ${hhmm}.`;
}

function parseAlertNumbers(envVar, fallback) {
  return (envVar || fallback).split(",").map(n => n.trim()).filter(Boolean);
}

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("✅", name); pass++; }
  catch (e) { console.log("❌", name, "—", e.message); fail++; }
}

t("parseAlertNumbers: CSV con 2 números", () => {
  const r = parseAlertNumbers("50663038030,50688887777", "50663038030");
  if (r.length !== 2) throw new Error(`esperado 2, recibido ${r.length}`);
  if (r[0] !== "50663038030") throw new Error("primer número incorrecto");
});

t("parseAlertNumbers: fallback si env vacía", () => {
  const r = parseAlertNumbers(undefined, "50663038030");
  if (r.length !== 1 || r[0] !== "50663038030") throw new Error("fallback no funciona");
});

t("parseAlertNumbers: ignora espacios", () => {
  const r = parseAlertNumbers(" 50663038030 , 50688887777 ", "");
  if (r[0] !== "50663038030") throw new Error("no trim");
  if (r[1] !== "50688887777") throw new Error("no trim");
});

t("alert pedido: incluye nombre, número enmascarado y hora límite", () => {
  const d = buildAlertDetalle({
    clientPhone: "50688887777",
    clientName: "Vicente",
    originalText: "Tocó '1 Menú y realizar pedido'"
  });
  if (!d.includes("Vicente")) throw new Error("falta nombre");
  if (!d.includes("***88887777")) throw new Error("teléfono mal enmascarado");
  if (!d.includes("Atender en WATI antes de")) throw new Error("falta hora límite");
});

t("alert evento: trunca mensaje a 80 chars", () => {
  const longText = "quiero hacer una fiesta súper grande para celebrar mi cumpleaños número 50 con familia, amigos del trabajo y vecinos del barrio";
  const d = buildAlertDetalle({
    clientPhone: "50699998888",
    clientName: "Carolina",
    originalText: longText
  });
  const msgMatch = d.match(/Mensaje: "(.*?)"/);
  if (!msgMatch) throw new Error("no se encontró Mensaje:");
  if (msgMatch[1].length > 80) throw new Error(`mensaje no truncado: ${msgMatch[1].length} chars`);
});

t("alert sin nombre: solo número enmascarado", () => {
  const d = buildAlertDetalle({
    clientPhone: "50611112222",
    clientName: null,
    originalText: "asesor"
  });
  if (!d.startsWith("(***")) throw new Error(`debería empezar con (***, empieza con: ${d.slice(0, 10)}`);
});

t("alert sin teléfono: usa 'desconocido'", () => {
  const d = buildAlertDetalle({
    clientPhone: null,
    clientName: "Lili",
    originalText: "asesor"
  });
  if (!d.includes("desconocido")) throw new Error("debería decir desconocido");
});

console.log(`\nResultado: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
