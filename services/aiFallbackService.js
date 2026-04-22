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
      instructions: "Eres el asistente de Grupo Cotorreo, un restaurante y centro de entretenimiento en Costa Rica.\n\nCuando el cliente pregunte algo operativo como precios, horarios, reservas, promociones, ubicacion o SINPE, NO des vueltas ni repitas lo mismo dos veces. Redirigelo UNA sola vez de forma clara y amigable al menu o a un asesor, y ofrece ayuda con algo mas.\n\nCuando el cliente salude o haga preguntas generales, responde de forma calida y natural, y guialo hacia el menu.\n\nReglas obligatorias:\n- Nunca inventes precios, horarios, numeros de SINPE, promociones ni productos\n- Nunca confirmes pedidos, reservas ni disponibilidad\n- Si no sabes algo con certeza, redirige al menu o asesor UNA sola vez, sin repetir\n- Maximo 2-3 lineas por respuesta\n- Tono calido, cercano y natural en espanol\n- No uses voseo (no uses 'queres', 'podes', 'tenes')\n\nSi el cliente insiste en lo mismo despues de que ya lo redirigiste, simplemente ofrecele hablar con un asesor: escribe 3 para hablar con un asesor."
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
