/* A quien le toca cada alerta del staff.
 *
 * 🔴 23-nov-2026. Hasta hoy TODA alerta iba a la misma lista de cuatro
 * personas: cotizaciones de fiesta, preguntas por un pedido, quejas, "quiero
 * un asesor" y el vigilante de espera. Vicente lo dijo asi: "eso le avisaria
 * a Kati cuando fuera de cotizaciones, no de cualquier cosa". Y tenia razon:
 * de las 31 alertas que le llegaron a el entre el 20 y el 23 de noviembre,
 * NINGUNA era de cotizacion — eran recordatorios de reserva, limpiezas y
 * tickets de mantenimiento. Cuando todo es urgente nada lo es, y la alerta
 * que si importa se pierde en el ruido.
 *
 * Esto vive aparte de index.js para poder probarlo sin levantar el servidor.
 */

const lista = (v) => String(v || "").split(",").map((n) => n.trim()).filter(Boolean);

// Grupo por defecto de cada alerta. El que no aparezca aqui cae en operacion:
// mas vale que una alerta nueva suene de mas en el equipo que se pierda.
const POR_DEFECTO = "operacion";

function construir(env = process.env) {
  // La lista historica. Sigue siendo la red de seguridad: si manana alguien
  // borra las variables de grupo, el bot avisa a esta gente en vez de callarse.
  const base = lista(env.HANDOFF_ALERT_NUMBERS || "50660127557");
  const grupos = {
    fiestas: lista(env.ALERTA_FIESTAS_NUMEROS),
    operacion: lista(env.ALERTA_OPERACION_NUMEROS),
  };

  // Un grupo que no existe NO puede caer en "avisarle a todos": si manana
  // alguien escribe grupo:"fiesta" en singular, la alerta le llegaria a Kati
  // igual que antes y el arreglo se deshace solo, en silencio. Lo desconocido
  // cae en operacion, que es el grupo mas amplio pero acotado.
  const destinatarios = (grupo) => {
    const g = Object.prototype.hasOwnProperty.call(grupos, grupo) ? grupo : POR_DEFECTO;
    const l = grupos[g];
    return l && l.length ? l : base;
  };

  // El vigilante de espera no debe perseguir al propio staff: si Liliana le
  // escribe al bot, su mensaje no es "un cliente esperando". Se excluye a
  // TODOS los que reciben alertas, de cualquier grupo.
  const todoElStaff = [...new Set([...base, ...grupos.fiestas, ...grupos.operacion])];

  return { base, grupos, destinatarios, todoElStaff };
}

module.exports = { construir, lista, POR_DEFECTO };
