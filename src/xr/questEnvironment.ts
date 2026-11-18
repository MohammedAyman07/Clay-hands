/**
 * Pure helper: detects Meta Quest browser (OculusBrowser / Horizon OS) or an active WebXR session.
 */
export function isMetaQuestEnvironment(
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  inXRSession = false
): boolean {
  if (inXRSession) return true;
  return /OculusBrowser|Meta Quest|Quest\s*[234]|Quest Pro/i.test(userAgent);
}
