<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import Icon from '$lib/Icon.svelte';

	interface ChatMessageFromServer {
		id: string;
		speaker: string;
		content: string;
		timestamp: string;
		isThinking?: boolean;
		isRegenerated?: boolean;
	}

	type SessionState = 'idle' | 'automated_debate' | 'user_interaction' | 'summarizing';

	const REPO_URL = 'https://github.com/Anish-1205/AI_groupchat';

	// `name` must match the persona name in the backend's ALL_PERSONAS (it's the message speaker).
	const availablePersonas = [
		{ id: 'stoic', name: 'Zeno', title: 'Calm', tradition: 'Stoic', mono: 'ZE', color: '#60a5fa', defaultChecked: true },
		{ id: 'existentialist', name: 'Simone', title: 'Free Spirit', tradition: 'Existentialist', mono: 'SM', color: '#fb923c', defaultChecked: true },
		{ id: 'buddhist', name: 'Ananda', title: 'Mindful', tradition: 'Buddhist', mono: 'AN', color: '#facc15', defaultChecked: true },
		{ id: 'pragmatist', name: 'Dewey', title: 'Practical', tradition: 'Pragmatist', mono: 'DW', color: '#2dd4bf', defaultChecked: false },
		{ id: 'rationalist', name: 'Baruch', title: 'Rational', tradition: 'Rationalist', mono: 'BA', color: '#a5b4fc', defaultChecked: false },
		{ id: 'absurdist', name: 'Sisyphus', title: 'Rebel', tradition: 'Absurdist', mono: 'SY', color: '#fb7185', defaultChecked: false },
		{ id: 'moderator', name: 'Arbiter', title: 'Neutral', tradition: 'Moderator', mono: 'AR', color: '#a1a1aa', defaultChecked: true }
	];
	type Persona = (typeof availablePersonas)[number];
	const personaByName: Record<string, Persona> = Object.fromEntries(availablePersonas.map((p) => [p.name, p]));

	const exampleQuestions = [
		'Is happiness the point of life?',
		'Can a machine ever have a mind?',
		'Do we owe anything to future generations?',
		'Is suffering necessary?'
	];

	const highlights = [
		{ icon: 'radio', title: 'Live over WebSockets', text: 'Every turn streams to the browser as it is produced.' },
		{ icon: 'workflow', title: 'Server-side orchestration', text: 'A state machine schedules speakers, rounds and moderation.' },
		{ icon: 'user-round', title: 'Human in the loop', text: 'Interject, question one agent with @name, or regenerate a turn.' }
	] as const;

	const steps = [
		{ title: 'Pose a question', text: 'Choose a panel of agents and set the topic.' },
		{ title: 'Watch them argue', text: 'Agents trade two rounds of arguments while a moderator keeps it sharp.' },
		{ title: 'Take the floor', text: 'Interject, address one agent with @name, or regenerate a turn.' },
		{ title: 'Get the verdict', text: 'The moderator closes with a structured, balanced verdict.' }
	];

	const stack = ['SvelteKit', 'TypeScript', 'Hono', 'Node.js', 'WebSockets', 'Mistral AI', 'Google Gemini', 'Render'];

	const phases = ['Opening rounds', 'Open floor', 'Verdict'];

	// --- State ---
	let messages: ChatMessageFromServer[] = [];
	let ws: WebSocket | null = null;
	let userInput = '';
	let debateTopicInput = '';
	let topic = '';
	let isConnected = false;
	let currentSessionState: SessionState = 'idle';
	let showError: string | null = null;
	let chatContainer: HTMLElement;
	let thinkingSpeakers = new Set<string>();
	let selectedPersonaIds: string[] = availablePersonas.filter((p) => p.defaultChecked).map((p) => p.id);
	let motion = 220; // transition duration; zeroed for prefers-reduced-motion

	function parseMarkdown(markdownText: string): string {
		if (!markdownText) return '';
		try {
			return DOMPurify.sanitize(marked.parse(markdownText) as string, { USE_PROFILES: { html: true } });
		} catch (e) {
			console.error('Error parsing markdown:', e);
			const div = document.createElement('div');
			div.textContent = markdownText;
			return div.innerHTML.replace(/\n/g, '<br>');
		}
	}

	// --- WebSocket Logic ---
	onMount(() => {
		marked.setOptions({ gfm: true, breaks: true });
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) motion = 0;
		connectWebSocket();
		return () => ws?.close();
	});

	function connectWebSocket() {
		ws = new WebSocket(import.meta.env.VITE_WS_URL || 'ws://localhost:3001');

		ws.onopen = () => {
			isConnected = true;
			showError = null;
		};

		ws.onmessage = async (event) => {
			try {
				const message: ChatMessageFromServer = JSON.parse(event.data as string);

				if (message.isThinking) {
					thinkingSpeakers.add(message.speaker);
				} else {
					thinkingSpeakers.delete(message.speaker);
					messages = [...messages, message];

					if (message.speaker === 'System') {
						const lower = message.content.toLowerCase();
						if (lower.includes('debate started')) currentSessionState = 'automated_debate';
						else if (lower.includes('automated debate phase complete')) currentSessionState = 'user_interaction';
						else if (lower.includes('generating final summary')) currentSessionState = 'summarizing';
						else if (lower.includes('debate concluded') || lower.includes('session ended') || lower.includes('session stopped')) {
							currentSessionState = 'idle';
							thinkingSpeakers.clear();
						}
					}
				}
				thinkingSpeakers = thinkingSpeakers;
				await tick();
				scrollToBottom();
			} catch (error) {
				console.error('Error processing message:', error);
				showError = 'Error processing server message.';
			}
		};

		ws.onclose = () => {
			isConnected = false;
			thinkingSpeakers.clear();
			thinkingSpeakers = thinkingSpeakers;
			showError = 'Connection lost. Reconnecting…';
			setTimeout(connectWebSocket, 3000);
		};

		ws.onerror = (error) => {
			console.error('WebSocket error:', error);
			showError = 'Could not reach the debate server. It may be waking up — this can take up to a minute.';
		};
	}

	function sendMessageToWs(type: string, payload: any = {}) {
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type, payload }));
			showError = null;
		} else {
			showError = 'Not connected yet. Please wait a moment.';
		}
	}

	function handleStartDebate() {
		if (!debateTopicInput.trim()) {
			showError = 'Enter a question to debate.';
			return;
		}
		if (!selectedPersonaIds.some((id) => id !== 'moderator')) {
			showError = 'Select at least one debating agent.';
			return;
		}
		messages = [];
		thinkingSpeakers.clear();
		topic = debateTopicInput.trim();
		sendMessageToWs('start_debate', { topic, persona_ids: selectedPersonaIds });
	}

	async function handleSendMessage() {
		if (!userInput.trim() || !canSendMessage) return;
		const messageType = currentSessionState === 'user_interaction' ? 'user_query' : 'user_interjection';
		sendMessageToWs(messageType, { content: userInput });
		messages = [...messages, { id: `local_${Date.now()}`, speaker: 'User', content: userInput, timestamp: new Date().toISOString() }];
		userInput = '';
		await tick();
		scrollToBottom();
	}

	const handleRegenerate = () => sendMessageToWs('regenerate_last_ai_turn');
	const handleStopOrReset = () => sendMessageToWs('stop_debate');

	function handleAdvance() {
		if (currentSessionState === 'automated_debate') sendMessageToWs('seek_convergence');
		else if (currentSessionState === 'user_interaction') sendMessageToWs('user_query', { content: '/end' });
	}

	function handleNewDebate() {
		messages = [];
		debateTopicInput = '';
		topic = '';
		showError = null;
	}

	function scrollToBottom() {
		if (chatContainer) setTimeout(() => (chatContainer.scrollTop = chatContainer.scrollHeight), 50);
	}

	function formatTimestamp(iso: string) {
		try {
			return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		} catch {
			return '';
		}
	}

	// Cursor-following highlight on cards.
	function spotlight(e: MouseEvent) {
		const el = e.currentTarget as HTMLElement;
		const r = el.getBoundingClientRect();
		el.style.setProperty('--mx', `${e.clientX - r.left}px`);
		el.style.setProperty('--my', `${e.clientY - r.top}px`);
	}

	// The summary "thinking" indicator is sent as speaker System; show it as the Arbiter drafting.
	const thinkingPersona = (speaker: string) => personaByName[speaker] ?? personaByName['Arbiter'];

	$: statusText = !isConnected
		? 'Connecting'
		: { idle: 'Ready', automated_debate: 'Debating', user_interaction: 'Open floor', summarizing: 'Writing verdict' }[currentSessionState];
	$: statusKind = !isConnected ? 'off' : currentSessionState === 'idle' ? 'ready' : 'live';
	$: phaseIndex = { idle: 3, automated_debate: 0, user_interaction: 1, summarizing: 2 }[currentSessionState];
	$: panel = availablePersonas.filter((p) => selectedPersonaIds.includes(p.id));
	$: canStartDebate = isConnected && currentSessionState === 'idle';
	$: isLive = currentSessionState === 'automated_debate' || currentSessionState === 'user_interaction';
	$: canSendMessage = isConnected && isLive;
	$: turns = messages.filter((m) => personaByName[m.speaker]).length;
	$: noAiMessagesYet = turns === 0;
	// Keyed on topic, not messages: the server sends a welcome System message on connect.
	$: inSetup = currentSessionState === 'idle' && !topic;
</script>

<svelte:head>
	<title>Multi-Agent AI Debate Chamber</title>
	<meta
		name="description"
		content="A real-time multi-agent debate platform: AI agents with distinct reasoning styles argue a question live, with human interjection and a moderated verdict."
	/>
</svelte:head>

<div class="app" class:locked={!inSetup}>
	<header class="topbar">
		<div class="brand">
			<span class="logo"><Icon name="messages" size={16} /></span>
			<span class="brand-name">Debate Chamber</span>
		</div>
		<div class="topbar-right">
			<span class="status {statusKind}"><span class="dot"></span>{statusText}</span>
			<a class="ghost-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">
				<svg viewBox="0 0 24 24" aria-hidden="true" class="gh"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" /></svg>
				<span class="source-label">Source</span>
			</a>
		</div>
	</header>

	{#if showError}
		<div class="notice" role="alert">{showError}</div>
	{/if}

	{#if inSetup}
		<div class="backdrop" aria-hidden="true"></div>
		<main class="landing">
			<section class="hero">
				<p class="eyebrow reveal" style="--i:0"><span class="eyebrow-dot"></span>Multi-agent LLM orchestration</p>
				<h1 class="reveal" style="--i:1">Multi-Agent AI<br />Debate Chamber</h1>
				<p class="lede reveal" style="--i:2">
					Ask a hard question and a panel of AI agents, each reasoning from a different school of thought, argues
					it out in real time. Step in whenever you like, cross-examine a single agent, and finish with a neutral
					moderator's structured verdict.
				</p>
				<ul class="highlights reveal" style="--i:3">
					{#each highlights as h}
						<li>
							<span class="hl-icon"><Icon name={h.icon} size={15} /></span>
							<span><strong>{h.title}</strong><span class="muted">{h.text}</span></span>
						</li>
					{/each}
				</ul>
			</section>

			<section class="card setup beam reveal" style="--i:2" aria-labelledby="setup-title">
				<h2 id="setup-title" class="card-title">New debate</h2>

				<label class="field-label" for="topic">Question</label>
				<textarea
					id="topic"
					bind:value={debateTopicInput}
					on:keydown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && handleStartDebate()}
					placeholder="e.g. Should we fear death?"
					rows="3"
				></textarea>
				<div class="suggestions">
					{#each exampleQuestions as q}
						<button type="button" class="chip" on:click={() => (debateTopicInput = q)}>{q}</button>
					{/each}
				</div>

				<div class="field-row">
					<span class="field-label">Panel</span>
					<span class="muted small">{selectedPersonaIds.length} selected</span>
				</div>
				<div class="agent-grid">
					{#each availablePersonas as p (p.id)}
						<label class="agent-option" class:selected={selectedPersonaIds.includes(p.id)} on:mousemove={spotlight}>
							<input type="checkbox" bind:group={selectedPersonaIds} value={p.id} />
							<span class="avatar" style="--c:{p.color}">{p.mono}</span>
							<span class="agent-text">
								<span class="agent-name">{p.name} <span class="muted">({p.title})</span></span>
								<span class="agent-school">{p.tradition}</span>
							</span>
							<span class="check"><Icon name="check" size={14} /></span>
						</label>
					{/each}
				</div>

				<button class="btn primary block shine" on:click={handleStartDebate} disabled={!canStartDebate}>
					Start debate
					<Icon name="arrow-right" size={15} />
				</button>
				<p class="muted small center">
					{#if isConnected}
						Two opening rounds, then the floor opens to you<span class="kbd-hint"> · <kbd>Ctrl</kbd> <kbd>Enter</kbd></span>
					{:else}
						Connecting to the server…
					{/if}
				</p>
			</section>
		</main>

		<section class="section">
			<p class="eyebrow">How it works</p>
			<ol class="steps-grid">
				{#each steps as s, i}
					<li class="step-card" on:mousemove={spotlight}>
						<span class="step-num">0{i + 1}</span>
						<strong>{s.title}</strong>
						<span class="muted">{s.text}</span>
					</li>
				{/each}
			</ol>
		</section>

		<section class="section">
			<p class="eyebrow">Architecture</p>
			<div class="arch" role="img" aria-label="Browser connects over WebSocket to a Hono orchestrator, which routes each agent to Mistral or Gemini">
				<div class="node">
					<span class="node-k">Client</span>
					<span>SvelteKit UI</span>
				</div>
				<div class="edge"><span class="edge-label">WebSocket · JSON</span><span class="pulse"></span></div>
				<div class="node strong">
					<span class="node-k">Orchestrator</span>
					<span>Hono · turn state machine</span>
				</div>
				<div class="edge"><span class="edge-label">per-agent routing</span><span class="pulse"></span></div>
				<div class="node-stack">
					<div class="node"><span class="node-k">Model</span><span>Mistral</span></div>
					<div class="node"><span class="node-k">Model</span><span>Gemini</span></div>
				</div>
			</div>
			<ul class="stack">
				{#each stack as t}<li>{t}</li>{/each}
			</ul>
		</section>

		<footer class="footer">
			<span>Multi-Agent AI Debate Chamber</span>
			<a href={REPO_URL} target="_blank" rel="noopener noreferrer">View source on GitHub</a>
		</footer>
	{:else}
		<main class="session">
			<aside class="sidebar">
				<div class="side-block">
					<p class="side-label">Question</p>
					<p class="topic">{topic || 'Untitled debate'}</p>
				</div>

				<div class="side-block">
					<p class="side-label">Progress</p>
					<ol class="steps">
						{#each phases as phase, i}
							<li class:done={i < phaseIndex} class:current={i === phaseIndex}>
								<span class="step-dot"></span>{phase}
							</li>
						{/each}
					</ol>
					<dl class="stats">
						<div><dt>Turns</dt><dd>{turns}</dd></div>
						<div><dt>Agents</dt><dd>{panel.length}</dd></div>
					</dl>
				</div>

				<div class="side-block">
					<p class="side-label">Panel</p>
					<ul class="panel-list">
						{#each panel as p (p.id)}
							<li class:is-speaking={thinkingSpeakers.has(p.name)}>
								<span class="avatar sm" style="--c:{p.color}">{p.mono}</span>
								<span class="agent-text">
									<span class="agent-name">{p.name} <span class="muted">({p.title})</span></span>
									<span class="agent-school">{p.tradition}</span>
								</span>
								{#if thinkingSpeakers.has(p.name)}<span class="speaking">Speaking</span>{/if}
							</li>
						{/each}
					</ul>
				</div>

				<div class="side-actions">
					{#if isLive}
						<button class="btn secondary" on:click={handleAdvance} disabled={!isConnected}>
							{#if currentSessionState === 'automated_debate'}
								<Icon name="skip-forward" size={14} /> Skip to open floor
							{:else}
								<Icon name="gavel" size={14} /> End & get verdict
							{/if}
						</button>
						<button class="btn ghost" on:click={handleRegenerate} disabled={!isConnected || noAiMessagesYet}>
							<Icon name="rotate-ccw" size={14} /> Regenerate last turn
						</button>
						<button class="btn ghost danger" on:click={handleStopOrReset} disabled={!isConnected}>
							<Icon name="square" size={14} /> Stop debate
						</button>
					{:else if currentSessionState === 'idle'}
						<button class="btn primary" on:click={handleNewDebate} disabled={!isConnected}>
							<Icon name="plus" size={14} /> New debate
						</button>
					{/if}
				</div>
			</aside>

			<section class="transcript-wrap">
				<div class="transcript" bind:this={chatContainer} aria-live="polite">
					{#each messages as m (m.id)}
						{#if m.speaker === 'System'}
							<p class="sys" in:fly={{ y: 6, duration: motion }}>{m.content}</p>
						{:else if m.speaker === 'Verdict'}
							<article class="verdict" in:fly={{ y: 10, duration: motion * 2 }}>
								<header>
									<span class="verdict-title"><Icon name="gavel" size={15} /> Moderator's verdict</span>
									<span class="muted small">{formatTimestamp(m.timestamp)}</span>
								</header>
								<div class="prose">{@html parseMarkdown(m.content)}</div>
							</article>
						{:else}
							{@const p = personaByName[m.speaker]}
							<article class="msg" class:from-user={m.speaker === 'User'} in:fly={{ y: 8, duration: motion }}>
								<span class="avatar" style="--c:{p?.color ?? '#e4e4e7'}">{p?.mono ?? 'YOU'}</span>
								<div class="msg-body">
									<header>
										<span class="msg-name">{p ? p.name : 'You'}</span>
										{#if p}<span class="muted small">{p.title} · {p.tradition}</span>{/if}
										{#if m.isRegenerated}<span class="tag">Regenerated</span>{/if}
										<time class="muted small">{formatTimestamp(m.timestamp)}</time>
									</header>
									<div class="prose">{@html parseMarkdown(m.content)}</div>
								</div>
							</article>
						{/if}
					{/each}

					{#each Array.from(thinkingSpeakers) as s (s)}
						{@const p = thinkingPersona(s)}
						<article class="msg pending" in:fly={{ y: 8, duration: motion }}>
							<span class="avatar" style="--c:{p.color}">{p.mono}</span>
							<div class="msg-body">
								<header>
									<span class="msg-name">{p.name}</span>
									<span class="muted small">{s === 'System' ? 'drafting the verdict' : 'is thinking'}</span>
								</header>
								<div class="skeleton"><span></span><span></span></div>
							</div>
						</article>
					{/each}
				</div>

				{#if isLive}
					<form class="composer" on:submit|preventDefault={handleSendMessage}>
						<textarea
							bind:value={userInput}
							on:keydown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
							placeholder={currentSessionState === 'user_interaction'
								? `Ask the panel, or address one agent with @${panel[0]?.name ?? 'Zeno'}: …`
								: 'Interject — the next speaker will respond to you'}
							rows="2"
							disabled={!canSendMessage}
							aria-label="Message"
						></textarea>
						<button class="btn primary icon" type="submit" disabled={!userInput.trim() || !canSendMessage} aria-label="Send">
							<Icon name="send" size={15} />
						</button>
					</form>
					<p class="composer-hint muted small">
						<span class="kbd-hint"><kbd>Enter</kbd> to send · <kbd>Shift</kbd> <kbd>Enter</kbd> for a new line ·&nbsp;</span>{#if currentSessionState === 'user_interaction'}Type <code>/end</code> for the verdict{:else}Your interjection goes to the next speaker{/if}
					</p>
				{/if}
			</section>
		</main>
	{/if}
</div>

<style>
	:global(html, body) {
		margin: 0;
		background: #09090b;
	}
	@property --angle {
		syntax: '<angle>';
		initial-value: 0deg;
		inherits: false;
	}
	.app {
		--bg: #09090b;
		--surface: #111113;
		--surface-2: #18181b;
		--border: #27272a;
		--border-strong: #3f3f46;
		--text: #fafafa;
		--text-2: #a1a1aa;
		--text-3: #71717a;
		--accent: #fafafa;
		--live: #22c55e;
		--warn: #f59e0b;
		--danger: #f87171;
		--ease: cubic-bezier(0.2, 0.7, 0.2, 1);
		position: relative;
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--text);
		font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
		font-size: 14px;
		line-height: 1.55;
		-webkit-font-smoothing: antialiased;
	}
	.app :global(*) { scrollbar-width: thin; scrollbar-color: #3f3f46 transparent; }
	.muted { color: var(--text-2); }
	.small { font-size: 12px; }
	.center { text-align: center; }
	kbd {
		font-family: inherit;
		font-size: 11px;
		padding: 1px 5px;
		border: 1px solid var(--border-strong);
		border-bottom-width: 2px;
		border-radius: 4px;
		color: var(--text-2);
		background: var(--surface-2);
	}
	code { font-size: 12px; color: var(--text); }

	/* Top bar */
	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 56px;
		padding: 0 24px;
		border-bottom: 1px solid var(--border);
		position: sticky;
		top: 0;
		background: rgba(9, 9, 11, 0.75);
		backdrop-filter: blur(10px);
		z-index: 10;
	}
	.brand { display: flex; align-items: center; gap: 10px; }
	.logo {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		background: linear-gradient(180deg, #27272a, #18181b);
		border: 1px solid var(--border-strong);
	}
	.brand-name { font-weight: 600; letter-spacing: -0.01em; }
	.topbar-right { display: flex; align-items: center; gap: 16px; }
	.status {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--text-2);
		padding: 4px 10px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
	}
	.status .dot { position: relative; width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); }
	.status.ready .dot, .status.live .dot { background: var(--live); }
	.status.live .dot::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: var(--live);
		animation: ping 1.4s var(--ease) infinite;
	}
	.status.off .dot { background: var(--warn); }
	.ghost-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-2);
		text-decoration: none;
		font-size: 13px;
		transition: color 0.15s;
	}
	.ghost-link:hover { color: var(--text); }
	.gh { width: 16px; height: 16px; fill: currentColor; }

	.notice {
		position: relative;
		z-index: 2;
		margin: 16px auto 0;
		max-width: 1080px;
		width: calc(100% - 48px);
		box-sizing: border-box;
		padding: 10px 14px;
		border: 1px solid #7f1d1d;
		background: #1c0a0a;
		color: #fecaca;
		border-radius: 8px;
		font-size: 13px;
	}

	/* Landing backdrop: dot grid + soft top spotlight */
	.backdrop {
		position: absolute;
		inset: 0 0 auto 0;
		height: 900px;
		pointer-events: none;
		background:
			radial-gradient(600px 320px at 30% 0%, rgba(129, 140, 248, 0.1), transparent 70%),
			radial-gradient(circle, rgba(255, 255, 255, 0.07) 1px, transparent 1px) 0 0 / 22px 22px;
		mask-image: radial-gradient(ellipse 80% 70% at 50% 0%, #000 30%, transparent 100%);
		-webkit-mask-image: radial-gradient(ellipse 80% 70% at 50% 0%, #000 30%, transparent 100%);
	}

	.reveal { animation: rise 0.7s var(--ease) both; animation-delay: calc(var(--i, 0) * 90ms); }

	/* Landing */
	.landing, .section {
		position: relative;
		width: 100%;
		max-width: 1080px;
		margin: 0 auto;
		padding: 72px 24px;
		box-sizing: border-box;
	}
	.landing {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 480px;
		gap: 56px;
		align-items: start;
	}
	.eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 18px;
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3);
	}
	.eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: #818cf8; box-shadow: 0 0 10px #818cf8; }
	h1 {
		margin: 0;
		font-size: clamp(36px, 4.6vw, 54px);
		line-height: 1.04;
		letter-spacing: -0.04em;
		font-weight: 600;
		background: linear-gradient(180deg, #fafafa 30%, #a1a1aa);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	.lede {
		margin: 22px 0 0;
		max-width: 520px;
		font-size: 16px;
		line-height: 1.7;
		color: var(--text-2);
	}
	.highlights { list-style: none; margin: 40px 0 0; padding: 0; display: flex; flex-direction: column; gap: 18px; }
	.highlights li { display: flex; gap: 14px; font-size: 13px; }
	.highlights li > span:last-child { display: flex; flex-direction: column; }
	.highlights strong { font-weight: 500; }
	.hl-icon {
		flex-shrink: 0;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-2);
	}

	.card {
		position: relative;
		background: rgba(17, 17, 19, 0.85);
		backdrop-filter: blur(6px);
		border: 1px solid var(--border);
		border-radius: 14px;
		padding: 24px;
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 24px 60px -20px rgba(0, 0, 0, 0.6);
	}
	/* Border beam: a light that travels around the card edge */
	.beam::before {
		content: '';
		position: absolute;
		inset: -1px;
		border-radius: inherit;
		padding: 1px;
		background: conic-gradient(from var(--angle), transparent 0deg 300deg, rgba(165, 180, 252, 0.9) 340deg, transparent 360deg);
		-webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
		-webkit-mask-composite: xor;
		mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
		mask-composite: exclude;
		animation: spin 7s linear infinite;
		pointer-events: none;
	}
	.card-title { margin: 0 0 20px; font-size: 15px; font-weight: 600; }
	.field-label { display: block; font-size: 12px; font-weight: 500; color: var(--text-2); margin-bottom: 8px; }
	.field-row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 24px; }

	textarea {
		width: 100%;
		box-sizing: border-box;
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 10px 12px;
		font: inherit;
		resize: vertical;
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	textarea::placeholder { color: var(--text-3); }
	textarea:focus { outline: none; border-color: var(--border-strong); box-shadow: 0 0 0 3px rgba(165, 180, 252, 0.12); }

	.suggestions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
	.chip {
		font: inherit;
		font-size: 12px;
		color: var(--text-2);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 3px 8px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.chip:hover { color: var(--text); border-color: var(--border-strong); background: var(--surface-2); }

	.agent-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 20px; }
	.agent-option, .step-card { position: relative; overflow: hidden; }
	.agent-option {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s, transform 0.15s var(--ease);
	}
	/* Cursor spotlight */
	.agent-option::after, .step-card::after {
		content: '';
		position: absolute;
		inset: 0;
		background: radial-gradient(180px circle at var(--mx, 50%) var(--my, 50%), rgba(255, 255, 255, 0.07), transparent 65%);
		opacity: 0;
		transition: opacity 0.2s;
		pointer-events: none;
	}
	.agent-option:hover::after, .step-card:hover::after { opacity: 1; }
	.agent-option:hover { border-color: var(--border-strong); }
	.agent-option:active { transform: scale(0.985); }
	.agent-option.selected { border-color: var(--border-strong); background: var(--surface-2); }
	.agent-option input { position: absolute; opacity: 0; pointer-events: none; }
	.agent-option:has(input:focus-visible) { outline: 2px solid var(--text-2); outline-offset: 2px; }
	.check { margin-left: auto; color: var(--text); opacity: 0; transform: scale(0.6); transition: opacity 0.15s, transform 0.2s var(--ease); }
	.agent-option.selected .check { opacity: 1; transform: none; }

	.avatar {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		display: grid;
		place-items: center;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--c);
		background: color-mix(in srgb, var(--c) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--c) 28%, transparent);
	}
	.avatar.sm { width: 28px; height: 28px; font-size: 10px; }
	.agent-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
	.agent-name { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
	.agent-name .muted { font-weight: 400; }
	.agent-school { font-size: 12px; color: var(--text-3); }

	/* Buttons */
	.btn {
		position: relative;
		overflow: hidden;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: 36px;
		padding: 0 14px;
		border-radius: 8px;
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		border: 1px solid transparent;
		transition: background 0.15s, border-color 0.15s, opacity 0.15s, transform 0.1s;
	}
	.btn:active:not(:disabled) { transform: translateY(1px); }
	.btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.btn:focus-visible { outline: 2px solid var(--text-2); outline-offset: 2px; }
	.btn.primary { background: var(--accent); color: #09090b; }
	.btn.primary:hover:not(:disabled) { background: #e4e4e7; }
	.btn.secondary { background: var(--surface-2); border-color: var(--border); color: var(--text); }
	.btn.secondary:hover:not(:disabled) { border-color: var(--border-strong); }
	.btn.ghost { background: transparent; color: var(--text-2); }
	.btn.ghost:hover:not(:disabled) { color: var(--text); background: var(--surface-2); }
	.btn.danger:hover:not(:disabled) { color: var(--danger); }
	.btn.block { width: 100%; height: 42px; margin-bottom: 12px; }
	.btn.icon { width: 40px; height: 40px; padding: 0; }
	/* Shine sweep on hover */
	.shine::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(110deg, transparent 35%, rgba(255, 255, 255, 0.55) 50%, transparent 65%);
		transform: translateX(-100%);
		pointer-events: none;
	}
	.shine:hover:not(:disabled)::after { transform: translateX(100%); transition: transform 0.7s var(--ease); }

	/* Sections below the fold */
	.section { padding-top: 24px; padding-bottom: 48px; }
	.steps-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
	}
	.step-card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 20px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		font-size: 13px;
		transition: border-color 0.2s;
	}
	.step-card:hover { border-color: var(--border-strong); }
	.step-card strong { font-size: 14px; font-weight: 500; }
	.step-num { font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; margin-bottom: 8px; }

	.arch {
		display: flex;
		align-items: center;
		padding: 28px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
	}
	.node {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 14px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg);
		font-size: 13px;
		white-space: nowrap;
	}
	.node.strong { border-color: rgba(165, 180, 252, 0.45); box-shadow: 0 0 24px -8px rgba(165, 180, 252, 0.5); }
	.node-k { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-3); }
	.node-stack { display: flex; flex-direction: column; gap: 8px; }
	.edge {
		position: relative;
		flex: 1;
		min-width: 60px;
		height: 1px;
		margin: 0 8px;
		background: linear-gradient(90deg, var(--border-strong), var(--border));
	}
	.edge-label {
		position: absolute;
		left: 50%;
		bottom: 8px;
		transform: translateX(-50%);
		font-size: 11px;
		color: var(--text-3);
		white-space: nowrap;
	}
	/* Packet travelling along each connection */
	.pulse {
		position: absolute;
		top: -2px;
		left: 0;
		width: 28px;
		height: 5px;
		border-radius: 999px;
		background: linear-gradient(90deg, transparent, #a5b4fc);
		animation: travel 2.4s linear infinite;
	}
	.stack { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
	.stack li {
		font-size: 12px;
		color: var(--text-2);
		padding: 4px 10px;
		border: 1px solid var(--border);
		border-radius: 999px;
	}

	.footer {
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
		max-width: 1032px;
		width: calc(100% - 48px);
		margin: 24px auto 0;
		padding: 24px 0;
		box-sizing: border-box;
		border-top: 1px solid var(--border);
		font-size: 12px;
		color: var(--text-3);
	}
	.footer a { color: var(--text-2); text-decoration: none; }
	.footer a:hover { color: var(--text); }

	/* Session */
	.session {
		flex: 1;
		display: grid;
		grid-template-columns: 280px minmax(0, 1fr);
		grid-template-rows: minmax(0, 1fr);
		min-height: 0;
	}
	/* Debate view: fixed to the viewport so the transcript scrolls, not the page. */
	.app.locked { height: 100vh; height: 100dvh; }
	.sidebar {
		border-right: 1px solid var(--border);
		padding: 24px 20px;
		display: flex;
		flex-direction: column;
		gap: 28px;
		overflow-y: auto;
		background: linear-gradient(180deg, #0c0c0e, var(--bg));
	}
	.side-label {
		margin: 0 0 10px;
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3);
	}
	.topic { margin: 0; font-size: 15px; font-weight: 500; line-height: 1.45; }
	.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
	.steps li { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-3); }
	.step-dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--border-strong); }
	.steps li.done { color: var(--text-2); }
	.steps li.done .step-dot { background: var(--text-2); border-color: var(--text-2); }
	.steps li.current { color: var(--text); font-weight: 500; }
	.steps li.current .step-dot { background: var(--live); border-color: var(--live); box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18); }
	.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 16px 0 0; }
	.stats div { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
	.stats dt { font-size: 11px; color: var(--text-3); }
	.stats dd { margin: 2px 0 0; font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
	.panel-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.panel-list li { display: flex; align-items: center; gap: 10px; padding: 6px 8px; margin: 0 -8px; border-radius: 8px; transition: background 0.2s; }
	.panel-list li.is-speaking { background: var(--surface-2); }
	.speaking { margin-left: auto; font-size: 11px; color: var(--live); animation: fade 1.6s infinite; }
	.side-actions { margin-top: auto; display: flex; flex-direction: column; gap: 6px; }
	.side-actions .btn { width: 100%; justify-content: flex-start; }
	.side-actions .btn.primary, .side-actions .btn.secondary { justify-content: center; }

	.transcript-wrap { display: flex; flex-direction: column; min-height: 0; }
	.transcript {
		flex: 1;
		overflow-y: auto;
		padding: 32px max(24px, calc((100% - 760px) / 2));
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.msg { display: flex; gap: 14px; padding: 14px 0; }
	.msg + .msg { border-top: 1px solid var(--border); }
	.msg-body { min-width: 0; flex: 1; }
	.msg-body header { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
	.msg-name { font-weight: 600; font-size: 13px; }
	.msg-body time { margin-left: auto; color: var(--text-3); }
	.msg.from-user .avatar { font-size: 9px; }
	.msg.from-user .msg-body .prose { color: var(--text); }
	.tag { font-size: 11px; padding: 0 6px; border-radius: 4px; border: 1px solid var(--border-strong); color: var(--text-2); }
	.sys { margin: 10px 0; text-align: center; font-size: 12px; color: var(--text-3); }

	.prose { color: #d4d4d8; font-size: 14px; line-height: 1.7; overflow-wrap: anywhere; }
	.prose :global(p) { margin: 0 0 10px; }
	.prose :global(p:last-child) { margin-bottom: 0; }
	.prose :global(ul), .prose :global(ol) { margin: 0 0 10px; padding-left: 20px; }
	.prose :global(strong) { color: var(--text); font-weight: 600; }
	.prose :global(code) { font-size: 12.5px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
	.prose :global(h1), .prose :global(h2), .prose :global(h3) { margin: 20px 0 8px; font-size: 14px; font-weight: 600; color: var(--text); }

	.verdict {
		position: relative;
		margin: 20px 0 8px;
		padding: 24px 28px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		overflow: hidden;
	}
	.verdict::before {
		content: '';
		position: absolute;
		inset: 0 0 auto 0;
		height: 1px;
		background: linear-gradient(90deg, transparent, #a5b4fc, transparent);
	}
	.verdict header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding-bottom: 12px;
		margin-bottom: 4px;
		border-bottom: 1px solid var(--border);
	}
	.verdict-title { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }

	/* Shimmering skeleton while an agent is thinking */
	.skeleton { display: flex; flex-direction: column; gap: 8px; padding: 6px 0; }
	.skeleton span {
		height: 10px;
		border-radius: 4px;
		background: linear-gradient(90deg, var(--surface-2) 25%, #27272a 50%, var(--surface-2) 75%) 0 0 / 200% 100%;
		animation: shimmer 1.4s linear infinite;
	}
	.skeleton span:first-child { width: 85%; }
	.skeleton span:last-child { width: 55%; }

	.composer {
		display: flex;
		gap: 8px;
		align-items: flex-end;
		margin: 0 max(24px, calc((100% - 760px) / 2));
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}
	.composer textarea { resize: none; min-height: 40px; }
	.composer-hint { margin: 8px max(24px, calc((100% - 760px) / 2)) 16px; color: var(--text-3); }

	@keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
	@keyframes spin { to { --angle: 360deg; } }
	@keyframes ping { 75%, 100% { transform: scale(2.6); opacity: 0; } }
	@keyframes fade { 50% { opacity: 0.45; } }
	@keyframes shimmer { to { background-position: -200% 0; } }
	@keyframes travel { from { left: 0; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } to { left: calc(100% - 28px); opacity: 0; } }

	@media (prefers-reduced-motion: reduce) {
		.reveal, .beam::before, .status.live .dot::after, .speaking, .skeleton span, .pulse { animation: none; }
		.shine::after { display: none; }
	}

	@media (max-width: 900px) {
		.landing { grid-template-columns: minmax(0, 1fr); gap: 40px; padding: 40px 16px; }
		.section { padding: 16px 16px 40px; }
		.steps-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.arch { flex-direction: column; align-items: stretch; padding: 20px; }
		.node { white-space: normal; }
		.node-stack { flex-direction: row; }
		.node-stack .node { flex: 1; }
		.edge { width: 1px; height: 48px; min-width: 0; flex: none; margin: 4px auto; background: var(--border-strong); }
		.edge-label { left: 12px; bottom: auto; top: 50%; transform: translateY(-50%); }
		.pulse { display: none; }
		.app.locked { height: auto; }
		.session { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto; }
		.sidebar { border-right: none; border-bottom: 1px solid var(--border); padding: 20px 16px; gap: 20px; }
		.transcript { padding: 20px 16px; min-height: 50vh; }
		.composer { margin: 0 16px; }
		.composer-hint { margin: 8px 16px 16px; }
		.topbar { padding: 0 16px; }
		.notice { width: calc(100% - 32px); }
		.footer { width: calc(100% - 32px); padding: 20px 0; }
	}
	/* Keyboard hints are noise on touch devices */
	@media (hover: none) {
		.kbd-hint { display: none; }
	}
	@media (max-width: 480px) {
		.agent-grid, .steps-grid { grid-template-columns: minmax(0, 1fr); }
		.source-label { display: none; }
		.topbar-right { gap: 10px; }
	}
</style>
