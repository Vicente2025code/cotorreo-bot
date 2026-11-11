// intencionMensaje.js — ¿de qué está hablando el cliente?
//
// POR QUÉ EXISTE
// El interceptor del 2x1 de sushi vivía en línea dentro de whatsappHandler con
// estas dos pruebas:
//
//   /(cuales|cual|que|en que|aplica|...)/.test(nrm) &&
//   /(sushi|roll|rollo|rollos|2x1|...)/.test(nrm)
//
// Sin límites de palabra. O sea que `que` no buscaba la palabra "qué": buscaba
// las letras q-u-e en cualquier parte, y esas letras viven dentro de "porque",
// "quería" y "queque". Resultado: cualquier mensaje con una palabra de sushi y
// las letras "que" en algún lado recibía la lista de precios completa.
//
// Medido el 10-nov-2026 con frases reales: 7 de 12 salían mal. Entre ellas:
//   "Porque el sushi estaba frio"       → lista de precios a una QUEJA
//   "Ya esta lista mi orden de sushi?"  → lista de precios a quien pregunta
//                                         por su pedido
//   "El sushi que pedi ya esta listo?"  → igual
//
// Acá vive como funciones puras y con tabla de pruebas, no en línea dentro de
// un handler de 3.400 renglones. La lección del día: lo que no se puede probar
// solo, no se prueba.

function normalizar(texto) {
  return String(texto || "")
    .trim()
    .toLowerCase()
    .replace(/[¡!¿?.,;:()]/g, " ")
    .normalize("NFD")
    // Rango de diacríticos combinantes con escapes a propósito: con los
    // caracteres literales es invisible en un diff.
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Palabras de sushi ───
// Incluye los nombres DISTINTIVOS de los rollos, porque un cliente pregunta
// "el 2x1 sirve para el caterpillar?" sin decir ni sushi ni roll.
// Se dejan fuera a propósito "tico" (en Costa Rica es el gentilicio) y
// "camaron" (hay camarón en platos que no son sushi): solos darían falsos
// positivos, y acompañados de "roll" ya los agarra el grupo de arriba.
//
// `2x1` NO va acá, aunque el interceptor viejo lo tenía: los martes es sushi,
// pero el lunes es tacos, el miércoles quesabirrias y el jueves hamburguesas.
// Con 2x1 adentro, "el 2x1 de tacos" habría recibido la lista de SUSHI.
const RE_SUSHI = new RegExp([
  /\b(sushi|sushis|roll|rolls|rollo|rollos|maki|makis|kumo)\b/.source,
  /\b(caterpillar|california|teriyaki|salmon lovers|crazy roll|rib eye)\b/.source,
].join("|"));

// ─── Señales de "¿cuáles aplican?" ───
// Ojo: `que` a secas NO está. No aporta señal y aparece en medio del español.
// Para cubrir "¿qué sushis tienen?" está RE_QUE_ROLLOS, que exige la frase.
const RE_SENAL_CUALES =
  /\b(cuales|cual|aplica|aplican|incluye|incluyen|entran|entra|valido|validos|valida|validas|sirve|sirven|participan)\b/;
const RE_QUE_ROLLOS = /\bque\s+(sushis?|rolls?|rollos?|makis?)\b/;

// ─── Señales de "dame la carta" ───
// "lista" exige ir seguida de "de/del": sin eso choca con "¿ya está lista mi
// orden?", que es la pregunta por el pedido, no por el menú.
const RE_PIDE_CARTA = /\b(menu|carta|lista|listado)\s+(de\s+|del\s+)?(sushi|sushis|roll|rolls|rollo|rollos|makis?)\b/;
const RE_TIENEN = /\b(tienen|tenes|tienes|hay|manejan|venden)\b/;

// ─── Señales de promo directa ───
const RE_PROMO_DIRECTA = /\b(2x1|2 x 1|dos por uno|promo|promocion|promociones|oferta)\b/;

// ─────────────────────────────────────────────────────────────────────────────
// VETOS — preguntas que el bot NO puede contestar y nunca debe improvisar
// ─────────────────────────────────────────────────────────────────────────────

// Estado del pedido. El bot no tiene forma de saberlo: no ve la cocina ni el
// express. Esto siempre va a una persona.
// Caso real: Alejandra, 10-nov. Un humano le dijo "unos 40min", el handoff se
// venció a los 30, ella preguntó "¿maso menos cuánto falta?" y le contestó el
// bot — con la promo del martes, tres veces.
const RE_ESTADO_PEDIDO = new RegExp([
  // "cuánto falta", "cuánto le falta", "cuánto más falta", "cuánto tarda"
  /cuanto\s+(?:\w+\s+){0,2}(falta|faltan|tarda|tardan|demora|demoran|dura)/.source,
  // "ya está", "ya están", "ya salió", "ya viene", "ya mero"
  /\bya\s+(esta|estan|salio|salieron|viene|vienen|mero|casi)\b/.source,
  // "está listo", "están listos"
  /\b(esta|estan)\s+(listo|lista|listos|listas)\b/.source,
  // "mi orden", "mi pedido", "el pedido", "la orden"
  /\b(mi|el|la)\s+(orden|pedido|comida|entrega)\b/.source,
  // "en camino", "cuándo llega", "cuándo sale"
  /\ben\s+camino\b/.source,
  /\bcuando\s+(llega|llegan|sale|salen|esta|estara|lo traen|la traen)\b/.source,
  // "paso a retirar", "voy a recoger"
  /\b(retirar|recoger)\b/.source,
].join("|"));

// Quejas y reclamos. Contestar una queja con publicidad es peor que no
// contestar. Esto siempre va a una persona.
const RE_QUEJA = new RegExp([
  /\b(frio|fria|frios|frias|crudo|cruda|quemado|quemada|malo|mala|feo|fea|horrible|pesimo|pesima)\b/.source,
  /\b(falto|faltaba|faltaron|equivocado|equivocada|incompleto|incompleta)\b/.source,
  /\b(reclamo|queja|quejar|devolver|devolucion|reembolso)\b/.source,
  /\bsin\s+(salsa|aguacate|queso|sal|nada)\b/.source,
  /\bno\s+me\s+(trajeron|llego|llegaron|gusto|sirvieron|dieron)\b/.source,
  /\b(tardaron|tardo|demoraron)\b/.source,
].join("|"));

function esEstadoDePedido(texto) {
  return RE_ESTADO_PEDIDO.test(normalizar(texto));
}

function esQueja(texto) {
  return RE_QUEJA.test(normalizar(texto));
}

// ¿Debe el bot soltar la lista cerrada de rollos del 2x1?
function preguntaPorRollos2x1(texto) {
  const n = normalizar(texto);
  if (!n) return false;
  if (!RE_SUSHI.test(n)) return false;

  // El veto va ANTES de cualquier señal positiva. Un cliente puede decir
  // "el rollo que pedí ya está listo?" — tiene palabra de sushi, pero está
  // preguntando por su pedido, no por precios.
  if (RE_ESTADO_PEDIDO.test(n) || RE_QUEJA.test(n)) return false;

  const cuales = RE_SENAL_CUALES.test(n) || RE_QUE_ROLLOS.test(n);
  const carta = RE_PIDE_CARTA.test(n) || RE_TIENEN.test(n);
  const promo = RE_PROMO_DIRECTA.test(n);
  return cuales || carta || promo;
}

// ¿Esto tiene que verlo una persona, sí o sí?
function requiereHumano(texto) {
  const n = normalizar(texto);
  if (!n) return null;
  if (RE_ESTADO_PEDIDO.test(n)) return "estado_pedido";
  if (RE_QUEJA.test(n)) return "queja";
  return null;
}

module.exports = {
  normalizar,
  preguntaPorRollos2x1,
  esEstadoDePedido,
  esQueja,
  requiereHumano,
};
