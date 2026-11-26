/** The editor is the heaviest screen, so it ships as its own chunk.
    Call this early (e.g. on hover) to warm it up before it is needed. */
export function loadEditor() {
  return import('./EditorLayout');
}
