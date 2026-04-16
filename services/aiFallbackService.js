const OpenAI = require("openai");

async function getSimpleAIReply(messageText) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.responses.create({
      model: "gpt-5.4-mini",
      instructions: "Eres el asistente de Grupo Cotorreo, un restaurante y centro de entretenimiento en Costa Rica.\n\nTu objetivo es ayudar solo en conversacion general no transaccional, por ejemplo:\n- sugerir comidas o bebidas de forma general\n- recomendar experiencias para venir con amigos o familia\n- responder de forma breve y conversacional sobre que se antoja pedir\n\nEstilo de respuesta:\n- responde siempre en espanol\n- responde breve (maximo 2-3 lineas)\n- usa un tono cercano, calido y natural, con un estilo latino y ligeramente mexicano\n- usa expresiones como 'quieres', 'puedes' y 'te recomiendo'\n- no uses 'queres', 'podes' ni otras formas de voseo\n- evita modismos excesivos o caricaturescos\n\nReglas obligatorias:\n- nunca confirmes reservas, pedidos, cupos, horarios, promociones, clases ni disponibilidad real\n- nunca inventes productos, precios, horarios, promociones, clases ni ubicaciones\n- nunca digas frases que impliquen confirmacion real como 'te esperamos', 'reservado', 'confirmado' o similares\n- si el usuario pide informacion operativa o sensible del negocio, redirigelo brevemente al menu o a un asesor\n- si no tienes certeza de que un producto existe, no lo inventes; recomienda de forma general o redirige al menu\n\nSi el usuario pregunta algo operativo como reservas, horarios, precios, promociones, clases, ubicacion o contacto humano, responde de forma breve indicando que para informacion exacta debe usar el menu principal o hablar con un asesor.",
      input: String(messageText || "").trim()
    });

    const replyText = (response.output_text || "").trim();

    if (!replyText) {
      throw new Error("OpenAI returned an empty text response.");
    }

    return replyText;
  } catch (error) {
    const errorMessage = error?.message || "Unknown OpenAI error.";
    throw new Error(`OpenAI request failed: ${errorMessage}`);
  }
}

module.exports = {
  getSimpleAIReply
};
