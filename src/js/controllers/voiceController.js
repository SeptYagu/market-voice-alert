import { decideVoiceSchedule } from '../services/voiceSchedule.js';
import { formatQuoteSpeech, formatQuoteSpeechDelta, buildQuoteSpeechSegments } from '../tts.js';
import { getBeijingClockParts, getBeijingDate } from '../time.js';

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
  // Legacy adapters cannot report playback completion. They must opt in explicitly;
  // defaulting to "wait for confirmation" keeps the dedup baseline honest.
  const seedsMemoryWithoutPlayback = speech.syncMemory === true;

  function stopTimer() {
    if (worker) { const old = worker; worker = null; old.onmessage = null; old.onerror = null; try { old.terminate(); } catch { /* already stopped */ } }
    if (timer !== null) timers.clearInterval(timer);
    timer = null;
    runningInterval = null;
  }

  function speakCodes(codes, { manual = false, full = false } = {}) {
    if (!speech.supported()) return;
    const settings = getSettings();
    // "Same quote is not repeated" is the default and can be switched off from the
    // voice bar. `full` is the one-off path (manual test broadcast, closing snapshot):
    // it always announces the selected fields, even when nothing changed.
    const parts = getBeijingClockParts(clock());
    const min = parts.hour * 60 + parts.minute;
    // 09:20 - 09:25 开盘集合竞价不可撤单博弈期，强制按间隔全量播报（不受 skipUnchanged 约束）
    const isAuctionGuaranteedWindow = min >= 9 * 60 + 20 && min < 9 * 60 + 25;
    const dedupe = !manual && !full && !isAuctionGuaranteedWindow && settings.skipUnchanged !== false;
    for (const code of codes) {
      const quote = getQuotes().get(code);
      if (!quote) continue;
      // The full formatter is required when dedup is off: the delta variant needs a
      // changed price/percent and would stay silent for a name-only field selection.
      let result;
      if (dedupe) {
        result = formatQuoteSpeechDelta(quote, memory.get(code), settings.fields, settings.fieldsOrder);
      } else {
        const canSeedBaseline = !full && settings.skipUnchanged !== false;
        const spokenSegments = canSeedBaseline ? buildQuoteSpeechSegments(quote) : null;
        result = {
          text: formatQuoteSpeech(quote, settings.fields, settings.fieldsOrder),
          spoken: spokenSegments ? { price: spokenSegments.price, percent: spokenSegments.percent } : null
        };
      }
      if (!result.text) continue;
      // The dedup baseline may only advance once the listener actually heard the
      // announcement: a queued item that is coalesced away, expires, times out or
      // is cancelled never reports 'end', and must not be remembered as spoken.
      const onSpoken = (reason) => {
        if (reason === 'end' && result.spoken) {
          memory.set(code, { ...memory.get(code), ...result.spoken });
        }
      };
      speech.speak(result.text, { volume: volume(), code, onSpoken });
      if (seedsMemoryWithoutPlayback && result.spoken) {
        memory.set(code, { ...memory.get(code), ...result.spoken });
      }
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
    if (d.transitionNotice && speech.supported()) {
      speech.speak(d.transitionNotice, { volume: volume() });
      // One last round of the fields the user selected, right after the pause notice.
      // Only the selected fields are spoken (no forced name), and it is not fed into
      // the dedup memory: the session is over and the next start clears it anyway.
      if (d.finalCodes && d.finalCodes.length) speakCodes(d.finalCodes, { full: true });
    }
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

  // Drops the remembered baselines: the dedup memory is only meaningful for the
  // exact field selection / dedup mode it was recorded under.
  function resetMemory() { memory.clear(); }

  return { start, stop, startTimer, stopTimer, applySchedule, setEnabled, speakSubscribed,
    speakManual: code => speakCodes([code], { manual: true }), prune,
    resetFields: resetMemory, resetMemory,
    inspect: () => ({ memory: new Map(memory), timerCount: Number(runningInterval !== null) + Number(checker !== null) }) };
}
