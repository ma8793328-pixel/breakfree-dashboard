const FLAGGED = /\b(kill\s*yourself|kys|suicide|self\s*harm|cut\s*my\s*self|fuck|shit|ass|bitch|cunt|dick|pussy|whore|slut|nigger|nigga|chink|spic|retard|rape)\b/i;

export function containsFlagged(text) {
  return FLAGGED.test(String(text || ''));
}

export function filterText(text) {
  return String(text || '').replace(FLAGGED, (match) => '*'.repeat(match.length));
}
