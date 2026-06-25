Multiple AI Agent Debate Chamber 🎭🤖

An event-driven, stateful multi-agent conversational platform that orchestrates structured, multi-perspective debates using role-driven LLMs. Built using a lightweight, high-performance architecture, the system simulates real-time adversarial and collaborative dialogues to deliver deep analytical reasoning on complex topics.

🏛️ System Architecture Overview

Unlike standard linear chatbots, this platform implements a Finite-State Machine (FSM) over long-lived, bi-directional WebSocket channels to preserve conversational context and orchestrate agent turn-taking.

                  +--------------------------------+
                  |       Client (Svelte UI)       |
                  +---------------+----------------+
                                  |
                        WebSocket (JSON Streams)
                                  v
                  +---------------+----------------+
                  |      Hono Server (Node.js)     |
                  +-------+----------------+-------+
                          |                |
                          v                v
            +-------------+----+      +----+-------------+
            | Session / FSM    |      | Orchestration    |
            | State Manager    |      | & Turn Engine    |
            +------------------+      +----+-------------+
                                           |
                                  +--------+--------+
                                  v                 v
                       +----------+------+   +------+----------+
                       |   Mistral API   |   |   Gemini API    |
                       +----------+------+   +------+----------+
                                  |                 |
                             (Skeptic &        (Visionary &
                             Moderator)          Custom)


🧠 Core Engineering Features

[cite_start]Multi-Model Persona Mapping: Divergent perspectives are guaranteed by routing distinct personas to separate LLM providers (e.g., Mistral API and Google Gemini SDK), eliminating single-model cognitive bias[cite: 9, 175, 328, 352].

[cite_start]Turn-Based Scheduling Logic: Prevents conversational dominance or race conditions through a deterministic round-robin execution queue controlled by the central server backend[cite: 13, 111, 156, 755].

Human-in-the-Loop Interjection: Users are active participants rather than observers. [cite_start]The system contextually hooks user interjections into ongoing states, using pattern parsing to evaluate whether to distribute queries broadly or target specific sub-agents[cite: 54, 55, 148, 151, 152].

[cite_start]Dynamic Context Compression: Constructs dynamic system prompts based on current session parameters and conversation logs, finalizing with an automated full-history abstractive summarizer upon session closure[cite: 114, 162, 164, 255].

🧰 Tech Stack

Component

Technology

Purpose

Backend Framework

Hono v4+

[cite_start]Lightweight routing and event handlers [cite: 99, 167]

Runtime Environment

Node.js

[cite_start]Non-blocking asynchronous event loop [cite: 92, 101]

Real-time Protocol

WebSockets (ws)

[cite_start]Duplex persistent connection matrix [cite: 90, 100]

Frontend Framework

Svelte

[cite_start]Granular compiled reactive tracking [cite: 264, 300]

Markdown & Security

marked + DOMPurify

[cite_start]XSS-insulated markdown message rendering [cite: 265]

AI Inference Engine

Gemini SDK & Mistral API

[cite_start]Multi-tenant LLM execution pipeline [cite: 102, 328]

📁 Project Structure

multi-agent-debate/
├── backend/
│   ├── src/
│   │   ├── index.ts          # Server core & WebSocket router
│   │   ├── state.ts          # FSM & Session Schema configurations
│   │   ├── personas.ts       # Behavioral system instructions
│   │   └── services/
│   │       ├── gemini.ts     # Google AI SDK client integration
│   │       └── mistral.ts    # Mistral API endpoint fetchers
│   ├── .env.example
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.svelte        # Unified chat dashboard & layout
    │   ├── ChatWindow.svelte # Reactive message thread viewer
    │   └── SetupForm.svelte  # Debate topic initialization interface
    └── package.json


🛠️ Getting Started

1. Clone & Dependencies

git clone [https://github.com/Anish-1205/Multiple_AI_Debate_Chamber.git](https://github.com/Anish-1205/Multiple_AI_Debate_Chamber.git)
cd Multiple_AI_Debate_Chamber


2. Configure Environment Variables

Create a .env file within your backend/ directory:

PORT=8080
MISTRAL_API_KEY=your_mistral_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here


3. Execution Pipeline

Launch Backend Engine:

cd backend
npm install
npm run dev
# Server initializes on http://localhost:8080


Launch Frontend Client:

cd frontend
npm install
npm run dev
# Dashboard launches locally


🧪 Real-Time Protocol Specifications (JSON Payloads)

All system events pass through standard WebSocket channel envelopes:

Client Init Command (start_debate):

{
  "type": "start_debate",
  "payload": {
    "topic": "Should AI development be decentralized to prevent corporate monopoly?",
    "personas": ["visionary", "skeptic"]
  }
}


Server Response Stream (ai_turn_chunk):

{
  "type": "ai_response",
  "payload": {
    "id": "msg_171890253412",
    "speaker": "Skeptic",
    "content": "While decentralization democratizes access, it exacerbates safety alignment tracking...",
    "isThinking": false
  }
}


📊 Evaluation & Trade-offs

[cite_start]As noted in the Senior Design Project analysis[cite: 4]:

[cite_start]Reasoning Density: The multi-agent approach showed substantial improvement in depth of arguments and contextual variety versus a baseline single-agent chatbot[cite: 13, 350].

[cite_start]Latency Trade-off: Sequential API calls introduce higher overall round latency proportional to the active agent group size, presenting an optimization path for parallelized predictive pipeline parsing[cite: 371, 417].

📜 License & Disclaimers

[cite_start]All API integrations conform to strict safety boundaries preventing dangerous response generation[cite: 332].
