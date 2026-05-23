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
  const voiceQuality = document.getElementById('voice-quality');
  const voiceQualityStatus = document.getElementById('voice-quality-status');

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
  voiceQuality.value = settings.voiceQuality;

  // Enable/disable Premium based on whether a real API key is present
  const elevenLabsReady = typeof BODYCI_CONFIG !== 'undefined' &&
    BODYCI_CONFIG.elevenLabsApiKey &&
    BODYCI_CONFIG.elevenLabsApiKey !== 'PASTE_KEY_HERE';

  if (!elevenLabsReady) {
    voiceQuality.querySelector('option[value="premium"]').disabled = true;
    if (voiceQuality.value === 'premium') voiceQuality.value = 'standard';
    voiceQualityStatus.textContent = 'Add your ElevenLabs API key to config.local.js to enable Premium voice.';
  } else {
    voiceQualityStatus.textContent = 'Premium uses ElevenLabs neural TTS for natural-sounding speech.';
  }

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
  voiceQuality.addEventListener('change', () => saveSettings());

  testAlertBtn.addEventListener('click', async () => {
    const type = alertType.value;
    const quality = voiceQuality.value;
    const message = alertMessage.value.trim() || 'Relax';
    const originalText = testAlertFeedback.textContent;

    testAlertBtn.disabled = true;

    if (type === 'audio' || type === 'both') {
      if (quality === 'premium') {
        testAlertFeedback.textContent = `Requesting ElevenLabs…`;
        const success = await speakElevenLabs(message);
        if (success) {
          testAlertFeedback.textContent = `Speaking: "${message}" (ElevenLabs)`;
        } else {
          chrome.tts.stop();
          chrome.tts.speak(message);
          testAlertFeedback.textContent = `ElevenLabs failed — using system voice`;
        }
      } else {
        chrome.tts.stop();
        chrome.tts.speak(message);
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
      voiceQuality: voiceQuality.value
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
