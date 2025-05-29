import { GenerateContentResponse } from "@google/genai";
import Message from "../../model/message";
import gemini from "../../services/gemini";
import { Response } from "express";
import { isEmpty } from "../../utils/helpers";
import { IPagination } from "../../utils/interface";

export async function prompt(payload, user: string) {
  const messages = await Message.find({ user }).limit(25)

  const chat = gemini.chats.create({
    model: "gemini-2.0-flash",
    history: messages.map(m => ({
      role: m.role === "ai" ? "model" : "user",
      parts: [{ text: m.text }]
    }))
  });

  const response = await chat.sendMessageStream({ message: payload?.text });
  await Message.create({ user, role: 'user', text: payload?.text })

  return response
}

export async function handleStreaming(user: string, payload: AsyncGenerator<GenerateContentResponse, any, any>, res: Response) {
  let text = ""
  try {
    for await (const chunk of payload) {
      if (chunk.text) {
        text += chunk.text;
        res.write(chunk.text);
      }
    }
  } catch (error) {
    res.write(`ERROR: ${error?.message}`);
  } finally {
    res.end();
    if (!isEmpty(text)) {
      await Message.create({ text, user, role: "ai" })
    }
  }
}

export async function getUserMessages({ page, limit }: IPagination, user: string) {
  const data = await Message.paginate(
    { user },
    { page, limit }
  )

  return { message: "User messages retrieved successfully", data }
}