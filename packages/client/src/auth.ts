import type { Session, AuthUser } from "./types";

async function postJson(url: string, body: unknown, token?: string): Promise<unknown> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url} → ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

/**
 * The auth namespace — a thin, predictable wrapper over the project's GoTrue.
 * Safe to use in the browser: it only ever exchanges credentials for tokens.
 */
export class AuthClient {
  constructor(private readonly baseUrl: string) {}

  signUp(creds: { email: string; password: string }): Promise<Session> {
    return postJson(`${this.baseUrl}/signup`, creds) as Promise<Session>;
  }

  signInWithPassword(creds: { email: string; password: string }): Promise<Session> {
    return postJson(`${this.baseUrl}/token?grant_type=password`, creds) as Promise<Session>;
  }

  async getUser(accessToken: string): Promise<AuthUser> {
    const r = await fetch(`${this.baseUrl}/user`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) throw new Error(`getUser → ${r.status}: ${await r.text()}`);
    return r.json() as Promise<AuthUser>;
  }

  async signOut(accessToken: string): Promise<void> {
    await postJson(`${this.baseUrl}/logout`, {}, accessToken);
  }
}
