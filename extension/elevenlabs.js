/**
 * ElevenLabs TTS helper.
 * Loaded in both content scripts and the options page.
 * Routes playback through background → offscreen document to bypass
 * the autoplay restriction that blocks direct Audio.play() in content scripts.
 */

async function speakElevenLabs(text, voiceId) {
  const config = typeof BODYCI_CONFIG !== 'undefined' ? BODYCI_CONFIG : null;
  if (!config || !config.elevenLabsApiKey || config.elevenLabsApiKey === 'PASTE_KEY_HERE') {
    return false;
  }
  if (!voiceId || voiceId === 'PASTE_MY_CLONE_ID') {
    return false;
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'elevenLabsSpeak', text, voiceId }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('Bodyci: ElevenLabs message error:', chrome.runtime.lastError.message);
        resolve(false);
        return;
      }
      resolve(response != null && response.success === true);
    });
  });
}
