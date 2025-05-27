import gemini from "../../services/gemini";

export async function prompt(payload, user_id: string) {
  const response = await gemini.models.generateContentStream({
    model: "gemini-2.0-flash",
    contents: payload?.text,
  });
  return response
}