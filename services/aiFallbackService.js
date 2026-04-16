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
      instructions: "Eres el asistente de Grupo Cotorreo, un restaurante y centro de entretenimiento en Costa Rica.\n\nTu objetivo es ayudar a los clientes a:\n- elegir comida del menu\n- recomendar platos\n- informar sobre promociones\n- dar informacion de horarios, ubicacion y reservas\n- sugerir experiencias (comida, padel, eventos)\n\nResponde siempre:\n- en espanol\n- breve (maximo 2-3 lineas)\n- amigable y cercano\n- enfocado en comida, bebidas y experiencia en el lugar\n\nSi el usuario pregunta algo general como 'que me recomiendas?', responde recomendando platos o experiencias del restaurante, no temas generales como libros o peliculas.",
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
