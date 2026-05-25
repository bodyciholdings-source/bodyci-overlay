/**
 * Options page script for PulseOverlay.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const serverUrl = document.getElementById('server-url');
  const displayMode = document.getElementById('display-mode');
  const position = document.getElementById('position');
  const size = document.getElementById('size');
  const opacity = document.getElementById('opacity');
  const opacityValue = document.getElementById('opacity-value');
  const graphDuration = document.getElementById('graph-duration');
  const graphDurationGroup = document.getElementById('graph-duration-group');
  const graphMinBpm = document.getElementById('graph-min-bpm');
  const graphMaxBpm = document.getElementById('graph-max-bpm');
  const graphBpmRangeGroup = document.getElementById('graph-bpm-range-group');
  const enabled = document.getElementById('enabled');
  const siteOverrides = document.getElementById('site-overrides');
  const newSite = document.getElementById('new-site');
  const newSiteState = document.getElementById('new-site-state');
  const addSiteBtn = document.getElementById('add-site-btn');
  const connectionStatus = document.getElementById('connection-status');
  const currentBpm = document.getElementById('current-bpm');
  const reconnectBtn = document.getElementById('reconnect-btn');
  const alertThreshold = document.getElementById('alert-threshold');
  const alertCooldown = document.getElementById('alert-cooldown');
  const alertMessage = document.getElementById('alert-message');
  const alertType = document.getElementById('alert-type');
  const testAlertBtn = document.getElementById('test-alert-btn');
  const testAlertFeedback = document.getElementById('test-alert-feedback');
  const voiceSelect = document.getElementById('voice-select');
  const voiceStatus = document.getElementById('voice-status');
  const voiceInputMode = document.getElementById('voice-input-mode');
  const aiChatEnabled = document.getElementById('ai-chat-enabled');
  const aiGeneratedMessage = document.getElementById('ai-generated-message');
  const cloudAuthBtn = document.getElementById('cloud-auth-btn');
  const cloudStatusText = document.getElementById('cloud-status-text');
  const cloudStatusDot = document.getElementById('cloud-status-dot');
  const cloudSyncNote = document.getElementById('cloud-sync-note');

  // ── Cloud Sync (Supabase) ──────────────────────────────────────────────────

  const supabaseConfigured = typeof BODYCI_CONFIG !== 'undefined' &&
    BODYCI_CONFIG.supabaseUrl && BODYCI_CONFIG.supabaseUrl !== '';
  const supabaseSdkLoaded = typeof window.supabase !== 'undefined';

  let sbClient = null;

  if (supabaseConfigured && supabaseSdkLoaded) {
    // Custom storage adapter backed by chrome.storage.local so the session
    // survives the options page being closed and reopened.
    const chromeStorageAdapter = {
      getItem:    (key) => new Promise(r => chrome.storage.local.get([key], res => r(res[key] ?? null))),
      setItem:    (key, value) => chrome.storage.local.set({ [key]: value }),
      removeItem: (key) => chrome.storage.local.remove([key])
    };

    sbClient = window.supabase.createClient(
      BODYCI_CONFIG.supabaseUrl,
      BODYCI_CONFIG.supabaseAnonKey,
      {
        auth: {
          storage: chromeStorageAdapter,
          flowType: 'pkce',
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: true
        }
      }
    );

    // Restore session badge from stored tokens
    const stored = await chrome.storage.local.get(['sb_access_token', 'sb_user_email']);
    if (stored.sb_access_token) {
      setCloudUI({ email: stored.sb_user_email });
    }
  } else if (!supabaseConfigured) {
    cloudStatusText.textContent = 'Add supabaseUrl & supabaseAnonKey to config.local.js';
    cloudAuthBtn.disabled = true;
  } else {
    cloudStatusText.textContent = 'Supabase library failed to load — check lib/supabase.js';
    cloudAuthBtn.disabled = true;
  }

  cloudAuthBtn.addEventListener('click', async () => {
    if (!sbClient) return;
    if (cloudAuthBtn.dataset.action === 'signout') {
      await cloudSignOut();
    } else {
      await cloudSignIn();
    }
  });

  async function cloudSignIn() {
    cloudAuthBtn.disabled = true;
    cloudAuthBtn.textContent = 'Opening…';
    cloudSyncNote.style.display = 'none';

    try {
      const { data, error } = await sbClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: chrome.identity.getRedirectURL(),
          skipBrowserRedirect: true
        }
      });
      if (error || !data?.url) throw error || new Error('No OAuth URL returned');

      chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true }, async (redirectUrl) => {
        if (chrome.runtime.lastError || !redirectUrl) {
          showCloudNote('Sign-in cancelled or failed. Try again.');
          resetCloudBtn();
          return;
        }

        // PKCE: Supabase returns ?code= in the redirect URL
        const code = new URL(redirectUrl).searchParams.get('code');
        if (!code) {
          showCloudNote('No auth code received. Check your Supabase redirect URL settings.');
          resetCloudBtn();
          return;
        }

        const { data: sd, error: se } = await sbClient.auth.exchangeCodeForSession(code);
        if (se || !sd?.session) {
          showCloudNote('Session exchange failed. Check your Supabase configuration.');
          resetCloudBtn();
          return;
        }

        await chrome.storage.local.set({
          sb_access_token: sd.session.access_token,
          sb_refresh_token: sd.session.refresh_token,
          sb_user_email:    sd.user?.email || ''
        });
        setCloudUI({ email: sd.user?.email });
      });
    } catch (e) {
      console.error('Bodyci: cloud sign-in error:', e);
      showCloudNote('Sign-in failed: ' + (e.message || e));
      resetCloudBtn();
    }
  }

  async function cloudSignOut() {
    await sbClient.auth.signOut().catch(() => {});
    await chrome.storage.local.remove(['sb_access_token', 'sb_refresh_token', 'sb_user_email']);
    setCloudUI(null);
  }

  function setCloudUI(user) {
    if (user?.email) {
      cloudStatusText.textContent = `Signed in as ${user.email}`;
      cloudStatusDot.className = 'cloud-status-dot signed-in';
      cloudAuthBtn.textContent = 'Sign out';
      cloudAuthBtn.dataset.action = 'signout';
    } else {
      cloudStatusText.textContent = 'Not signed in';
      cloudStatusDot.className = 'cloud-status-dot';
      cloudAuthBtn.textContent = 'Sign in with Google';
      cloudAuthBtn.dataset.action = 'signin';
    }
    cloudAuthBtn.disabled = false;
  }

  function resetCloudBtn() {
    cloudAuthBtn.textContent = 'Sign in with Google';
    cloudAuthBtn.disabled = false;
  }

  function showCloudNote(msg) {
    cloudSyncNote.textContent = msg;
    cloudSyncNote.style.display = 'block';
  }

  // ── End Cloud Sync ─────────────────────────────────────────────────────────

  // Load settings
  const settings = await PulseState.getSettings();

  // Populate form
  serverUrl.value = settings.serverUrl;
  displayMode.value = settings.displayMode;
  position.value = settings.position;
  size.value = settings.size;
  opacity.value = settings.opacity;
  opacityValue.textContent = `${Math.round(settings.opacity * 100)}%`;
  graphDuration.value = settings.graphDuration;
  graphMinBpm.value = settings.graphMinBpm ?? '';
  graphMaxBpm.value = settings.graphMaxBpm ?? '';
  enabled.checked = settings.enabled;
  alertThreshold.value = settings.alertThreshold;
  alertCooldown.value = settings.alertCooldown;
  alertMessage.value = settings.alertMessage;
  alertType.value = settings.alertType;
  voiceInputMode.value = settings.voiceInputMode || 'off';
  aiChatEnabled.checked = settings.aiChatEnabled;
  aiGeneratedMessage.checked = settings.aiGeneratedMessage;

  // Populate voice dropdown from VOICE_OPTIONS
  const elevenLabsReady = typeof BODYCI_CONFIG !== 'undefined' &&
    BODYCI_CONFIG.elevenLabsApiKey &&
    BODYCI_CONFIG.elevenLabsApiKey !== 'PASTE_KEY_HERE';

  for (const voice of VOICE_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = voice.id;
    opt.textContent = voice.name;
    if (voice.engine === 'elevenlabs' && !elevenLabsReady) {
      opt.disabled = true;
      opt.textContent += ' (API key required)';
    }
    voiceSelect.appendChild(opt);
  }

  // Select saved voice, falling back to standard if stored value is gone
  voiceSelect.value = settings.selectedVoice;
  if (!voiceSelect.value) voiceSelect.value = 'standard';

  voiceStatus.textContent = elevenLabsReady
    ? ''
    : 'Add your ElevenLabs API key to config.local.js to enable additional voices.';

  // Show/hide graph duration based on display mode
  updateGraphDurationVisibility();

  // Render site overrides
  renderSiteOverrides(settings.siteOverrides);

  // Bind status UI using shared helper
  PulseState.bindStatusUI({
    statusEl: connectionStatus,
    bpmEl: currentBpm,
    statusClass: 'status-badge'
  });

  // Event handlers
  serverUrl.addEventListener('change', () => saveSettings());
  displayMode.addEventListener('change', () => {
    updateGraphDurationVisibility();
    saveSettings();
  });
  position.addEventListener('change', () => saveSettings());
  size.addEventListener('change', () => saveSettings());
  opacity.addEventListener('input', () => {
    opacityValue.textContent = `${Math.round(opacity.value * 100)}%`;
  });
  opacity.addEventListener('change', () => saveSettings());
  graphDuration.addEventListener('change', () => saveSettings());
  graphMinBpm.addEventListener('change', () => saveSettings());
  graphMaxBpm.addEventListener('change', () => saveSettings());
  enabled.addEventListener('change', () => saveSettings());
  alertThreshold.addEventListener('change', () => saveSettings());
  alertCooldown.addEventListener('change', () => saveSettings());
  alertMessage.addEventListener('change', () => saveSettings());
  alertType.addEventListener('change', () => saveSettings());
  voiceSelect.addEventListener('change', () => saveSettings());
  voiceInputMode.addEventListener('change', () => saveSettings());
  aiChatEnabled.addEventListener('change', () => {
    // Turning off AI chat also turns off AI-generated messages
    if (!aiChatEnabled.checked) {
      aiGeneratedMessage.checked = false;
    }
    saveSettings();
  });
  aiGeneratedMessage.addEventListener('change', () => {
    // AI-generated messages requires AI chat — auto-enable it
    if (aiGeneratedMessage.checked && !aiChatEnabled.checked) {
      aiChatEnabled.checked = true;
    }
    saveSettings();
  });

  testAlertBtn.addEventListener('click', async () => {
    const type = alertType.value;
    const message = alertMessage.value.trim() || 'Relax';
    const voiceId = voiceSelect.value;
    const voice = VOICE_OPTIONS.find(v => v.id === voiceId) || VOICE_OPTIONS[0];
    const originalText = testAlertFeedback.textContent;

    testAlertBtn.disabled = true;

    if (type === 'audio' || type === 'both') {
      const spokenMessage = normalizeForTts(message);
      if (voice.engine === 'elevenlabs') {
        testAlertFeedback.textContent = `Requesting ${voice.name}…`;
        const success = await speakElevenLabs(spokenMessage, voice.id);
        if (success) {
          testAlertFeedback.textContent = `Speaking: "${message}" (${voice.name})`;
        } else {
          chrome.tts.stop();
          chrome.tts.speak(spokenMessage);
          testAlertFeedback.textContent = `ElevenLabs failed — using system voice`;
        }
      } else {
        chrome.tts.stop();
        chrome.tts.speak(spokenMessage);
        testAlertFeedback.textContent = `Speaking: "${message}"`;
      }
    } else {
      testAlertFeedback.textContent = 'Visual alerts appear in the overlay on web pages.';
    }

    setTimeout(() => {
      testAlertBtn.disabled = false;
      testAlertFeedback.textContent = originalText;
    }, 3000);
  });

  addSiteBtn.addEventListener('click', () => addSiteOverride());
  newSite.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addSiteOverride();
  });

  reconnectBtn.addEventListener('click', () => {
    PulseState.requestReconnect();
  });

  /**
   * Save settings to storage.
   */
  async function saveSettings() {
    const minVal = graphMinBpm.value.trim();
    const maxVal = graphMaxBpm.value.trim();
    const newSettings = {
      serverUrl: serverUrl.value,
      displayMode: displayMode.value,
      position: position.value,
      size: size.value,
      opacity: parseFloat(opacity.value),
      graphDuration: parseInt(graphDuration.value),
      graphMinBpm: minVal === '' ? null : parseInt(minVal),
      graphMaxBpm: maxVal === '' ? null : parseInt(maxVal),
      enabled: enabled.checked,
      alertThreshold: parseInt(alertThreshold.value) || 110,
      alertCooldown: parseInt(alertCooldown.value) || 60,
      alertMessage: alertMessage.value.trim() || 'Relax',
      alertType: alertType.value,
      selectedVoice: voiceSelect.value,
      voiceInputMode: voiceInputMode.value,
      aiChatEnabled: aiChatEnabled.checked,
      aiGeneratedMessage: aiGeneratedMessage.checked
    };

    await chrome.storage.sync.set(newSettings);
  }

  /**
   * Update graph settings visibility based on display mode.
   */
  function updateGraphDurationVisibility() {
    const isGraph = displayMode.value === 'graph';
    graphDurationGroup.style.display = isGraph ? 'block' : 'none';
    graphBpmRangeGroup.style.display = isGraph ? 'block' : 'none';
  }

  /**
   * Render site overrides list.
   */
  function renderSiteOverrides(overrides) {
    siteOverrides.innerHTML = '';

    const entries = Object.entries(overrides);
    if (entries.length === 0) {
      siteOverrides.innerHTML = '<li class="empty">No site overrides configured</li>';
      return;
    }

    for (const [site, state] of entries) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="site-name">${escapeHtml(site)}</span>
        <span class="site-state ${state ? 'enabled' : 'disabled'}">${state ? 'Enabled' : 'Disabled'}</span>
        <button class="remove-btn" data-site="${escapeHtml(site)}">&times;</button>
      `;
      siteOverrides.appendChild(li);
    }

    // Add remove handlers
    siteOverrides.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => removeSiteOverride(btn.dataset.site));
    });
  }

  /**
   * Add a site override.
   */
  async function addSiteOverride() {
    const site = newSite.value.trim().toLowerCase();
    if (!site) return;

    const state = newSiteState.value === 'true';
    const current = await chrome.storage.sync.get({ siteOverrides: {} });
    current.siteOverrides[site] = state;

    await chrome.storage.sync.set({ siteOverrides: current.siteOverrides });
    renderSiteOverrides(current.siteOverrides);

    newSite.value = '';
  }

  /**
   * Remove a site override.
   */
  async function removeSiteOverride(site) {
    const current = await chrome.storage.sync.get({ siteOverrides: {} });
    delete current.siteOverrides[site];

    await chrome.storage.sync.set({ siteOverrides: current.siteOverrides });
    renderSiteOverrides(current.siteOverrides);
  }

  /**
   * Escape HTML to prevent XSS.
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
