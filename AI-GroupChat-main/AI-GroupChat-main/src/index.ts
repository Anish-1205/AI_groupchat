// src/index.ts
import { Hono } from 'hono';
const toNodeListener = (app: Hono<any, any, any>) => app.fetch;

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';

import { fetchMistral } from './ai/mistral';
import { fetchGemini } from './ai/gemini';

import * as dotenv from 'dotenv';
dotenv.config();

const app = new Hono();
const port = process.env.PORT || 3001;
const nodeListener: (req: IncomingMessage, res: ServerResponse) => void = toNodeListener(app) as any;
const server = createServer(nodeListener);

server.listen(port, () => {
  console.log(`🔥 Hono server running at http://localhost:${port}`);
});

const MAX_DEBATE_ROUNDS_PER_PARTICIPANT = 2;
const MODERATOR_TURN_INTERVAL = 2;
const AI_MISTRAL_ID = 'mistral';
const AI_GEMINI_ID = 'gemini';
const MODERATOR_PERSONA_ID = 'moderator';

interface Persona {
  id: string;
  name: string;
  model: typeof AI_MISTRAL_ID | typeof AI_GEMINI_ID;
  instructions: string;
  expertise?: string;
}

interface ChatMessage {
  id: string;
  speaker: string;
  content: string;
  timestamp: string;
  isThinking?: boolean;
  isRegenerated?: boolean;
}

interface Debate {
  id: string;
  topic: string;
  history: ChatMessage[];
  participants: Persona[];
  moderator?: Persona;
  currentTurnParticipantIndex: number;
  participantTurnsThisCycle: number;
  currentRound: number;
  isActive: boolean;
  isSummarizing: boolean;
  isPausedForUserInteraction: boolean;
  automatedPhaseComplete: boolean;
}

const ALL_PERSONAS: Record<string, Persona> = {
  nilm_expert: { id: 'nilm_expert', name: 'mistral', model: AI_MISTRAL_ID, instructions: "NILM Expert instructions...", expertise: 'NILM expertise' },
  data_scientist: { id: 'data_scientist', name: 'gemini', model: AI_GEMINI_ID, instructions: "Data Scientist instructions...", expertise: 'Data science expertise' },
  [MODERATOR_PERSONA_ID]: { id: MODERATOR_PERSONA_ID, name: 'mod', model: AI_MISTRAL_ID, instructions: "Moderator instructions..." }
};

const wss = new WebSocketServer({ server });
const activeDebates = new Map<WebSocket, Debate>();

wss.on('connection', (ws) => {
  console.log('Client connected');
  activeDebates.set(ws, createNewDebateState());

  ws.on('message', async (msg) => {
    const debate = activeDebates.get(ws);
    if (!debate) {
      const idForSystemMessage: string = 'unknown_debate_session';
      sendSystemMessage(ws, idForSystemMessage, 'Error: Internal session error.');
      return;
    }

    let parsedMessage: any;
    try {
      parsedMessage = JSON.parse(msg.toString());
      if (typeof parsedMessage !== 'object' || parsedMessage === null) throw new Error("Msg not an object");
    } catch (e) {
      sendSystemMessage(ws, debate.id, 'Error: Invalid message format.');
      return;
    }

    const { type, payload } = parsedMessage as { type: string, payload: any };

    if (debate.isSummarizing && type !== 'stop_debate' && !(type === 'user_command' && payload?.command === 'end_session')) {
        sendSystemMessage(ws, debate.id, "Please wait, session is summarizing.");
        return;
    }

    switch (type) {
      case 'start_debate':
        if (payload && payload.topic && typeof payload.topic === 'string') {
          if (debate.isActive || debate.isPausedForUserInteraction) {
            sendSystemMessage(ws, debate.id, 'Session in progress. End/reset first.');
            return;
          }
          const personaIds = Array.isArray(payload.persona_ids) && payload.persona_ids.every((id: any) => typeof id === 'string')
            ? payload.persona_ids
            : [ALL_PERSONAS.nilm_expert.id, ALL_PERSONAS.data_scientist.id];
          await startDebate(ws, debate, payload.topic, personaIds);
        } else {
          sendSystemMessage(ws, debate.id, 'Error: "topic" (string) required.');
        }
        break;
      case 'user_query':
      case 'user_interjection':
        if (payload && payload.content && typeof payload.content === 'string') {
          if (!debate.isActive && !debate.isPausedForUserInteraction) {
            sendSystemMessage(ws, debate.id, 'No active session.');
            return;
          }
          if (debate.isPausedForUserInteraction) {
            await handleUserMessageDuringInteraction(ws, debate, payload.content);
          } else if (debate.isActive) {
            handleUserInterjectionDuringAutoDebate(ws, debate, payload.content);
          }
        } else {
          sendSystemMessage(ws, debate.id, 'Error: "content" (string) required.');
        }
        break;
      case 'regenerate_last_ai_turn':
        if (!debate.isActive && !debate.isPausedForUserInteraction) {
          sendSystemMessage(ws, debate.id, 'No active session to regenerate from.');
          return;
        }
        await handleRegenerateLastAiTurn(ws, debate);
        break;
      case 'seek_convergence':
        if (debate.isActive && !debate.automatedPhaseComplete && !debate.isPausedForUserInteraction) {
            sendSystemMessage(ws, debate.id, 'User initiated early pause. Transitioning to Q&A.');
            await transitionToUserInteractionPhase(ws, debate);
        } else if (debate.isPausedForUserInteraction) {
            sendSystemMessage(ws, debate.id, 'Already in Q&A. Type /end to summarize.');
        } else {
            sendSystemMessage(ws, debate.id, 'No active automated debate to transition.');
        }
        break;
      case 'stop_debate':
        sendSystemMessage(ws, debate.id, 'Session stopped and reset by user.');
        await concludeSession(ws, debate, true);
        break;
      case 'user_command':
        if (payload && payload.command === 'end_session') {
            if (debate.isActive || debate.isPausedForUserInteraction) {
                sendSystemMessage(ws, debate.id, "Ending session & summarizing...");
                await concludeSession(ws, debate, false);
            } else {
                 sendSystemMessage(ws, debate.id, 'No active session to end.');
            }
        } else {
            sendSystemMessage(ws, debate.id, `Unknown user command: "${payload?.command}".`);
        }
        break;
      default:
        sendSystemMessage(ws, debate.id, `Unknown message type: "${type}".`);
    }
  });

  ws.on('close', () => { /* ... */ });
  sendSystemMessage(ws, 'initial_connection', 'Welcome! ...');
});

function createNewDebateState(): Debate {
  const debateId = `debate_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  return {
    id: debateId, topic: '', history: [], participants: [],
    moderator: ALL_PERSONAS[MODERATOR_PERSONA_ID] ? { ...ALL_PERSONAS[MODERATOR_PERSONA_ID] } : undefined,
    currentTurnParticipantIndex: 0, participantTurnsThisCycle: 0, currentRound: 0,
    isActive: false, isSummarizing: false, isPausedForUserInteraction: false, automatedPhaseComplete: false,
  };
}

async function startDebate(ws: WebSocket, debate: Debate, topic: string, personaIds: string[]) {
  const newParticipants = personaIds.filter(id => id !== MODERATOR_PERSONA_ID)
                                   .map(id => ALL_PERSONAS[id]).filter(Boolean) as Persona[];
  const moderatorSelected = personaIds.includes(MODERATOR_PERSONA_ID);
  const existingDebateId = debate.id;

  Object.assign(debate, {
      ...createNewDebateState(), id: existingDebateId, topic: topic, participants: newParticipants,
      moderator: moderatorSelected && ALL_PERSONAS[MODERATOR_PERSONA_ID] ? { ...ALL_PERSONAS[MODERATOR_PERSONA_ID] } : undefined,
      isActive: true, // This is key for automated phase
      isPausedForUserInteraction: false, automatedPhaseComplete: false, isSummarizing: false, // Explicitly reset
      currentRound: 0, participantTurnsThisCycle: 0, currentTurnParticipantIndex: 0 // Explicitly reset counters
  });

  if (debate.participants.length === 0) {
    sendSystemMessage(ws, debate.id, "Error: At least one active participant required.");
    debate.isActive = false; return;
  }

  addMessageToHistory(debate, createChatMessage('User', topic));
  broadcastMessage(ws, debate.history[debate.history.length -1]);

  const pNames = debate.participants.map(p => p.name).join(', ');
  let startMsg = `Debate started on: "${topic}". Participants: ${pNames}.`;
  if (debate.moderator) startMsg += ` Moderated by ${debate.moderator.name}.`;
  sendSystemMessage(ws, debate.id, startMsg);

  setTimeout(() => processNextTurn(ws, debate), 500);
}

function handleUserInterjectionDuringAutoDebate(ws: WebSocket, debate: Debate, content: string) {
    addMessageToHistory(debate, createChatMessage('User', content));
    broadcastMessage(ws, debate.history[debate.history.length -1]);
    sendSystemMessage(ws, debate.id, "User interjection noted for next speaker.");
}

async function handleUserMessageDuringInteraction(ws: WebSocket, debate: Debate, userContent: string) {
    console.log(`[Debate ${debate.id}] Handling user message in Q&A: "${userContent.substring(0,50)}..."`);
    addMessageToHistory(debate, createChatMessage('User', userContent));
    broadcastMessage(ws, debate.history[debate.history.length -1]);

    if (userContent.trim().toLowerCase() === '/end') {
        sendSystemMessage(ws, debate.id, "User requested end. Summarizing...");
        await concludeSession(ws, debate, false);
        return;
    }

    const targetedRegex = /^@([\w\s().-]+):\s*(.*)/i;
    const match = userContent.match(targetedRegex);

    if (match) {
        const targetPersonaName = match[1].trim();
        const questionForPersona = match[2].trim();
        const allAddressable = [...debate.participants, debate.moderator].filter(Boolean) as Persona[];
        const targetPersona = allAddressable.find(p => p.name.toLowerCase() === targetPersonaName.toLowerCase());

        if (targetPersona) {
            console.log(`[Debate ${debate.id}] User targeted ${targetPersona.name}.`);
            sendSystemMessage(ws, debate.id, `Asking ${targetPersona.name}...`);
            const prompt = buildPromptForUserQuestionToPersona(debate, targetPersona, questionForPersona);
            await executeAiTurn(ws, debate, targetPersona, false, prompt);
        } else {
            sendSystemMessage(ws, debate.id, `Persona "${targetPersonaName}" not found. Treating as general comment.`);
            await triggerSequentialResponsesToUserComment(ws, debate, userContent, null);
        }
    } else {
        console.log(`[Debate ${debate.id}] User made a general comment.`);
        sendSystemMessage(ws, debate.id, `Processing general comment...`);
        if (debate.moderator) {
            console.log(`[Debate ${debate.id}] Moderator will field general comment first.`);
            const modPrompt = buildPromptForGeneralUserComment(debate, debate.moderator, userContent, true);
            await executeAiTurn(ws, debate, debate.moderator, false, modPrompt);
            // After moderator, trigger participants
            await triggerSequentialResponsesToUserComment(ws, debate, userContent, debate.moderator.name);
        } else {
            console.log(`[Debate ${debate.id}] No moderator, participants will respond to general comment.`);
            await triggerSequentialResponsesToUserComment(ws, debate, userContent, null);
        }
    }
}

async function triggerSequentialResponsesToUserComment(
    ws: WebSocket, debate: Debate, originalUserComment: string, initialResponderName: string | null
) {
    if (!debate.isPausedForUserInteraction || !debate.isActive || debate.isSummarizing) { // Ensure correct state
        console.log(`[Debate ${debate.id}] Skipping sequential responses. State: paused=${debate.isPausedForUserInteraction}, active=${debate.isActive}, summarizing=${debate.isSummarizing}`);
        return;
    }
    console.log(`[Debate ${debate.id}] Triggering sequential responses from participants to user comment (initial responder: ${initialResponderName || 'None'}).`);

    // Ensure there are participants
    if (debate.participants.length === 0) {
        sendSystemMessage(ws, debate.id, "No participants available to respond to the comment.");
        if(debate.isPausedForUserInteraction) sendSystemMessage(ws, debate.id, "You can ask another question or type '/end'.");
        return;
    }

    sendSystemMessage(ws, debate.id, `Asking other experts to weigh in...`);

    for (const participant of debate.participants) {
        // Double check state before each AI call in the loop
        if (!debate.isPausedForUserInteraction || !debate.isActive || debate.isSummarizing) {
            console.log(`[Debate ${debate.id}] Halting sequential responses mid-loop due to state change.`);
            break;
        }
        console.log(`[Debate ${debate.id}] Participant ${participant.name} to respond to user comment + initial response.`);
        const prompt = buildPromptForParticipantFollowUpToUserComment(debate, participant, originalUserComment, initialResponderName);
        await executeAiTurn(ws, debate, participant, false, prompt);
    }

    // After all participants have had a chance to respond (if the loop completed)
    if (debate.isPausedForUserInteraction && debate.isActive && !debate.isSummarizing) {
        sendSystemMessage(ws, debate.id, "All experts have responded. You can ask another question or type '/end'.");
    }
}

async function handleRegenerateLastAiTurn(ws: WebSocket, debate: Debate) {
    let lastAiMessageIndex = -1;
    for (let i = debate.history.length - 1; i >= 0; i--) {
        if (debate.history[i].speaker !== 'User' && debate.history[i].speaker !== 'System' && !debate.history[i].isThinking) {
            lastAiMessageIndex = i; break;
        }
    }
    if (lastAiMessageIndex === -1) { sendSystemMessage(ws, debate.id, "No AI response to regenerate."); return; }

    const lastAiMessage = debate.history[lastAiMessageIndex];
    const allAddressable = [...debate.participants, debate.moderator].filter(Boolean) as Persona[];
    const personaToRegenerate = allAddressable.find(p => p.name === lastAiMessage.speaker);

    if (!personaToRegenerate) { sendSystemMessage(ws, debate.id, "Could not identify persona for regen."); return; }

    sendSystemMessage(ws, debate.id, `Regenerating last response from ${lastAiMessage.speaker}...`);
    debate.history.splice(lastAiMessageIndex);
    while (debate.history.length > 0 && debate.history[debate.history.length - 1].isThinking && debate.history[debate.history.length - 1].speaker === personaToRegenerate.name) {
        debate.history.pop();
    }
    await executeAiTurn(ws, debate, personaToRegenerate, true);
}

async function processNextTurn(ws: WebSocket, debate: Debate) {
    if (debate.isPausedForUserInteraction || !debate.isActive || debate.isSummarizing) {
        console.log(`[Debate ${debate.id}] Halting automated turns. State: paused=${debate.isPausedForUserInteraction}, active=${debate.isActive}, summarizing=${debate.isSummarizing}`);
        return;
    }

    if (await checkAndTransitionToUserInteractionPhase(ws, debate)) { return; }

    let currentPersona: Persona | undefined;
    const isModeratorTurnNext = debate.moderator && debate.participants.length > 0 &&
                             debate.participantTurnsThisCycle >= MODERATOR_TURN_INTERVAL;

    if (isModeratorTurnNext && debate.moderator) {
        currentPersona = debate.moderator;
        console.log(`[Debate ${debate.id}] Moderator's turn. Turns this cycle: ${debate.participantTurnsThisCycle}`);
    } else {
        if (debate.participants.length > 0) {
            currentPersona = debate.participants[debate.currentTurnParticipantIndex];
             console.log(`[Debate ${debate.id}] P${debate.currentTurnParticipantIndex} (${currentPersona?.name}) turn. Round ${debate.currentRound + 1}. Turns this cycle: ${debate.participantTurnsThisCycle + 1}`);
        } else {
            sendSystemMessage(ws, debate.id, "No participants. Concluding.");
            await concludeSession(ws, debate, true); return;
        }
    }
    if (!currentPersona) {
        sendSystemMessage(ws, debate.id, "Error: No next speaker. Concluding.");
        await concludeSession(ws, debate, true); return;
    }

    await executeAiTurn(ws, debate, currentPersona, false, undefined);

    if (!debate.isActive || debate.isSummarizing || debate.isPausedForUserInteraction) return;

    const wasModeratorTurn = currentPersona.id === debate.moderator?.id;
    if (wasModeratorTurn) {
        debate.participantTurnsThisCycle = 0;
        console.log(`[Debate ${debate.id}] Mod turn done. Turns this cycle reset.`);
    } else {
        debate.participantTurnsThisCycle++;
        if (debate.participants.length > 0) {
            const nextParticipantIndex = (debate.currentTurnParticipantIndex + 1) % debate.participants.length;
            if (debate.currentTurnParticipantIndex === debate.participants.length - 1) { // Just finished last participant of a round
                debate.currentRound++;
                console.log(`[Debate ${debate.id}] P${currentPersona.name} finished turn. COMPLETED ROUND: ${debate.currentRound}.`);
            }
            debate.currentTurnParticipantIndex = nextParticipantIndex;
            console.log(`[Debate ${debate.id}] P${currentPersona.name} finished turn. Next P idx: ${debate.currentTurnParticipantIndex}. Turns this cycle: ${debate.participantTurnsThisCycle}`);
        }
    }

    if (debate.isActive && !debate.isSummarizing && !debate.isPausedForUserInteraction) {
        console.log(`[Debate ${debate.id}] Scheduling next automated turn.`);
        setTimeout(() => processNextTurn(ws, debate), 500);
    } else {
        console.log(`[Debate ${debate.id}] Not scheduling next auto turn. State: active=${debate.isActive}, summarizing=${debate.isSummarizing}, paused=${debate.isPausedForUserInteraction}`);
    }
}

async function checkAndTransitionToUserInteractionPhase(ws: WebSocket, debate: Debate): Promise<boolean> {
    if (debate.automatedPhaseComplete || debate.isPausedForUserInteraction) {
        return debate.isPausedForUserInteraction;
    }
    if (debate.participants.length > 0 && debate.currentRound >= MAX_DEBATE_ROUNDS_PER_PARTICIPANT) {
        console.log(`[Debate ${debate.id}] Max rounds (${MAX_DEBATE_ROUNDS_PER_PARTICIPANT}) reached at round ${debate.currentRound}. Transitioning.`);
        await transitionToUserInteractionPhase(ws, debate);
        return true;
    }
    return false;
}

async function transitionToUserInteractionPhase(ws: WebSocket, debate: Debate) {
    console.log(`[Debate ${debate.id}] Transitioning to user Q&A phase.`);
    debate.automatedPhaseComplete = true;
    debate.isPausedForUserInteraction = true;
    // debate.isActive remains true for the session
    sendSystemMessage(ws, debate.id, "Automated debate phase complete. You can now ask questions to the AIs (e.g., '@mod/gemini/mistral: your question') or make general comments. Type '/end' in the chat to summarize and conclude the session.");
}

async function executeAiTurn( ws: WebSocket, debate: Debate, persona: Persona, isRegeneration: boolean = false, customPrompt?: string) {
    if (debate.isSummarizing) {
        console.log(`[Debate ${debate.id}] Skipping AI turn for ${persona.name} (summarizing).`);
        return;
    }
    // This is key: if it's an automated turn, but we are past the automated phase, skip.
    // Custom prompts (for Q&A) or regenerations should still proceed if session is active.
    if (!customPrompt && !isRegeneration && (debate.automatedPhaseComplete || debate.isPausedForUserInteraction)) {
        console.log(`[Debate ${debate.id}] Skipping automated AI turn for ${persona.name} (auto phase done/paused).`);
        return;
    }

    broadcastMessage(ws, createChatMessage(persona.name, '', false, true)); // isThinking = true

    const finalPrompt = customPrompt || buildPromptForPersona(debate, persona, isRegeneration);
    const callType = customPrompt ? 'UserQuery/CommentResponse' : (isRegeneration ? 'Regeneration' : 'AutoDebate');

    try {
        let aiResponseContent = '';
        console.log(`[Debate ${debate.id}] Calling ${persona.model} for ${persona.name}. Type: ${callType}. Prompt (first 60): ${finalPrompt.substring(0,60)}...`);

        if (persona.model === AI_MISTRAL_ID) aiResponseContent = await fetchMistral(finalPrompt);
        else if (persona.model === AI_GEMINI_ID) aiResponseContent = await fetchGemini(finalPrompt);
        else throw new Error(`Unknown AI model: ${persona.model}`);

        if (debate.isSummarizing || (!debate.isActive && !debate.isPausedForUserInteraction)) {
            console.log(`[Debate ${debate.id}] AI response for ${persona.name} received, but session state changed. Discarding.`);
            return;
        }
        addMessageToHistory(debate, createChatMessage(persona.name, aiResponseContent, isRegeneration, false)); // isThinking = false
        broadcastMessage(ws, debate.history[debate.history.length - 1]);
    } catch (error: any) {
        console.error(`[Debate ${debate.id}] Error for ${persona.name} (${callType}):`, error);
        // Send a non-thinking message to clear the indicator on client for this persona if an error occurs
        addMessageToHistory(debate, createChatMessage(persona.name, `Error: Could not get response from ${persona.name}.`, false, false));
        broadcastMessage(ws, debate.history[debate.history.length -1]);

        if (debate.isActive || debate.isPausedForUserInteraction) {
            sendSystemMessage(ws, debate.id, `Error with ${persona.name}: ${error.message}.`);
        }
    }
}

function buildPromptForPersona(debate: Debate, persona: Persona, isRegeneration: boolean = false): string {
  let prompt = `${persona.instructions}\n\n`;
  prompt += `CURRENT DEBATE TOPIC: "${debate.topic}" (Automated Debate Phase)\n`;
  if (persona.expertise) prompt += `YOUR SPECIFIC EXPERTISE: ${persona.expertise}\n`;
  prompt += "\nRECENT CONVERSATION HISTORY (last ~5-7 entries, most recent first):\n";
  prompt += debate.history.slice(-7).map(msg => `${msg.speaker}: ${msg.content.substring(0, 500)}${msg.content.length > 500 ? '...' : ''}`).join('\n') + "\n\n---\n";
  prompt += `YOUR TASK, ${persona.name}:\n`;
  if (isRegeneration) prompt += `You are REGENERATING your previous response. Provide an alternative or refined answer based on the existing conversation context.\n`;

  if (persona.id === MODERATOR_PERSONA_ID) {
    prompt += `- Review the recent discussion.\n- Keep it on topic and productive. Are participants addressing each other's points?\n- Identify confusion or suggest clarifying questions.\n- Highlight consensus or disagreements.\n- Be concise.`;
  } else {
    const lastMeaningfulHistoryMessage = [...debate.history].reverse().find(m => m.speaker !== 'System' && !m.isThinking);
    const lastUserMessage = [...debate.history].reverse().find(m => m.speaker === 'User' && !m.isThinking && m.content !== debate.topic);
    const lastOtherAiOrModeratorMessage = [...debate.history].reverse().find(m => m.speaker !== 'System' && !m.isThinking && m.speaker !== 'User' && m.speaker !== persona.name);

    if (!lastMeaningfulHistoryMessage || (lastMeaningfulHistoryMessage.speaker === 'User' && lastMeaningfulHistoryMessage.content === debate.topic)) {
        prompt += `- This is your first substantive turn in the automated debate. Provide your initial perspective on "${debate.topic}".\n- Identify 1-2 key challenges or important considerations.`;
    } else if (lastUserMessage && (!lastOtherAiOrModeratorMessage || new Date(lastUserMessage.timestamp) > new Date(lastOtherAiOrModeratorMessage.timestamp))) {
      prompt += `- The User recently interjected with: "${lastUserMessage.content.substring(0,150)}...".\n- Address the user's point or provide your perspective on the topic, considering their input.`;
      if (lastOtherAiOrModeratorMessage) prompt += `\n- You can also consider the last statement from ${lastOtherAiOrModeratorMessage.speaker}: "${lastOtherAiOrModeratorMessage.content.substring(0,100)}..."`;
    } else if (lastOtherAiOrModeratorMessage) {
      prompt += `- The last speaker (excluding User) was ${lastOtherAiOrModeratorMessage.speaker}, who said: "${lastOtherAiOrModeratorMessage.content.substring(0, 150)}...".\n- Briefly critique their response from your perspective (strengths/weaknesses).\n- Suggest a specific improvement, alternative, or build upon their idea, aligning with your expertise.`;
    } else {
      prompt += `- Continue the discussion on "${debate.topic}".\n- Offer new insights, develop existing points, or ask a clarifying question from your expertise.`;
    }
  }
  prompt += `\nRemember your persona and keep your response concise as instructed.`;
  return prompt;
}

function buildPromptForUserQuestionToPersona(debate: Debate, persona: Persona, userQuestion: string): string {
    let prompt = `${persona.instructions}\n\n`;
    prompt += `CONTEXT: You are in an interactive Q&A phase of a debate on the topic: "${debate.topic}".\n`;
    if (persona.expertise) prompt += `YOUR EXPERTISE: ${persona.expertise}\n`;
    prompt += "\nSUMMARY OF PRIOR AUTOMATED DEBATE & RECENT Q&A (last ~5-7 entries):\n";
    prompt += debate.history.slice(-7).map(msg => `${msg.speaker}: ${msg.content.substring(0,200)}${msg.content.length > 200 ? '...' : ''}`).join('\n') + "\n\n---\n";
    prompt += `The User has asked YOU (${persona.name}) a direct question:\nUSER: "${userQuestion}"\n\n`;
    prompt += `YOUR TASK: Provide a concise, helpful, and direct answer to the User's question, drawing upon your expertise and the prior discussion. If the question is outside your expertise, say so politely and perhaps suggest which other expert might be better suited.`;
    return prompt;
}

function buildPromptForGeneralUserComment(debate: Debate, persona: Persona, userComment: string, isInitialResponderToUser: boolean = false): string {
    let prompt = `${persona.instructions}\n\n`;
    prompt += `CONTEXT: You are in an interactive Q&A phase of a debate on the topic: "${debate.topic}".\n`;
    if (persona.expertise) prompt += `YOUR EXPERTISE: ${persona.expertise}\n`;
    prompt += "\nSUMMARY OF PRIOR AUTOMATED DEBATE & RECENT Q&A (last ~5-7 entries):\n";
    prompt += debate.history.slice(-7).map(msg => `${msg.speaker}: ${msg.content.substring(0,200)}${msg.content.length > 200 ? '...' : ''}`).join('\n') + "\n\n---\n";
    prompt += `The User has made a general comment/asked a question to the group:\nUSER: "${userComment}"\n\n`;
    if (isInitialResponderToUser && persona.id === MODERATOR_PERSONA_ID) {
        prompt += `YOUR TASK, ${persona.name}: Acknowledge the user's comment. Briefly summarize its key point. Then, if appropriate, direct specific follow-up questions based on the user's comment AND the prior debate context to the NILM Expert and Data Scientist to continue the discussion. Be concise. Formulate clear questions for the experts if you direct them.`;
    } else {
        prompt += `YOUR TASK, ${persona.name}: Provide your perspective on the User's input. Address it thoughtfully based on your expertise and the prior discussion. Be concise.`;
    }
    return prompt;
}

function buildPromptForParticipantFollowUpToUserComment( debate: Debate, participant: Persona, originalUserComment: string, initialResponderName: string | null ): string {
    let prompt = `${participant.instructions}\n\n`;
    prompt += `CONTEXT: You are in an interactive Q&A phase of a debate on the topic: "${debate.topic}".\n`;
    if (participant.expertise) prompt += `YOUR EXPERTISE: ${participant.expertise}\n`;
    prompt += "\nRELEVANT CONVERSATION HISTORY (last ~7-10 entries to get user comment and initial response):\n";
    prompt += debate.history.slice(-10).map(msg => `${msg.speaker}: ${msg.content.substring(0,250)}${msg.content.length > 250 ? '...' : ''}`).join('\n') + "\n\n---\n";
    prompt += `The User made the following comment/question:\nUSER: "${originalUserComment}"\n\n`;
    if (initialResponderName) {
        const initialResponse = debate.history.slice().reverse().find(m => m.speaker === initialResponderName && new Date(m.timestamp).getTime() > new Date(debate.history.find(um => um.speaker === 'User' && um.content === originalUserComment)!.timestamp).getTime() );
        if(initialResponse) {
            prompt += `${initialResponderName} (e.g., the Moderator) then responded, potentially directing questions to you or other experts. Their response included:\n${initialResponderName}: "${initialResponse.content.substring(0, 300)}..."\n\n`;
        } else {
            prompt += `${initialResponderName} also responded to the user's comment.\n\n`;
        }
    }
    prompt += `YOUR TASK, ${participant.name}: Provide your specific insights and response. Consider the User's original comment AND ${initialResponderName ? initialResponderName + "'s points (and any questions they may have directed to you or your field of expertise). " : "the context. "}Address any questions relevant to your expertise. Be concise and focused.`;
    return prompt;
}

async function concludeSession(ws: WebSocket, debate: Debate, hardReset: boolean = false) {
    const oldDebateId = debate.id;
    debate.isActive = false;
    debate.isPausedForUserInteraction = false;
    debate.automatedPhaseComplete = true; // Mark as complete
    
    if (hardReset || debate.history.filter(m => m.speaker !== 'User' && m.speaker !== 'System' && !m.isThinking).length < 1) {
        if (!hardReset && debate.topic) sendSystemMessage(ws, oldDebateId, "Not enough discussion for a summary.");
        sendSystemMessage(ws, oldDebateId, 'Session ended. You can start a new one.');
        activeDebates.set(ws, createNewDebateState());
        return;
    }
    await summarizeAndConclude(ws, debate);
}

async function summarizeAndConclude(ws: WebSocket, debate: Debate) {
  if (debate.isSummarizing) return;
  debate.isSummarizing = true;
  debate.isActive = false;
  debate.isPausedForUserInteraction = false;

  broadcastMessage(ws, createChatMessage("System", "", false, true, `msg_summary_think_${Date.now()}`));
  sendSystemMessage(ws, debate.id, 'Generating final summary...');

  const fullHistoryText = debate.history.map(msg => `${msg.speaker}: ${msg.content}`).join('\n\n');
  const summaryPrompt = `
CONTEXT: Transcript of an AI debate and user Q&A on: "${debate.topic}"
Participants: ${debate.participants.map(p => p.name).join(', ')}${debate.moderator ? ', moderated by ' + debate.moderator.name : ''}.
HISTORY:
${fullHistoryText}
---
TASK: Neutral summarizer. Provide a concise summary (~5-8 sentences). Include:
1. Core problem/topic.
2. Key arguments from automated debate.
3. Significant points/clarifications from user Q&A.
4. Agreements/disagreements.
5. Emerged solutions/understandings.
6. Unresolved questions.
Output: Clear, balanced, practical plain text.`;

  try {
    const summary = await fetchMistral(summaryPrompt);
    broadcastMessage(ws, createChatMessage('System', `Final Summary:\n${summary}`));
  } catch (error: any) {
    sendSystemMessage(ws, debate.id, `Error generating summary: ${error.message}`);
  } finally {
    sendSystemMessage(ws, debate.id, 'Debate concluded. You can start a new one.');
    activeDebates.set(ws, createNewDebateState());
  }
}

function createChatMessage(speaker: string, content: string, isRegenerated: boolean = false, isThinking: boolean = false, id?: string): ChatMessage {
  return {
    id: id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    speaker, content, timestamp: new Date().toISOString(),
    isRegenerated: isRegenerated || false, isThinking: isThinking || false,
  };
}

function addMessageToHistory(debate: Debate, message: ChatMessage) { debate.history.push(message); }
function sendSystemMessage(ws: WebSocket, debateId: string, content: string) { broadcastMessage(ws, createChatMessage('System', content)); }
function broadcastMessage(ws: WebSocket, message: ChatMessage) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }