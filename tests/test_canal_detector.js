// Pruebas del detector de canal (seguro anti-silencio para IG / Messenger).
//
// Contexto (10-nov-2026): Vicente conectó Instagram y Facebook Messenger a WATI.
// La API REST de WATI NO puede mandar DM de Instagram ni mensajes de Messenger
// (su propia doc: "WhatsApp and Instagram today. TikTok and Messenger are coming
// soon" / "Not in the API yet"). sendWatiMessage además fuerza
// channelPhoneNumber:"50683436583" y hace to.replace(/\D/g,"").
//
// Entonces: si entra un DM de Instagram, el bot le intentaría mandar un WhatsApp
// a un ID de 17 dígitos → WATI lo rechaza → el cliente NO recibe nada y falla
// callado. Este detector existe para avisarle al staff en vez de perder al cliente.

const { detectarCanal, esWhatsApp } = require("../services/canalDetector");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("✅", name); pass++; }
  catch (e) { console.log("❌", name, "—", e.message); fail++; }
}
function eq(a, b) {
  if (a !== b) throw new Error(`esperado ${JSON.stringify(b)}, recibido ${JSON.stringify(a)}`);
}

// ─── WhatsApp: lo que ya funciona hoy, no se puede romper ───

t("número de Costa Rica (11 dígitos) → whatsapp", () => {
  eq(detectarCanal({ waId: "50688551308" }), "whatsapp");
});

t("payload real de Luisa (6-nov) → whatsapp", () => {
  eq(detectarCanal({ waId: "50688551308", text: "Asesor", timestamp: "1762469000" }), "whatsapp");
});

t("número de México (12 dígitos) → whatsapp", () => {
  eq(detectarCanal({ waId: "525512345678" }), "whatsapp");
});

t("número con + y espacios → whatsapp", () => {
  eq(detectarCanal({ whatsappNumber: "+506 8855-1308" }), "whatsapp");
});

t("E.164 al límite: 15 dígitos sigue siendo whatsapp", () => {
  eq(detectarCanal({ waId: "123456789012345" }), "whatsapp");
});

// ─── Sesiones demo: NO se tocan (el prefijo "demo:" trae letras y dos puntos) ───

t("sesión demo NO se confunde con otro canal", () => {
  eq(detectarCanal({ waId: "demo:abc123" }), "demo");
});

t("esWhatsApp acepta demo (el handler demo ya lo maneja aparte)", () => {
  eq(esWhatsApp("demo"), true);
});

// ─── Instagram ───

// Sin un campo explícito, el ID NO permite distinguir Instagram de Messenger
// (IGSID ~17 dígitos, PSID ~16): lo único seguro es "esto no es un teléfono".
// Por eso devuelve otro_canal y la alerta al staff dice "Instagram o Messenger".
t("ID de 17 dígitos (pasa el máximo de E.164) → otro_canal", () => {
  eq(detectarCanal({ waId: "17841400000000000" }), "otro_canal");
});

t("otro_canal NO es WhatsApp: el bot no debe intentar contestar", () => {
  eq(esWhatsApp("otro_canal"), false);
});

t("ID de Instagram CON marca de canal → instagram (para nombrarlo en la alerta)", () => {
  eq(detectarCanal({ waId: "17841400000000000", channel: "Instagram" }), "instagram");
});

// ─── Messenger ───

t("ID de Messenger (16 dígitos) con channel:messenger → messenger", () => {
  eq(detectarCanal({ waId: "9876543210987654", channel: "messenger" }), "messenger");
});

t("ID largo con channelType:FACEBOOK → messenger", () => {
  eq(detectarCanal({ waId: "9876543210987654", channelType: "FACEBOOK" }), "messenger");
});

t("ID largo con mgPhoneSource → messenger", () => {
  eq(detectarCanal({ waId: "9876543210987654", mgPhoneSource: 2 }), "messenger");
});

// ─── EL INVARIANTE: un teléfono SIEMPRE es respondible ───
// Regresión del hallazgo CRÍTICO de la revisión del 10-nov-2026. La primera
// versión miraba las marcas ANTES de la heurística de dígitos e incluía
// `source` con match por substring. En WATI `source` es el ORIGEN DEL
// CONTACTO, no el canal: los valores reales de la cuenta son "Wati",
// "WhatsApp", "CTWA" y null — y CTWA es Click-to-WhatsApp Ads, o sea anuncios
// que corren EN Instagram y Facebook. Si WATI escribiera "Instagram Ads" ahí,
// el bot se habría quedado MUDO en WhatsApp con ese cliente de forma
// permanente, con una sola alerta al staff por día. La prueba vieja de
// channelType:"FACEBOOK" sobre un número tico daba eso por correcto.

t("source:'Instagram Ads' sobre un teléfono sigue siendo whatsapp", () => {
  eq(detectarCanal({ waId: "50688551308", source: "Instagram Ads" }), "whatsapp");
});

t("source:'Facebook Ads' sobre un teléfono sigue siendo whatsapp", () => {
  eq(detectarCanal({ waId: "50688551308", source: "Facebook Ads" }), "whatsapp");
});

t("contact.source:'Instagram' sobre un teléfono sigue siendo whatsapp", () => {
  eq(detectarCanal({ waId: "50688551308", contact: { source: "Instagram" } }), "whatsapp");
});

t("ni una marca de canal explícita vence a un teléfono válido", () => {
  eq(detectarCanal({ waId: "50688551308", channel: "Instagram" }), "whatsapp");
  eq(detectarCanal({ waId: "50688551308", channelType: "FACEBOOK" }), "whatsapp");
  eq(detectarCanal({ waId: "50688551308", igPhoneSource: 1 }), "whatsapp");
  eq(detectarCanal({ waId: "50688551308", mgPhoneSource: 2 }), "whatsapp");
});

// ─── Casos raros: ante la duda NO romper WhatsApp ───

t("sin remitente → desconocido", () => {
  eq(detectarCanal({}), "desconocido");
});

t("remitente con letras y no es demo → desconocido", () => {
  eq(detectarCanal({ waId: "usuario_abc" }), "desconocido");
});

t("source:CTWA (anuncio click-to-WhatsApp) sigue siendo whatsapp", () => {
  eq(detectarCanal({ waId: "50688551308", source: "CTWA" }), "whatsapp");
});

t("source:Wati (contacto creado dentro de WATI) sigue siendo whatsapp", () => {
  eq(detectarCanal({ waId: "50661821332", source: "Wati" }), "whatsapp");
});

// ─── esWhatsApp: la puerta que decide si el bot contesta o avisa ───

t("esWhatsApp(whatsapp) = true", () => eq(esWhatsApp("whatsapp"), true));
t("esWhatsApp(instagram) = false", () => eq(esWhatsApp("instagram"), false));
t("esWhatsApp(messenger) = false", () => eq(esWhatsApp("messenger"), false));
t("esWhatsApp(desconocido) = true — ante la duda, comportamiento de hoy", () => {
  eq(esWhatsApp("desconocido"), true);
});

console.log(`\nResultado: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
