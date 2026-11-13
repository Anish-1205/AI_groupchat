// src/ai/groq.ts — Groq exposes an OpenAI-compatible chat completions API.
import * as dotenv from 'dotenv';

dotenv.config();

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

export async function fetchGroq(prompt: string): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not set.');

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 700, // room for the moderator's verdict; persona prompts ask for <150 words themselves
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    // Body may echo request details; log it server-side, keep the client message short.
    console.error(`[Groq] ${res.status} ${res.statusText}:`, (await res.text()).slice(0, 500));
    throw new Error(`Groq request failed (${res.status}).`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Groq returned an empty response.');
  return text;
}
