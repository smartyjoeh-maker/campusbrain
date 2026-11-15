import "server-only";

export function getAppBaseUrl(): string | null {
  const configured = process.env.APP_BASE_URL;
  const candidate = configured || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "");
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
