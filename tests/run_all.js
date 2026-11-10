// run_all.js — corre todas las pruebas locales, una por proceso.
// Un proceso por archivo porque varios dejan estado de modulo (memoria,
// process.env) y se contaminarian entre si.
//   npm test
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const archivos = fs.readdirSync(dir)
  .filter((f) => /^test_.*\.js$/.test(f))
  .sort();

let rotos = [];
for (const f of archivos) {
  console.log("\n=============== " + f + " ===============");
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: "inherit" });
  if (r.status !== 0) rotos.push(f + " (exit " + r.status + ")");
}

console.log("\n=======================================");
if (rotos.length) {
  console.log("FALLARON " + rotos.length + " de " + archivos.length + ":");
  for (const r of rotos) console.log("  - " + r);
  process.exit(1);
}
console.log("OK: " + archivos.length + " archivos de prueba en verde");
