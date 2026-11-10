// fiestasHandler.js
// Califica leads de fiestas (empresa, fin de curso, cumpleanos) y cotiza.
// Reemplaza el viejo F1.9, que solo mandaba un link de Drive con el tarifario
// de ninos y pedia escribir "asesor".
//
// DISENO DEFENSIVO: este handler NUNCA debe tumbar al bot ni dejar al cliente
// encerrado.
//   - Todo va en try/catch. Si algo falla devuelve { handled: false } y el bot
//     sigue su camino normal, como antes de que esto existiera.
//   - Las salidas cubren TODO lo que isGlobalCommand() acepta en index.js, mas
//     cualquier toque de boton (llegan como id numerico: "3" = "Hablar asesor").
//     Un digito TECLEADO, en cambio, es la opcion del menu numerado del flujo.
//   - El borrador caduca a los 20 min. Nadie queda atrapado en el flujo.
//   - El borrador vive en Redis y se recupera aunque Render reinicie, porque
//     "seguimos o no" se decide por el borrador, no por la memoria del proceso.
//   - Airtable y la alerta al staff van SIN await: nunca retrasan el 200 del
//     webhook (misma convencion que index.js:2088).

const LINK = "https://fiestas.grupocotorreo.com";
const LINK_RESERVAS = "https://cotorreo-app.onrender.com/cliente.html";

// Mismo deep-link que usa index.js (buildReservasLink): con ?tel= el cliente
// entra directo al formulario en vez de teclear su numero otra vez. Va copiado
// y no importado para no cruzar un require circular con index.js.
function linkReservas(area, from) {
  const p = new URLSearchParams();
  if (area === "Canchas") p.set("tipo", "alpadel");
  else if (area === "Restaurante") p.set("tipo", "cotorreo");
  const tel = String(from || "").replace(/[^0-9]/g, "");
  if (tel.length >= 8) p.set("tel", tel);
  const qs = p.toString();
  return qs ? `${LINK_RESERVAS}?${qs}` : LINK_RESERVAS;
}
const TTL_S = 7 * 24 * 60 * 60;
// 20 min sin hablar = flujo muerto. Mas corto que esto corta al cliente que
// fue a preguntarle a su jefe cuanta gente va; mas largo y el que vuelve en la
// tarde a pedir una mesa se encuentra contestando preguntas de fiesta.
const EXPIRA_MS = 20 * 60 * 1000;
const MINIMO = 10;                          // bajo 10 no hay paquete que aplique
const MAXIMO = 30;                          // la capacidad real del lugar
const TOPE_MEMORIA = 500;                   // respaldo en RAM: techo duro

const P_EMPRESA = 9500;
const P_TORNEO = 11500;
const P_ALEGRIA = { basico: 6500, canchas: 9500, completo: 12000 };
const P_ADULTO = 5000;                      // almuerzo del adulto acompanante

// Intencion clara: una sola de estas palabras basta.
const RE_INTENCION = /\b(cumple|cumpleanos|fiesta|fiestas|evento|eventos|quinceanos|aniversario|bautizo|graduacion|fin de curso|fin de ano|posada|despedida|festejo)\b/;
// Ambiguas: "paquete" tambien es el paquete ejecutivo o el de 20 piezas de
// sushi. Solo cuentan si vienen acompanadas de algo de grupo o celebracion.
const RE_AMBIGUA = /\b(paquete|paquetes|celebrar|navidena|navideno|alquilar|reservar el (local|lugar|salon))\b/;
const RE_APOYO = /\b(empresa|oficina|trabajo|companer|colabor|equipo|grupo|colegio|escuela|cole|personas|gente|invitados|fin de ano|navidad|cumple|fiesta|evento)\b/;

// Salidas que index.js ya sabe atender (isGlobalCommand).
// OJO: NO metemos "cualquier digito". Este bot entreno a sus clientes durante
// meses a contestar con numeros, asi que un "1" a "empresa / colegio /
// cumpleanos" es la respuesta mas esperable que hay, no una salida. Solo 0 y 9
// son universales en todo el bot (volver / menu principal).
const RE_SALIR_GLOBAL = /^(0|9|menu|menú|inicio|hola|asesor|carrito|reservas)$/;
// Salidas que index.js NO atiende: las cerramos nosotros para que no caigan
// en el fallback de IA.
const RE_SALIR_SUAVE = /^(salir|cancelar|volver|atras|atrás|nada|olvidalo|ya no|despues|déspues)$/;

const norm = (s) => String(s || "").trim().toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "");

const colones = (n) => "₡" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, setiembre: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const NOM_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "setiembre", "octubre", "noviembre", "diciembre"];

// ---------------------------------------------------------------- borrador
const memoria = new Map();
const clave = (from) => `fiesta_draft:${from}`;

async function leer(redis, from) {
  try {
    const v = await redis.get(clave(from));
    if (v) return typeof v === "string" ? JSON.parse(v) : v;
  } catch (e) {
    console.log("⚠️ fiestas: Redis get", e?.message);
  }
  return memoria.get(from) || null;
}

async function guardar(redis, from, d) {
  // Techo duro al respaldo en RAM: si no, crece para siempre con cada
  // conversacion abandonada (Render no recicla el proceso seguido).
  if (memoria.size >= TOPE_MEMORIA) {
    const viejo = memoria.keys().next().value;
    memoria.delete(viejo);
  }
  memoria.set(from, d);
  try {
    await redis.set(clave(from), JSON.stringify(d), { ex: TTL_S });
  } catch (e) {
    console.log("⚠️ fiestas: Redis set", e?.message);
  }
}

async function borrar(redis, from) {
  memoria.delete(from);
  try { await redis.del(clave(from)); } catch (e) { /* da igual */ }
}

// ---------------------------------------------------------------- extraer
function extraer(texto, previo) {
  const d = { ...previo };                     // sin mutar lo que nos pasaron
  // Normalizamos de nuevo por si nos llaman directo: sin esto, la "ñ" de
  // "niños" no cuadra con el patron "ninos" y se pierden los invitados.
  const t = norm(texto);

  if (!d.tipo) {
    if (/\bempresa|trabajo|oficina|companer|equipo|colabor|fin de ano|navide|posada|aguinaldo|corporativ/.test(t)) d.tipo = "Empresa";
    else if (/\bcolegio|escuela|fin de curso|grado|promocion|generacion|profe|seccion|bachiller|kinder|liceo/.test(t)) d.tipo = "Colegio o escuela";
    else if (/\bcumple|cumplean|quince|bautizo|aniversario/.test(t)) d.tipo = "Cumpleanos";
  }

  // --- Personas.
  // Antes borramos los numeros que NO son gente. OJO: aqui NO se puede borrar
  // todo numero de 3 digitos, porque un grupo de 120 SI es un numero de gente
  // (y es el lead mas caro). Solo se borran montos y horas.
  const limpio = t
    .replace(/\d{1,2}\s*[\/\-]\s*\d{1,2}(\s*[\/\-]\s*\d{2,4})?/g, " ")   // 12/12/2026
    .replace(/\d{1,2}\s*(de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|setiembre|septiembre|octubre|noviembre|diciembre)/g, " ")
    .replace(/\ba\s+las?\s+\d{1,2}(\s*[:.]\s*\d{2})?/g, " ")             // a las 7 / a la 1
    .replace(/\d{1,2}\s*(am|pm|a\.m|p\.m)/g, " ")
    .replace(/\d{1,2}\s*(de la|en la)\s*(ma\w*ana|tarde|noche)/g, " ")   // 8 de la noche
    .replace(/\d{1,2}\s*[:.]\s*\d{2}/g, " ")                             // 19:30
    .replace(/cumpl\w*\s+(los\s+)?\d{1,3}/g, " ")                        // cumplir 8
    .replace(/\b\d{1,3}\s*an\w*/g, " ")                                  // 8 anos
    .replace(/\b\d{1,3}\s*mil\b/g, " ")                                  // 150 mil
    .replace(/\b\d{1,3}[.,]\d{3}\b/g, " ")                               // 9.500
    .replace(/\b\d{4,}\b/g, " ");                                        // 9500, 2026

  // Dos clases de palabra, y la diferencia vale dinero:
  //   TOTAL     ("30 personas", "25 invitados") → ya es el total, manda.
  //   SUBGRUPO  ("10 adultos y 12 ninos")       → son partes, se suman.
  // Por eso "somos 30 personas, 20 adultos y 10 ninos" son 30 y no 60,
  // mientras que "10 adultos y 12 ninos" son 22 y no 12.
  const RANGO = (n) => n >= 1 && n <= 300;
  const cuenta = (lista) =>
    [...limpio.matchAll(new RegExp(`\\b(\\d{1,3})\\s*(?:${lista})`, "g"))]
      .map((m) => Number(m[1])).filter(RANGO);
  const totales = cuenta("personas|invitados|gente|companer\\w+|colaborador\\w+|alumnos|estudiantes|empleados");
  const adultos = cuenta("adultos|pap\\w+|mam\\w+|encargados");
  const ninos = cuenta("ninos|ninas|chiquitos|chicos|muchachos|nenes");
  const otros = cuenta("jugadores");
  const grupos = [...adultos, ...ninos, ...otros];

  // El desglose vale dinero: en Fiestas de la Alegria el paquete es por NINO
  // y el adulto acompanante se cobra aparte (almuerzo 5.000). Si lo perdemos,
  // cotizamos 22 ninos donde hay 12 ninos y 10 adultos.
  if (adultos.length && d.adultos === undefined) {
    d.adultos = adultos.reduce((a, b) => a + b, 0);
  }
  if (ninos.length && d.ninos === undefined) {
    d.ninos = ninos.reduce((a, b) => a + b, 0);
  }

  let cuantos = null;
  if (totales.length) cuantos = Math.max(...totales);
  else if (grupos.length) cuantos = grupos.reduce((a, b) => a + b, 0);
  else {
    // SOLO conteos dichos con todas sus letras. NO existe un "agarra el numero
    // mas grande que quede": ese atajo leia "la fiesta el 31" como 31 personas
    // (y el 31 es 31 de diciembre, el mensaje mas probable de la campana).
    // Ojo: el numero va PEGADO a la palabra. "para el 31" no entra, "para 31" si.
    const g = limpio.match(/\b(?:somos|seriamos|serian|vamos a ser|van a ser|seremos|aprox\w*|como|unos|unas|para|cerca de|alrededor de)\s+(\d{1,3})\b/);
    if (g) cuantos = Number(g[1]);
  }
  if (cuantos !== null && cuantos >= 4 && RANGO(cuantos)) d.personas = cuantos;

  // --- Fecha
  if (!d.fecha) {
    let dia = null; let mes = null;
    let g = t.match(/\b(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|setiembre|septiembre|octubre|noviembre|diciembre)/);
    if (g) { dia = Number(g[1]); mes = MESES[g[2]]; }
    else {
      g = t.match(/\b(\d{1,2})\s*[\/\-]\s*(\d{1,2})\b/);
      if (g) { dia = Number(g[1]); mes = Number(g[2]); }
    }
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      const hoy = new Date();
      let ano = hoy.getFullYear();
      if (new Date(Date.UTC(ano, mes - 1, dia)) < new Date(hoy.getTime() - 864e5)) ano += 1;
      const prueba = new Date(Date.UTC(ano, mes - 1, dia));
      // "30 de febrero" existe como texto pero no como fecha. Si no cuadra,
      // la ignoramos: mejor volver a preguntar que mandarle 422 a Airtable.
      if (prueba.getUTCDate() === dia && prueba.getUTCMonth() === mes - 1) {
        d.fecha = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
        d.fechaLinda = `${dia} de ${NOM_MES[mes - 1]}`;
      }
    }
  }

  // --- Area
  if (!d.area) {
    const cancha = /cancha|padel|futtenis|torneo|jugar/.test(t);
    const resto = /restaurante|comer|comida|mesa|salon|cena|almuerzo/.test(t);
    if (/\bambas|las dos|todo|completo\b/.test(t) || (cancha && resto)) d.area = "Ambas";
    else if (cancha) d.area = "Canchas";
    else if (resto) d.area = "Restaurante";
  }
  return d;
}

// ---------------------------------------------------------------- cotizar
function cotizar(d, nombre) {
  const q = d.personas;
  const cuando = d.fechaLinda || "la fecha que escojan";
  const pie = "\n\nLa fecha se aparta con el 50% y el resto el día del evento.\n\n" +
    `Ya le aviso a un compañero para confirmarle la disponibilidad. 🙌\n\n${LINK}`;

  if (d.tipo === "Empresa") {
    return `¡Listo${nombre ? ", " + nombre : ""}! Para *${q} personas* el *${cuando}*:\n\n` +
      `🍽️ *Paquete Empresa* — ${colones(P_EMPRESA)} por persona\n` +
      "• Comida de adultos: chifrijo, chicharrón, cordon bleu, lomo jalapeño o quesabirrias\n" +
      "• Refrescos ilimitados\n" +
      "• 2 horas de cancha de pádel y futtenis\n" +
      "• Billar, arcade y el área que escojan\n" +
      `• Total: *${colones(q * P_EMPRESA)}*\n\n` +
      `🏆 *Paquete Empresa Torneo* — ${colones(P_TORNEO)} por persona\n` +
      "• Todo lo anterior y una hora más de cancha (3 en total)\n" +
      "• Cuadro de torneo armado por nosotros\n" +
      "• Diploma y premio para la pareja campeona: una noche en Hotel Nube o ₡15.000 en consumo\n" +
      `• Total: *${colones(q * P_TORNEO)}*` + pie;
  }
  // El paquete de Alegría es POR NIÑO; el adulto acompañante come aparte.
  // Si el cliente dio el desglose, cotizamos sobre los niños y sumamos los
  // adultos a ₡5.000 — cobrarle a un adulto tarifa de niño y ADEMÁS decirle
  // que los adultos van aparte es un precio que no se puede defender después.
  const nk = (d.ninos && d.ninos > 0) ? d.ninos : q;
  const na = (d.adultos && d.adultos > 0) ? d.adultos : 0;
  const desglosado = na > 0 && nk < q;
  const total = (p) => colones(nk * p + na * P_ADULTO);
  const quienes = desglosado
    ? `*${nk} niños* y *${na} adultos* el *${cuando}*`
    : `*${q} personas* el *${cuando}*`;

  return `¡Listo${nombre ? ", " + nombre : ""}! Para ${quienes}, ` +
    "nuestras *Fiestas de la Alegría* son de 3 horas:\n\n" +
    `• *Básico* ${colones(P_ALEGRIA.basico)} — comida, inflable, playground y maquinitas → ${total(P_ALEGRIA.basico)}\n` +
    `• *Con canchas* ${colones(P_ALEGRIA.canchas)} — lo anterior más pádel y futtenis → ${total(P_ALEGRIA.canchas)}\n` +
    `• *Completo* ${colones(P_ALEGRIA.completo)} — más algodón de azúcar, pastel de 20 cm y arco de globos → ${total(P_ALEGRIA.completo)}\n\n` +
    (desglosado
      ? `El paquete es por niño; los ${na} adultos van con almuerzo a ${colones(P_ADULTO)} cada uno, ya incluido arriba. ` +
        "Si prefieren café con bocadillos en vez de almuerzo son ₡3.000."
      : "Si van adultos acompañando: almuerzo ₡5.000 o café con bocadillos ₡3.000 por persona.") + pie;
}

const COMO_SALIR = "\n\n_Escribí *menú* o *asesor* cuando quieras._";

// ------------------------------------------------------- Airtable (opcional)
async function anotarEnAirtable(d, from, nombre, estado = "Cotizado") {
  const tk = process.env.AIRTABLE_TOKEN;
  if (!tk) return;
  const fields = {
    Referencia: `Fiesta · ${nombre || from} · ${d.fecha || "sin fecha"}`,
    Telefono: from,
    Nombre: nombre || "",
    Origen: "Entrante directo",
    "Tipo de fiesta": d.tipo || "Por definir",
    Personas: d.personas || null,
    Area: d.area || "Por definir",
    Paquete: d.grande ? "A la medida"
      : (d.tipo === "Empresa" ? "Empresa 9500" : "Por definir"),
    // Un grupo de 60 nunca recibió un precio: marcarlo "Cotizado" haría que
    // el equipo lo leyera como un lead ya atendido y nadie lo llamaría.
    Estado: estado,
    "Ultimo mensaje": String(d.ultimo || "").slice(0, 500),
    "Ultima actividad": new Date().toISOString(),
  };
  if (d.fecha) fields["Fecha deseada"] = d.fecha;

  const r = await fetch(
    "https://api.airtable.com/v0/apptnTz0OkjAAXADp/tblgZ15tXHhuDLYRy", {
      method: "POST",
      headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ fields }] }),
      signal: AbortSignal.timeout(5000),
    });
  if (!r.ok) console.log("⚠️ fiestas: Airtable", r.status, (await r.text()).slice(0, 180));
}

// ---------------------------------------------------------------- handler
/**
 * @returns { handled, dentro, salir }
 *   handled=false -> el bot sigue su camino de siempre.
 *   dentro=true   -> index deja userState en FIESTA_FLUJO.
 *   salir=true    -> index limpia el estado y sigue procesando el mensaje.
 */
async function handle({ from, rawText, profile, continuar, forzar, esBoton, redis,
                        sendWatiMessage, notifyHandoffAlert, logEvent }) {
  let enviado = false;
  try {
    if (!from) return { handled: false };

    // El borrador manda, no la memoria del proceso: asi el flujo sobrevive
    // un redeploy de Render (antes no, y eso dejaba el lead a medias).
    const guardado = await leer(redis, from);
    const vivo = guardado && guardado.ts && (Date.now() - guardado.ts) < EXPIRA_MS;
    if (guardado && !vivo) await borrar(redis, from);

    // "Estamos dentro" lo decide el borrador vivo, no userState: asi el flujo
    // sobrevive un reinicio de Render. (continuar ya se uso arriba para soltar
    // al cliente cuando el borrador caduco.)
    const dentroDeVerdad = Boolean(vivo);

    // Caducado: soltamos al cliente para que el bot lo atienda normal.
    if (continuar && !vivo) return { handled: false, salir: true };

    const t = norm(rawText);

    // Audio, foto o sticker dentro del flujo: no podemos leerlo.
    if (dentroDeVerdad && !t) {
      const d = { ...guardado, mudos: (guardado.mudos || 0) + 1 };
      if (d.mudos >= 2) {
        await borrar(redis, from);
        return { handled: false, salir: true };     // que lo agarre el bot normal
      }
      await guardar(redis, from, { ...d, ts: Date.now() });
      await sendWatiMessage(from,
        "Perdón, por acá solo puedo leer texto 😅 " +
        "¿Me lo escribís?" + COMO_SALIR);
      return { handled: true, dentro: true };
    }
    if (!t) return { handled: false };

    // Un toque de boton SIEMPRE sale. Los botones del menu llegan como id
    // numerico ("3" = "Hablar asesor"), asi que si no distinguieramos, el
    // cliente que pide un humano terminaria eligiendo "ambas areas".
    if (dentroDeVerdad && (esBoton || RE_SALIR_GLOBAL.test(t))) {
      await borrar(redis, from);
      return { handled: false, salir: true };       // index tiene los globales
    }
    if (dentroDeVerdad && RE_SALIR_SUAVE.test(t)) {
      await borrar(redis, from);
      await sendWatiMessage(from,
        "¡De una! Cuando quieran armar la fiesta me escriben. 🎈\n\n" +
        `Los paquetes quedan acá: ${LINK}`);
      return { handled: true, dentro: false };
    }

    if (!dentroDeVerdad && !forzar) {
      const claro = RE_INTENCION.test(t);
      const ambiguo = RE_AMBIGUA.test(t) && RE_APOYO.test(t);
      if (!claro && !ambiguo) return { handled: false };
    }

    const nombre = (profile?.name || "").split(" ")[0] || "";
    const previo = vivo ? guardado : {};

    // --- Respuestas numeradas.
    // El resto del bot es 100% menus numerados, asi que numeramos las opciones
    // y aceptamos el numero. Sin esto, un "1" se iba como salida y el lead
    // terminaba en el menu de comida.
    const paso = !previo.tipo ? "TIPO"
      : (!previo.personas ? "PERSONAS"
        : (!previo.fecha ? "FECHA" : (!previo.area ? "AREA" : "LISTO")));
    let texto = t;
    if (paso === "TIPO" && /^[1-3]$/.test(t)) {
      texto = { 1: "empresa", 2: "colegio fin de curso", 3: "cumpleanos" }[t];
    } else if (paso === "AREA" && /^[1-3]$/.test(t)) {
      texto = { 1: "restaurante", 2: "canchas padel", 3: "ambas" }[t];
    } else if (paso === "PERSONAS" && /^\d{1,3}$/.test(t)) {
      // Le acabamos de preguntar cuantos son. Un numero pelado es la respuesta
      // mas natural que existe, y sin esto extraer() no lo lee y repreguntamos
      // para siempre.
      texto = `${t} personas`;
    } else if (paso === "PERSONAS" && /^(entre\s+|de\s+)?\d{1,3}\s*(?:a|-|o|y)\s*\d{1,3}\s*(personas|invitados)?$/.test(t)) {
      // "entre 20 y 25", "20-25", "de 20 a 25": nos quedamos con el techo, que
      // es lo que hay que poder acomodar.
      const r = t.match(/(\d{1,3})\s*(?:a|-|o|y)\s*(\d{1,3})/);
      texto = `${Math.max(Number(r[1]), Number(r[2]))} personas`;
    } else if (paso === "FECHA" && /^\d{1,2}$/.test(t)) {
      // "5" a secas en la pregunta de fecha es el dia del mes, no 5 personas.
      await guardar(redis, from, { ...previo, ts: Date.now(), ultimo: rawText });
      await sendWatiMessage(from,
        `¿El ${t} de cuál mes? Escribímelo completo, por ejemplo *${t} de diciembre*.` +
        COMO_SALIR);
      return { handled: true, dentro: true };
    }

    const d = extraer(texto, previo);
    d.ultimo = rawText;
    d.ts = Date.now();
    d.mudos = 0;

    // --- Red de seguridad contra el bucle.
    // Si despues de procesar el mensaje seguimos en el MISMO paso, es que no
    // entendimos. A la segunda dejamos de repreguntar y lo pasamos a una
    // persona: repetir la misma pregunta diez veces pierde el lead y queda
    // horrible por escrito. El TTL no sirve de red acá porque cada mensaje
    // renueva el borrador.
    const pasoNuevo = !d.tipo ? "TIPO"
      : (!d.personas ? "PERSONAS"
        : (!d.fecha ? "FECHA" : (!d.area ? "AREA" : "LISTO")));
    d.paso = pasoNuevo;
    d.tropiezos = (pasoNuevo === paso && dentroDeVerdad) ? (previo.tropiezos || 0) + 1 : 0;

    if (d.tropiezos >= 2) {
      await borrar(redis, from);
      logEvent?.("fiesta_no_califica", { from, paso: pasoNuevo, texto: t.slice(0, 60) });
      await sendWatiMessage(from,
        "Mejor te paso con un compañero para que lo armen bien entre los dos 🙌\n\n" +
        "En un ratito te escribe. Mientras tanto, los paquetes están acá:\n" +
        `👉 ${LINK}`);
      notifyHandoffAlert?.({
        reason: "🎉 Fiesta: no pude calificarla",
        clientPhone: from,
        clientName: profile?.name || "",
        originalText: `Se trabó en ${pasoNuevo}. ` +
          `Tipo: ${d.tipo || "?"} · Personas: ${d.personas || "?"} · ` +
          `Fecha: ${d.fechaLinda || d.fecha || "?"} · Área: ${d.area || "?"} · ` +
          `Último: "${String(rawText).slice(0, 60)}"`,
      })?.catch?.((e) => console.log("⚠️ fiestas: alerta", e?.message));
      anotarEnAirtable(d, from, profile?.name, "Calificando")
        .catch((e) => console.log("⚠️ fiestas: Airtable", e?.message));
      return { handled: true, dentro: false };
    }

    // --- Grupo chico: no hay paquete que aplique. Se revisa APENAS sabemos
    // cuantos son, antes de gastarle preguntas de fecha y area.
    if (d.personas && d.personas < MINIMO) {
      await borrar(redis, from);
      logEvent?.("fiesta_grupo_chico", { from, personas: d.personas });
      await sendWatiMessage(from,
        `Para grupos de menos de ${MINIMO} personas no manejamos paquete, ` +
        "pero con mucho gusto les apartamos la mesa o la cancha:\n\n" +
        `👉 ${linkReservas(d.area, from)}\n\n` +
        `Si al final son ${MINIMO} o más, escribime y te paso el paquete completo. 😊`);
      return { handled: true, dentro: false };
    }

    // --- Grupo grande: cabemos 30. Arriba de eso NO se cotiza por WhatsApp:
    // un precio por escrito es un compromiso, y 120 personas no caben en el
    // paquete estándar. Va directo a una persona, que para eso es el lead
    // mas grande que puede entrar.
    if (d.personas && d.personas > MAXIMO) {
      await borrar(redis, from);
      logEvent?.("fiesta_grupo_grande", { from, personas: d.personas });
      await sendWatiMessage(from,
        `¡${d.personas} personas! 😍 Eso ya es más grande que nuestro paquete ` +
        `estándar, que llega hasta ${MAXIMO}.\n\n` +
        "Sí lo podemos hacer, pero se arma a la medida y hay que ver cómo " +
        "acomodamos el lugar. Ya le paso el dato a un compañero para que " +
        "les llame hoy mismo y lo cotice bien. 🙌");
      notifyHandoffAlert?.({
        reason: "🚨 Fiesta GRANDE (fuera de paquete)",
        clientPhone: from,
        clientName: profile?.name || "",
        originalText: `${d.personas} personas · ${d.tipo || "tipo?"} · ` +
          `${d.fechaLinda || d.fecha || "sin fecha"}`,
      })?.catch?.((e) => console.log("⚠️ fiestas: alerta", e?.message));
      anotarEnAirtable({ ...d, grande: true }, from, profile?.name, "Nuevo")
        .catch((e) => console.log("⚠️ fiestas: Airtable", e?.message));
      return { handled: true, dentro: false };
    }

    let msg;
    if (!d.tipo) {
      msg = (dentroDeVerdad ? "" :
        `🎈 ¡Qué bueno${nombre ? ", " + nombre : ""}! Con gusto le armamos la fiesta.\n` +
        "Le hago unas preguntas rápidas y le paso el precio exacto.\n\n") +
        "¿Qué tipo de fiesta es?\n\n" +
        "1️⃣ De *empresa* o fin de año\n" +
        "2️⃣ De *fin de curso* o colegio\n" +
        "3️⃣ Un *cumpleaños*" + COMO_SALIR;
    } else if (!d.personas) {
      msg = "¡Perfecto! ¿Más o menos *cuántas personas* van a ser?" + COMO_SALIR;
    } else if (!d.fecha) {
      msg = `Anotado: ${d.personas} personas.\n\n` +
        "¿Qué *fecha* tienen en mente? Trabajamos todos los días, en almuerzo o en cena." +
        COMO_SALIR;
    } else if (!d.area) {
      msg = "Última: ¿dónde la quieren?\n\n" +
        "1️⃣ En el *restaurante*\n" +
        "2️⃣ En las *canchas de pádel*\n" +
        "3️⃣ En *ambas*" +
        COMO_SALIR;
    } else {
      msg = cotizar(d, nombre);
    }

    const terminado = Boolean(d.tipo && d.personas && d.fecha && d.area);

    if (!terminado) {
      await guardar(redis, from, d);
      await sendWatiMessage(from, msg);
      enviado = true;
      logEvent?.("fiesta_pregunta", { from, tiene: Object.keys(d).join(",") });
      return { handled: true, dentro: true };
    }

    await borrar(redis, from);
    await sendWatiMessage(from, msg);
    enviado = true;

    // Ni la alerta ni Airtable pueden retrasar el 200 del webhook.
    const resumen = `${d.tipo} · ${d.personas} personas · ` +
      `${d.fechaLinda || d.fecha} · ${d.area}`;
    notifyHandoffAlert?.({
      reason: "🎉 Fiesta calificada",
      clientPhone: from,
      clientName: profile?.name || "",
      originalText: resumen,
    })?.catch?.((e) => console.log("⚠️ fiestas: alerta", e?.message));
    anotarEnAirtable(d, from, profile?.name)
      .catch((e) => console.log("⚠️ fiestas: Airtable", e?.message));

    logEvent?.("fiesta_calificada", { from, tipo: d.tipo, personas: d.personas });
    return { handled: true, dentro: false };
  } catch (e) {
    console.log("⚠️ fiestasHandler error:", e?.message);
    // Si ya le mandamos algo al cliente, NO devolvemos handled:false: eso
    // haria que index siguiera y le mandara un segundo mensaje encima.
    return enviado ? { handled: true, dentro: false } : { handled: false };
  }
}

/** Suelta el borrador a la fuerza. La usa la red de seguridad de index.js. */
async function soltar(redis, from) {
  try { await borrar(redis, from); } catch (e) { /* nunca importa */ }
}

module.exports = {
  handle, extraer, cotizar, soltar,
  RE_INTENCION, EXPIRA_MS, MINIMO, MAXIMO,
};
