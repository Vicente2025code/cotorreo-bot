// ================================
// PRECIOS HANDLER — Combos Mundialistas + fallback calido
// ================================
// Detecta preguntas sobre combos del Mundial y responde con foto + precio + CTA.
// Si pregunta precio pero NO es de combo conocido, responde calido y avisa a Vicente.
// Sino devuelve {handled:false} y sigue el flujo normal del bot.
//
// Vigencia promo: 11 jun 2026 -> 19 jul 2026 (todo el Mundial)
// Telefono restaurante: 6303-8030
//
// Hookear ANTES de mundialHandler.handle() en index.js para que "combo
// mundialista" caiga aqui (foto+precio) y no en mundialHandler (texto quiniela).

const VIGENCIA_FIN = new Date("2026-07-19T23:59:59-06:00").getTime();
const VICENTE_NUM = process.env.PRECIOS_NOTIFY_TO || "50672882394";
const TEL_RESTAURANTE = "6303-8030";

// ================================
// CATALOGO DE COMBOS
// ================================
const COMBOS = {
  mexico: {
    pais: "México",
    flag: "🇲🇽",
    plato: "8 tacos de pastor",
    precio_total: 8500,
    precio_persona: 4250,
    imagen: "https://files.catbox.moe/998xbw.jpg",
    keywords: ["mexico", "méxico", "mexicano", "tacos pastor", "pastor", "tacos de pastor"],
  },
  japon: {
    pais: "Japón",
    flag: "🇯🇵",
    plato: "2 Sushi Camarón Roll",
    precio_total: 9300,
    precio_persona: 4650,
    imagen: "https://files.catbox.moe/5jgagt.jpg",
    keywords: ["japon", "japón", "japonés", "sushi", "camaron roll", "camarón roll", "rolls"],
  },
  usa: {
    pais: "USA",
    flag: "🇺🇸",
    plato: "2 Burger BBQ",
    precio_total: 13000,
    precio_persona: 6500,
    imagen: "https://files.catbox.moe/wqbg85.jpg",
    keywords: ["usa", "estados unidos", "burger", "burguer", "hamburguesa", "bbq", "barbacoa"],
  },
  francia: {
    pais: "Francia",
    flag: "🇫🇷",
    plato: "2 Cordon Bleu",
    precio_total: 10300,
    precio_persona: 5150,
    imagen: "https://files.catbox.moe/t4t6l0.jpg",
    keywords: ["francia", "francés", "cordon bleu", "cordón bleu", "cordon", "frances"],
  },
  argentina: {
    pais: "Argentina",
    flag: "🇦🇷",
    plato: "Parrillada para 2",
    precio_total: 14000,
    precio_persona: 7000,
    imagen: "https://files.catbox.moe/d0dxxe.jpg",
    keywords: ["argentina", "argentino", "parrillada", "parrilla", "asado", "asadito"],
  },
};

// ================================
// DETECTORES
// ================================
const PALABRAS_PRECIO = [
  "cuanto", "cuánto", "costo", "precio", "vale", "cobran", "valor",
  "cuesta", "cuestan", "esta", "está", "cuánto es", "cuanto es",
];

const PALABRAS_COMBO_GENERICO = [
  "combos mundialistas", "combo mundialista", "combos del mundial",
  "combos de mundial", "que combos", "qué combos", "los combos",
  "cuales son los combos", "cuáles son los combos", "ver combos",
];

function normalizar(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .trim();
}

function detectarComboEspecifico(text) {
  const t = normalizar(text);
  if (!t) return null;
  // Necesita mencionar "combo"/"mundialista" + un país, O directamente el plato específico
  const menciona_combo = /\bcombo|mundialist/.test(t);
  // Palabras muy genéricas que NO deberían disparar combo mundialista por sí solas.
  // Ej: "promo de sushi?" en martes debe ir a IA para ofrecer el Martes sushiero
  // (rollo+rollo), no el combo mundialista japón.
  const GENERICAS = new Set([
    "sushi", "burger", "burguer", "hamburguesa", "asado", "parrilla",
    "pastor", "tacos pastor", "tacos de pastor", "rolls"
  ]);
  for (const [key, combo] of Object.entries(COMBOS)) {
    const keywordsNormalizadas = combo.keywords.map(k => normalizar(k));
    const matchPlato = keywordsNormalizadas.some(k => {
      if (k.length < 5) return false;
      if (!t.includes(k)) return false;
      if (GENERICAS.has(k) && !menciona_combo) return false;
      return true;
    });
    const matchPais = keywordsNormalizadas.some(k =>
      ["mexico", "japon", "usa", "francia", "argentina"].includes(k) && t.includes(k)
    );
    if (matchPlato || (menciona_combo && matchPais)) {
      return key;
    }
  }
  return null;
}

function detectarComboGenerico(text) {
  const t = normalizar(text);
  return PALABRAS_COMBO_GENERICO.some(k => t.includes(normalizar(k)));
}

function detectarPreguntaPrecio(text) {
  const t = normalizar(text);
  return PALABRAS_PRECIO.some(k => t.includes(normalizar(k)));
}

function vigenciaActiva() {
  return Date.now() < VIGENCIA_FIN;
}

// ================================
// COPYS
// ================================
function copyComboEspecifico(comboKey) {
  const c = COMBOS[comboKey];
  return (
    `${c.flag} *Combo Mundialista ${c.pais}*\n` +
    `${c.plato} + 2 cervezas/bebidas\n\n` +
    `💰 *₡${c.precio_total.toLocaleString("es-CR")}* en total\n` +
    `(₡${c.precio_persona.toLocaleString("es-CR")} por persona)\n\n` +
    `📅 Disponible todo el Mundial (hasta el 19 de julio)\n\n` +
    `📍 Te esperamos en Plaza Cotorreo. Si querés mesa reservada para el partido inaugural, llamanos al *${TEL_RESTAURANTE}*.`
  );
}

function copyListaCombos() {
  const items = Object.values(COMBOS).map(c =>
    `${c.flag} *${c.pais}* — ${c.plato} = ₡${c.precio_total.toLocaleString("es-CR")} (₡${c.precio_persona.toLocaleString("es-CR")} p/p)`
  ).join("\n");
  return (
    `🏆 *Combos Mundialistas Cotorreo*\n\n` +
    `${items}\n\n` +
    `Todos incluyen 2 cervezas/bebidas.\n` +
    `📅 Disponibles durante todo el Mundial (jue 11 jun → dom 19 jul).\n\n` +
    `¿De cuál querés más info? Escribí el nombre (ej: "combo argentina") y te mando la foto. 📸\n\n` +
    `📍 Reservas al *${TEL_RESTAURANTE}*.`
  );
}

const COPY_FALLBACK_PRECIO =
  "¡Buena pregunta! Dejame consultar el precio exacto y te respondo en máximo 5 minutos 🙌\n\n" +
  "Si preferís llamar directo, marcá al *6303-8030* y te atendemos al toque.";

// ================================
// NOTIFICACION INTERNA
// ================================
async function notificarLeadEsperando(from, textOriginal, sendWatiMessage) {
  const ultimos4 = String(from || "").slice(-4);
  const aviso =
    `🔔 *Lead esperando precio*\n\n` +
    `📱 De: ${from} (...${ultimos4})\n` +
    `❓ Preguntó: "${textOriginal.slice(0, 200)}"\n\n` +
    `Respondele ya en WATI antes que se enfríe.`;
  try {
    await sendWatiMessage(VICENTE_NUM, aviso);
  } catch (e) {
    console.log("preciosHandler: error notificando Vicente:", e?.message);
  }
}

// ================================
// HANDLER PRINCIPAL
// ================================
async function handle({ from, text, sendWatiMessage, sendWatiImage }) {
  // Kill switch
  if (process.env.PRECIOS_HANDLER_DISABLED === "true") {
    return { handled: false };
  }

  // Si la promo ya expiró, NO interceptamos combos (sigue flujo normal)
  if (!vigenciaActiva()) {
    return { handled: false };
  }

  const t = text || "";
  if (!t || t.length < 2) return { handled: false };

  // 1) Combo especifico (ej: "combo mexico", "cuanto cuestan las hamburguesas")
  const comboKey = detectarComboEspecifico(t);
  if (comboKey) {
    const combo = COMBOS[comboKey];
    const caption = copyComboEspecifico(comboKey);
    try {
      if (typeof sendWatiImage === "function") {
        await sendWatiImage(from, combo.imagen, caption);
      } else {
        // Fallback: solo texto + URL
        await sendWatiMessage(from, caption + "\n\n📸 Foto: " + combo.imagen);
      }
      console.log(`preciosHandler: respondio combo ${comboKey} a ${from.slice(-4)}`);
      return { handled: true };
    } catch (e) {
      console.log("preciosHandler: error enviando combo:", e?.message);
      return { handled: false };
    }
  }

  // 2) Pregunta generica por combos mundialistas
  if (detectarComboGenerico(t)) {
    try {
      await sendWatiMessage(from, copyListaCombos());
      console.log(`preciosHandler: respondio lista combos a ${from.slice(-4)}`);
      return { handled: true };
    } catch (e) {
      console.log("preciosHandler: error enviando lista:", e?.message);
      return { handled: false };
    }
  }

  // 3) Fallback SOLO para preguntas de precio sobre eventos/fiestas/catering
  // (cosas que la IA NO sabe). Para hamburguesa, sushi, tacos, etc. dejamos
  // que la IA responda con precio del menu.
  const esPreguntaPrecio = detectarPreguntaPrecio(t);
  const tNorm = normalizar(t);
  // Solo activar fallback para categorias que la IA NO maneja bien
  const mencionaProductoNoIA = /\b(paquete|fiesta|evento|catering|domicilio|delivery|servicio a domicilio)\b/.test(tNorm);

  if (esPreguntaPrecio && mencionaProductoNoIA) {
    try {
      await sendWatiMessage(from, COPY_FALLBACK_PRECIO);
      await notificarLeadEsperando(from, t, sendWatiMessage);
      console.log(`preciosHandler: fallback precio + ping a ${from.slice(-4)}`);
      return { handled: true };
    } catch (e) {
      console.log("preciosHandler: error fallback precio:", e?.message);
      return { handled: false };
    }
  }

  // Nada matchea → seguir flujo normal
  return { handled: false };
}

module.exports = {
  handle,
  COMBOS,
  detectarComboEspecifico,
  detectarComboGenerico,
  detectarPreguntaPrecio,
};
