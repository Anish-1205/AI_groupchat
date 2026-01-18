// src/ai/mistral.ts
import fetch from 'node-fetch'; // Use node-fetch@2 for CommonJS require, or ESM import for v3
import * as dotenv from 'dotenv';

dotenv.config(); // Ensure environment variables are loaded

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
// Define the model you want to use, e.g., 'mistral-tiny', 'mistral-small', 'mistral-medium', or open-source ones via other providers
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest'; // Or your preferred model
const MISTRAL_API_URL = process.env.MISTRAL_API_URL || 'https://api.mistral.ai/v1/chat/completions';


interface MistralChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

interface MistralAPIResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: 'assistant';
            content: string;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}


export async function fetchMistral(prompt: string): Promise<string> {
    if (!MISTRAL_API_KEY) {
        console.error("MISTRAL_API_KEY is not set.");
        return "Error: Mistral API key not configured.";
    }

    // Mistral's chat API expects a messages array. We'll treat the whole prompt as a user message.
    // For more sophisticated interaction, you might parse your `prompt` string into system/user/assistant turns.
    // For now, let's assume the prompt is structured such that it can be a single user message following a system setup.

    // A common way to structure for Mistral chat:
    // System prompt defines the persona, user prompt gives the current task / context
    // Let's try to parse the system instruction from your main prompt string
    const systemPromptEnd = "CURRENT DEBATE TOPIC:"; // Or another clear delimiter
    let systemInstruction = "You are a helpful AI assistant participating in a debate."; // Default
    let userContent = prompt;

    const systemEndIndex = prompt.indexOf(systemPromptEnd);
    if (systemEndIndex !== -1) {
        // A bit crude, but tries to extract the persona part as system message
        const potentialSystem = prompt.substring(0, systemEndIndex).trim();
        if (potentialSystem.toLowerCase().startsWith("system:") || potentialSystem.toLowerCase().startsWith("you are")) {
            systemInstruction = potentialSystem.replace(/^system:\s*/i, '').trim();
            userContent = prompt.substring(systemEndIndex).trim();
        }
    }
    
    const messages: MistralChatMessage[] = [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent }
    ];

    try {
        console.log(`[Mistral AI] Sending request. Model: ${MISTRAL_MODEL}. System: ${systemInstruction.substring(0,50)}... User: ${userContent.substring(0,100)}...`);
        const response = await fetch(MISTRAL_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${MISTRAL_API_KEY}`,
            },
            body: JSON.stringify({
                model: MISTRAL_MODEL,
                messages: messages,
                temperature: 0.6, // Adjust for creativity vs. factuality
                max_tokens: 300, // Adjust based on expected response length
                // top_p: 1,
                // stream: false, // Set to true if you want to handle streaming responses
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Mistral API Error: ${response.status} ${response.statusText}`, errorBody);
            return `Error fetching response from Mistral: ${response.statusText}. Details: ${errorBody.substring(0,100)}`;
        }

        const data = await response.json() as MistralAPIResponse;

        if (data.choices && data.choices.length > 0 && data.choices[0].message) {
            console.log(`[Mistral AI] Received response. Tokens used: ${data.usage?.total_tokens || 'N/A'}`);
            return data.choices[0].message.content.trim();
        } else {
            console.error("Mistral API Error: No valid response choices found.", data);
            return "Error: Mistral returned an empty or invalid response.";
        }
    } catch (error: any) {
        console.error("Error calling Mistral API:", error);
        return `Exception during Mistral API call: ${error.message}`;
    }
}