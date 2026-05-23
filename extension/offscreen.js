/**
 * Offscreen document — runs in a real browser context with autoplay permission.
 * Receives ElevenLabs TTS requests from the background, fetches audio, and plays it.
 */

let currentAudio = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === '_offscreenStop') {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type !== '_offscreenPlay') return;

  // Stop any currently-playing audio before starting new playback
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  playElevenLabs(message.text, message.voiceId)
    .then(success => sendResponse({ success }))
    .catch(() => sendResponse({ success: false }));

  return true; // keep channel open for async sendResponse
});

async function playElevenLabs(text, voiceId) {
  const key = BODYCI_CONFIG.elevenLabsApiKey;

  if (!key || key === 'PASTE_KEY_HERE') return false;
  if (!voiceId) return false;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5' })
    }
  );

  if (!response.ok) throw new Error(`ElevenLabs ${response.status}`);

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  await new Promise((resolve, reject) => {
    const audio = new Audio(url);
    currentAudio = audio;
    audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
    audio.onerror = (e) => { URL.revokeObjectURL(url); currentAudio = null; reject(e); };
    audio.play().catch(reject);
  });

  return true;
}
