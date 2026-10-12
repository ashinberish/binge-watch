const trim = (url: string) => url.replace(/\/+$/, '')

/** Build-time configuration (see .env.example). */
export const env = {
  apiUrl: trim(import.meta.env.WXT_API_URL ?? 'http://localhost:8000'),
  webUrl: trim(import.meta.env.WXT_WEB_URL ?? 'http://localhost:5173'),
}
