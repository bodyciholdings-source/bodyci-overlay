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
    this.chatInputRowElement = null;
    this.micBtnElement = null;
    // Voice input state
    this._recognition = null;
    this._recognitionActive = false;
    this._voiceState = 'idle'; // 'idle' | 'listening' | 'processing' | 'speaking'
    this._handleVisibilityChange = null;
    this._audioEndedListener = null;
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

    // Listen for audio-ended broadcasts from background so we know when to re-enable mic
    this._audioEndedListener = (message) => {
      if (message.type === 'audioPlaybackEnded') this._onAudioEnded();
    };
    chrome.runtime.onMessage.addListener(this._audioEndedListener);

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

    // Heart icon (for standard mode)
    this.heartElement = document.createElement('div');
    this.heartElement.className = 'heart-icon';
    if (this.settings.displayMode === 'minimal') {
      this.heartElement.style.display = 'none';
    }

    // SVG ring — two circles: faint base (full) + solid arc (rotating)
    const svgNS = 'http://www.w3.org/2000/svg';
    const ringSvg = document.createElementNS(svgNS, 'svg');
    ringSvg.setAttribute('class', 'heart-ring-svg');
    ringSvg.setAttribute('viewBox', '0 0 50 50');
    ringSvg.setAttribute('aria-hidden', 'true');

    const baseCircle = document.createElementNS(svgNS, 'circle');
    baseCircle.setAttribute('class', 'ring-base');
    baseCircle.setAttribute('cx', '25');
    baseCircle.setAttribute('cy', '25');
    baseCircle.setAttribute('r', '23');

    // 90° solid arc: circumference = 2π×23 ≈ 144.51, quarter = 36.13
    const arcCircle = document.createElementNS(svgNS, 'circle');
    arcCircle.setAttribute('class', 'ring-arc');
    arcCircle.setAttribute('cx', '25');
    arcCircle.setAttribute('cy', '25');
    arcCircle.setAttribute('r', '23');
    arcCircle.setAttribute('stroke-dasharray', '36.13 108.38');

    ringSvg.appendChild(baseCircle);
    ringSvg.appendChild(arcCircle);
    this.heartElement.appendChild(ringSvg);

    // Heart image (sits inside the ring)
    const heartImg = document.createElement('img');
    heartImg.src = chrome.runtime.getURL('icons/heart.png');
    heartImg.alt = '';
    this.heartElement.appendChild(heartImg);

    bpmRow.appendChild(this.heartElement);

    // BPM display
    this.bpmElement = document.createElement('div');
    this.bpmElement.className = 'bpm-display';
    this.bpmElement.innerHTML = '<span class="bpm-value">--</span><span class="bpm-label">BPM</span>';
    bpmRow.appendChild(this.bpmElement);

    // Close button — pushed to far right of bpmRow by margin-left:auto in CSS
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

    // Alert message is the first item in the panel (below the always-visible BPM row)
    this.alertMessageElement = document.createElement('div');
    this.alertMessageElement.className = 'alert-message';
    this.alertPanel.appendChild(this.alertMessageElement);

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
    chatInputRow.classList.add(`voice-${this.settings.voiceInputMode || 'off'}`);
    this.chatInputRowElement = chatInputRow;

    this.micBtnElement = document.createElement('button');
    this.micBtnElement.type = 'button';
    this.micBtnElement.className = 'chat-mic-btn mic-idle';
    this.micBtnElement.title = 'Click to speak';
    this.micBtnElement.innerHTML = this.getMicSvg();

    this.chatInputElement = document.createElement('input');
    this.chatInputElement.type = 'text';
    this.chatInputElement.className = 'chat-input';
    this.chatInputElement.placeholder = 'Ask for help…';
    this.chatInputElement.maxLength = 200;

    this.chatSendBtn = document.createElement('button');
    this.chatSendBtn.className = 'chat-send-btn';
    this.chatSendBtn.textContent = 'Send';

    chatInputRow.appendChild(this.micBtnElement);
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
    this.micBtnElement.addEventListener('click', () => {
      if (this._voiceState === 'idle') {
        this._startListening();
      } else if (this._voiceState === 'listening') {
        this._stopListening();
      }
    });
    // Pause mic while user is typing (voice+text mode); restart on blur
    this.chatInputElement.addEventListener('focus', () => {
      if (this._voiceState === 'listening') this._stopListening();
    });
    this.chatInputElement.addEventListener('blur', () => {
      const mode = this.settings.voiceInputMode || 'off';
      if (mode === 'both' && this.alertState === 'alert' && !this._chatDismissed &&
          this._voiceState === 'idle' && this.settings.aiChatEnabled) {
        setTimeout(() => this._startListening(), 200);
      }
    });

    this.shadowRoot.appendChild(overlay);
    document.body.appendChild(this.container);

    // Listen for fullscreen changes to move overlay into fullscreen element
    document.addEventListener('fullscreenchange', this._handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this._handleFullscreenChange);

    // Init voice recognition and stop mic when tab is hidden
    this._initVoiceInput();
    this._handleVisibilityChange = () => {
      if (document.hidden) {
        this._stopListening();
      } else if (this.alertState === 'alert' && !this._chatDismissed &&
                 (this.settings.voiceInputMode || 'off') !== 'off' &&
                 this.settings.aiChatEnabled) {
        setTimeout(() => this._startListening(), 200);
      }
    };
    document.addEventListener('visibilitychange', this._handleVisibilityChange);
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
        pointer-events: none;
        background: #ffffff;
        border-radius: 24px;
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 0;
        max-width: 380px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #0f172a;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.08);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        user-select: none;
        border: 2px solid transparent;
        transition: border-color 0.4s ease, box-shadow 0.4s ease;
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
      .pulse-overlay.alert-active {
        border-color: #2563eb;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.08), 0 0 18px rgba(37, 99, 235, 0.35);
      }

      .bpm-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .heart-icon {
        width: 50px;
        height: 50px;
        flex-shrink: 0;
        position: relative;
        padding: 7px;
        box-sizing: border-box;
      }

      .heart-icon img {
        width: 100%;
        height: 100%;
        display: block;
        position: relative;
        z-index: 1;
      }

      /* SVG ring: covers the full icon div, rotates continuously */
      .heart-ring-svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
        animation: ring-spin 2.5s linear infinite;
      }

      @keyframes ring-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }

      /* Faint full-circle base */
      .ring-base {
        fill: none;
        stroke: rgba(148, 163, 184, 0.35);
        stroke-width: 4;
        transition: stroke 0.3s ease;
      }

      /* Solid quarter-arc that sweeps around */
      .ring-arc {
        fill: none;
        stroke: #2563eb;
        stroke-width: 4;
        stroke-linecap: round;
      }

      /* Connected: full-opacity blue */
      .heart-icon.ring-connected    .ring-base { stroke: rgba(37, 99, 235, 0.2); }
      .heart-icon.ring-connected    .ring-arc  { stroke: #2563eb; }

      /* Connecting / Scanning: same arc, slightly dimmer */
      .heart-icon.ring-connecting   .ring-base,
      .heart-icon.ring-scanning     .ring-base { stroke: rgba(37, 99, 235, 0.15); }
      .heart-icon.ring-connecting   .ring-arc,
      .heart-icon.ring-scanning     .ring-arc  { stroke: rgba(37, 99, 235, 0.65); }

      /* Disconnected: gray base, arc hidden, rotation stopped */
      .heart-icon.ring-disconnected .ring-base { stroke: rgba(148, 163, 184, 0.35); }
      .heart-icon.ring-disconnected .ring-arc  { display: none; }
      .heart-icon.ring-disconnected .heart-ring-svg { animation: none; }

      /* Heartbeat: only the img scales — SVG ring stays fixed */
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
        font-weight: 700;
        line-height: 1;
        min-width: 45px;
        color: #0f172a;
      }

      .bpm-label {
        font-size: 12px;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .pulse-overlay.disconnected {
        opacity: 0.55;
      }

      .pulse-overlay.disconnected .bpm-value {
        color: #94a3b8;
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
        border-top: 1px solid rgba(37, 99, 235, 0.15);
      }

      .pulse-overlay.alert-active .alert-panel {
        display: flex;
      }

      .alert-message {
        text-align: center;
        word-break: break-word;
        overflow-wrap: break-word;
        line-height: 1.3;
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #2563eb;
      }

      .alert-countdown {
        font-size: 11px;
        color: #94a3b8;
        font-variant-numeric: tabular-nums;
      }

      /* AI Chat */
      .chat-section {
        width: 220px;
      }

      .chat-close-btn {
        display: none;
        flex-shrink: 0;
        margin-left: auto;
        background: none;
        border: none;
        color: #94a3b8;
        font-size: 16px;
        line-height: 1;
        padding: 2px 4px;
        cursor: pointer;
        pointer-events: auto;
        transition: color 0.15s;
      }

      .chat-close-btn:hover {
        color: #0f172a;
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
        scrollbar-color: rgba(15, 23, 42, 0.1) transparent;
      }

      .pulse-overlay.alert-active.chat-visible .chat-area {
        display: flex;
      }

      .pulse-overlay.alert-active.chat-visible .chat-input-row {
        display: flex;
      }

      .chat-bubble {
        max-width: 90%;
        padding: 6px 10px;
        border-radius: 16px;
        font-size: 12px;
        line-height: 1.4;
        word-wrap: break-word;
        color: #0f172a;
      }

      .chat-bubble.user {
        align-self: flex-end;
        background: rgba(37, 99, 235, 0.1);
      }

      .chat-bubble.assistant {
        align-self: flex-start;
        background: #f8fafc;
      }

      .chat-bubble.thinking {
        align-self: flex-start;
        background: #f1f5f9;
        color: #94a3b8;
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
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        color: #0f172a;
        font-size: 12px;
        padding: 4px 8px;
        outline: none;
        font-family: inherit;
        transition: border-color 0.15s;
      }

      .chat-input:focus {
        border-color: #2563eb;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
      }

      .chat-input::placeholder {
        color: #94a3b8;
      }

      .chat-send-btn {
        background: #2563eb;
        border: none;
        border-radius: 8px;
        color: #ffffff;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 10px;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s;
      }

      .chat-send-btn:hover {
        background: #1d4ed8;
      }

      .chat-send-btn:disabled {
        opacity: 0.4;
        cursor: default;
      }

      /* Voice input mic button */
      .chat-mic-btn {
        display: none;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border-radius: 50%;
        border: 1px solid #e2e8f0;
        background: #f8fafc;
        color: #64748b;
        cursor: pointer;
        flex-shrink: 0;
        pointer-events: auto;
        transition: color 0.2s, background 0.2s, border-color 0.2s, box-shadow 0.2s;
      }

      .chat-mic-btn svg {
        width: 14px;
        height: 14px;
      }

      .chat-input-row.voice-only .chat-mic-btn,
      .chat-input-row.voice-both .chat-mic-btn {
        display: flex;
      }

      .chat-input-row.voice-only .chat-input,
      .chat-input-row.voice-only .chat-send-btn {
        display: none;
      }

      .chat-mic-btn.mic-listening {
        border-color: #ef4444;
        background: rgba(239, 68, 68, 0.08);
        color: #ef4444;
        animation: mic-pulse 1.4s ease-in-out infinite;
      }

      .chat-mic-btn.mic-processing {
        border-color: rgba(37, 99, 235, 0.3);
        background: rgba(37, 99, 235, 0.05);
        color: rgba(37, 99, 235, 0.5);
        cursor: default;
      }

      .chat-mic-btn.mic-speaking {
        border-color: #e2e8f0;
        background: #f1f5f9;
        color: #cbd5e1;
        cursor: default;
      }

      @keyframes mic-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
        50% { box-shadow: 0 0 0 5px rgba(239, 68, 68, 0); }
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
        this._speakText(this.settings.alertMessage || 'Relax');
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

    // Auto-start voice if enabled (delay lets DOM render and optional AI audio start first)
    if ((this.settings.voiceInputMode || 'off') !== 'off' && this.settings.aiChatEnabled) {
      setTimeout(() => {
        if (this.alertState === 'alert' && !this._chatDismissed) this._startListening();
      }, 400);
    }
  }

  /**
   * Speak text using the currently-selected voice, cancelling any prior audio.
   */
  _speakText(text) {
    // Stop any active mic session — the mic must be silent while AI is speaking
    if (this._voiceState === 'listening') this._stopListening();
    if ((this.settings.voiceInputMode || 'off') !== 'off') this._setVoiceState('speaking');

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
    this._stopListening();
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
    this._stopListening();
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
      this._speakText(fullText); // also stops mic and sets 'speaking' state
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
        // Only refocus text input in text-available modes
        if ((this.settings.voiceInputMode || 'off') !== 'only') this.chatInputElement.focus();
      }
      // Mic restart is handled by _onAudioEnded() once the audio playback actually ends.
      // No timer needed here — _speakText() already put the mic into 'speaking' state.
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

  getMicSvg() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>`;
  }

  _initVoiceInput() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      this._recognition = null;
      return;
    }

    this._recognition = new SR();
    this._recognition.continuous = false;
    this._recognition.interimResults = false;
    this._recognition.lang = 'en-US';
    this._recognition.maxAlternatives = 1;

    this._recognition.onstart = () => {
      this._recognitionActive = true;
      this._setVoiceState('listening');
    };

    this._recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .filter(r => r.isFinal)
        .map(r => r[0].transcript)
        .join('')
        .trim();
      if (transcript) {
        this._recognitionActive = false;
        this._setVoiceState('processing');
        this.sendChatMessage(transcript);
      }
    };

    this._recognition.onerror = (event) => {
      this._recognitionActive = false;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this._setVoiceState('idle');
        this._addChatBubble('assistant',
          'Voice input needs microphone access. Enable it in your browser settings and reload.');
        return;
      }
      if (event.error === 'aborted') {
        // We stopped it intentionally — onend will fire but should not restart
        return;
      }
      // Transient errors (no-speech, network) — restart loop via onend
      this._setVoiceState('idle');
    };

    this._recognition.onend = () => {
      this._recognitionActive = false;
      // Restart only if we're still in listening mode (not processing/speaking/idle-by-intent)
      if (this._voiceState === 'listening' && this.alertState === 'alert' &&
          !this._chatDismissed && (this.settings.voiceInputMode || 'off') !== 'off' &&
          this.settings.aiChatEnabled) {
        setTimeout(() => {
          if (this.alertState === 'alert' && !this._chatDismissed &&
              this._voiceState === 'listening') {
            this._startListening();
          }
        }, 150);
      } else if (this._voiceState === 'listening') {
        this._setVoiceState('idle');
      }
    };
  }

  _startListening() {
    if (!this._recognition) return;
    if (this._recognitionActive) return;
    if ((this.settings.voiceInputMode || 'off') === 'off') return;
    // Never start mic while AI is generating ('processing') or playing audio ('speaking')
    if (this._voiceState === 'processing' || this._voiceState === 'speaking') return;
    try {
      this._recognition.start();
    } catch (e) {
      console.warn('Bodyci: voice start error:', e);
    }
  }

  _stopListening() {
    // Set state to idle BEFORE calling stop() so the onend handler won't restart
    this._setVoiceState('idle');
    if (this._recognition && this._recognitionActive) {
      this._recognitionActive = false;
      try { this._recognition.stop(); } catch (e) {}
    }
  }

  _setVoiceState(state) {
    this._voiceState = state;
    if (!this.micBtnElement) return;
    this.micBtnElement.className = `chat-mic-btn mic-${state}`;
    this.micBtnElement.disabled = state === 'processing' || state === 'speaking';
    const titles = {
      idle: 'Click to speak',
      listening: 'Listening… click to stop',
      processing: 'Processing…',
      speaking: 'AI is speaking…'
    };
    this.micBtnElement.title = titles[state] ?? '';
  }

  _onAudioEnded() {
    if (this._voiceState !== 'speaking') return;
    if (this.alertState !== 'alert' || this._chatDismissed) return;
    if ((this.settings.voiceInputMode || 'off') === 'off' || !this.settings.aiChatEnabled) return;
    this._setVoiceState('idle');
    this._startListening();
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
        // Restart voice if enabled after rebuild
        if (!snap._chatDismissed && this.settings.aiChatEnabled &&
            (this.settings.voiceInputMode || 'off') !== 'off') {
          setTimeout(() => this._startListening(), 300);
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
      // Sync voice mode class and recognition state
      if (this.chatInputRowElement) {
        this.chatInputRowElement.classList.remove('voice-off', 'voice-only', 'voice-both');
        this.chatInputRowElement.classList.add(`voice-${this.settings.voiceInputMode || 'off'}`);
      }
      if (this.alertState === 'alert' && !this._chatDismissed && this.settings.aiChatEnabled) {
        const newMode = this.settings.voiceInputMode || 'off';
        if (newMode !== 'off') {
          this._startListening();
        } else {
          this._stopListening();
        }
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

    // Remove fullscreen and visibility listeners
    document.removeEventListener('fullscreenchange', this._handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', this._handleFullscreenChange);
    if (this._handleVisibilityChange) {
      document.removeEventListener('visibilitychange', this._handleVisibilityChange);
      this._handleVisibilityChange = null;
    }

    // Stop voice recognition
    this._stopListening();
    this._recognition = null;
    this._recognitionActive = false;
    this._voiceState = 'idle';

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
    this.chatInputRowElement = null;
    this.micBtnElement = null;
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

    // Update connection ring on heart icon
    this.heartElement.classList.remove('ring-connected', 'ring-connecting', 'ring-scanning', 'ring-disconnected');
    this.heartElement.classList.add(`ring-${this.connectionState}`);

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

    // Remove audio-ended listener (added in init(), persists across removeOverlay() calls)
    if (this._audioEndedListener) {
      chrome.runtime.onMessage.removeListener(this._audioEndedListener);
      this._audioEndedListener = null;
    }
  }
}

// Export for content script
window.PulseOverlay = PulseOverlay;
