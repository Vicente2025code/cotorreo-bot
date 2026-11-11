// replay.js — ARNÉS DE REGRESIÓN
//
// POR QUÉ EXISTE
// El 10-nov-2026 subí dos cambios al bot. Uno traía un bug CRÍTICO que mis
// propias pruebas daban por correcto, y otro rompía los adjuntos porque probé
// mi función con un payload que me inventé en vez de uno real de WATI. Ninguno
// de los dos lo vieron las pruebas unitarias.
//
// Y lo peor: cuando apareció un síntoma en producción, Vicente no tenía forma
// de saber si lo había causado yo o si siempre había estado ahí.
//
// Este arnés contesta esa pregunta antes de subir. Pasa webhooks REALES de
// WATI por el bot y escribe QUÉ LE CONTESTARÍA a cada cliente. Se corre antes
// del cambio (línea base) y después (nuevo), y se comparan los dos archivos.
// Lo que cambie sale como diferencia en pantalla, no como queja de un cliente.
//
//   node tests/replay.js > /tmp/antes.txt      ← ANTES de tocar nada
//   ...hacer el cambio...
//   node tests/replay.js > /tmp/despues.txt
//   diff /tmp/antes.txt /tmp/despues.txt
//
// Nada de esto toca WATI, OpenAI ni a un cliente: Redis es de juguete, WATI es
// un receptor local que solo guarda, y OpenAI no tiene llave (el fallback de IA
// se reporta como "[IA]" sin llamar a nadie).

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.join(__dirname, "..");
const PUERTO_BOT = 3500;
const PUERTO_REDIS = 4500;
const PUERTO_WATI = 4600;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(url, opciones = {}) {
  const r = await fetch(url, opciones);
  const t = await r.text();
  try { return JSON.parse(t); } catch (_) { return t; }
}

// El Redis de juguete vive en replay_infra.js, compartido con el arnés de
// frases (tests/replay_frases.js).
const { redisDeJuguete } = require("./replay_infra");


// ─────────────────────────────────────────────────────────────────────────────
function remitenteDe(f) {
  for (const k of ["waId", "wa_id", "whatsappNumber", "from", "sender", "senderId"]) {
    if (f[k]) return String(f[k]);
  }
  return "?";
}

function resumen(f) {
  const t = (typeof f.text === "string" ? f.text : "") || "";
  const tipo = f.type && f.type !== "text" ? `[${f.type}]` : "";
  const dir = f.eventType === "sessionMessageSent" || f.owner === true ? "CASA→" : "cliente→";
  const asig = f.assignedId ? " {ticket asignado}" : "";
  return `${dir}${asig} ${tipo} ${t.replace(/\s+/g, " ").trim().slice(0, 70)}`.trim();
}

async function main() {
  const fixturesPath = path.join(__dirname, "fixtures", "webhooks_reales.json");
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

  await redisDeJuguete(PUERTO_REDIS);
  const sink = spawn(process.execPath, [path.join(__dirname, "wati_sink.js"), String(PUERTO_WATI)],
    { cwd: RAIZ, stdio: "ignore" });

  const bot = spawn(process.execPath, ["index.js"], {
    cwd: RAIZ,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(PUERTO_BOT),
      UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${PUERTO_REDIS}`,
      UPSTASH_REDIS_REST_TOKEN: "falso",
      WATI_TOKEN: "falso",
      WATI_ENDPOINT: `http://127.0.0.1:${PUERTO_WATI}`,
      OPENAI_API_KEY: "",          // el fallback de IA no llama a nadie
      HANDOFF_ALERT_NUMBERS: "50670000099",
      ESPERA_AVISO_MIN: "99999",   // el vigilante no debe meter ruido acá
    },
  });

  const eventos = [];
  const capturar = (buf) => {
    for (const ln of String(buf).split("\n")) {
      const s = ln.trim();
      if (!s.startsWith("{") || !s.includes('"event"')) continue;
      try { eventos.push(JSON.parse(s)); } catch (_) {}
    }
  };
  bot.stdout.on("data", capturar);
  bot.stderr.on("data", capturar);

  await dormir(4500);

  const lineas = [];
  lineas.push("ARNÉS DE REGRESIÓN — qué le contesta el bot a webhooks REALES de WATI");
  lineas.push(`fixtures: ${fixtures.length}  (anonimizados, de los logs de producción)`);
  lineas.push("=".repeat(78));

  const ahoraSeg = Math.floor(Date.now() / 1000);

  for (let i = 0; i < fixtures.length; i++) {
    // El timestamp se reescribe a "ahora": el filtro F1.6 descarta lo que tenga
    // más de 2 minutos, y estos payloads son de ayer.
    const f = { ...fixtures[i], timestamp: String(ahoraSeg) };
    eventos.length = 0;

    await pedir(`http://127.0.0.1:${PUERTO_BOT}/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    await dormir(260);

    const enviados = await pedir(`http://127.0.0.1:${PUERTO_WATI}/__enviados`);
    const evs = eventos.map((e) => e.event).filter((e) => e && e !== "message_received");

    lineas.push("");
    lineas.push(`#${String(i + 1).padStart(2, "0")} ${remitenteDe(f)}  ${resumen(f)}`);
    if (evs.length) lineas.push(`    ruta: ${evs.join(" → ")}`);
    if (!Array.isArray(enviados) || !enviados.length) {
      lineas.push("    RESPUESTA: (ninguna)");
    } else {
      for (const e of enviados) {
        const txt = String(e.texto || "").replace(/\s+/g, " ").trim();
        lineas.push(`    RESPUESTA [${e.clase}] → ${e.numero}: ${txt.slice(0, 160)}`);
        if (txt.length > 160) lineas.push(`               ...(${txt.length} caracteres en total)`);
      }
    }
  }

  lineas.push("");
  lineas.push("=".repeat(78));
  console.log(lineas.join("\n"));

  bot.kill();
  sink.kill();
  await dormir(300);
  process.exit(0);
}

main().catch((e) => { console.error("arnés falló:", e); process.exit(1); });
