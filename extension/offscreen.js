/**
 * Offscreen document — runs in a real browser context with autoplay permission.
 * Receives ElevenLabs TTS requests from the background, fetches audio, and plays it.
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== '_offscreenPlay') return;

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
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    audio.play().catch(reject);
  });

  return true;
}
