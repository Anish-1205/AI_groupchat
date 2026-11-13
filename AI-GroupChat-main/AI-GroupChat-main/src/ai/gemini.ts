// src/ai/gemini.ts
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import * as dotenv from 'dotenv';

dotenv.config(); // Ensure environment variables are loaded

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-latest";
const GEMINI_MODEL_NAME = process.env.GEMINI_MODEL || "gemini-flash-lite-latest"; // Or "gemini-pro" etc.

let genAI: GoogleGenerativeAI | null = null;
if (GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
} else {
    console.warn("GEMINI_API_KEY is not set. Gemini API calls will fail.");
}

// Safety settings - adjust as needed for your use case
// See https://ai.google.dev/docs/safety_setting_gemini
const safetySettings = [
    {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
];

export async function fetchGemini(prompt: string): Promise<string> {
    if (!genAI) {
        return "Error: Gemini API not initialized (API key likely missing).";
    }

    try {
        const model = genAI.getGenerativeModel({
            model: GEMINI_MODEL_NAME,
            safetySettings: safetySettings,
            // generationConfig: { // Optional:
            //     maxOutputTokens: 250,
            //     temperature: 0.7,
            //     topP: 0.9,
            // }
        });

        // Gemini's API can take the prompt directly for simpler cases,
        // or a structured "contents" array for multi-turn chat.
        // For consistency with how Mistral prompt is built, we assume `prompt` contains instructions + history.

        // Attempt to parse system instructions similar to Mistral for Gemini's multi-turn format
        // Gemini prefers history as [{role: "user", parts: [{text: ""}]}, {role: "model", parts: [{text: ""}]}]
        // Your current prompt is one big string. Let's try to make it work.
        // We can split the initial system instruction from the rest of the prompt.
        
        const systemPromptEnd = "CURRENT DEBATE TOPIC:"; // Or another clear delimiter from your main prompt builder
        let systemInstructionText = "You are an intelligent AI participating in a debate. Be insightful and constructive."; // Default
        let userPromptText = prompt;

        const systemEndIndex = prompt.indexOf(systemPromptEnd);
        if (systemEndIndex !== -1) {
            const potentialSystem = prompt.substring(0, systemEndIndex).trim();
             if (potentialSystem.toLowerCase().startsWith("system:") || potentialSystem.toLowerCase().startsWith("you are")) {
                systemInstructionText = potentialSystem.replace(/^system:\s*/i, '').trim();
                userPromptText = prompt.substring(systemEndIndex).trim();
            }
        }
        
        // Construct a simplified history. For complex debates, you'd parse your existing `prompt` string
        // back into a proper `Content[]` array if it contains multiple turns.
        // For now, system instruction + the rest of the prompt as user message.
        const chat = model.startChat({
            history: [
                // System instructions can be part of the first user message or specific to the model config.
                // For gemini, often system instructions are implicitly part of the model's tuning or can be added to generationConfig or first user message.
                // Let's add it as context in the first user message for simplicity given the current prompt structure.
            ],
            // generationConfig could also include systemInstruction if the model supports it directly in config.
        });
        
        const fullUserPrompt = `${systemInstructionText}\n\n${userPromptText}`;

        console.log(`[Gemini AI] Sending request. Model: ${GEMINI_MODEL_NAME}. Full prompt (first 150 chars): ${fullUserPrompt.substring(0,150)}...`);

        // Retry transient overload (503/429); last attempt uses a lighter fallback model. Timeout so the UI never spins forever.
        const delays = [2000, 5000, 0];
        let result;
        for (let i = 0; i < delays.length; i++) {
            const name = i === delays.length - 1 ? GEMINI_FALLBACK_MODEL : GEMINI_MODEL_NAME;
            const m = genAI.getGenerativeModel({ model: name, safetySettings }, { timeout: 30000 });
            try {
                result = await m.startChat({ history: [] }).sendMessage(fullUserPrompt);
                break;
            } catch (e: any) {
                const transient = /(503|429)|timeout|timed out|fetch failed/i.test(String(e?.message));
                if (!transient || i === delays.length - 1) throw e;
                console.warn(`[Gemini AI] transient error (attempt ${i + 1}), retrying: ${e.message}`);
                await new Promise(r => setTimeout(r, delays[i]));
            }
        }
        if (!result) throw new Error('Gemini returned no result');
        const response = result.response;
        const text = response.text();
        
        console.log(`[Gemini AI] Received response. Finish reason: ${response.candidates?.[0]?.finishReason || 'N/A'}`);
        return text.trim();

    } catch (error: any) {
        console.error("Error calling Gemini API:", error);
        if (error.message && error.message.includes("SAFETY")) {
             return "Error: Gemini API blocked the response due to safety settings. The prompt or generated content may have violated policies.";
        }
        return `Exception during Gemini API call: ${error.message}`;
    }
}