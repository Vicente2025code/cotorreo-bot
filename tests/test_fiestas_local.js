// test_fiestas_local.js
// Prueba el fiestasHandler sin tocar WATI, Redis ni Airtable de verdad.
//   node tests/test_fiestas_local.js

const fiestas = require("../services/fiestasHandler");

let fallos = 0;
const ok = (cond, etiqueta) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + etiqueta);
  if (!cond) fallos++;
};

// --- dobles de prueba
function hacerRedis({ roto = false } = {}) {
  const m = new Map();
  const boom = () => { throw new Error("redis caido"); };
  return roto
    ? { get: boom, set: boom, del: boom }
    : {
        get: async (k) => m.get(k) || null,
        set: async (k, v) => m.set(k, v),
        del: async (k) => m.delete(k),
      };
}

// Cada sesión necesita su PROPIO número: el respaldo en memoria del handler
// es de módulo, así que dos sesiones con el mismo teléfono se heredan el
// borrador — igual que un cliente real que vuelve antes de 45 min.
let secuencia = 0;
function sesion(opts = {}) {
  const enviados = [];
  const alertas = [];
  const redis = hacerRedis(opts);
  const tel = "5069000" + String(++secuencia).padStart(4, "0");
  let dentro = false;
  return {
    enviados, alertas, tel,
    async decir(texto, profile = { name: "Karla Jiménez" }, esBoton = false) {
      const r = await fiestas.handle({
        from: tel, rawText: texto, profile, esBoton,
        continuar: dentro, redis,
        sendWatiMessage: async (_t, m) => enviados.push(m),
        notifyHandoffAlert: async (a) => alertas.push(a),
        logEvent: () => {},
      });
      if (r.handled) dentro = Boolean(r.dentro);
      if (r.salir) dentro = false;
      return r;
    },
  };
}

(async () => {
  console.log("\n1. Empresa, paso a paso");
  {
    const s = sesion();
    await s.decir("Hola, quiero info para la fiesta de mi empresa");
    ok(/cuántas personas/.test(s.enviados[0]), "pregunta cuantas personas");
    await s.decir("somos como 22");
    ok(/fecha/.test(s.enviados[1]), "pregunta la fecha");
    await s.decir("el 12 de diciembre");
    ok(/restaurante[\s\S]*canchas[\s\S]*ambas/i.test(s.enviados[2]), "pregunta el area");
    const r = await s.decir("ambas");
    ok(/₡209\.000/.test(s.enviados[3]), "cotiza 22 × 9.500 = ₡209.000");
    ok(/₡253\.000/.test(s.enviados[3]), "cotiza el torneo = ₡253.000");
    ok(/Hotel Nube/.test(s.enviados[3]), "menciona el premio");
    ok(s.alertas.length === 1, "avisa al equipo una sola vez");
    ok(/22 personas/.test(s.alertas[0].originalText), "la alerta trae el resumen");
    ok(r.dentro === false, "cierra el flujo al cotizar");
  }

  console.log("\n2. Todo en un solo mensaje (fin de curso)");
  {
    const s = sesion();
    await s.decir("somos la escuela, el fin de curso el 4/12 para 28 niños en el restaurante");
    ok(s.enviados.length === 1, "no hace ninguna pregunta de más");
    ok(/Alegría/.test(s.enviados[0]), "cotiza con los paquetes de Alegría");
    ok(/₡182\.000/.test(s.enviados[0]), "28 × 6.500 = ₡182.000");
  }

  console.log("\n3. La edad NO es el número de invitados");
  {
    const s = sesion();
    await s.decir("es el cumpleaños de mi hija, va a cumplir 8 años");
    ok(/cuántas personas/.test(s.enviados.at(-1)), "no se tragó el 8 como invitados");
    await s.decir("seriamos 18 chiquitos, el 20 de diciembre, en las canchas");
    ok(/18 personas/.test(s.enviados.at(-1)), "sí toma los 18");
  }

  console.log("\n4. REGRESIÓN: fiesta que menciona canchas");
  {
    const s = sesion();
    const r = await s.decir("quiero hacer la fiesta de la empresa en las canchas");
    ok(r.handled === true, "lo agarra fiestas, NO el shortcut de reservas");
    ok(/cuántas personas/.test(s.enviados[0]), "ya tiene tipo y área, pide personas");
  }

  console.log("\n5. Mensajes que NO son de fiesta: el bot sigue como siempre");
  {
    for (const m of ["a que hora abren?", "quiero reservar una cancha el jueves",
                     "tienen mesa para 4 hoy?", "hola buenas tardes",
                     "cuanto cuesta la hora de padel"]) {
      const s = sesion();
      const r = await s.decir(m);
      ok(r.handled === false && s.enviados.length === 0, `no contesta: "${m}"`);
    }
  }

  console.log("\n6. Salidas del flujo");
  {
    const s = sesion();
    await s.decir("quiero una fiesta de empresa");
    const r = await s.decir("asesor");
    ok(r.handled === false && r.salir === true, "'asesor' lo saca y deja seguir al bot");
  }

  console.log("\n7. Si Redis está caído, la conversación sigue");
  {
    const s = sesion({ roto: true });
    await s.decir("fiesta de empresa");
    await s.decir("25 personas");
    await s.decir("5 de diciembre");
    await s.decir("ambas");
    ok(/₡237\.500/.test(s.enviados.at(-1)), "cotiza igual con memoria (25 × 9.500)");
  }

  console.log("\n8. Sin AIRTABLE_TOKEN no se cae");
  {
    delete process.env.AIRTABLE_TOKEN;
    const s = sesion();
    await s.decir("fiesta de empresa para 10 el 6 de diciembre en el restaurante");
    ok(s.enviados.length === 1 && /Total/.test(s.enviados[0]), "cotiza sin Airtable");
    ok(s.alertas.length === 1, "y aun así avisa al equipo");
  }

  console.log("\n9. Grupo chico: NO se le cotiza paquete");
  {
    const s = sesion();
    const r = await s.decir("reservar mesa para mi cumpleaños, somos 4");
    ok(/menos de 10 personas no manejamos paquete/.test(s.enviados.at(-1)),
       "le explica que no hay paquete");
    ok(/cliente\.html/.test(s.enviados.at(-1)), "lo manda a reservar normal");
    ok(!/₡38\.000/.test(s.enviados.at(-1)), "NO le cotiza 4 × 9.500");
    ok(r.dentro === false, "cierra el flujo");
    ok(s.alertas.length === 0, "no molesta al equipo por una mesa de 4");
  }

  console.log("\n10. Vía IA (forzar): frases que ninguna keyword agarra");
  {
    for (const m of ["necesito un lugar para juntar a los 20 del trabajo en diciembre",
                     "hacen algo para despedir el año con los companeros?",
                     "mi mama cumple 60 y queremos algo bonito"]) {
      const s = sesion();
      const r = await fiestas.handle({
        from: "50600001111", rawText: m, profile: { name: "Luis" },
        continuar: false, forzar: true, redis: hacerRedis(),
        sendWatiMessage: async (_t, x) => s.enviados.push(x),
        notifyHandoffAlert: async () => {}, logEvent: () => {},
      });
      ok(r.handled === true, `la IA puede abrir el flujo: "${m}"`);
    }
    // y sin forzar, esas mismas frases NO disparan por keyword
    const s2 = sesion();
    const r2 = await s2.decir("necesito un lugar para juntar a los 20 del trabajo en diciembre");
    ok(r2.handled === false, "sin la IA, esa frase se le escapa a las keywords");
  }

  // ══════════ los casos que encontró la revisión ══════════

  console.log("\n11. CRITICAL 1 — salidas: nadie queda encerrado");
  {
    // Todo lo que isGlobalCommand() acepta en index.js. Ojo: "1".."3" NO van
    // acá — son las opciones del menú numerado del propio flujo (test 11b).
    for (const salida of ["menu", "menú", "inicio", "hola", "asesor",
                          "carrito", "reservas", "0", "9"]) {
      const s = sesion();
      await s.decir("quiero la fiesta de mi empresa");
      const r = await s.decir(salida);
      ok(r.salir === true && r.handled === false,
         `"${salida}" lo suelta y lo atiende index`);
    }
    // El botón "👤 Hablar asesor" llega como "3": ESE era el bug de los 3
    // clientes. Tecleado es la opción 3; tocado en el botón es un humano.
    const s = sesion();
    await s.decir("fiesta de empresa");
    const antes = s.enviados.length;
    const r = await s.decir("3", { name: "Karla Jiménez" }, true);
    ok(r.salir === true && s.enviados.length === antes,
       "botón Hablar asesor: sale sin contestar encima");
  }

  console.log("\n11b. El menú numerado: 1/2/3 son opciones, no salidas");
  {
    const s = sesion();
    await s.decir("quiero hacer una fiesta");
    ok(/1️⃣/.test(s.enviados.at(-1)), "las opciones de tipo van numeradas");
    const r = await s.decir("1");
    ok(r.handled === true && r.dentro === true && /cuántas personas/.test(s.enviados.at(-1)),
       '"1" elige empresa y sigue, no se va al menú de comida');
    await s.decir("somos 20");
    await s.decir("12 de diciembre");
    ok(/2️⃣/.test(s.enviados.at(-1)), "las opciones de área van numeradas");
    await s.decir("3");
    ok(/₡190\.000/.test(s.enviados.at(-1)), '"3" = ambas, y cotiza 20 × 9.500');

    // Un día del mes suelto en la pregunta de fecha no son personas.
    const s2 = sesion();
    await s2.decir("fiesta de empresa para 20 personas");
    const r2 = await s2.decir("31");
    ok(r2.dentro === true && /cuál mes/.test(s2.enviados.at(-1)),
       '"31" en la pregunta de fecha pregunta el mes, no cotiza ni cambia el grupo');
  }

  console.log("\n12. CRITICAL 1b — salidas suaves no caen en la IA");
  {
    for (const salida of ["cancelar", "salir", "volver", "atras"]) {
      const s = sesion();
      await s.decir("fiesta de empresa");
      const r = await s.decir(salida);
      ok(r.handled === true && r.dentro === false,
         `"${salida}" lo cierra el handler, no el LLM`);
    }
  }

  console.log("\n13. CRITICAL 2 — grupos de 3 dígitos (el lead grande)");
  {
    for (const [msg, esperado] of [["somos 120", 120], ["somos 120 personas", 120],
                                   ["seriamos unas 100 personas", 100],
                                   ["vamos a ser 150 colaboradores", 150],
                                   ["somos 99 personas", 99], ["somos 300", 300]]) {
      const d = fiestas.extraer(msg, { tipo: "Empresa" });
      ok(d.personas === esperado, `"${msg}" -> ${d.personas} (esperado ${esperado})`);
    }
    // y que los precios SIGAN sin contarse como gente
    const d2 = fiestas.extraer("tengo como 150 mil de presupuesto", { tipo: "Empresa" });
    ok(!d2.personas, "\"150 mil de presupuesto\" no son 150 personas");
    const d3 = fiestas.extraer("vi que son 9.500 por persona", { tipo: "Empresa" });
    ok(!d3.personas, "\"9.500 por persona\" no son personas");
  }

  console.log("\n14. CRITICAL 3 — el estado caduca");
  {
    const redis = hacerRedis();
    const viejo = { tipo: "Empresa", ts: Date.now() - (fiestas.EXPIRA_MS + 60000) };
    await redis.set("fiesta_draft:50644445555", JSON.stringify(viejo));
    const env = [];
    const r = await fiestas.handle({
      from: "50644445555", rawText: "tienen mesa para 4 hoy?",
      profile: { name: "Ana" }, continuar: true, redis,
      sendWatiMessage: async (_t, m) => env.push(m),
      notifyHandoffAlert: async () => {}, logEvent: () => {},
    });
    ok(r.salir === true && env.length === 0,
       "borrador de hace 46 min: lo suelta y NO le roba la reserva de mesa");
  }

  console.log("\n15. HIGH 4 — el borrador sobrevive un reinicio de Render");
  {
    const redis = hacerRedis();
    const env = [];
    const llamar = (texto, continuar) => fiestas.handle({
      from: "50655556666", rawText: texto, profile: { name: "Luis" },
      continuar, redis,
      sendWatiMessage: async (_t, m) => env.push(m),
      notifyHandoffAlert: async () => {}, logEvent: () => {},
    });
    await llamar("fiesta de la empresa", false);
    // Render reinicia: userState se vacía, así que index manda continuar=false
    const r = await llamar("somos 25", false);
    ok(r.handled === true && /fecha/.test(env.at(-1)),
       "después del reinicio retoma donde iba, no empieza de cero");
  }

  console.log("\n16. HIGH 6 — números que NO son personas");
  {
    const casos = [
      ["la fiesta de la empresa el 12 de diciembre a las 7 de la noche", undefined, "la hora no son 7 personas"],
      ["queremos algo el 20 a las 8 de la noche para la empresa", undefined, "ni el 20 ni el 8"],
      ["somos 10 adultos y 12 niños", 22, "suma adultos + niños"],
      ["somos 30 personas, 20 adultos y 10 niños", 30, "'30 personas' es el total, no suma 60"],
      ["queremos la fiesta de fin de año de la empresa el 31", undefined,
       "'el 31' es 31 de diciembre, NO 31 personas"],
      ["la fiesta de la empresa el 20 en el restaurante", undefined,
       "'el 20' tampoco son 20 personas"],
      ["fiesta de empresa para 25", 25, "'para 25' sí es un conteo"],
      ["la queremos para el 31", undefined, "'para el 31' es fecha, no conteo"],
    ];
    for (const [msg, esperado, etiqueta] of casos) {
      const d = fiestas.extraer(msg, {});
      ok(d.personas === esperado, `${etiqueta} (dio ${d.personas})`);
    }
    const dF = fiestas.extraer("evento el 30 de febrero", {});
    ok(!dF.fecha, "30 de febrero se descarta en vez de mandarle 422 a Airtable");
  }

  console.log("\n17. MEDIUM 7 — 'paquete' solo ya no secuestra");
  {
    for (const m of ["¿tienen paquetes de sushi?", "el paquete de 20 piezas",
                     "quiero el paquete ejecutivo"]) {
      const s = sesion();
      const r = await s.decir(m);
      ok(r.handled === false, `no lo agarra: "${m}"`);
    }
    const s2 = sesion();
    const r2 = await s2.decir("¿qué paquetes tienen para la empresa?");
    ok(r2.handled === true, "pero 'paquetes ... empresa' sí");
  }

  console.log("\n18. Nota de voz dentro del flujo");
  {
    const s = sesion();
    await s.decir("fiesta de empresa");
    const r1 = await s.decir("");
    ok(r1.handled === true && /solo puedo leer texto/.test(s.enviados.at(-1)),
       "primera vez: le pide que escriba");
    const r2 = await s.decir("");
    ok(r2.salir === true, "segunda vez: lo suelta, no lo deja pegado");
  }

  console.log("\n19. Grupo más grande que el lugar: NO se cotiza por escrito");
  {
    const s = sesion();
    await s.decir("fiesta de fin de año de la empresa");
    await s.decir("somos 120");
    const ultimo = s.enviados.at(-1);
    ok(!/1\.140\.000/.test(ultimo), "NO le manda un precio para 120 personas");
    ok(/más grande que nuestro paquete/.test(ultimo), "le explica que se sale del paquete");
    ok(/a la medida/.test(ultimo), "le ofrece armarlo a la medida");
    ok(s.alertas.length === 1 && /GRANDE/.test(s.alertas[0].reason),
       "avisa al equipo con alerta propia");
    ok(/120 personas/.test(s.alertas[0].originalText), "la alerta trae el tamaño");
  }

  console.log("\n20. El borde: 30 sí, 31 no");
  {
    const s30 = sesion();
    await s30.decir("fiesta de empresa para 30 el 5 de diciembre en ambas");
    ok(/₡285\.000/.test(s30.enviados.at(-1)), "30 personas sí se cotiza (30 × 9.500)");
    const s31 = sesion();
    await s31.decir("fiesta de empresa para 31 el 5 de diciembre en ambas");
    ok(/más grande que nuestro paquete/.test(s31.enviados.at(-1)), "31 ya pasa a persona");
  }

  console.log("\n21. BLOQUEANTE: el número pelado y el bucle");
  {
    const s = sesion();
    await s.decir("quiero hacer la fiesta de la empresa");
    await s.decir("20");
    ok(/fecha/.test(s.enviados.at(-1)), '"20" pelado SÍ son 20 personas, avanza a la fecha');

    // Rangos, que es como habla la gente de verdad
    for (const [frase, esperado] of [["entre 20 y 25", 25], ["20-25", 25], ["de 20 a 30", 30]]) {
      const x = sesion();
      await x.decir("fiesta de empresa");
      await x.decir(frase);
      ok(/fecha/.test(x.enviados.at(-1)), `"${frase}" se entiende (techo ${esperado})`);
    }

    // Nadie se queda dando vueltas: a la segunda que no entendemos, va a humano
    const b = sesion();
    await b.decir("quiero una fiesta");
    await b.decir("una despedida de soltera");
    const r = await b.decir("no sé todavía");
    ok(r.dentro === false && /compañero/.test(b.enviados.at(-1)),
       "a los 2 tropiezos lo pasa a una persona en vez de repreguntar ∞");
    ok(b.alertas.length === 1 && /no pude calificarla/.test(b.alertas[0].reason),
       "y avisa al equipo con el contexto");
    ok(/Se trabó en TIPO/.test(b.alertas[0].originalText), "la alerta dice en qué paso se trabó");

    // El lead caro que escribe el número pelado NO se pierde en el bucle
    const g = sesion();
    await g.decir("fiesta de fin de año de la empresa");
    await g.decir("120");
    ok(/más grande que nuestro paquete/.test(g.enviados.at(-1)),
       '"120" pelado escala a persona, no se queda en el loop');
  }

  console.log("\n22. BLOQUEANTE: adultos no pagan tarifa de niño");
  {
    const s = sesion();
    await s.decir("es el cumpleaños de mi hijo, somos 12 niños y 10 adultos, el 20 de diciembre en el restaurante");
    const m = s.enviados.at(-1);
    ok(!/₡143\.000/.test(m), "NO cobra los 22 a tarifa de niño");
    ok(/₡128\.000/.test(m), "12 × 6.500 + 10 × 5.000 = ₡128.000");
    ok(/12 niños/.test(m) && /10 adultos/.test(m), "dice el desglose que usó");
    ok(!/Si van adultos acompañando/.test(m), "y ya no repite que los adultos van aparte");

    // Sin desglose se comporta como antes
    const s2 = sesion();
    await s2.decir("cumpleaños para 20 el 20 de diciembre en el restaurante");
    ok(/₡130\.000/.test(s2.enviados.at(-1)), "sin desglose: 20 × 6.500 = ₡130.000");
  }

  console.log(fallos === 0
    ? "\n✅ TODO BIEN\n"
    : `\n❌ ${fallos} fallo(s)\n`);
  process.exit(fallos === 0 ? 0 : 1);
})();
