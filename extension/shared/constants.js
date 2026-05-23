/**
 * Shared constants for PulseOverlay extension.
 */

const PULSE_DEFAULTS = {
  enabled: true,
  serverUrl: 'ws://localhost:8765',
  displayMode: 'standard',
  position: 'bottom-right',
  opacity: 0.9,
  size: 'medium',
  graphDuration: 60,
  graphMinBpm: null,
  graphMaxBpm: null,
  siteOverrides: {},
  alertThreshold: 110,
  alertCooldown: 60,
  alertMessage: 'Relax',
  alertType: 'visual',
  selectedVoice: 'standard'
};

// Add new voices here - they appear in the options dropdown automatically.
const VOICE_OPTIONS = [
  { id: 'standard',              name: 'Standard (system voice)', engine: 'chrome' },
  { id: 'weA4Q36twV5kwSaTEL0Q', name: 'EVA',                    engine: 'elevenlabs' },
  { id: 'O7v0YDbhx8g0if0HbxDL', name: 'My Voice',               engine: 'elevenlabs' },
  { id: 'mDKMl9qFtrIxpyzVKiz3', name: 'announcer',               engine: 'elevenlabs' }
];

const PULSE_STATE_LABELS = {
  scanning: 'Scanning...',
  connected: 'Connected',
  connecting: 'Connecting...',
  disconnected: 'Disconnected'
};

// Export for different contexts
if (typeof window !== 'undefined') {
  window.PULSE_DEFAULTS = PULSE_DEFAULTS;
  window.VOICE_OPTIONS = VOICE_OPTIONS;
  window.PULSE_STATE_LABELS = PULSE_STATE_LABELS;
}
