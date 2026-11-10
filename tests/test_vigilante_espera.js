// Pruebas del vigilante de espera.
//
// Por qué existe (medido 9-nov-2026 sobre 100 conversaciones reales de WATI):
// en 3 de cada 100 el cliente habló de último y NADIE le contestó nunca. Las 3
// pasaron igual: el cliente pidió asesor, un humano entró, preguntó algo, el
// cliente respondió... y nadie volvió.
//   · Luisa          66 h  "si nos sirve el precio yo haría una lista"  → ~₡87.500
//   · Karol          137 h "Ha enviado 12.200 colones por SINPE Móvil"  → ya pagó
// A las 24 h WhatsApp cierra la ventana y ya no se puede escribir libre: hay que
// mandar plantilla. Luisa costó exactamente eso.
//
// El vigilante NO consulta a WATI: el bot ya recibe los mensajes entrantes y los
// sessionMessageSent, así que lleva la cuenta en Redis. Costo en llamadas a la
// API de WATI: cero (solo gasta cuando manda una alerta).

const {
  crearVigilante, requiereRespuesta, textoAlerta, textoAlertaCanal, numEnv,
  tipoDeAdjunto, textoParaVigilante,
} = require("../services/vigilanteEspera");

let pass = 0, fail = 0;
function t(name, fn) {
  const done = () => { console.log("✅", name); pass++; };
  const err = (e) => { console.log("❌", name, "—", e.message); fail++; };
  let r;
  try { r = fn(); } catch (e) { err(e); return Promise.resolve(); }
  return Promise.resolve(r).then(done, err);
}
function eq(a, b) {
  if (a !== b) throw new Error(`esperado ${JSON.stringify(b)}, recibido ${JSON.stringify(a)}`);
}

// ─── Redis falso: solo lo que el módulo usa de verdad ───
function fakeRedis() {
  const kv = new Map();      // string keys
  const z = new Map();       // key -> Map(member -> score)
  return {
    _kv: kv, _z: z,
    async zadd(key, opts, entry) {
      if (!z.has(key)) z.set(key, new Map());
      const m = z.get(key);
      if (opts && opts.nx && m.has(entry.member)) return 0;
      m.set(entry.member, entry.score);
      return 1;
    },
    async zrem(key, member) {
      const m = z.get(key);
      if (!m) return 0;
      return m.delete(member) ? 1 : 0;
    },
    async zrange(key, min, max, opts) {
      const m = z.get(key);
      if (!m) return [];
      const out = [];
      for (const [member, score] of m.entries()) {
        if (!opts || !opts.byScore) { out.push(member); continue; }
        if (score >= min && score <= max) out.push(member);
      }
      return out;
    },
    async zscore(key, member) {
      const m = z.get(key);
      return m && m.has(member) ? m.get(member) : null;
    },
    async set(key, val, opts) {
      if (opts && opts.nx && kv.has(key)) return null;
      kv.set(key, val);
      return "OK";
    },
    async get(key) { return kv.has(key) ? kv.get(key) : null; },
    async del(key) { return kv.delete(key) ? 1 : 0; },
  };
}

const MIN = 60 * 1000;
const H = 60 * MIN;
// 2026-11-10T18:00:00Z = 12:00 p.m. en Costa Rica (UTC-6, sin horario de verano)
const MEDIODIA = Date.parse("2026-11-10T18:00:00Z");
// 2026-11-10T08:00:00Z = 2:00 a.m. en Costa Rica — local cerrado
const MADRUGADA = Date.parse("2026-11-10T08:00:00Z");

function nuevo({ t0 = MEDIODIA, excluidos = ["50660127557"], maxPorCorrida = 10 } = {}) {
  const reloj = { t: t0 };
  const eventos = [];
  const v = crearVigilante({
    redis: fakeRedis(),
    ahora: () => reloj.t,
    avisoMin: 20,
    urgenteH: 20,
    horaInicio: 8,
    horaFin: 22,
    maxPorCorrida,
    excluidos,
    registrar: (ev, payload) => eventos.push({ ev, ...payload }),
  });
  return { v, reloj, eventos };
}

async function run() {

  // ─── El reloj arranca y suena ───

  await t("recién llegado no alerta", async () => {
    const { v } = nuevo();
    await v.marcarEspera("50688551308", { nombre: "Luisa", texto: "¿cuánto cuesta?" });
    eq((await v.revisarEsperas()).length, 0);
  });

  await t("a los 21 min alerta nivel aviso", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("50688551308", { nombre: "Luisa", texto: "¿cuánto cuesta?" });
    reloj.t += 21 * MIN;
    const a = await v.revisarEsperas();
    eq(a.length, 1);
    eq(a[0].nivel, "aviso");
    eq(a[0].telefono, "50688551308");
    eq(a[0].nombre, "Luisa");
    eq(a[0].minutos, 21);
  });

  await t("a los 19 min todavía no", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("50688551308", { texto: "¿cuánto cuesta?" });
    reloj.t += 19 * MIN;
    eq((await v.revisarEsperas()).length, 0);
  });

  // ─── El caso Luisa: dos mensajes seguidos, el reloj NO se reinicia ───

  await t("el 2do mensaje del cliente NO reinicia el reloj (caso Luisa 22:55→22:56)", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "sí por favor armar un paquete" });
    reloj.t += 1 * MIN;
    await v.marcarEspera("506", { texto: "si nos sirve el precio yo haría una lista" });
    reloj.t += 20 * MIN;                       // 21 min desde el PRIMER mensaje
    const a = await v.revisarEsperas();
    eq(a.length, 1);
    eq(a[0].minutos, 21);                      // no 20: cuenta desde el primero
  });

  await t("el texto guardado es el del primer mensaje sin contestar", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "¿tienen mesa para 25?" });
    reloj.t += 1 * MIN;
    await v.marcarEspera("506", { texto: "gracias" });
    reloj.t += 25 * MIN;
    const a = await v.revisarEsperas();
    eq(a[0].texto, "¿tienen mesa para 25?");
  });

  // ─── Cuando la casa contesta, el reloj se apaga ───

  await t("limpiarEspera apaga el reloj", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "¿cuánto cuesta?" });
    await v.limpiarEspera("506");
    reloj.t += 3 * H;
    eq((await v.revisarEsperas()).length, 0);
  });

  await t("limpiar y volver a esperar arranca un reloj nuevo", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "primera" });
    reloj.t += 30 * MIN;
    await v.limpiarEspera("506");
    await v.marcarEspera("506", { texto: "segunda" });
    eq((await v.revisarEsperas()).length, 0);   // reloj nuevo, aún no cumple
    reloj.t += 21 * MIN;
    const a = await v.revisarEsperas();
    eq(a.length, 1);
    eq(a[0].texto, "segunda");
  });

  // ─── Nivel urgente: la ventana de 24 h se está cerrando ───

  await t("a las 21 h alerta nivel urgente", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "¿cuánto cuesta?" });
    reloj.t += 21 * H;
    const a = await v.revisarEsperas();
    eq(a.length, 1);
    eq(a[0].nivel, "urgente");
    eq(a[0].horas, 21);
  });

  await t("no repite el mismo nivel dos veces", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "¿cuánto cuesta?" });
    reloj.t += 21 * MIN;
    eq((await v.revisarEsperas()).length, 1);
    reloj.t += 10 * MIN;
    eq((await v.revisarEsperas()).length, 0);   // ya avisó el nivel aviso
  });

  await t("después del aviso todavía puede escalar a urgente", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "¿cuánto cuesta?" });
    reloj.t += 21 * MIN;
    eq((await v.revisarEsperas())[0].nivel, "aviso");
    reloj.t += 21 * H;
    const a = await v.revisarEsperas();
    eq(a.length, 1);
    eq(a[0].nivel, "urgente");
  });

  await t("pasadas 25 h ya no alerta: la ventana se cerró, no hay nada que correr", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "¿cuánto cuesta?" });
    reloj.t += 25 * H;
    eq((await v.revisarEsperas()).length, 0);
  });

  // ─── Mensajes que no piden respuesta: no hacer ruido ───

  await t("'gracias' solo no arranca reloj", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "gracias" });
    reloj.t += 3 * H;
    eq((await v.revisarEsperas()).length, 0);
  });

  await t("'Graciaaas' (caso real 27-sep) tampoco", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "Graciaaas" });
    reloj.t += 3 * H;
    eq((await v.revisarEsperas()).length, 0);
  });

  // Nota: "ya le confirmo cuántos de cada uno" (Luisa, 9-nov) tampoco necesitaba
  // respuesta, pero filtrarlo requeriría entender la intención, no una lista de
  // palabras. Meter "cuantos" o "confirmo" en la lista se tragaría "¿cuántos
  // combos cuestan?". Se prefiere avisar de más: el staff descarta en 2 segundos,
  // mientras que un aviso que no suena cuesta ₡87.500.

  await t("pero una pregunta sí arranca reloj", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "¿y a qué hora abren?" });
    reloj.t += 21 * MIN;
    eq((await v.revisarEsperas()).length, 1);
  });

  await t("el SINPE de Karol SÍ arranca reloj (ya pagó, alguien tiene que verlo)", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", {
      texto: "Ha enviado 12,200.00 Colones a Nunez Rodriguez Mariela por SINPE Movil"
    });
    reloj.t += 21 * MIN;
    eq((await v.revisarEsperas()).length, 1);
  });

  // ─── Exclusiones ───

  await t("el número del staff no genera alerta", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("50660127557", { texto: "¿cuánto cuesta?" });
    reloj.t += 21 * MIN;
    eq((await v.revisarEsperas()).length, 0);
  });

  await t("sesión demo no genera alerta", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("demo:abc", { texto: "¿cuánto cuesta?" });
    reloj.t += 21 * MIN;
    eq((await v.revisarEsperas()).length, 0);
  });

  await t("texto vacío no arranca reloj", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "" });
    reloj.t += 21 * MIN;
    eq((await v.revisarEsperas()).length, 0);
  });

  // ─── Horario: no despertar a nadie a las 2 a.m. ───

  await t("a las 2 a.m. aguanta la alerta", async () => {
    const { v, reloj } = nuevo({ t0: MADRUGADA });
    await v.marcarEspera("506", { texto: "¿cuánto cuesta?" });
    reloj.t += 21 * MIN;
    eq((await v.revisarEsperas()).length, 0);
  });

  await t("al abrir a las 8 a.m. suelta la alerta con las horas acumuladas", async () => {
    const { v, reloj } = nuevo({ t0: MADRUGADA });
    await v.marcarEspera("506", { texto: "¿cuánto cuesta?" });
    reloj.t += 6 * H;                           // 2 a.m. + 6 h = 8 a.m. CR
    const a = await v.revisarEsperas();
    eq(a.length, 1);
    eq(a[0].horas, 6);
  });

  // ─── requiereRespuesta: la función sola ───

  await t("requiereRespuesta clasifica bien", () => {
    eq(requiereRespuesta("gracias"), false);
    eq(requiereRespuesta("Gracias!"), false);
    eq(requiereRespuesta("ok"), false);
    eq(requiereRespuesta("listo"), false);
    eq(requiereRespuesta("👍"), false);
    eq(requiereRespuesta("perfecto, muchas gracias"), false);
    eq(requiereRespuesta(""), false);
    eq(requiereRespuesta("   "), false);
    eq(requiereRespuesta("¿cuánto vale la cancha?"), true);
    eq(requiereRespuesta("quiero reservar"), true);
    eq(requiereRespuesta("gracias, pero cuánto sale el combo?"), true);
  });

  // ═══ Hallazgos de la revisión del 10-nov-2026 ═══

  // A3 — WATI reintenta webhooks y no garantiza orden. Sin comparar tiempos, un
  // sessionMessageSent atrasado borraba el reloj de la pregunta siguiente y esa
  // pregunta no alertaba nunca.
  await t("un mensaje saliente ATRASADO no borra el reloj de la pregunta nueva", async () => {
    const { v, reloj } = nuevo();
    const tSalida = reloj.t;                   // la casa responde
    reloj.t += 4 * 1000;                       // 4 s después
    await v.marcarEspera("506", { texto: "¿y para 20 personas?" });
    reloj.t += 2 * 1000;
    await v.limpiarEspera("506", tSalida);     // llega atrasado el de antes
    reloj.t += 21 * MIN;
    const a = await v.revisarEsperas();
    eq(a.length, 1);                           // el reloj sobrevivió
    eq(a[0].texto, "¿y para 20 personas?");
  });

  await t("un mensaje saliente POSTERIOR sí borra el reloj", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "¿cuánto cuesta?" });
    reloj.t += 30 * 1000;
    await v.limpiarEspera("506", reloj.t);     // la casa respondió después
    reloj.t += 21 * MIN;
    eq((await v.revisarEsperas()).length, 0);
  });

  // M7 — el hueco de las 02:00 a las 08:00
  await t("el URGENTE suena fuera de horario (es la alerta que vale plata)", async () => {
    const { v, reloj } = nuevo({ t0: MADRUGADA });   // 2 a.m. CR
    await v.marcarEspera("506", { texto: "¿me armás el paquete?" });
    reloj.t += 21 * H;                                // 11 p.m. CR, fuera de horario
    const a = await v.revisarEsperas();
    eq(a.length, 1);
    eq(a[0].nivel, "urgente");
  });

  await t("el aviso de 20 min sigue respetando el horario", async () => {
    const { v, reloj } = nuevo({ t0: MADRUGADA });
    await v.marcarEspera("506", { texto: "¿cuánto cuesta?" });
    reloj.t += 21 * MIN;                              // sigue siendo madrugada
    eq((await v.revisarEsperas()).length, 0);
  });

  // M8 — el purgado deja rastro
  await t("al vencer la ventana queda registrado el cliente que se perdió", async () => {
    const { v, reloj, eventos } = nuevo();
    await v.marcarEspera("506", { texto: "¿tienen mesa para 25?" });
    reloj.t += 25 * H;
    await v.revisarEsperas();
    const vencidas = eventos.filter((e) => e.ev === "espera_vencida");
    eq(vencidas.length, 1);
    eq(vencidas[0].horas, 25);
    if (!vencidas[0].texto_preview.includes("mesa para 25")) {
      throw new Error("no guardó de qué se trataba: " + JSON.stringify(vencidas[0]));
    }
  });

  await t("el purgado corre DESPUÉS de evaluar, no antes", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "¿cuánto cuesta?" });
    reloj.t += 23 * H;                      // 23 h: urgente pendiente, aún no vencida
    const a = await v.revisarEsperas();
    eq(a.length, 1);
    eq(a[0].nivel, "urgente");
  });

  // A6 — tope por corrida
  await t("con tope de 2, solo salen 2 y el resto espera el siguiente tick", async () => {
    const { v, reloj } = nuevo({ maxPorCorrida: 2 });
    for (const n of ["50611110001", "50611110002", "50611110003", "50611110004"]) {
      await v.marcarEspera(n, { texto: "¿cuánto cuesta?" });
    }
    reloj.t += 21 * MIN;
    eq((await v.revisarEsperas()).length, 2);
    eq((await v.revisarEsperas()).length, 2);   // los otros 2, no re-marcados
    eq((await v.revisarEsperas()).length, 0);
  });

  // A5 — si WATI rechaza el envío, hay que poder reintentar
  await t("desmarcarAviso permite reintentar una alerta que no salió", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("506", { texto: "¿cuánto cuesta?" });
    reloj.t += 21 * MIN;
    const a = await v.revisarEsperas();
    eq(a.length, 1);
    eq((await v.revisarEsperas()).length, 0);   // ya marcada
    await v.desmarcarAviso("506", "aviso");     // el envío falló
    eq((await v.revisarEsperas()).length, 1);   // reintenta
  });

  // M13 — el mismo cliente con dos formatos no puede tener dos relojes
  await t("'+506 8855-1308' y '50688551308' son el mismo reloj", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("+506 8855-1308", { texto: "¿cuánto cuesta?" });
    await v.marcarEspera("50688551308", { texto: "otra vez" });
    reloj.t += 21 * MIN;
    eq((await v.revisarEsperas()).length, 1);   // un solo reloj, no dos
  });

  await t("limpiar con formato distinto igual apaga el reloj", async () => {
    const { v, reloj } = nuevo();
    await v.marcarEspera("50688551308", { texto: "¿cuánto cuesta?" });
    await v.limpiarEspera("+506 8855-1308");
    reloj.t += 21 * MIN;
    eq((await v.revisarEsperas()).length, 0);
  });

  // ─── Configuración por env ───
  // Bug encontrado en la prueba de integración del 10-nov: `Number(x) || def`
  // se traga el 0, y ESPERA_HORA_INICIO=0 (medianoche) es un valor legítimo que
  // se volvía 8 en silencio.

  await t("numEnv respeta el 0 (medianoche es una hora válida)", () => {
    eq(numEnv("0", 8), 0);
    eq(numEnv(0, 8), 0);
  });

  await t("numEnv cae al default con vacío, nulo o basura", () => {
    eq(numEnv(undefined, 8), 8);
    eq(numEnv(null, 8), 8);
    eq(numEnv("", 8), 8);
    eq(numEnv("   ", 8), 8);
    eq(numEnv("ocho", 8), 8);
  });

  await t("numEnv acepta números normales", () => {
    eq(numEnv("20", 8), 20);
    eq(numEnv("1", 8), 1);
  });

  await t("horaInicio 0 y horaFin 24 hacen que avise a cualquier hora", async () => {
    const reloj = { t: MADRUGADA };           // 2 a.m. en Costa Rica
    const v = crearVigilante({
      redis: fakeRedis(), ahora: () => reloj.t,
      avisoMin: 20, urgenteH: 20, horaInicio: 0, horaFin: 24, excluidos: [],
    });
    await v.marcarEspera("506", { texto: "¿cuánto cuesta?" });
    reloj.t += 21 * MIN;
    eq((await v.revisarEsperas()).length, 1);  // con el bug esto daba 0
  });

  // ─── Texto de la alerta (va por la plantilla staff_alerta ya aprobada) ───

  await t("alerta nivel aviso: nombre, teléfono y minutos", () => {
    const { tipo, detalle } = textoAlerta({
      nivel: "aviso", nombre: "Luisa", telefono: "50688551308",
      texto: "si nos sirve el precio yo haría una lista", minutos: 21, horas: 0,
    });
    eq(tipo, "Cliente esperando respuesta");
    if (!detalle.includes("Luisa")) throw new Error("falta el nombre");
    if (!detalle.includes("21 min")) throw new Error("faltan los minutos: " + detalle);
  });

  // Mismo criterio de datos personales que notifyHandoffAlert: cola de 8
  // dígitos, no el número completo. En Costa Rica esos 8 dígitos son el número
  // local, así que el staff igual encuentra el chat.
  await t("la alerta manda la cola de 8 dígitos, no el número completo", () => {
    const { detalle } = textoAlerta({
      nivel: "aviso", nombre: "Luisa", telefono: "50688551308",
      texto: "hola", minutos: 21, horas: 0,
    });
    if (detalle.includes("50688551308")) throw new Error("manda el número completo: " + detalle);
    if (!detalle.includes("***88551308")) throw new Error("falta la cola: " + detalle);
  });

  await t("alerta de 90 min se lee '1 h 30 min', no '90 min'", () => {
    const { detalle } = textoAlerta({
      nivel: "aviso", telefono: "506", texto: "", minutos: 90, horas: 1,
    });
    if (!detalle.includes("1 h 30 min")) throw new Error(detalle);
  });

  await t("alerta urgente dice cuántas horas quedan de ventana", () => {
    const { tipo, detalle } = textoAlerta({
      nivel: "urgente", nombre: "Karol", telefono: "506", texto: "SINPE", horas: 21, minutos: 1260,
    });
    if (!tipo.includes("URGENTE")) throw new Error(tipo);
    if (!detalle.includes("21 horas")) throw new Error(detalle);
    if (!detalle.includes("~3 h")) throw new Error("no dice lo que queda: " + detalle);
  });

  await t("ningún parámetro de plantilla lleva salto de línea (WATI los rechaza)", () => {
    for (const nivel of ["aviso", "urgente"]) {
      const { tipo, detalle } = textoAlerta({
        nivel, nombre: "X", telefono: "506", texto: "hola\ncon salto", minutos: 30, horas: 1,
      });
      if (/[\n\r\t]/.test(tipo + detalle)) throw new Error("hay salto de línea en " + nivel);
    }
    const c = textoAlertaCanal({
      canalEtiqueta: "Instagram", remitente: "178414", texto: "hola\nahí",
    });
    if (/[\n\r\t]/.test(c.tipo + c.detalle)) throw new Error("hay salto de línea en canal");
  });

  await t("alerta de canal nombra el canal y dice que hay que ir a la bandeja", () => {
    const { tipo, detalle } = textoAlertaCanal({
      canalEtiqueta: "Facebook Messenger", remitente: "9876543210987654",
      texto: "tienen mesa?",
    });
    if (!tipo.includes("Facebook Messenger")) throw new Error(tipo);
    if (!detalle.includes("***43210987654".slice(-8))) throw new Error("falta el remitente");
    if (!detalle.toLowerCase().includes("wati")) throw new Error("no dice dónde contestar");
  });

  // ─── Adjuntos ───
  //
  // Regresión de un bug que las pruebas unitarias NO cazaron y sí cazó la
  // prueba end-to-end del 10-nov: la primera versión hacía
  // `String(eventType || b.type)`, y como WATI manda eventType:"message" junto
  // con type:"image", el "message" tapaba el "image" y el adjunto quedaba
  // invisible. En la corrida real la foto de SINPE NO arrancó reloj — que es
  // justo el caso Karol, el cliente que ya pagó.

  await t("payload real de WATI con foto: eventType 'message' NO tapa type 'image'", () => {
    const body = {
      waId: "50688551308", senderName: "Karol", type: "image",
      data: "https://ejemplo/sinpe.jpg", eventType: "message", owner: false,
    };
    eq(tipoDeAdjunto(body, "message"), "image");
    eq(textoParaVigilante(body, "message", ""), "[image]");
  });

  await t("nota de voz sin texto arranca reloj como [audio]", () => {
    const body = { waId: "50688551308", type: "audio", eventType: "message" };
    eq(textoParaVigilante(body, "message", ""), "[audio]");
  });

  await t("si hay texto, el texto manda sobre la marca del adjunto", () => {
    const body = { waId: "506", type: "image", eventType: "message" };
    eq(textoParaVigilante(body, "message", "  aquí va el comprobante  "), "aquí va el comprobante");
  });

  await t("mensaje de texto normal no inventa adjunto", () => {
    const body = { waId: "506", type: "text", eventType: "message", text: "hola" };
    eq(tipoDeAdjunto(body, "message"), null);
    eq(textoParaVigilante(body, "message", "hola"), "hola");
  });

  await t("texto vacío y sin adjunto devuelve cadena vacía (no arranca reloj)", () => {
    eq(textoParaVigilante({ waId: "506", type: "text" }, "message", ""), "");
  });

  await t("`contacts` en la raíz del webhook NO cuenta como adjunto", () => {
    // En el shape de WhatsApp Cloud, contacts[] en la raíz es el PERFIL del
    // remitente, no un contacto compartido. Si se probara la raíz, cada
    // mensaje de texto se marcaría como adjunto.
    const body = { contacts: [{ profile: { name: "Karol" }, wa_id: "50688551308" }], type: "text" };
    eq(tipoDeAdjunto(body, "message"), null);
  });

  await t("shape de WhatsApp Cloud: messages[0].image sí cuenta", () => {
    const body = { messages: [{ from: "506", type: "image", image: { id: "abc" } }] };
    eq(tipoDeAdjunto(body, "messages"), "image");
  });

  await t("mediaUrl sin tipo conocido queda como [adjunto]", () => {
    eq(textoParaVigilante({ mediaUrl: "https://x/y.bin" }, "message", ""), "[adjunto]");
  });

  await t("el adjunto pasa requiereRespuesta (una foto no es un 'gracias')", () => {
    eq(requiereRespuesta("[image]"), true);
    eq(requiereRespuesta("[audio]"), true);
  });

  console.log(`\nResultado: ${pass} pass / ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
