// Que el bot reconozca su PROPIO menu cuando WATI se lo devuelve.
//
//   node tests/test_eco_del_bot.js
//
// El caso central no esta inventado: es el eco que recibio el bot el
// 24-nov-2026 a las 18:12:31, 300 ms despues de mandarle el menu principal a
// la audiologa Deylin Mena. Lo leyo como "un humano contesto", se callo, y
// cuando ella toco "Quiero información" le contesto "ya esta en la fila" en
// vez del cotizador de cierres de ano.

const eco = require("../services/ecoDelBot");

let pass = 0, fail = 0;
function t(name, fn) {
  const ok = () => { console.log("✅", name); pass++; };
  const mal = (e) => { console.log("❌", name, "—", e.message); fail++; };
  let r;
  try { r = fn(); } catch (e) { mal(e); return Promise.resolve(); }
  return Promise.resolve(r).then(ok, mal);
}
function eq(a, b) {
  if (a !== b) throw new Error(`esperado ${JSON.stringify(b)}, recibido ${JSON.stringify(a)}`);
}

function fakeRedis() {
  const sets = new Map();
  const ttl = new Map();
  return {
    _sets: sets, _ttl: ttl,
    async sadd(k, v) {
      if (!sets.has(k)) sets.set(k, new Set());
      sets.get(k).add(v);
      return 1;
    },
    async smembers(k) { return sets.has(k) ? [...sets.get(k)] : []; },
    async expire(k, s) { ttl.set(k, s); return 1; },
  };
}

// El cuerpo que sendWatiButtonsMessage le pasa a WATI.
const CUERPO = `🎉 *Hoy:* 🍣 *Martes sushiero*: rollo + rollo gratis. Pedís 1 y *te llevás 2* — perfecto para vos y un cómplice 🤝

¡Hola Audióloga Deylin Mena! Bienvenido/a a *Grupo Cotorreo*.

¿Qué te late hacer hoy?`;

// Lo que WATI devolvio por webhook: encabezado + cuerpo + botones numerados.
const ECO = `🏢 Grupo Cotorreo
🎉 *Hoy:* 🍣 *Martes sushiero*: rollo + rollo gratis. Pedís 1 y *te llevás 2* — perfecto para vos y un cómplice 🤝

¡Hola Audióloga Deylin Mena! Bienvenido/a a *Grupo Cotorreo*.

¿Qué te late hacer hoy?

1. 🍽️ Comer en Plaza
2. 🎾 Jugar pádel
3. 👤 Hablar asesor
 `;

const TEL = "50670795036";

(async () => {
  await t("🔴 caso Deylin Mena: el bot reconoce su propio menú", async () => {
    const redis = fakeRedis();
    eq(await eco.registrarCuerpo(redis, TEL, CUERPO), true);
    eq(await eco.cuerpoCoincide(redis, TEL, ECO), true);
  });

  await t("el número se normaliza a dígitos en los dos lados", async () => {
    const redis = fakeRedis();
    await eco.registrarCuerpo(redis, "+506 7079-5036", CUERPO);
    eq(await eco.cuerpoCoincide(redis, TEL, ECO), true);
  });

  await t("🔴 un humano escribiendo a mano NO es eco", async () => {
    const redis = fakeRedis();
    await eco.registrarCuerpo(redis, TEL, CUERPO);
    eq(await eco.cuerpoCoincide(redis, TEL,
      "Buenas tardes doctora, le paso los paquetes del cierre de año"), false);
    // ni aunque mencione el nombre de la marca
    eq(await eco.cuerpoCoincide(redis, TEL,
      "Hola, le escribe Mariela de Grupo Cotorreo"), false);
  });

  await t("sin nada registrado no hay eco", async () => {
    eq(await eco.cuerpoCoincide(fakeRedis(), TEL, ECO), false);
  });

  await t("el eco de OTRO cliente no cuenta", async () => {
    const redis = fakeRedis();
    await eco.registrarCuerpo(redis, TEL, CUERPO);
    eq(await eco.cuerpoCoincide(redis, "50660001111", ECO), false);
  });

  await t("🔴 un cuerpo cortito no se usa para comparar", async () => {
    // Si no, un "Listo 👍" guardado haria pasar por eco cualquier mensaje de
    // un humano que contenga esas letras.
    const redis = fakeRedis();
    eq(await eco.registrarCuerpo(redis, TEL, "Listo 👍"), false);
    eq(await eco.cuerpoCoincide(redis, TEL, "Listo 👍 ya le reservé la mesa"), false);
  });

  await t("vacíos y basura no truenan", async () => {
    const redis = fakeRedis();
    eq(await eco.registrarCuerpo(redis, TEL, ""), false);
    eq(await eco.registrarCuerpo(redis, TEL, null), false);
    eq(await eco.registrarCuerpo(null, TEL, CUERPO), false);
    eq(await eco.cuerpoCoincide(redis, TEL, ""), false);
    eq(await eco.cuerpoCoincide(redis, "", ECO), false);
    eq(await eco.cuerpoCoincide(null, TEL, ECO), false);
  });

  await t("si Redis truena, no es eco y no revienta el webhook", async () => {
    const roto = {
      async sadd() { throw new Error("redis caido"); },
      async smembers() { throw new Error("redis caido"); },
      async expire() { throw new Error("redis caido"); },
    };
    eq(await eco.registrarCuerpo(roto, TEL, CUERPO), false);
    eq(await eco.cuerpoCoincide(roto, TEL, ECO), false);
  });

  await t("🔴 aguanta que WATI recodifique los emoji", async () => {
    // En el log de Render los emoji del eco vuelven con otra codificación. Un
    // comparador que dependa de ellos se rompe sin avisar.
    const redis = fakeRedis();
    await eco.registrarCuerpo(redis, TEL, CUERPO);
    const ecoSinEmoji = ECO.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "?");
    eq(await eco.cuerpoCoincide(redis, TEL, ecoSinEmoji), true);
  });

  await t("🔴 aguanta un cuerpo largo con el encabezado adelante", async () => {
    // El eco trae el encabezado ANTES del cuerpo. Si los dos lados se
    // recortaran al mismo largo, en un cuerpo largo el del eco perdería el
    // final y el "contiene" fallaría. WATI admite cuerpos de hasta 1024.
    const redis = fakeRedis();
    const largo = "Buenas, le cuento del cierre de año de la empresa. " +
      "Detalle numero ".repeat(60);            // ~950 caracteres
    await eco.registrarCuerpo(redis, TEL, largo);
    eq(await eco.cuerpoCoincide(redis, TEL,
      "🏢 Grupo Cotorreo \r\n" + largo + "\n \n1. Sí\n2. No\n"), true);
  });

  await t("el registro le pone TTL a la llave", async () => {
    const redis = fakeRedis();
    await eco.registrarCuerpo(redis, TEL, CUERPO);
    eq(redis._ttl.get(eco.claveCuerpos(TEL)), eco.TTL_S);
  });

  console.log(`\nResultado: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
