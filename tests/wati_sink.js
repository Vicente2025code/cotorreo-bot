// Receptor falso de WATI para el arnés de regresión.
//
// Se para en lugar de live-mt-server.wati.io y GUARDA lo que el bot quiso
// mandar, en vez de mandárselo a un cliente de verdad. Sin esto el arnés solo
// podía ver "WATI_TOKEN no configurado" en el log y no el TEXTO, que es
// justamente lo que hay que comparar entre el antes y el después.
//
// Rutas que imita:
//   POST /{tenant}/api/v1/sendSessionMessage/{numero}   (texto, form-urlencoded)
//   POST /{tenant}/api/v1/sendTemplateMessage?whatsappNumber=...  (plantilla)
//   POST /{tenant}/api/v1/sendInteractiveButtonsMessage?...       (botones)
const http = require("http");

const enviados = [];

const servidor = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const url = req.url || "";

    // El arnés corre en otro proceso, así que necesita una puerta para leer y
    // vaciar lo acumulado después de cada mensaje.
    if (url.startsWith("/__enviados")) {
      const out = enviados.slice();
      enviados.length = 0;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }

    let numero = "";
    let texto = "";
    let clase = "otro";

    if (url.includes("/sendSessionMessage/")) {
      clase = "texto";
      numero = url.split("/sendSessionMessage/")[1].split("?")[0];
      try {
        texto = new URLSearchParams(raw).get("messageText") || "";
      } catch (_) { texto = raw; }
    } else if (url.includes("/sendTemplateMessage")) {
      clase = "plantilla";
      numero = (url.match(/whatsappNumber=(\d+)/) || [])[1] || "";
      try {
        const b = JSON.parse(raw);
        texto = `[${b.template_name}] ` +
          (b.parameters || []).map((p) => p.value).join(" | ");
      } catch (_) { texto = raw; }
    } else if (url.includes("sendInteractiveButtons")) {
      clase = "botones";
      numero = (url.match(/whatsappNumber=(\d+)/) || [])[1] || "";
      try {
        const b = JSON.parse(raw);
        const cuerpo = b?.body?.text || b?.body || "";
        const bts = (b?.buttons || []).map((x) => x?.title || x?.text || "").filter(Boolean);
        texto = String(cuerpo) + (bts.length ? `  [botones: ${bts.join(" / ")}]` : "");
      } catch (_) { texto = raw; }
    } else {
      numero = "?";
      texto = raw;
    }

    enviados.push({ clase, numero, texto });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, result: "success", message: { whatsappMessageId: "wamid.PRUEBA" } }));
  });
});

function arrancar(puerto) {
  return new Promise((resolve) => servidor.listen(puerto, () => resolve(servidor)));
}

function tomar() {
  const out = enviados.slice();
  enviados.length = 0;
  return out;
}

if (require.main === module) {
  const puerto = Number(process.argv[2]) || 4200;
  arrancar(puerto).then(() => console.log("wati sink en " + puerto));
  // Permite que el arnés lea lo acumulado sin matar el proceso.
  process.on("SIGTERM", () => process.exit(0));
}

module.exports = { arrancar, tomar, enviados };
