import { decideVoiceSchedule } from '../services/voiceSchedule.js';
import { formatQuoteSpeechDelta } from '../tts.js';
import { getBeijingDate } from '../time.js';

export function createVoiceController({ getSettings, saveSettings, getCodes, getQuotes,
  getTradingDates, speech, clock = () => new Date(), onChange = () => {},
  timers = globalThis, createWorker = () => new Worker(new URL('../worker.js', import.meta.url), { type: 'module' }) }) {
  const memory = new Map();
  let worker = null;
  let timer = null;
  let checker = null;
  let previous = null;
  let runningInterval = null;
  let lifecycle = 0;
  const decision = () => decideVoiceSchedule({ codes: getCodes(), settings: getSettings(),
    now: clock(), tradingDates: getTradingDates(), previous });
  const volume = () => Math.max(0, Math.min(100, Number(getSettings().volume) || 0)) / 100;

  function stopTimer() {
    if (worker) { const old = worker; worker = null; old.onmessage = null; old.onerror = null; try { old.terminate(); } catch { /* already stopped */ } }
    if (timer !== null) timers.clearInterval(timer);
    timer = null;
    runningInterval = null;
  }

  function speakCodes(codes, { manual = false } = {}) {
    if (!speech.supported()) return;
    const settings = getSettings();
    for (const code of codes) {
      const quote = getQuotes().get(code);
      if (!quote) continue;
      const result = formatQuoteSpeechDelta(quote, manual ? null : memory.get(code), settings.fields, settings.fieldsOrder);
      if (!result.text) continue;
      speech.speak(result.text, { volume: volume(), code });
      if (result.spoken) memory.set(code, { ...memory.get(code), ...result.spoken });
    }
  }

  function speakSubscribed() {
    if (!getSettings().enabled) return;
    speakCodes(decision().eligibleCodes);
  }

  function startTimer() {
    stopTimer();
    memory.clear();
    const d = decision();
    if (!d.timerShouldRun) return;
    runningInterval = getSettings().interval;
    try {
      const owner = createWorker();
      worker = owner;
      owner.onmessage = event => { if (worker === owner && event.data?.type === 'tick') speakSubscribed(); };
      owner.onerror = () => {
        if (worker !== owner) return;
        stopTimer();
        if (decision().timerShouldRun) {
          runningInterval = getSettings().interval;
          timer = timers.setInterval(speakSubscribed, runningInterval);
        }
      };
      owner.postMessage({ type: 'start', interval: runningInterval });
    } catch {
      stopTimer();
      runningInterval = getSettings().interval;
      timer = timers.setInterval(speakSubscribed, runningInterval);
    }
  }

  function applySchedule() {
    const d = decision();
    const settingsChanged = d.enabled !== getSettings().enabled;
    if (settingsChanged) saveSettings({ enabled: d.enabled });
    if (!d.timerShouldRun) {
      const wasRunning = runningInterval !== null;
      stopTimer();
      if (wasRunning) speech.cancel();
    } else if (runningInterval !== getSettings().interval) startTimer();
    if (d.transitionNotice && speech.supported()) speech.speak(d.transitionNotice, { volume: volume() });
    previous = d;
    onChange({ paused: d.enabled && !d.timerShouldRun, decision: d, settingsChanged });
    return d;
  }

  function setEnabled(enabled) {
    saveSettings({ enabled: !!enabled, manualDisabledDate: enabled ? null : getBeijingDate(clock()) });
    previous = null;
    stopTimer();
    if (!enabled) speech.cancel();
    applySchedule();
    if (enabled) speakSubscribed();
  }

  function start(warmCalendar = () => Promise.resolve()) {
    stop();
    const owner = lifecycle;
    applySchedule();
    Promise.resolve().then(warmCalendar).catch(() => {}).finally(() => { if (owner === lifecycle) applySchedule(); });
    checker = timers.setInterval(applySchedule, 30000);
  }

  function stop() {
    lifecycle++;
    stopTimer();
    if (checker !== null) timers.clearInterval(checker);
    checker = null;
    previous = null;
    memory.clear();
    speech.cancel();
  }

  function prune() {
    const codes = new Set(getCodes());
    for (const code of memory.keys()) if (!codes.has(code)) memory.delete(code);
  }

  return { start, stop, startTimer, stopTimer, applySchedule, setEnabled, speakSubscribed,
    speakManual: code => speakCodes([code], { manual: true }), prune,
    resetFields: () => memory.clear(),
    inspect: () => ({ memory: new Map(memory), timerCount: Number(runningInterval !== null) + Number(checker !== null) }) };
}
