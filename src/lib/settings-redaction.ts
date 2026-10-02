export const CREDENTIAL_ENV: Record<string, string> = {
  "api.tvdb.key": "PINGUFUNK_TVDB_KEY",
  "api.tvdb.pin": "PINGUFUNK_TVDB_PIN",
  "api.tmdb.key": "PINGUFUNK_TMDB_READ_TOKEN",
  "api.sonarr.key": "PINGUFUNK_SONARR_API_KEY",
  "api.radarr.key": "PINGUFUNK_RADARR_API_KEY",
  "api.srgssr.consumerKey": "PINGUFUNK_SRGSSR_CONSUMER_KEY",
  "api.srgssr.consumerSecret": "PINGUFUNK_SRGSSR_CONSUMER_SECRET",
  "download.proxyUrl": "PINGUFUNK_STREAMING_PROXY_URL",
};

const MASKED_CREDENTIAL = "••••••••";

export function isCredentialSettingKey(key: string): boolean {
  return Object.hasOwn(CREDENTIAL_ENV, key);
}

export function maskSetting(key: string, value: string): string {
  return isCredentialSettingKey(key) && value ? MASKED_CREDENTIAL : value;
}

export function isMaskedSetting(key: string, value: unknown): boolean {
  return isCredentialSettingKey(key) && value === MASKED_CREDENTIAL;
}
