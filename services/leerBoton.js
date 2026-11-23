/* Saca de un webhook de WATI lo que el cliente de verdad toco.
 *
 * 🔴 23-nov-2026, caso Juan Ramirez. Recibio la campana de cierres de ano,
 * toco el boton "Quiero información" y el bot le contesto con la promo de
 * tacos del lunes. El log lo dijo todo:
 *
 *   ✅ Button reply parseado, id: {"ButtonIndex":0,...,"QuickReplyIndex":0}
 *   AI candidate: {"buttonindex":0,"carouselcardindex":null,...}
 *   ai_fallback_triggered
 *
 * El bot le estaba pasando ESE BLOQUE DE JSON al cerebro como si fuera el
 * mensaje del cliente. Hay dos clases de boton y no son lo mismo:
 *
 *   - Los que manda el PROPIO bot (interactiveButtonReply): su payload es un
 *     id util, "1" / "2" / "3", y los handlers numerados dependen de el.
 *   - Los de PLANTILLA aprobada por Meta (buttonReply, respuesta rapida): su
 *     payload son indices de posicion en JSON, no significan nada. Las
 *     palabras que la persona ve y toca vienen en .text.
 *
 * Por eso no basta con invertir el orden: hay que descartar el payload solo
 * cuando es el JSON de WATI, y quedarse con el texto en ese caso.
 *
 * Vive aparte de index.js para poder probarlo contra payloads reales.
 */

// Un payload sirve como id si NO es el bloque JSON de WATI.
const payloadServible = (p) => {
  const s = String(p == null ? "" : p).trim();
  if (!s) return null;
  if (s.startsWith("{") || s.startsWith("[")) return null;
  return s;
};

// De un objeto de respuesta de boton, lo mejor que tenga: id, payload util,
// o — ultimo recurso y el que salva el caso Juan — el texto visible.
const deBoton = (x) => {
  if (!x || typeof x !== "object") return null;
  const t = typeof x.text === "string" ? x.text.trim() : "";
  return x.id || payloadServible(x.payload) || t || null;
};

// La cadena completa, con todas las formas que ha mandado WATI y las de la
// Cloud API de WhatsApp. El orden importa: primero las formas de WATI.
function idDeBoton(b) {
  if (!b || typeof b !== "object") return null;
  return (
    deBoton(b.buttonReply) ||
    deBoton(b.interactiveButtonReply) ||
    b.interactive?.button_reply?.id ||
    b.interactive?.list_reply?.id ||
    b.button?.payload ||
    b.button?.text ||
    b.listReply?.id ||
    b.listReply?.rowId ||
    b.message?.interactive?.button_reply?.id ||
    b.message?.interactive?.list_reply?.id ||
    b.message?.buttonReply?.id ||
    b.message?.listReply?.id ||
    b.messages?.[0]?.button_reply?.id ||
    b.messages?.[0]?.list_reply?.id ||
    b.messages?.[0]?.interactive?.button_reply?.id ||
    b.messages?.[0]?.interactive?.list_reply?.id ||
    null
  );
}

module.exports = { idDeBoton, deBoton, payloadServible };
