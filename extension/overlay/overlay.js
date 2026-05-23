/**
 * PulseOverlay overlay component.
 * Creates and manages the heart rate overlay on web pages.
 */

class PulseOverlay {
  constructor() {
    this.container = null;
    this.shadowRoot = null;
    this.bpmElement = null;
    this.statusElement = null;
    this.heartElement = null;
    this.graphCanvas = null;
    this.graph = null;
    this.settings = null;
    this.currentBpm = null;
    this.connectionState = 'disconnected';
    // Alert state machine — not persisted across page loads
    this.alertState = 'idle'; // 'idle' | 'alert'
    this.alertCooldownRemaining = 0;
    this._alertShowsVisual = false; // locked in at enterAlert() time
    this._alertInterval = null;
    this.alertPanel = null;
    this.alertMessageElement = null;
    this.alertCountdownElement = null;
    // AI chat
    this._chatHistory = []; // [{role, content}]
    this._alertDisplayMessage = null; // overrides preset message when AI generates one
    this._chatDismissed = false; // true after user clicks X; reset on next alert
    this.chatAreaElement = null;
    this.chatInputElement = null;
    this.chatSendBtn = null;
    this.chatCloseBtn = null;
    // Store unsubscribe functions for cleanup
    this._unsubscribeState = null;
    this._unsubscribeHR = null;
    this._unsubscribeSettings = null;
    // Fullscreen handler bound to this instance
    this._handleFullscreenChange = this.handleFullscreenChange.bind(this);
  }

  /**
   * Initialize the overlay.
   */
  async init() {
    this.settings = await PulseState.getSettings();

    // Always listen for settings changes so we can show overlay when enabled
    this._unsubscribeSettings = PulseState.onSettingsChange(() => {
      this.handleSettingsChange();
    });

    if (!this.settings || !this.shouldShow()) {
      return;
    }

    this.createOverlay();
    this.setupListeners();

    // Get initial state
    const state = await PulseState.getState();
    this.connectionState = state.connectionState;
    if (state.currentBpm !== null) {
      this.currentBpm = state.currentBpm;
      // Seed graph with current BPM if in graph mode
      if (this.graph) {
        this.graph.addPoint(state.currentBpm, Date.now());
      }
    }
    this.updateDisplay();
  }

  /**
   * Check if overlay should be shown on this site.
   * Shows if: site explicitly enabled OR (globally enabled AND site not explicitly disabled)
   */
  shouldShow() {
    const hostname = window.location.hostname;
    const override = this.settings.siteOverrides[hostname];

    // Site explicitly enabled - always show
    if (override === true) {
      return true;
    }

    // Site explicitly disabled - never show
    if (override === false) {
      return false;
    }

    // No override - follow global setting
    return this.settings.enabled;
  }

  /**
   * Create the overlay DOM structure.
   */
  createOverlay() {
    // Create container with Shadow DOM for style isolation
    this.container = document.createElement('div');
    this.container.id = 'pulse-overlay-container';
    this.shadowRoot = this.container.attachShadow({ mode: 'open' });

    // Inject styles
    const styles = document.createElement('style');
    styles.textContent = this.getStyles();
    this.shadowRoot.appendChild(styles);

    // Create overlay element
    const overlay = document.createElement('div');
    overlay.className = `pulse-overlay ${this.settings.position} size-${this.settings.size}`;
    overlay.style.opacity = this.settings.opacity;

    // Inner row: status + heart + bpm (always horizontal)
    const bpmRow = document.createElement('div');
    bpmRow.className = 'bpm-row';

    // Status indicator
    this.statusElement = document.createElement('div');
    this.statusElement.className = 'status-indicator status-disconnected';
    bpmRow.appendChild(this.statusElement);

    // Heart icon (for standard mode)
    this.heartElement = document.createElement('div');
    this.heartElement.className = 'heart-icon';
    this.heartElement.innerHTML = this.getHeartSvg();
    if (this.settings.displayMode === 'minimal') {
      this.heartElement.style.display = 'none';
    }
    bpmRow.appendChild(this.heartElement);

    // BPM display
    this.bpmElement = document.createElement('div');
    this.bpmElement.className = 'bpm-display';
    this.bpmElement.innerHTML = '<span class="bpm-value">--</span><span class="bpm-label">BPM</span>';
    bpmRow.appendChild(this.bpmElement);

    // Alert message — hidden in idle, replaces BPM display in alert state, centered in available space
    this.alertMessageElement = document.createElement('div');
    this.alertMessageElement.className = 'alert-message';
    bpmRow.appendChild(this.alertMessageElement);

    // Close button — anchored to far right of bpmRow, hidden until alert+chat is visible
    this.chatCloseBtn = document.createElement('button');
    this.chatCloseBtn.className = 'chat-close-btn';
    this.chatCloseBtn.textContent = '×';
    this.chatCloseBtn.title = 'Close chat';
    bpmRow.appendChild(this.chatCloseBtn);

    overlay.appendChild(bpmRow);

    // Graph canvas (for graph mode)
    if (this.settings.displayMode === 'graph') {
      const graphContainer = document.createElement('div');
      graphContainer.className = 'graph-container';
      this.graphCanvas = document.createElement('canvas');
      this.graphCanvas.width = 120;
      this.graphCanvas.height = 40;
      graphContainer.appendChild(this.graphCanvas);
      overlay.appendChild(graphContainer);

      // Initialize graph
      this.graph = new PulseGraph(this.graphCanvas, this.settings.graphDuration, {
        minBpm: this.settings.graphMinBpm,
        maxBpm: this.settings.graphMaxBpm
      });
    }

    // Alert panel — always present, only visible in alert state
    this.alertPanel = document.createElement('div');
    this.alertPanel.className = 'alert-panel';

    this.alertCountdownElement = document.createElement('div');
    this.alertCountdownElement.className = 'alert-countdown';

    this.alertPanel.appendChild(this.alertCountdownElement);

    // AI chat area — only visible when alert active + visual + aiChatEnabled
    const chatSection = document.createElement('div');
    chatSection.className = 'chat-section';

    this.chatAreaElement = document.createElement('div');
    this.chatAreaElement.className = 'chat-area';

    const chatInputRow = document.createElement('div');
    chatInputRow.className = 'chat-input-row';

    this.chatInputElement = document.createElement('input');
    this.chatInputElement.type = 'text';
    this.chatInputElement.className = 'chat-input';
    this.chatInputElement.placeholder = 'Ask for help…';
    this.chatInputElement.maxLength = 200;

    this.chatSendBtn = document.createElement('button');
    this.chatSendBtn.className = 'chat-send-btn';
    this.chatSendBtn.textContent = 'Send';

    chatInputRow.appendChild(this.chatInputElement);
    chatInputRow.appendChild(this.chatSendBtn);

    chatSection.appendChild(this.chatAreaElement);
    chatSection.appendChild(chatInputRow);
    this.alertPanel.appendChild(chatSection);
    overlay.appendChild(this.alertPanel);

    this.chatCloseBtn.addEventListener('click', () => this._dismissChat());
    this.chatSendBtn.addEventListener('click', () => this._handleChatSend());
    this.chatInputElement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._handleChatSend();
    });

    this.shadowRoot.appendChild(overlay);
    document.body.appendChild(this.container);

    // Listen for fullscreen changes to move overlay into fullscreen element
    document.addEventListener('fullscreenchange', this._handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this._handleFullscreenChange);
  }

  /**
   * Handle fullscreen changes - move overlay into/out of fullscreen element.
   */
  handleFullscreenChange() {
    if (!this.container) return;

    // Check both standard and webkit-prefixed fullscreen element
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (fullscreenElement) {
      // Entering fullscreen - move overlay into the fullscreen element
      fullscreenElement.appendChild(this.container);
    } else {
      // Exiting fullscreen - move overlay back to body
      document.body.appendChild(this.container);
    }
  }

  /**
   * Get overlay CSS styles.
   */
  getStyles() {
    return `
      .pulse-overlay {
        position: fixed;
        z-index: 2147483647;
        pointer-events: none; /* BPM row passes through in all states */
        background: rgba(0, 0, 0, 0.75);
        border-radius: 12px;
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 0;
        max-width: 380px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: white;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        user-select: none;
        border: 2px solid transparent;
        transition: opacity 0.3s ease, border-color 0.4s ease, box-shadow 0.4s ease, background 0.4s ease;
      }

      .pulse-overlay.top-left { top: 20px; left: 20px; }
      .pulse-overlay.top-right { top: 20px; right: 20px; }
      .pulse-overlay.bottom-left { bottom: 20px; left: 20px; }
      .pulse-overlay.bottom-right { bottom: 20px; right: 20px; }

      .pulse-overlay.size-small { transform: scale(0.8); }
      .pulse-overlay.size-medium { transform: scale(1); }
      .pulse-overlay.size-large { transform: scale(1.2); }

      /* Alert panel and its contents are interactive when alert is active */
      .pulse-overlay.alert-active .alert-panel {
        pointer-events: auto;
      }

      /* Alert state */
      .pulse-overlay.alert-active .bpm-row {
        align-items: flex-start;
      }

      .pulse-overlay.alert-active {
        border-color: #26C6DA;
        background: rgba(0, 12, 20, 0.88);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 18px rgba(38, 198, 218, 0.35);
      }

      .bpm-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .status-connected { background: #4CAF50; box-shadow: 0 0 6px #4CAF50; }
      .status-connecting { background: #FFC107; animation: pulse-status 1s ease-in-out infinite; }
      .status-scanning { background: #2196F3; animation: pulse-status 1s ease-in-out infinite; }
      .status-disconnected { background: #F44336; }

      @keyframes pulse-status {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      .heart-icon {
        width: 50px;
        height: 50px;
        flex-shrink: 0;
      }

      .heart-icon img {
        width: 100%;
        height: 100%;
        display: block;
      }

      .heart-icon.beating img {
        animation: heartbeat 0.8s ease-in-out infinite;
      }

      @keyframes heartbeat {
        0%, 100% { transform: scale(1); }
        15% { transform: scale(1.15); }
        30% { transform: scale(1); }
        45% { transform: scale(1.1); }
      }

      .bpm-display {
        display: flex;
        align-items: baseline;
        gap: 4px;
      }

      .bpm-value {
        font-size: 28px;
        font-weight: 600;
        line-height: 1;
        min-width: 45px;
      }

      .bpm-label {
        font-size: 12px;
        opacity: 0.7;
        text-transform: uppercase;
      }

      .pulse-overlay.disconnected {
        opacity: 0.6;
      }

      .pulse-overlay.disconnected .bpm-value {
        color: #999;
      }

      .graph-container {
        margin-top: 6px;
      }

      .graph-container canvas {
        display: block;
      }

      /* Alert panel — hidden until alert-active */
      .alert-panel {
        display: none;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(38, 198, 218, 0.3);
      }

      .pulse-overlay.alert-active .alert-panel {
        display: flex;
      }

      .alert-message {
        display: none;
        flex: 1;
        min-width: 0;
        text-align: center;
        word-break: break-word;
        overflow-wrap: break-word;
        line-height: 1.3;
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #4DD0E1;
      }

      .pulse-overlay.alert-active .alert-message {
        display: block;
      }

      .pulse-overlay.alert-active .bpm-display {
        display: none;
      }

      .alert-countdown {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.55);
        font-variant-numeric: tabular-nums;
      }

      /* AI Chat */
      .chat-section {
        width: 220px;
      }

      .chat-close-btn {
        display: none;
        flex-shrink: 0;
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.35);
        font-size: 14px;
        line-height: 1;
        padding: 2px 4px;
        cursor: pointer;
        pointer-events: auto;
        transition: color 0.15s;
      }

      .chat-close-btn:hover {
        color: rgba(255, 255, 255, 0.75);
      }

      .pulse-overlay.alert-active.chat-visible .chat-close-btn {
        display: flex;
        align-items: center;
      }

      .chat-area {
        display: none;
        flex-direction: column;
        gap: 6px;
        width: 220px;
        max-height: 160px;
        overflow-y: auto;
        margin-top: 6px;
        padding: 6px 0;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.2) transparent;
      }

      .pulse-overlay.alert-active.chat-visible .chat-area {
        display: flex;
      }

      .pulse-overlay.alert-active.chat-visible .chat-input-row {
        display: flex;
      }

      .chat-bubble {
        max-width: 90%;
        padding: 5px 9px;
        border-radius: 10px;
        font-size: 12px;
        line-height: 1.4;
        word-wrap: break-word;
      }

      .chat-bubble.user {
        align-self: flex-end;
        background: rgba(38, 198, 218, 0.25);
        color: #e0f7fa;
      }

      .chat-bubble.assistant {
        align-self: flex-start;
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
      }

      .chat-bubble.thinking {
        align-self: flex-start;
        background: rgba(255, 255, 255, 0.07);
        color: rgba(255,255,255,0.45);
        font-style: italic;
      }

      .chat-input-row {
        display: none;
        gap: 5px;
        margin-top: 4px;
        width: 220px;
      }

      .chat-input {
        flex: 1;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(38, 198, 218, 0.4);
        border-radius: 6px;
        color: #fff;
        font-size: 12px;
        padding: 4px 8px;
        outline: none;
        font-family: inherit;
      }

      .chat-input::placeholder {
        color: rgba(255,255,255,0.35);
      }

      .chat-send-btn {
        background: rgba(38, 198, 218, 0.3);
        border: 1px solid rgba(38, 198, 218, 0.5);
        border-radius: 6px;
        color: #4DD0E1;
        font-size: 11px;
        padding: 4px 8px;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.2s;
      }

      .chat-send-btn:hover {
        background: rgba(38, 198, 218, 0.45);
      }

      .chat-send-btn:disabled {
        opacity: 0.4;
        cursor: default;
      }
    `;
  }

  /**
   * Get heart SVG icon.
   */
  getHeartSvg() {
    const url = chrome.runtime.getURL('icons/heart.png');
    return `<img src="${url}" alt="">`;
  }

  /**
   * Setup event listeners using PulseState.
   * Note: Settings listener is set up in init() to always be active.
   */
  setupListeners() {
    // Subscribe to state changes
    this._unsubscribeState = PulseState.onStateChange((state) => {
      this.connectionState = state;
      this.updateDisplay();
    });

    // Subscribe to heart rate updates
    this._unsubscribeHR = PulseState.onHeartRate((data) => {
      this.currentBpm = data.bpm;
      this.checkAlertCondition(data.bpm);
      this.updateDisplay();

      if (this.graph) {
        this.graph.addPoint(data.bpm, data.timestamp);
      }
    });
  }

  /**
   * Check if BPM crosses the alert threshold and fire the alert if so.
   */
  checkAlertCondition(bpm) {
    if (this.alertState !== 'idle') return;
    if (!this.settings || typeof this.settings.alertThreshold !== 'number') return;
    if (this.connectionState !== 'connected') return;

    if (bpm > this.settings.alertThreshold) {
      this.enterAlert();
    }
  }

  /**
   * Enter the ALERT state and start the cooldown countdown.
   */
  enterAlert() {
    const alertType = this.settings.alertType || 'visual';
    this._alertShowsVisual = alertType === 'visual' || alertType === 'both';
    this.alertState = 'alert';
    this.alertCooldownRemaining = this.settings.alertCooldown || 60;
    this._alertDisplayMessage = null;
    this._chatDismissed = false;

    const useAiMessage = !!(this.settings.aiGeneratedMessage && this.settings.aiChatEnabled);

    if (useAiMessage) {
      // Show overlay immediately with empty message area; text streams in within ~200ms
      this._alertDisplayMessage = '';
      this.updateDisplay();

      this._generateOpeningMessage().then(reply => {
        if (this.alertState !== 'alert') return; // alert ended before AI replied
        if (reply) {
          this._alertDisplayMessage = reply;
          this._chatHistory.push({ role: 'assistant', content: reply });
          if (alertType === 'audio' || alertType === 'both') {
            this._speakText(reply);
          }
        } else {
          // Fallback to preset on error
          this._alertDisplayMessage = null;
          if (alertType === 'audio' || alertType === 'both') {
            this._speakText(this.settings.alertMessage || 'Relax');
          }
        }
        this.updateDisplay();
      });
    } else {
      // Normal mode: show preset, speak if audio
      if (alertType === 'audio' || alertType === 'both') {
        const text = this.settings.alertMessage || 'Relax';
        const voiceId = this.settings.selectedVoice || 'standard';
        const voice = VOICE_OPTIONS.find(v => v.id === voiceId) || VOICE_OPTIONS[0];
        if (voice.engine === 'elevenlabs' && typeof speakElevenLabs === 'function') {
          speakElevenLabs(text, voice.id).then(success => {
            if (!success) chrome.runtime.sendMessage({ type: 'speak', text });
          });
        } else {
          chrome.runtime.sendMessage({ type: 'speak', text });
        }
      }
      this.updateDisplay();
    }

    this._alertInterval = setInterval(() => {
      this.alertCooldownRemaining--;
      if (this.alertCooldownRemaining <= 0) {
        clearInterval(this._alertInterval);
        this._alertInterval = null;
        this.alertState = 'idle';
        this.alertCooldownRemaining = 0;
        this._clearChat();
      }
      this.updateDisplay();
    }, 1000);
  }

  /**
   * Speak text using the currently-selected voice, cancelling any prior audio.
   */
  _speakText(text) {
    const voiceId = this.settings.selectedVoice || 'standard';
    const voice = VOICE_OPTIONS.find(v => v.id === voiceId) || VOICE_OPTIONS[0];
    if (voice.engine === 'elevenlabs' && typeof speakElevenLabs === 'function') {
      chrome.runtime.sendMessage({ type: 'stopElevenLabs' });
      speakElevenLabs(text, voice.id).then(success => {
        if (!success) {
          chrome.runtime.sendMessage({ type: 'stopChromeTts' });
          chrome.runtime.sendMessage({ type: 'speak', text });
        }
      });
    } else {
      chrome.runtime.sendMessage({ type: 'speak', text });
    }
  }

  /**
   * User clicked X — hide chat for the rest of this alert cycle and stop audio.
   * Preserves _alertDisplayMessage so the AI opening text stays in the header.
   */
  _dismissChat() {
    this._chatDismissed = true;
    chrome.runtime.sendMessage({ type: 'stopElevenLabs' });
    chrome.runtime.sendMessage({ type: 'stopChromeTts' });
    this._chatHistory = [];
    if (this.chatAreaElement) this.chatAreaElement.innerHTML = '';
    if (this.chatInputElement) this.chatInputElement.value = '';
    this.updateDisplay();
  }

  /**
   * Clear chat history and DOM (called when cooldown ends — resets for next alert).
   */
  _clearChat() {
    this._chatHistory = [];
    this._alertDisplayMessage = null;
    this._chatDismissed = false;
    if (this.chatAreaElement) {
      this.chatAreaElement.innerHTML = '';
    }
    if (this.chatInputElement) {
      this.chatInputElement.value = '';
    }
  }

  /**
   * Shared SSE streaming helper for OpenAI chat completions.
   * Calls onChunk(accumulatedText) on each delta. Returns full text when done,
   * or whatever was accumulated if the stream ends early.
   */
  async _streamOpenAI(messages, maxTokens, onChunk) {
    const config = typeof BODYCI_CONFIG !== 'undefined' ? BODYCI_CONFIG : null;
    if (!config || !config.openaiApiKey || config.openaiApiKey === 'PASTE_KEY_HERE') return null;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: OPENAI_MODEL, messages, max_tokens: maxTokens, stream: true })
    });

    if (!response.ok) throw new Error(`OpenAI ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') return fullText;
          try {
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              onChunk(fullText);
            }
          } catch { /* skip malformed chunk */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return fullText || null;
  }

  /**
   * Add a bubble to the chat area and scroll to bottom.
   */
  _addChatBubble(role, text) {
    if (!this.chatAreaElement) return null;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.textContent = text;
    this.chatAreaElement.appendChild(bubble);
    this.chatAreaElement.scrollTop = this.chatAreaElement.scrollHeight;
    return bubble;
  }

  /**
   * Handle user pressing Send.
   */
  _handleChatSend() {
    if (!this.chatInputElement || !this.chatSendBtn) return;
    const text = this.chatInputElement.value.trim();
    if (!text) return;
    this.chatInputElement.value = '';
    this.sendChatMessage(text);
  }

  /**
   * Send a chat message to OpenAI and stream the response into a chat bubble.
   */
  async sendChatMessage(userText) {
    const config = typeof BODYCI_CONFIG !== 'undefined' ? BODYCI_CONFIG : null;
    if (!config || !config.openaiApiKey || config.openaiApiKey === 'PASTE_KEY_HERE') {
      this._addChatBubble('assistant', 'OpenAI API key not configured. Add it to config.local.js.');
      return;
    }

    if (this.chatSendBtn) this.chatSendBtn.disabled = true;
    if (this.chatInputElement) this.chatInputElement.disabled = true;

    this._addChatBubble('user', userText);
    this._chatHistory.push({ role: 'user', content: userText });

    // Empty bubble created immediately — text streams in word by word
    const assistantBubble = this._addChatBubble('assistant', '');

    const systemMessage = {
      role: 'system',
      content: `You are a calm, supportive coach helping a user who's experiencing an elevated heart rate. Their current BPM is ${this.currentBpm || 'unknown'}. Keep responses short (1-3 sentences). Be warm but not corny. Focus on practical, grounding suggestions. Don't diagnose or give medical advice.`
    };

    let fullText = '';
    try {
      fullText = await this._streamOpenAI(
        [systemMessage, ...this._chatHistory],
        120,
        (accumulated) => {
          if (assistantBubble) {
            assistantBubble.textContent = accumulated;
            if (this.chatAreaElement) this.chatAreaElement.scrollTop = this.chatAreaElement.scrollHeight;
          }
        }
      );

      if (!fullText) throw new Error('empty');
      this._chatHistory.push({ role: 'assistant', content: fullText });
      this._speakText(fullText);
    } catch (e) {
      console.warn('Bodyci: AI chat error:', e);
      if (assistantBubble) {
        if (fullText) {
          // Show what arrived before the failure
          assistantBubble.textContent = fullText + ' [interrupted]';
          this._chatHistory.push({ role: 'assistant', content: fullText });
        } else {
          assistantBubble.textContent = "Couldn't reach the AI. Try again?";
          this._chatHistory.pop(); // let user retry with same message
        }
        if (this.chatAreaElement) this.chatAreaElement.scrollTop = this.chatAreaElement.scrollHeight;
      }
    } finally {
      if (this.chatSendBtn) this.chatSendBtn.disabled = false;
      if (this.chatInputElement) {
        this.chatInputElement.disabled = false;
        this.chatInputElement.focus();
      }
    }
  }

  /**
   * Stream an AI-generated opening message into alertMessageElement.
   * Returns the full text (or partial on error) so the caller can add it to
   * _chatHistory and speak it. Returns null if no API key, triggering preset fallback.
   */
  async _generateOpeningMessage() {
    const config = typeof BODYCI_CONFIG !== 'undefined' ? BODYCI_CONFIG : null;
    if (!config || !config.openaiApiKey || config.openaiApiKey === 'PASTE_KEY_HERE') return null;

    const systemContent = `You are a calm, supportive coach checking in with someone whose heart rate just spiked. Their current BPM is ${this.currentBpm || 'unknown'} and their threshold is ${this.settings.alertThreshold}. They previously set their alert message to '${this.settings.alertMessage || 'Relax'}' — that's a hint at what they want to be reminded of.\n\nGenerate a short opening (1-2 sentences) that's mostly an open-ended check-in — ask what's going on, how they're feeling, or what they're in the middle of. Occasionally you can briefly mention a grounding suggestion at the end, but the main goal is to invite them to share. Be warm and curious, not clinical. Don't be corny.`;

    let fullText = '';
    try {
      fullText = await this._streamOpenAI(
        [
          { role: 'system', content: systemContent },
          { role: 'user', content: 'Generate the opening check-in.' }
        ],
        80,
        (accumulated) => {
          // Keep _alertDisplayMessage in sync so the every-second updateDisplay() tick
          // shows the latest partial text rather than overwriting with stale data
          this._alertDisplayMessage = accumulated;
          if (this.alertMessageElement) this.alertMessageElement.textContent = accumulated;
        }
      );
      return fullText || null;
    } catch (e) {
      console.warn('Bodyci: AI opening message failed:', e);
      return fullText || null; // partial text beats a blank screen; null triggers preset
    }
  }

  /**
   * Handle settings change.
   */
  async handleSettingsChange() {
    const oldSettings = this.settings;
    this.settings = await PulseState.getSettings();

    if (!this.shouldShow()) {
      this.removeOverlay();
      return;
    }

    // Only displayMode requires a DOM rebuild (graph canvas must be created/removed).
    // All other settings are applied in-place so an active alert is never interrupted.
    const needsRebuild = this.container && oldSettings &&
      oldSettings.displayMode !== this.settings.displayMode;

    if (needsRebuild) {
      // Snapshot every piece of alert state before teardown
      const snap = {
        alertState: this.alertState,
        alertCooldownRemaining: this.alertCooldownRemaining,
        _alertShowsVisual: this._alertShowsVisual,
        _alertInterval: this._alertInterval,
        _chatHistory: [...this._chatHistory],
        _alertDisplayMessage: this._alertDisplayMessage,
        _chatDismissed: this._chatDismissed,
      };
      // Detach the live timer so removeOverlay() doesn't cancel it
      this._alertInterval = null;
      this.removeOverlay();
      this.createOverlay();
      this.setupListeners();

      const state = await PulseState.getState();
      this.connectionState = state.connectionState;
      if (state.currentBpm !== null) {
        this.currentBpm = state.currentBpm;
        if (this.graph) this.graph.addPoint(state.currentBpm, Date.now());
      }

      // Restore alert state — never call enterAlert() again
      this.alertState = snap.alertState;
      this.alertCooldownRemaining = snap.alertCooldownRemaining;
      this._alertShowsVisual = snap._alertShowsVisual;
      this._alertInterval = snap._alertInterval;
      this._chatHistory = snap._chatHistory;
      this._alertDisplayMessage = snap._alertDisplayMessage;
      this._chatDismissed = snap._chatDismissed;

      // Re-render chat history into new DOM
      if (snap.alertState === 'alert') {
        for (const msg of snap._chatHistory) {
          this._addChatBubble(msg.role, msg.content);
        }
      }
    } else if (this.container) {
      // Apply visual changes in-place — alert state is completely untouched
      const overlay = this.shadowRoot.querySelector('.pulse-overlay');
      if (overlay) {
        overlay.style.opacity = this.settings.opacity;
        overlay.classList.remove('size-small', 'size-medium', 'size-large');
        overlay.classList.add(`size-${this.settings.size}`);
        overlay.classList.remove('top-left', 'top-right', 'bottom-left', 'bottom-right');
        overlay.classList.add(this.settings.position);
      }
      // Update graph settings without rebuilding canvas
      if (this.graph) {
        this.graph.duration = this.settings.graphDuration;
        this.graph.fixedMinBpm = this.settings.graphMinBpm ?? null;
        this.graph.fixedMaxBpm = this.settings.graphMaxBpm ?? null;
      }
    }

    // First-time creation (overlay was absent because shouldShow() was previously false)
    if (!this.container) {
      this.createOverlay();
      this.setupListeners();

      const state = await PulseState.getState();
      this.connectionState = state.connectionState;
      if (state.currentBpm !== null) {
        this.currentBpm = state.currentBpm;
        if (this.graph) this.graph.addPoint(state.currentBpm, Date.now());
      }
    }

    this.updateDisplay();
  }

  /**
   * Remove overlay DOM and data listeners but keep settings listener.
   */
  removeOverlay() {
    // Unsubscribe from data listeners
    if (this._unsubscribeState) {
      this._unsubscribeState();
      this._unsubscribeState = null;
    }
    if (this._unsubscribeHR) {
      this._unsubscribeHR();
      this._unsubscribeHR = null;
    }

    // Clear alert timer
    if (this._alertInterval) {
      clearInterval(this._alertInterval);
      this._alertInterval = null;
    }
    this.alertState = 'idle';
    this.alertCooldownRemaining = 0;
    this._alertShowsVisual = false;

    // Remove fullscreen listeners
    document.removeEventListener('fullscreenchange', this._handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', this._handleFullscreenChange);

    // Clean up graph
    if (this.graph && typeof this.graph.clear === 'function') {
      this.graph.clear();
    }

    // Remove DOM
    if (this.container) {
      this.container.remove();
    }
    this.container = null;
    this.shadowRoot = null;
    this.bpmElement = null;
    this.statusElement = null;
    this.heartElement = null;
    this.graphCanvas = null;
    this.graph = null;
    this.alertPanel = null;
    this.alertMessageElement = null;
    this.alertCountdownElement = null;
    this.chatAreaElement = null;
    this.chatInputElement = null;
    this.chatSendBtn = null;
    this.chatCloseBtn = null;
    this._chatHistory = [];
    this._alertDisplayMessage = null;
    this._chatDismissed = false;
  }

  /**
   * Update the overlay display.
   */
  updateDisplay() {
    if (!this.container) return;

    const overlay = this.shadowRoot.querySelector('.pulse-overlay');

    // Update status indicator
    this.statusElement.className = `status-indicator status-${this.connectionState}`;

    // Update BPM
    const bpmValue = this.bpmElement.querySelector('.bpm-value');
    if (this.currentBpm !== null && this.connectionState === 'connected') {
      bpmValue.textContent = this.currentBpm;
      this.heartElement.classList.add('beating');
      overlay.classList.remove('disconnected');
    } else {
      bpmValue.textContent = '--';
      this.heartElement.classList.remove('beating');
      overlay.classList.add('disconnected');
    }

    // Update alert state
    if (this.alertState === 'alert' && this._alertShowsVisual) {
      overlay.classList.add('alert-active');
      this.alertMessageElement.textContent = this._alertDisplayMessage ?? (this.settings.alertMessage || 'Relax');
      this.alertCountdownElement.textContent = `Cooling down: ${this.alertCooldownRemaining}s`;
      const showChat = !!(this.settings.aiChatEnabled) && !this._chatDismissed;
      overlay.classList.toggle('chat-visible', showChat);
      // Allow the container to receive pointer events so the alert panel is clickable
      this.container.style.pointerEvents = 'auto';
    } else {
      overlay.classList.remove('alert-active');
      overlay.classList.remove('chat-visible');
      // Restore pass-through so idle BPM display never blocks page clicks
      this.container.style.pointerEvents = '';
    }
  }

  /**
   * Destroy the overlay completely (including settings listener).
   */
  destroy() {
    // Remove overlay and data listeners
    this.removeOverlay();

    // Also remove settings listener (full cleanup)
    if (this._unsubscribeSettings) {
      this._unsubscribeSettings();
      this._unsubscribeSettings = null;
    }
  }
}

// Export for content script
window.PulseOverlay = PulseOverlay;
