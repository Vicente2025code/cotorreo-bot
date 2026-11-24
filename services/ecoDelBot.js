// ecoDelBot.js — distinguir el eco de un mensaje del PROPIO bot de la
// respuesta de un humano.
//
// POR QUE EXISTE
// WATI devuelve por webhook (eventType "sessionMessageSent") todos los
// mensajes salientes, los del bot incluidos, y todos con el mismo
// operatorEmail: la cuenta admin bajo la que el bot envia. Si el bot lee su
// propio eco como "un humano contesto", se calla solo (handoff) y el cliente
// queda hablandole a una pared.
//
// index.js ya resolvia eso para los mensajes de TEXTO: sendWatiMessage guarda
// el texto en el set bot_sent_texts:{numero} con TTL de 60 s y el webhook
// compara por igualdad exacta.
//
// EL HUECO QUE ESTE ARCHIVO CIERRA (24-nov-2026)
// sendWatiButtonsMessage nunca registro nada, y es el que manda el MENU
// PRINCIPAL. Resultado medido en el log de Render:
//
//   18:12:31  menu_principal_sent    mode: interactive_buttons
//   18:12:31  handoff_triggered      operator: null       <- 300 ms despues
//   18:13:00  message_received       "Quiero información"
//   18:13:02  handoff_acuse
//
// La audiologa (clinica de 4 sedes) toco el boton de la campana de cierres de
// ano y en vez del cotizador recibio "ya esta en la fila". Mismo caso esa
// madrugada con "Johel", que escribio tres mensajes seguidos sobre una pedida
// de mano un sabado y no recibio ninguno.
//
// Y NO SE PUEDE USAR bot_sent_texts PARA ESTO
// WATI no ecoa el cuerpo tal cual: manda el mensaje RENDERIZADO —encabezado,
// cuerpo y los botones convertidos en lista numerada— asi que la igualdad
// exacta falla siempre. De ahi el set aparte que se compara por "contiene".
//
// POR QUE NO BASTA operatorName == null
// Es la otra senal disponible (el eco del bot llega sin nombre de operador y
// el envio de un humano trae "vicente BENITEZ"), pero fiarse de ella se
// equivoca en la direccion CARA: si WATI algun dia manda un envio humano sin
// nombre, el bot le escribe encima a la persona que esta atendiendo. El set
// solo se equivoca en la direccion barata.

const TTL_S = 60;

// Una huella mas corta que esto no se usa: seria facil que apareciera por
// casualidad dentro de lo que escribe un humano.
const MIN_LARGO = 24;

// Largo de la huella. Se guarda solo el ARRANQUE del cuerpo, no el cuerpo
// entero, por dos razones medidas sobre el webhook real del 24-nov:
//
//  1. El eco trae el encabezado ANTES del cuerpo ("🏢 Grupo Cotorreo \r\n" y
//     despues el cuerpo). Si se recortan los dos lados al mismo largo, el del
//     eco pierde el final del cuerpo por culpa del encabezado y el "contiene"
//     falla justo en los mensajes largos. El payload de WATI admite cuerpos de
//     hasta 1024, asi que no es hipotetico.
//  2. Una huella corta es inmune a que WATI toque el final del mensaje (los
//     botones los agrega como lista numerada al final).
const LARGO_HUELLA = 120;

// Tope de huellas que se miran por eco. El set vive 60 s, asi que nunca deberia
// tener mas de un punado; el tope es para que un caso raro no haga un barrido
// largo dentro del webhook.
const MAX_CUERPOS = 20;

const claveCuerpos = (tel) => `bot_sent_bodies:${tel}`;
const soloDigitos = (t) => String(t || "").replace(/\D/g, "");

// Se compara solo el ESQUELETO del mensaje: letras y numeros, nada mas.
//
// No alcanza con quitar los emoji. En el eco que guarda el log de Render los
// emoji vuelven como surrogates huerfanos ("\udc8f"), que no son emoji validos
// para una expresion regular y se le escapan a cualquier filtro de simbolos.
// Tampoco se puede confiar en los asteriscos de negrita ni en los saltos de
// linea, que WATI reacomoda al renderizar.
//
// Lo que queda —120 caracteres de puras letras y numeros— identifica un
// mensaje del bot de sobra, y no depende de nada que WATI pueda tocar.
function limpiar(s) {
  return String(s || "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// La huella del mensaje que manda el bot.
const norm = (s) => limpiar(s).slice(0, LARGO_HUELLA);

// El texto entrante NO se recorta a la medida de la huella: tiene que quedar
// entero para que la huella pueda encontrarse dentro.
const normEntrante = (s) => limpiar(s).slice(0, 4000);

// Guarda el cuerpo de un mensaje interactivo para reconocer su eco despues.
// Nunca tira: si Redis falla, preferimos quedarnos sin la pista antes que
// tumbar un envio al cliente.
async function registrarCuerpo(redis, tel, cuerpo) {
  const txt = norm(cuerpo);
  if (!redis || txt.length < MIN_LARGO) return false;
  const num = soloDigitos(tel);
  if (!num) return false;
  try {
    await redis.sadd(claveCuerpos(num), txt);
    await redis.expire(claveCuerpos(num), TTL_S);
    return true;
  } catch (_) {
    return false;
  }
}

// ¿El texto que entra contiene alguno de los cuerpos que el bot acaba de
// mandar? Si si, es su propio eco renderizado por WATI.
async function cuerpoCoincide(redis, tel, textoEntrante) {
  const entra = normEntrante(textoEntrante);
  if (!redis || !entra) return false;
  const num = soloDigitos(tel);
  if (!num) return false;
  try {
    const cuerpos = await redis.smembers(claveCuerpos(num));
    if (!Array.isArray(cuerpos)) return false;
    return cuerpos
      .slice(0, MAX_CUERPOS)
      .some((c) => typeof c === "string" && c.length >= MIN_LARGO && entra.includes(c));
  } catch (_) {
    return false;
  }
}

module.exports = {
  registrarCuerpo,
  cuerpoCoincide,
  norm,
  normEntrante,
  claveCuerpos,
  MIN_LARGO,
  LARGO_HUELLA,
  TTL_S,
};
