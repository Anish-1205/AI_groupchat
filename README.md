# AI Group Chat: Philosopher Debate Chamber

A real-time, multi-agent debate app. Pick a topic and a panel of AI philosophers, watch them argue in turns, then step in with your own questions.

## Features

- **Six philosopher personas plus a moderator:** Zeno (Stoicism), Simone (Existentialism), Ananda (Buddhism), Dewey (Pragmatism), Baruch (Rationalism), Sisyphus (Absurdism), and Arbiter, the neutral host.
- **Multiple model providers:** Personas are routed across Groq, Google Gemini, and Mistral.
- **Provider fallback:** If a provider fails, the server tries the other configured providers.
- **Turn-based debates:** The server controls speaking order and moderator turns.
- **Human participation:** Comment to the group, or `@mention` a persona to ask it directly.
- **Debate controls:** Regenerate the last AI turn, seek convergence, or stop the debate.
- **Abuse limits:** LLM calls are capped per client IP each hour and across the server each day.
- **Safe rendering:** Messages are rendered with `marked` and sanitized with DOMPurify.

## Architecture

```text
SvelteKit static client
        │  WebSocket (JSON messages)
        ▼
Node.js server (Hono + ws)
  ├── Debate state and turn engine
  ├── Persona prompts
  └── Rate limits and provider fallback
        │
        ├── Groq
        ├── Google Gemini
        └── Mistral
```

Debate state and rate-limit counters are held in memory, so they reset when the server restarts and are not shared between server instances.

## Tech stack

| Area | Technology |
| --- | --- |
| Client | SvelteKit, Vite, TypeScript, marked, DOMPurify |
| Server | Node.js, Hono, ws, tsx, TypeScript |
| AI providers | Groq, Google Gemini, Mistral |
| Hosting config | Render Blueprint (`render.yaml`) |

## Getting started

You need Node.js and an API key for at least one provider.

### 1. Start the server

```bash
cd AI-GroupChat-main/AI-GroupChat-main
npm install
```

Create a `.env` file in that folder:

```env
GROQ_API_KEY=
GEMINI_API_KEY=
MISTRAL_API_KEY=
```

```bash
npm run dev
```

The server listens on port 3001.

### 2. Start the client

In a second terminal, from the repository root:

```bash
cd AI-GroupChat-frontend-main/AI-GroupChat-frontend-main
npm install
npm run dev
```

Open the local URL Vite prints. The client connects to `ws://localhost:3001` unless `VITE_WS_URL` is set.

## Configuration

Server variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Server port |
| `GROQ_API_KEY` | None | Enables Groq |
| `GEMINI_API_KEY` | None | Enables Gemini |
| `MISTRAL_API_KEY` | None | Enables Mistral |
| `GROQ_MODEL` | Set in `src/ai/groq.ts` | Groq model |
| `GEMINI_MODEL` | Set in `src/ai/gemini.ts` | Primary Gemini model |
| `GEMINI_FALLBACK_MODEL` | Set in `src/ai/gemini.ts` | Fallback Gemini model |
| `MISTRAL_MODEL` | Set in `src/ai/mistral.ts` | Mistral model |
| `MISTRAL_API_URL` | Set in `src/ai/mistral.ts` | Mistral endpoint |
| `MAX_CALLS_PER_IP_HOUR` | `30` | LLM calls per client IP per hour |
| `MAX_CALLS_PER_DAY` | `500` | LLM calls per server per day |

Client variable:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_WS_URL` | `ws://localhost:3001` | WebSocket server URL |

## WebSocket messages

The client sends JSON messages with a `type` and `payload`:

| Type | Purpose |
| --- | --- |
| `start_debate` | Start a debate with a `topic` and optional `persona_ids` |
| `user_query`, `user_interjection` | Add a user message |
| `regenerate_last_ai_turn` | Regenerate the latest AI reply |
| `seek_convergence` | Ask the panel to move toward agreement |
| `stop_debate` | End the debate |
| `user_command` | Run a debate command |

Example:

```json
{
  "type": "start_debate",
  "payload": {
    "topic": "Should AI development be decentralized?",
    "persona_ids": ["stoic", "existentialist", "buddhist", "moderator"]
  }
}
```

## Deployment

`render.yaml` defines a Node web service for the API and a static site for the client. Set the API keys in Render and point `VITE_WS_URL` at the deployed API using `wss://`.
