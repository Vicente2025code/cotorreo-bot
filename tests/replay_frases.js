// replay_frases.js — el arnés, pero con frases escritas a mano.
//
// El arnés de webhooks reales (replay.js) prueba lo que de verdad pasó. Esto
// prueba lo que PUEDE pasar: las frases que rompían el interceptor de sushi y
// las preguntas por el pedido. Ninguna de las dos aparece en los 43 webhooks
// capturados, porque esas conversaciones las atendió un humano de punta a
// punta — así que sin esto los dos arreglos solo tendrían prueba unitaria.
//
//   node tests/replay_frases.js > antes.txt   ← antes del cambio
//   node tests/replay_frases.js > despues.txt
//   diff antes.txt despues.txt

const { spawn } = require("child_process");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const PUERTO_BOT = 3600;
const PUERTO_REDIS = 4700;
const PUERTO_WATI = 4800;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Cada frase va con un número distinto para que ninguna herede el estado de la
// anterior (handoff, racha de fallback, promo ya mostrada).
const FRASES = [
  ["debe soltar lista de rollos", "Cuáles sushis aplican al 2x1?"],
  ["debe soltar lista de rollos", "En qué rollos aplica la promo?"],
  ["debe soltar lista de rollos", "menu de sushi"],
  ["debe soltar lista de rollos", "¿Qué sushis tienen?"],
  ["NO debe cotizar — pregunta por su pedido", "El sushi que pedi ya esta listo?"],
  ["NO debe cotizar — pregunta por su pedido", "Ya esta lista mi orden de sushi?"],
  ["NO debe cotizar — pregunta por su pedido", "Maso menos cuanto falta?"],
  ["NO debe cotizar — pregunta por su pedido", "Cuánto le falta al sushi!"],
  ["NO debe cotizar — es una queja", "Porque el sushi estaba frio"],
  ["NO debe cotizar — es una queja", "El rollo venia sin salsa, que hago?"],
  ["NO debe cotizar — no pidió nada", "No queria sushi, queria tacos"],
  ["NO debe cotizar — no pidió nada", "Que rico el sushi, gracias"],
  ["NO debe cotizar — no pidió nada", "Me gusto el rollo que me trajeron"],
  ["NO debe cotizar — otro 2x1", "cuales tacos entran en el 2x1 del lunes"],
];

async function pedir(url, opciones) {
  const r = await fetch(url, opciones);
  const t = await r.text();
  try { return JSON.parse(t); } catch (_) { return t; }
}

async function main() {
  // Reusa el Redis de juguete y el receptor de WATI del arnés principal.
  const { redisDeJuguete } = require("./replay_infra");
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
      OPENAI_API_KEY: "",
      HANDOFF_ALERT_NUMBERS: "50670000099",
      ESPERA_AVISO_MIN: "99999",
    },
  });

  const eventos = [];
  const capturar = (b) => {
    for (const ln of String(b).split("\n")) {
      const s = ln.trim();
      if (!s.startsWith("{") || !s.includes('"event"')) continue;
      try { eventos.push(JSON.parse(s)); } catch (_) {}
    }
  };
  bot.stdout.on("data", capturar);
  bot.stderr.on("data", capturar);

  await dormir(4500);

  const out = [];
  out.push("ARNÉS DE FRASES — qué contesta el bot a cada frase");
  out.push("=".repeat(78));

  for (let i = 0; i < FRASES.length; i++) {
    const [esperado, frase] = FRASES[i];
    const tel = `5067100${String(i + 1).padStart(4, "0")}`;
    eventos.length = 0;

    await pedir(`http://127.0.0.1:${PUERTO_BOT}/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        waId: tel,
        senderName: "Cliente Prueba",
        text: frase,
        type: "text",
        owner: false,
        eventType: "message",
        timestamp: String(Math.floor(Date.now() / 1000)),
      }),
    });
    await dormir(300);

    const enviados = await pedir(`http://127.0.0.1:${PUERTO_WATI}/__enviados`);
    const evs = eventos.map((e) => e.event).filter((e) => e && e !== "message_received" && e !== "name_autopopulated");

    out.push("");
    out.push(`#${String(i + 1).padStart(2, "0")} "${frase}"`);
    out.push(`    se espera: ${esperado}`);
    out.push(`    ruta: ${evs.join(" → ") || "(ninguna)"}`);
    if (!Array.isArray(enviados) || !enviados.length) {
      out.push("    RESPUESTA: (ninguna)");
    } else {
      for (const e of enviados) {
        const txt = String(e.texto || "").replace(/\s+/g, " ").trim();
        out.push(`    RESPUESTA: ${txt.slice(0, 130)}${txt.length > 130 ? " …" : ""}`);
      }
    }
  }

  out.push("");
  out.push("=".repeat(78));
  console.log(out.join("\n"));

  bot.kill();
  sink.kill();
  await dormir(300);
  process.exit(0);
}

main().catch((e) => { console.error("arnés de frases falló:", e); process.exit(1); });
