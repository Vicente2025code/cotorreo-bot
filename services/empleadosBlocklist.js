// empleadosBlocklist.js
// Trabajadores en el piloto de "Mi trabajo" (nómina.grupocotorreo.com/marcar).
// Reciben mensajes de RRHH y responderán "ENTERADO(A)" u otras palabras que
// podrían gatillar handlers del bot (rewardsHandler, promoSushiHandler, etc.).
// Para evitar respuestas cruzadas, el bot los ignora completamente.
//
// Ventana: desde 14-sep-2026 (día del comunicado). Retirar del array cuando
// el piloto termine y ya no queramos silenciar el bot para el colaborador.

const NUMEROS = new Set([
  "50685997818", // Maria Celeste Ugalde Sirias (Bebros)
  "50661022026", // Manrique Josue Carmona Alvarado (Bebros)
  "50661626204", // Maria Jose Garcia Sobalvarro (Taquería)
  "50661328480", // Chelsy Paola Solano Solano (Taquería)
  "50689485506", // Kendall Cordero Fernandez (Taquería)
  "50671198869", // Elimanys Perez Morejon (Taquería)
  "50685561925", // Ruth Mery Peraza Montaya (Plaza)
  "50670490106", // Eridania Garcia Sobalvarro (Plaza)
  "50664340546", // Irene Espinoza Olivares (Plaza)
  "50685437545", // Abigail Chaves Cubero (Plaza)
  "50689636832", // Ericka Marin Calvo (Plaza)
  "50686448851", // Sandra Carolina Nuñez Castro (Plaza)
  "50686881754", // Dylan Leonardo Sanabria Hidalgo (Plaza)
  "50662798223", // Mauricio Monje Cubero (Taquería)
  "50671670780", // Abbey Gail Avedaño Chavez (Taquería)
  "50663264741", // Jirlany Ochoa Madrigal (Nube)
  "50660675368", // Melania Alvarado Calero (Nube)
  "50687589604", // Maria del Carmen Monje Villegas (Nube)
]);

function esEmpleadoPiloto(from) {
  if (!from) return false;
  const d = String(from).replace(/\D/g, "");
  // WATI a veces manda con o sin 506 al frente
  return NUMEROS.has(d) || NUMEROS.has("506" + d);
}

module.exports = { esEmpleadoPiloto, NUMEROS };
