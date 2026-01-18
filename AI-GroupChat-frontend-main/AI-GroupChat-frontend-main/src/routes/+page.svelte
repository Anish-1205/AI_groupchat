<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { marked } from 'marked';      // For Markdown parsing
	import DOMPurify from 'dompurify'; // For HTML sanitization (security)

	interface ChatMessageFromServer {
		id: string;
		speaker: string;
		content: string;
		timestamp: string;
		isThinking?: boolean;
		isRegenerated?: boolean;
	}

	// --- State ---
	let messages: ChatMessageFromServer[] = [];
	let ws: WebSocket | null = null;
	let userInput: string = '';
	let debateTopicInput: string = '';
	let isConnected: boolean = false;
	let currentSessionState: 'idle' | 'automated_debate' | 'user_interaction' | 'summarizing' = 'idle';
	let showError: string | null = null;
	let chatContainer: HTMLElement;
	let thinkingSpeakers = new Set<string>();
		function parseMarkdown(markdownText: string): string {
    if (!markdownText) {
        return ''; // Return empty string if input is null, undefined, or empty
    }
    try {
        // 1. Parse Markdown to raw HTML
        const rawHtml = marked.parse(markdownText) as string;

        // 2. Sanitize the raw HTML to prevent XSS attacks
        // Ensure DOMPurify runs only in the browser environment
        if (typeof window !== 'undefined') {
            return DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
        }
        // Fallback for non-browser environments (e.g., SSR without JSDOM).
        // This is less secure for SSR if the content is directly rendered without further server-side sanitization.
        // For client-side rendering, the `typeof window` check is sufficient.
        return rawHtml;
    } catch (e) {
        console.error("Error parsing markdown:", e);
        // Fallback on error: escape basic HTML characters and replace newlines with <br>
        const escapedText = String(markdownText) // Ensure it's a string
            .replace(/&/g, "&")
            .replace(/</g, "<")
            .replace(/>/g, ">")
            .replace(/"/g, "\"")
            .replace(/'/g, "'");
        return escapedText.replace(/\n/g, '<br>');
    }
}
	const availablePersonas = [
		{ id: 'nilm_expert', name: 'NILM Expert (Mistral)', defaultChecked: true },
		{ id: 'data_scientist', name: 'Data Scientist (Gemini)', defaultChecked: true },
		{ id: 'moderator', name: 'Debate Moderator (Mistral)', defaultChecked: true }
	];
	let selectedPersonaIds: string[] = availablePersonas
		.filter((p) => p.defaultChecked)
		.map((p) => p.id);

	// --- WebSocket Logic ---
	onMount(() => {
		connectWebSocket();
		return () => {
			if (ws) ws.close();
		};
		marked.setOptions({
        gfm: true,          // Enable GitHub Flavored Markdown (tables, strikethrough, etc.)
        breaks: true,       // Convert single newlines in paragraphs into <br> tags
        pedantic: false,    // Don't be overly strict with Markdown syntax
        // No 'sanitize' or 'sanitizer' option here for modern 'marked' versions;
        // DOMPurify handles sanitization.
    });
	});

	function connectWebSocket() {
		ws = new WebSocket('ws://localhost:3001');

		ws.onopen = () => {
			isConnected = true;
			showError = null;
			// Don't reset state if it's already an active one from a previous connection attempt
			if (currentSessionState === 'summarizing' || currentSessionState === 'idle') {
                 // Or if trying to reconnect during an active phase, preserve it if possible
            } else if (currentSessionState !== 'user_interaction' && currentSessionState !== 'automated_debate'){
                currentSessionState = 'idle';
            }
			console.log('WebSocket connected');
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
						const lowerContent = message.content.toLowerCase();
						if (lowerContent.includes('debate started')) {
							currentSessionState = 'automated_debate';
						} else if (lowerContent.includes('automated debate phase complete')) {
							currentSessionState = 'user_interaction';
						} else if (lowerContent.includes('generating final summary')) {
							currentSessionState = 'summarizing';
						} else if (lowerContent.includes('debate concluded') || lowerContent.includes('session ended') || lowerContent.includes('session stopped')) {
							currentSessionState = 'idle';
							debateTopicInput = ''; // Clear topic for new debate
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
			// Don't immediately set to idle if it was an active state; user might be trying to resume
			// currentSessionState = 'idle';
			thinkingSpeakers.clear();
			console.log('WebSocket disconnected. Attempting to reconnect...');
			showError = 'Disconnected. Reconnecting...';
			setTimeout(connectWebSocket, 3000);
		};

		ws.onerror = (error) => {
			console.error('WebSocket error:', error);
			showError = 'WebSocket connection error.';
			// currentSessionState = 'idle';
		};
	}

	function sendMessageToWs(type: string, payload: any = {}) {
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type, payload }));
			showError = null;
		} else {
			showError = 'Not connected. Please wait or check connection.';
		}
	}

	async function handleStartDebate() {
		if (!debateTopicInput.trim()) {
			showError = 'Please enter a debate topic.';
			return;
		}
		if (selectedPersonaIds.length < 1) {
			showError = 'Please select at least one persona.';
			return;
		}
		messages = [];
		thinkingSpeakers.clear();
		// currentSessionState is set by server message "debate started"
		sendMessageToWs('start_debate', {
			topic: debateTopicInput,
			persona_ids: selectedPersonaIds
		});
	}

	async function handleSendMessage() {
		if (!userInput.trim()) return;
		// Allow sending only in these states
		if (currentSessionState !== 'automated_debate' && currentSessionState !== 'user_interaction') {
			showError = "Cannot send message when not in active debate or Q&A.";
			return;
		}

		const messageType = currentSessionState === 'user_interaction' ? 'user_query' : 'user_interjection';
		sendMessageToWs(messageType, { content: userInput });

		const userMsg: ChatMessageFromServer = {
			id: `local_${Date.now()}`,
			speaker: 'User',
			content: userInput,
			timestamp: new Date().toISOString()
		};
		messages = [...messages, userMsg];
		userInput = '';
		await tick();
		scrollToBottom();
	}

	function handleRegenerate() {
		if (currentSessionState !== 'automated_debate' && currentSessionState !== 'user_interaction') return;
		sendMessageToWs('regenerate_last_ai_turn');
	}

	function handleEarlyPauseOrSummarize() {
		if (currentSessionState === 'automated_debate') {
			sendMessageToWs('seek_convergence');
		} else if (currentSessionState === 'user_interaction') {
			sendMessageToWs('user_query', { content: '/end' });
			// Or: sendMessageToWs('user_command', { command: 'end_session' });
		}
	}

	function handleStopOrReset() {
		sendMessageToWs('stop_debate');
		// UI state like messages and currentSessionState will be updated by server messages or onclose
	}

	function scrollToBottom() {
		if (chatContainer) {
			setTimeout(() => {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }, 50);
		}
	}

	function getSpeakerClass(speaker: string) {
		if (speaker === 'User') return 'user';
		if (speaker === 'System') return 'system';
		if (speaker.toLowerCase().includes('mistral')) return 'mistral';
		if (speaker.toLowerCase().includes('gemini')) return 'gemini';
		if (speaker.toLowerCase().includes('moderator')) return 'moderator';
		return 'other-ai';
	}

	function formatTimestamp(isoTimestamp: string) {
		try {
			return new Date(isoTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		} catch (e) { return ''; }
	}

	$: statusText = isConnected ? 
		(currentSessionState === 'automated_debate' ? 'Debate Active' :
		(currentSessionState === 'user_interaction' ? 'Q&A Active' :
		(currentSessionState === 'summarizing' ? 'Summarizing...' : 'Idle')))
		: 'Connecting...';

	$: statusClass = isConnected ?
		(currentSessionState === 'automated_debate' || currentSessionState === 'user_interaction' ? 'active' :
		(currentSessionState === 'summarizing' ? 'busy' : 'idle'))
		: 'error';

	// Computed properties for disabling elements
	$: canStartDebate = isConnected && (currentSessionState === 'idle');
	$: canSendMessage = isConnected && (currentSessionState === 'automated_debate' || currentSessionState === 'user_interaction');
	$: canUseActionButtons = isConnected && (currentSessionState === 'automated_debate' || currentSessionState === 'user_interaction');
    $: noAiMessagesYet = messages.filter(m => m.speaker !== 'User' && m.speaker !== 'System').length === 0;

</script>

<div class="chat-modal-overlay">
	<div class="chat-modal-container">
		<header class="chat-modal-header">
			<h2>AI Debate Chamber</h2>
			<span class="status-indicator {statusClass}">{statusText}</span>
		</header>

		{#if showError}
			<div class="error-message" role="alert">{showError}</div>
		{/if}

		<!-- Show setup only if truly idle and no messages, or explicitly reset to this state -->
		{#if currentSessionState === 'idle' && messages.length === 0}
			<div class="debate-setup">
				<h3>Start a New Debate</h3>
				<textarea
					bind:value={debateTopicInput}
					placeholder="Enter the debate topic or problem statement..."
					rows="3"
					aria-label="Debate topic input"
				/>
				<div class="persona-selection">
					<h4>Select Participating Personas:</h4>
					{#each availablePersonas as persona (persona.id)}
						<label>
							<input type="checkbox" bind:group={selectedPersonaIds} value={persona.id} />
							{persona.name}
						</label>
					{/each}
				</div>
				<div class="setup-buttons">
					<button class="action-button start-button" on:click={handleStartDebate} disabled={!canStartDebate}>
						Start Debate
					</button>
				</div>
			</div>
		{/if}

		<!-- Prompt to start new debate if previous one ended -->
		{#if currentSessionState === 'idle' && messages.length > 0}
			<div class="debate-setup session-ended-prompt">
				<p>The previous session has ended.</p>
				<div class="setup-buttons">
					<button class="action-button start-button" on:click={() => { messages = []; debateTopicInput = ''; showError = null; }} disabled={!isConnected}>
						Start New Debate
					</button>
					 <button class="action-button stop-button" on:click={handleStopOrReset} title="Clear history">Clear History</button>
				</div>
			</div>
		{/if}

		<!-- Prompt for user during Q&A phase -->
		{#if currentSessionState === 'user_interaction'}
			<div class="system-prompt-for-user">
				Automated debate paused. Ask questions (e.g., "@NILM Expert: ...") or type <strong>/end</strong> to summarize.
			</div>
		{/if}


		<div class="chat-messages" bind:this={chatContainer} aria-live="polite">
			{#each messages as message (message.id)}
				<div class="message-wrapper {getSpeakerClass(message.speaker)}">
					<div class="message-bubble">
						{#if message.speaker !== 'System'}
							<div class="speaker-name">{message.speaker}</div>
						{/if}
						<div class="message-content">
							{#if message.isRegenerated}
								<span class="regenerated-tag">[Regenerated]</span>
							{/if}
            {@html parseMarkdown(message.content)}
						</div>
						{#if message.speaker !== 'System'}
							<div class="timestamp">{formatTimestamp(message.timestamp)}</div>
						{/if}
					</div>
				</div>
			{/each}
			{#each Array.from(thinkingSpeakers) as speakerName (speakerName)}
				 <div class="message-wrapper {getSpeakerClass(speakerName)}">
					<div class="message-bubble is-thinking">
						<div class="speaker-name">{speakerName}</div>
						<div class="message-content">
							<div class="typing-indicator">
								<span></span><span></span><span></span>
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Input Area: Show if in automated debate OR user interaction phase -->
		{#if currentSessionState === 'automated_debate' || currentSessionState === 'user_interaction'}
			<div class="chat-input-area">
				<textarea
					bind:value={userInput}
					on:keydown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
					placeholder={currentSessionState === 'user_interaction' ? "Ask a question (e.g. @NILM Expert: ...) or type /end" : "Type your interjection..."}
					rows="2"
					disabled={!canSendMessage}
					aria-label="User input message"
				/>
				<button 
					class="send-button" 
					on:click={handleSendMessage} 
					disabled={!userInput.trim() || !canSendMessage}>
					Send
				</button>
			</div>
		{/if}
		
		<!-- Action Buttons Panel: Show if in automated debate OR user interaction phase -->
		{#if currentSessionState === 'automated_debate' || currentSessionState === 'user_interaction'}
			<div class="action-buttons-panel">
				<button 
					class="action-button" 
					on:click={handleRegenerate} 
					disabled={!canUseActionButtons || noAiMessagesYet }>
					Regenerate Last AI
				</button>
				
				{#if currentSessionState === 'automated_debate'}
					<button 
						class="action-button" 
						on:click={handleEarlyPauseOrSummarize} 
						disabled={!canUseActionButtons}>
						Pause & Go to Q&A
					</button>
					<button 
						class="action-button stop-button" 
						on:click={handleStopOrReset} 
						disabled={!canUseActionButtons}>
						Stop & Reset
					</button>
				{:else if currentSessionState === 'user_interaction'}
					<button 
						class="action-button stop-button" 
						on:click={handleEarlyPauseOrSummarize} 
						disabled={!canUseActionButtons}>
						End & Summarize
					</button>
				{/if}
			</div>
		{/if}

	</div>
</div>

<!-- STYLES (Keep your existing improved styles here) -->
<style>
	:root {
		/* Tokyo Night Theme Colors (keeping these as per your original) */
		--bg-color: #1a1b26;
		--fg-color: #c0caf5;
		--panel-bg: #24283b; /* Primary background for elements on main bg */
		--border-color: #414868;
		--comment-color: #565f89; /* Muted text, subtle borders */
		--input-bg: #1f2335; /* Slightly different for inputs/textareas */

		--red: #f7768e;
		--orange: #ff9e64;
		--yellow: #e0af68;
		--green: #9ece6a;
		--cyan: #7dcfff;
		--blue: #7aa2f7;
		--purple: #bb9af7;

		--user-bubble-bg: var(--blue);
		--user-bubble-text: #16161e; /* Ensure good contrast */
		--mistral-bubble-bg: var(--purple);
		--mistral-bubble-text: #16161e;
		--gemini-bubble-bg: var(--green);
		--gemini-bubble-text: #16161e;
        --moderator-bubble-bg: var(--orange);
		--moderator-bubble-text: #16161e;
		--system-bubble-bg: transparent; /* Make system messages less obtrusive */
        --system-bubble-text: var(--comment-color); /* Muted color for system text */
		--other-ai-bubble-bg: #2f354e; /* A different dark shade for generic AI */
        --other-ai-bubble-text: var(--fg-color);

		--font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji';
        --font-size-base: 14px;
        --font-size-small: 12px;
        --font-size-large: 16px;
	}

	.chat-modal-overlay {
		position: fixed;
		inset: 0;
		background-color: rgba(20, 21, 31, 0.7); /* Darker overlay, using a theme color */
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		font-family: var(--font-family);
		color: var(--fg-color);
        font-size: var(--font-size-base);
	}

	.chat-modal-container {
		background-color: var(--bg-color);
		border-radius: 12px; /* Softer radius */
		box-shadow: 0 15px 35px rgba(0, 0, 0, 0.5); /* Deeper shadow */
		width: 100%;
		max-width: 750px; /* Slightly wider */
		height: 90vh;
		max-height: 850px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--border-color);
	}

	.chat-modal-header {
		background-color: var(--panel-bg);
		padding: 16px 24px; /* More padding */
		border-bottom: 1px solid var(--border-color);
		display: flex;
		justify-content: space-between;
		align-items: center;
        flex-shrink: 0; /* Prevent header from shrinking */
	}

	.chat-modal-header h2 {
		margin: 0;
		font-size: 1.25em; /* Slightly adjusted */
		font-weight: 600;
		color: var(--fg-color);
	}

	.status-indicator {
		font-size: 0.85em;
		padding: 4px 10px;
		border-radius: 16px; /* Pill shape */
        font-weight: 500;
	}
	.status-indicator.error { background-color: var(--red); color: var(--bg-color); }
	.status-indicator.active { background-color: var(--green); color: var(--bg-color); }
	.status-indicator.idle { background-color: var(--comment-color); color: var(--fg-color); }
    .status-indicator.busy { background-color: var(--orange); color: var(--bg-color); }


	.error-message {
		background-color: var(--red);
		color: var(--bg-color);
		padding: 12px 20px;
		text-align: center;
		font-size: 0.9em;
        font-weight: 500;
        flex-shrink: 0;
	}

	.debate-setup {
		padding: 24px;
		border-bottom: 1px solid var(--border-color);
		background-color: var(--input-bg); /* Use distinct input bg */
        flex-shrink: 0;
	}
    .debate-setup.session-ended-prompt {
        text-align: center;
    }
    .debate-setup.session-ended-prompt p {
        margin-top: 0;
        margin-bottom: 16px;
        font-size: 1.05em;
    }
	.debate-setup h3 {
        margin-top: 0;
        margin-bottom: 16px;
        color: var(--purple);
        font-size: 1.1em;
        font-weight: 600;
    }
	.debate-setup textarea {
		width: 100%; /* Use 100% and let padding handle spacing */
		padding: 12px;
		margin-bottom: 16px;
		border-radius: 6px;
		border: 1px solid var(--border-color);
		background-color: var(--panel-bg);
		color: var(--fg-color);
		font-family: var(--font-family);
		font-size: var(--font-size-base);
		resize: vertical;
        box-sizing: border-box; /* Important for width: 100% */
	}
    .persona-selection {
        margin-bottom: 20px;
    }
    .persona-selection h4 {
        margin-top: 0;
        margin-bottom: 10px;
        font-size: 1em;
        font-weight: 500;
        color: var(--cyan);
    }
    .persona-selection label {
        display: flex; /* Align checkbox and text nicely */
        align-items: center;
        margin-bottom: 8px;
        font-size: 0.95em;
        cursor: pointer;
        padding: 6px 0;
    }
    .persona-selection input[type="checkbox"] {
        margin-right: 10px;
        accent-color: var(--purple);
        width: 16px;
        height: 16px;
        flex-shrink: 0;
    }
    .setup-buttons {
        display: flex;
        gap: 12px;
        margin-top: 8px;
        justify-content: center; /* Center buttons in setup */
    }


	.chat-messages {
		flex-grow: 1;
		overflow-y: auto;
		padding: 20px; /* More padding */
		display: flex;
		flex-direction: column;
		gap: 16px; /* More gap */
	}

	.message-wrapper {
		display: flex;
		max-width: 80%; /* Slightly less for more breathing room */
	}
	.message-wrapper.user {
		margin-left: auto;
		flex-direction: row-reverse;
	}
    .message-wrapper.system {
		align-self: center;
        max-width: 90%; /* System messages can be wider */
        width: 100%;
        text-align: center;
	}


	.message-bubble {
		padding: 10px 16px; /* Adjusted padding */
		border-radius: 18px; /* More rounded */
		font-size: 0.95em;
		line-height: 1.6;
		word-wrap: break-word;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1); /* Subtle shadow on bubbles */
	}
	.message-wrapper.user .message-bubble {
		background-color: var(--user-bubble-bg);
		color: var(--user-bubble-text);
		border-bottom-right-radius: 6px;
	}
    /* Common AI bubble styling */
    .message-wrapper:not(.user):not(.system) .message-bubble {
        border-bottom-left-radius: 6px;
    }
	.message-wrapper.mistral .message-bubble {
		background-color: var(--mistral-bubble-bg);
		color: var(--mistral-bubble-text);
	}
    .message-wrapper.gemini .message-bubble {
		background-color: var(--gemini-bubble-bg);
		color: var(--gemini-bubble-text);
	}
    .message-wrapper.moderator .message-bubble {
		background-color: var(--moderator-bubble-bg);
		color: var(--moderator-bubble-text);
	}
	.message-wrapper.system .message-bubble {
		background-color: var(--system-bubble-bg); /* Transparent */
        color: var(--system-bubble-text);
		border: 1px dashed var(--comment-color);
        padding: 8px 12px;
        font-size: var(--font-size-small);
        box-shadow: none;
	}
    .message-wrapper.other-ai .message-bubble {
		background-color: var(--other-ai-bubble-bg);
		color: var(--other-ai-bubble-text);
	}


	.speaker-name {
		font-weight: 600; /* Bolder */
		font-size: var(--font-size-small);
		margin-bottom: 5px;
		opacity: 0.85;
	}
    .message-wrapper.user .speaker-name { color: var(--user-bubble-text); opacity: 0.7;}
    .message-wrapper.mistral .speaker-name { color: var(--mistral-bubble-text); opacity: 0.7;}
    .message-wrapper.gemini .speaker-name { color: var(--gemini-bubble-text); opacity: 0.7;}
    .message-wrapper.moderator .speaker-name { color: var(--moderator-bubble-text); opacity: 0.7;}
    .message-wrapper.other-ai .speaker-name { color: var(--other-ai-bubble-text); opacity: 0.7;}

    /* System messages usually don't need explicit speaker name in bubble */
    /* .message-wrapper.system .speaker-name { display: none; } */


	.message-content {
		/* white-space: pre-wrap; // Using @html with <br> instead for Svelte */
	}
    .regenerated-tag {
        font-style: italic;
        font-size: 0.85em;
        opacity: 0.7;
        margin-right: 6px;
        color: var(--yellow); /* Use yellow for emphasis */
        display: inline-block; /* Allow margin */
    }

	.timestamp {
		font-size: 0.75em; /* Slightly larger */
		text-align: right;
		margin-top: 6px;
		opacity: 0.6;
	}
    .message-wrapper.user .timestamp { color: var(--user-bubble-text); opacity: 0.5;}
    .message-wrapper:not(.user):not(.system) .timestamp { color: var(--other-ai-bubble-text); opacity: 0.5;}
    /* .message-wrapper.system .timestamp { display: none; } */

    .system-prompt-for-user {
        padding: 10px 20px;
        background-color: var(--input-bg);
        color: var(--cyan);
        text-align: center;
        font-size: var(--font-size-small);
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
    }
    .system-prompt-for-user strong {
        color: var(--purple);
        font-weight: 600;
    }


	.chat-input-area {
		display: flex;
        align-items: flex-start; /* Align items to top if textarea grows */
		padding: 12px 20px;
		border-top: 1px solid var(--border-color);
		background-color: var(--panel-bg);
        gap: 10px;
        flex-shrink: 0;
	}
	.chat-input-area textarea {
		flex-grow: 1;
		padding: 12px;
		border-radius: 6px;
		border: 1px solid var(--border-color);
		background-color: var(--input-bg);
		color: var(--fg-color);
		resize: none;
		font-family: var(--font-family);
        font-size: var(--font-size-base);
		min-height: 48px; /* Based on padding and line height */
        box-sizing: border-box;
        line-height: 1.5;
	}
	.send-button, .action-button {
		padding: 0 18px; /* Horizontal padding */
        height: 48px; /* Match textarea initial height */
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-weight: 500; /* Medium weight */
        font-size: 0.95em;
		transition: background-color 0.2s, transform 0.1s;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
	}
    .send-button:active:not(:disabled), .action-button:active:not(:disabled) {
        transform: translateY(1px);
    }
	.send-button {
		background-color: var(--blue);
		color: var(--bg-color);
	}
	.send-button:hover:not(:disabled) { background-color: #9abafd; } /* Lighter blue */
	.send-button:disabled, .action-button:disabled {
		background-color: var(--comment-color);
		color: var(--fg-color) !important; /* Ensure text is visible on disabled */
		cursor: not-allowed;
		opacity: 0.6;
	}

    .action-buttons-panel {
        display: flex;
        flex-wrap: wrap; /* Allow buttons to wrap on smaller screens */
        gap: 10px;
        padding: 12px 20px;
		border-top: 1px solid var(--border-color);
		background-color: var(--panel-bg);
        flex-shrink: 0;
        justify-content: flex-start;
    }
    .action-button {
        background-color: var(--purple);
        color: var(--bg-color);
        height: 40px; /* Slightly smaller action buttons */
        padding: 0 16px;
    }
    .action-button:hover:not(:disabled) { background-color: #cbb6f9; }

	.action-button.start-button { background-color: var(--green); flex-grow: 1; /* Make start button prominent */ }
	.action-button.start-button:hover:not(:disabled) { background-color: #b1dea4; }
	.action-button.stop-button { background-color: var(--red); }
	.action-button.stop-button:hover:not(:disabled) { background-color: #f990a4; }


	.message-bubble.is-thinking .message-content {
		display: flex;
		align-items: center;
		height: auto; /* Let content define height */
        padding: 6px 0; /* Minimal padding for thinking */
	}
	.typing-indicator span {
		height: 7px; /* Smaller dots */
		width: 7px;
		background-color: currentColor;
		opacity: 0.7;
		border-radius: 50%;
		display: inline-block;
		margin: 0 1.5px;
		animation: bounce 1.3s infinite ease-in-out both;
	}
	.typing-indicator span:nth-child(1) { animation-delay: -0.30s; }
	.typing-indicator span:nth-child(2) { animation-delay: -0.15s; }
	@keyframes bounce {
		0%, 80%, 100% { opacity: 0; transform: scale(0.5); }
		40% { opacity: 1; transform: scale(1.0); }
	}

    /* Custom scrollbar for webkit browsers */
    .chat-messages::-webkit-scrollbar {
        width: 10px;
    }
    .chat-messages::-webkit-scrollbar-track {
        background: var(--bg-color); /* Match main background */
    }
    .chat-messages::-webkit-scrollbar-thumb {
        background-color: var(--comment-color);
        border-radius: 5px;
        border: 2px solid var(--bg-color); /* Creates padding around thumb */
    }
    .chat-messages::-webkit-scrollbar-thumb:hover {
        background-color: var(--border-color);
    }

</style>