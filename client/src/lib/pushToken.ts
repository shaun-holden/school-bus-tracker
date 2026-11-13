// This phone's push token for the current app session. Memory only: never
// written to browser storage or to logs.
let currentToken: string | null = null;

export function getPushToken(): string | null {
  return currentToken;
}

export function setPushToken(token: string): void {
  currentToken = token;
}

export function clearPushToken(): void {
  currentToken = null;
}

/** Body for POST /api/auth/logout: this phone's token, so the server turns off only this phone (T4a). */
export function logoutBody(token: string | null | undefined): { deviceToken?: string } {
  return token ? { deviceToken: token } : {};
}
