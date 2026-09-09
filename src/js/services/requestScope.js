// Tokens remain valid after resolution until superseded or cancelled. This also
// protects already-resolved continuations that an AbortSignal cannot recall.
export function createRequestScope() {
  let current = null;
  function cancel() {
    const old = current;
    current = null;
    old?.controller.abort();
  }
  function begin() {
    cancel();
    const controller = new AbortController();
    const token = { controller, signal: controller.signal };
    current = token;
    return token;
  }
  return { begin, cancel, isCurrent: token => current === token && !token.signal.aborted };
}
