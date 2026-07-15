export function createHeroCarousel({
  length,
  initialIndex = 0,
  reducedMotion = false,
  intervalMs = 5000,
  onIndexChange = () => {},
  onStateChange = () => {},
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
} = {}) {
  const itemCount = Number.isInteger(length) && length > 0 ? length : 0;
  const pauseReasons = new Set();
  const normalizeIndex = (value) => {
    if (!itemCount) return 0;
    const numericValue = Number(value);
    return Number.isFinite(numericValue)
      ? ((numericValue % itemCount) + itemCount) % itemCount
      : 0;
  };

  let index = normalizeIndex(initialIndex);
  let manualPaused = Boolean(reducedMotion);
  let timer = null;
  let destroyed = false;

  function getState() {
    return {
      index,
      length: itemCount,
      manualPaused,
      autoplaying: timer !== null,
      pauseReasons: [...pauseReasons],
    };
  }

  function emitState() {
    onStateChange(getState());
  }

  function stopTimer() {
    if (timer === null) return;
    clearIntervalFn(timer);
    timer = null;
  }

  function canAutoplay() {
    return !destroyed
      && itemCount > 1
      && !manualPaused
      && pauseReasons.size === 0;
  }

  function advanceFromTimer() {
    index = normalizeIndex(index + 1);
    onIndexChange(index);
    emitState();
  }

  function syncTimer({ restart = false } = {}) {
    if (!canAutoplay()) {
      stopTimer();
      emitState();
      return;
    }

    if (restart) stopTimer();
    if (timer === null) {
      timer = setIntervalFn(advanceFromTimer, intervalMs);
    }
    emitState();
  }

  function select(nextIndex) {
    if (destroyed || itemCount === 0) return;
    index = normalizeIndex(nextIndex);
    onIndexChange(index);
    syncTimer({ restart: true });
  }

  function toggleManualPause() {
    if (destroyed) return getState();
    manualPaused = !manualPaused;
    syncTimer();
    return getState();
  }

  function setPauseReason(reason, active) {
    if (destroyed || !reason) return;
    if (active) pauseReasons.add(reason);
    else pauseReasons.delete(reason);
    syncTimer();
  }

  function setReducedMotion(active) {
    if (destroyed) return;
    if (active) manualPaused = true;
    syncTimer();
  }

  function destroy() {
    destroyed = true;
    stopTimer();
    pauseReasons.clear();
  }

  onIndexChange(index);
  syncTimer();

  return {
    select,
    next: () => select(index + 1),
    previous: () => select(index - 1),
    toggleManualPause,
    setPauseReason,
    setReducedMotion,
    getState,
    destroy,
  };
}
