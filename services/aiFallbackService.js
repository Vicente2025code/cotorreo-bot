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
      instructions: "Responde breve, claro y en espanol.",
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
