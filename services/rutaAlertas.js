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
    // 24-nov-2026. El telefono compartido del local. Nace de esto, dicho por
    // Vicente: el aviso de "un cliente esta esperando" le llegaba a tres
    // personas que no estan en el piso y a nadie que pudiera contestarle al
    // cliente en ese momento. El nivel rapido del vigilante (5 min) viene aca
    // y SOLO aca; los niveles de 20 min y 20 h siguen yendo a la oficina.
    piso: lista(env.ALERTA_PISO_NUMEROS),
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
  // Se arma recorriendo los grupos y NO enumerandolos a mano: el 24-nov-2026
  // se agrego el grupo "piso" y una lista escrita a mano lo habria dejado
  // afuera en silencio, con lo que el vigilante habria tratado sus propias
  // notificaciones al local como "un cliente esperando".
  const todoElStaff = [...new Set([...base, ...Object.values(grupos).flat()])];

  return { base, grupos, destinatarios, todoElStaff };
}

module.exports = { construir, lista, POR_DEFECTO };
