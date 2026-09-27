// ============================================================================
// Buscador de platillos del menú, en código.
//
// Por qué existe: el 27-sep-2026 el bot le dijo a dos clientas que no teníamos
// California Roll (₡3.000), Duo coreano (₡5.000) ni Dedos de pollo (₡3.900).
// Los tres estaban en el menú Y en el prompt de la IA. El problema no era
// falta de información: era pedirle a gpt-4o-mini que encontrara un platillo
// entre 115 renglones de prosa. Fallaba, y siempre para el mismo lado —
// matando la venta. Una la rescató un humano 55 segundos después; la otra no
// sabemos.
//
// Buscar en el catálogo dejó de ser trabajo del modelo.
// ============================================================================

function normalizarPlato(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "deditos" → "dedos", "papitas" → "papas". El cliente habla en diminutivo y
// el menú no. Se prueban las dos formas, nunca se reemplaza: "burrito pollo"
// es un platillo real y no queremos convertirlo en "burro pollo".
function sinDiminutivos(s) {
  return s.replace(/(\w{2,}?)it([oa]s?)\b/g, "$1$2");
}

// ¿Difieren en a lo sumo una letra? Para los typos de WhatsApp: la clienta
// del 27-sep escribió "delitos" por "deditos".
function difiereEnUna(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, errores = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++errores > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return errores + (a.length - i) + (b.length - j) <= 1;
}

function mismaPalabra(clave, palabra, permitirTypo) {
  if (clave === palabra) return true;
  if (palabra === clave + "s" || palabra === clave + "es") return true;
  if (clave === palabra + "s" || clave === palabra + "es") return true;
  // el typo solo se tolera en palabras largas: en las cortas cambia el sentido
  return Boolean(permitirTypo) && clave.length >= 5 && palabra.length >= 5 &&
         difiereEnUna(clave, palabra);
}

// Busca la secuencia de palabras respetando límites de palabra. Sin esto,
// "birria" pegaba dentro de "quesabirrias" y traía la pizza equivocada.
function contieneSecuencia(palabrasMsg, palabrasClave, permitirTypo) {
  const n = palabrasClave.length;
  for (let i = 0; i + n <= palabrasMsg.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (!mismaPalabra(palabrasClave[j], palabrasMsg[i + j], permitirTypo)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

// Palabras de unión que el cliente pone y el menú no: el menú dice "Nachos
// Birria" y la gente escribe "nachos DE birria". Se quitan de los dos lados
// antes de comparar, así da igual quién las use.
const RELLENO = new Set([
  "de", "del", "la", "el", "los", "las", "con", "al", "a", "y", "en",
  "un", "una", "unos", "unas", "para", "por"
]);

function quitarRelleno(palabras) {
  const limpio = palabras.filter((p) => !RELLENO.has(p));
  return limpio.length ? limpio : palabras;   // "a la" solo: no lo vaciamos
}

// Cómo llama el cliente a las cosas vs cómo se llaman en el menú. Esto no lo
// resuelve ninguna búsqueda por parecido: "birria" y "quesabirrias" son
// palabras distintas. Vicente confirmó el 27-sep que la gente pide "tacos de
// birria" y el bot contestaba que no teníamos.
// Para agregar: poner la forma del CLIENTE (en minúscula, sin tildes) y el
// nombre EXACTO del platillo en el menú.
const ALIAS_CLIENTE = {
  "taco birria": "Quesabirrias",
  "taco quesabirria": "Quesabirrias",
  "birria taco": "Quesabirrias"
};

// Nombres de una sola palabra tan genéricos que buscarlos sueltos matchearía
// media conversación: el menú tiene un taco que se llama solamente "Pollo".
// Solo cuentan si el cliente nombra la categoría.
const GENERICOS = new Set([
  "pollo", "pastor", "camaron", "lomito", "vegetarianos", "res", "birria"
]);

// Qué palabra tiene que aparecer para desbloquear un nombre genérico,
// según la categoría del platillo. Antes esto era global y por eso
// "pizza de pastor" quedaba bloqueado por la regla del taco.
const CONTEXTO_POR_CATEGORIA = {
  "Tacos Mexicanos": ["taco"],
  "Pizzas": ["pizza"]
};

function formatearPrecio(n) {
  return "₡" + Number(n).toLocaleString("de-DE");   // 3.000, no "3 000"
}

const NIEGA_RX =
  /\b(no tenemos|no contamos con|no manejamos|no lo tenemos|no disponemos|no hay)\b/i;
const CONTRASTE_RX = /\b(pero|sin embargo|aunque|en cambio)\b/i;

/**
 * @param {Array} categorias PLAZA_MENU_CATEGORIES
 */
function crearBuscador(categorias) {
  const catalogo = [];
  for (const cat of categorias || []) {
    for (const item of cat.items || []) {
      const limpio = String(item.name).replace(/\(.*?\)/g, "").trim();
      const norm = normalizarPlato(limpio);
      const base = normalizarPlato(limpio.replace(/\s+(familiar|personal)$/i, ""));
      // los alias que apuntan a este platillo
      const alias = Object.entries(ALIAS_CLIENTE)
        .filter(([, destino]) => destino === item.name)
        .map(([forma]) => normalizarPlato(forma));
      catalogo.push({
        nombre: item.name,
        precio: item.price,
        categoria: cat.label,
        norm,
        // las pizzas son "Pepperoni Familiar" / "Pepperoni Personal";
        // la base deja que "pizza pepperoni" también pegue
        base,
        alias,
        // el contexto se pide por categoría, no por palabra suelta: así
        // "pastor" se desbloquea con "taco" si es taco y con "pizza" si es
        // pizza, en vez de que la regla del taco tape a la pizza
        requiere: GENERICOS.has(norm) ? (CONTEXTO_POR_CATEGORIA[cat.label] || null) : null
      });
    }
  }
  // más largo primero: "camaron roll" le gana al taco "camaron"
  catalogo.sort((a, b) => b.norm.length - a.norm.length);

  /** Platillos del menú que el cliente menciona. [] = decide la IA. */
  function buscarPlatillos(texto) {
    const base = normalizarPlato(texto);
    if (!base) return [];
    const formas = [base, sinDiminutivos(base)]
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((f) => quitarRelleno(f.split(" ").filter(Boolean)));

    const hablaDePizza = /\bpizza/.test(base);
    // si el cliente ya dijo el tamaño, no le ofrecemos el otro
    const dijoTamano = /\b(familiar|personal)\b/.test(base);
    const encontrados = [];
    const cubierto = [];

    // dos vueltas: exacto primero, con typo después, para que un match
    // exacto siempre le gane a uno aproximado
    for (const permitirTypo of [false, true]) {
      for (const it of catalogo) {
        if (encontrados.some((e) => e.nombre === it.nombre)) continue;

        // la clave "base" (pizza sin tamaño) solo si hablan de pizza; si no,
        // "tacos de pastor" traía la pizza Pastor
        const claves = [it.norm, ...it.alias];
        if (hablaDePizza && !dijoTamano && it.base !== it.norm) claves.push(it.base);

        for (const clave of claves) {
          if (!clave || clave.length < 5) continue;
          // el requisito de contexto es del platillo, no de la palabra
          if (it.requiere && !it.requiere.some((w) => base.includes(w))) continue;

          const pc = quitarRelleno(clave.split(" "));
          if (!formas.some((f) => contieneSecuencia(f, pc, permitirTypo))) continue;

          // ¿matcheó por la base de pizza ("birria") y no por el nombre
          // completo ("birria familiar")? Entonces el cliente no dijo tamaño
          // y hay que darle los dos, no cotizarle uno a dedo.
          const porBasePizza = clave === it.base && it.base !== it.norm;

          // "camaron roll" ya cubre al taco "camaron"
          if (!porBasePizza && pc.every((p) => cubierto.includes(p))) break;

          encontrados.push(it);
          if (!porBasePizza) pc.forEach((p) => cubierto.push(p));
          break;
        }
        if (encontrados.length >= 6) return encontrados;
      }
    }
    return encontrados;
  }

  /**
   * Línea para la IA, que va ARRIBA del prompt y no enterrada entre los 115
   * platillos. Esa es la diferencia entre que lo encuentre y que no.
   */
  function contextoPlatillos(hits) {
    if (!hits || !hits.length) return "";
    const lista = hits
      .map((h) => `${h.nombre} ${formatearPrecio(h.precio)} (${h.categoria})`)
      .join("; ");
    return (
      `PLATILLOS QUE EL CLIENTE MENCIONÓ Y QUE SÍ EXISTEN EN EL MENÚ: ${lista}. ` +
      "Están disponibles y esos son los precios exactos. " +
      "Bajo ninguna circunstancia digas que no los tenemos."
    );
  }

  /** Respuesta armada desde el catálogo, por si la IA igual niega. */
  function respuestaPlatillos(hits) {
    if (!hits || !hits.length) return "";
    let r = "¡Sí tenemos! 🙌\n\n";
    if (hits.length === 2) r = "¡Sí tenemos los dos! 🙌\n\n";
    else if (hits.length > 2) r = "¡Sí los tenemos! 🙌\n\n";
    for (const h of hits) r += `• *${h.nombre}* — ${formatearPrecio(h.precio)}\n`;
    r += "\nDecime si te lo preparamos y para cuándo lo querés 😊\n";
    r += "Precio no incluye 10% de servicio si comés acá, ni empaque si es para llevar.";
    return r;
  }

  /**
   * ¿La IA negó un platillo que sí existe? Solo se mira la cláusula ANTES del
   * "pero": "no tenemos X pero sí tenemos Y" niega X, no Y.
   */
  function niegaPlatilloReal(respuesta, hits) {
    if (!hits || !hits.length || !respuesta) return false;
    const corte = CONTRASTE_RX.exec(respuesta);
    const clausula = corte ? respuesta.slice(0, corte.index) : respuesta;
    if (!NIEGA_RX.test(clausula)) return false;
    const cn = normalizarPlato(clausula);
    const formas = [cn, sinDiminutivos(cn)];
    return hits.some((h) =>
      formas.some((f) => f.includes(h.norm) || f.includes(h.base))
    );
  }

  return {
    buscarPlatillos,
    contextoPlatillos,
    respuestaPlatillos,
    niegaPlatilloReal,
    _catalogo: catalogo
  };
}

module.exports = {
  crearBuscador,
  normalizarPlato,
  sinDiminutivos,
  difiereEnUna,
  formatearPrecio
};
