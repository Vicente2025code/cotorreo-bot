// replay_infra.js — Redis de juguete compartido por los dos arneses.
// Solo los comandos que el bot usa. NUNCA se despliega.

const http = require("http");

function redisDeJuguete(puerto) {
  const kv = new Map();
  const zs = new Map();

  function cmd(a) {
    const op = String(a[0] || "").toUpperCase();
    const x = a.slice(1);
    switch (op) {
      case "PING": return "PONG";
      case "GET": return kv.has(x[0]) ? kv.get(x[0]) : null;
      case "SET": {
        const opts = x.slice(2).map((s) => String(s).toUpperCase());
        if (opts.includes("NX") && kv.has(x[0])) return null;
        kv.set(x[0], x[1]);
        return "OK";
      }
      case "INCR": {
        const n = Number(kv.get(x[0]) || 0) + 1;
        kv.set(x[0], String(n));
        return n;
      }
      case "DEL": { let n = 0; for (const k of x) if (kv.delete(k)) n++; return n; }
      case "EXPIRE": case "SADD": case "SREM": return 1;
      case "SMEMBERS": return [];
      case "ZADD": {
        if (!zs.has(x[0])) zs.set(x[0], new Map());
        const z = zs.get(x[0]);
        const nx = x.slice(1).some((s) => String(s).toUpperCase() === "NX");
        const pares = x.slice(1).filter((s) => String(s).toUpperCase() !== "NX");
        let n = 0;
        for (let i = 0; i + 1 < pares.length; i += 2) {
          const sc = Number(pares[i]); const mb = String(pares[i + 1]);
          if (nx && z.has(mb)) continue;
          z.set(mb, sc); n++;
        }
        return n;
      }
      case "ZREM": {
        const z = zs.get(x[0]); if (!z) return 0;
        let n = 0; for (const m of x.slice(1)) if (z.delete(String(m))) n++;
        return n;
      }
      case "ZSCORE": {
        const z = zs.get(x[0]); const v = z && z.get(String(x[1]));
        return v === undefined ? null : String(v);
      }
      case "ZRANGE": {
        const z = zs.get(x[0]); if (!z) return [];
        const porScore = x.slice(1).some((s) => String(s).toUpperCase() === "BYSCORE");
        let e = [...z.entries()].sort((a, b) => a[1] - b[1]);
        if (porScore) {
          const lo = Number(x[1]); const hi = Number(x[2]);
          e = e.filter(([, s]) => s >= lo && s <= hi);
        }
        return e.map(([m]) => m);
      }
      default: return null;
    }
  }

  return new Promise((resolve) => {
    http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        let body = [];
        try { body = raw ? JSON.parse(raw) : []; } catch (_) {}
        if (!raw && req.url && req.url.length > 1) {
          body = req.url.slice(1).split("/").map(decodeURIComponent);
        }
        const esPipeline = Array.isArray(body) && Array.isArray(body[0]);
        const correr = (c) => {
          try { return { result: cmd(c) }; } catch (e) { return { error: String(e.message) }; }
        };
        let out = esPipeline ? body.map(correr) : correr(body);

        // @upstash/redis pide base64 y decodifica lo que llega: si se le manda
        // texto plano lo convierte en basura ("506" salía como caracteres
        // raros y el ZRANGE devolvía miembros inservibles). Costó un rato.
        const b64 = String(req.headers["upstash-encoding"] || "").toLowerCase() === "base64";
        if (b64) {
          const cod = (v) => typeof v === "string"
            ? Buffer.from(v, "utf8").toString("base64")
            : Array.isArray(v) ? v.map(cod) : v;
          out = Array.isArray(out)
            ? out.map((o) => ("result" in o ? { result: cod(o.result) } : o))
            : ("result" in out ? { result: cod(out.result) } : out);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out));
      });
    }).listen(puerto, () => resolve());
  });
}

module.exports = { redisDeJuguete };
