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
  const audio = new Audio(url);
  currentAudio = audio;

  // Revoke the blob URL and clear the reference when playback finishes naturally.
  // Use identity check so a subsequent _offscreenStop doesn't clear a newer audio's ref.
  audio.onended = () => {
    URL.revokeObjectURL(url);
    if (currentAudio === audio) currentAudio = null;
    // Notify background so the content script can re-enable the mic after AI finishes speaking.
    // Only fires on natural end — pause() (from _offscreenStop) does NOT trigger onended.
    chrome.runtime.sendMessage({ type: '_offscreenAudioEnded' }).catch(() => {});
  };
  audio.onerror = () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; };

  // Respond to the caller as soon as playback starts — NOT when it ends.
  // Waiting for onended keeps the message channel (and the MV3 service worker) alive
  // for the full audio duration, which can exceed Chrome's ~30s SW idle timeout.
  // When the SW is suspended mid-playback the channel breaks, speakElevenLabs() resolves
  // false, and the chrome.tts fallback fires incorrectly. Resolving here (~200ms after
  // fetch) keeps the channel lifetime under a second regardless of clip length.
  await audio.play(); // throws if autoplay is blocked (true failure → caller falls back)
  return true;        // audio plays on independently in the offscreen document
}
