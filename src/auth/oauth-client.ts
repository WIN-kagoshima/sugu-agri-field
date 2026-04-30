import { AuthError, UpstreamError } from "../lib/errors.js";

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** Override fetch — used in tests with MSW. */
  fetchImpl?: typeof fetch;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * Minimal OAuth 2.1 Client Credentials helper. Production deployments
 * would substitute a richer library (e.g. `openid-client`); this one is
 * intentionally tiny so the demo provider in `src/server/mock-oauth.ts`
 * stays understandable end-to-end.
 */
export class OAuthClient {
  private readonly config: OAuthClientConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OAuthClientConfig) {
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  buildAuthorizeUrl(opts: { state: string; redirectUri: string; scope?: string }): string {
    const url = new URL(this.config.authorizeUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", opts.redirectUri);
    url.searchParams.set("state", opts.state);
    if (opts.scope) url.searchParams.set("scope", opts.scope);
    return url.toString();
  }

  async exchangeCode(opts: {
    code: string;
    redirectUri: string;
  }): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: body.toString(),
      });
    } catch (err) {
      throw new UpstreamError("oauth", "token exchange failed", {
        cause: (err as Error).message,
      });
    }
    if (response.status === 401 || response.status === 403) {
      throw new AuthError("OAuth token exchange rejected.");
    }
    if (!response.ok) {
      throw new UpstreamError("oauth", `token exchange returned ${response.status}`);
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new UpstreamError("oauth", "token endpoint returned non-JSON");
    }
    if (
      typeof json !== "object" ||
      json === null ||
      typeof (json as { access_token?: unknown }).access_token !== "string"
    ) {
      throw new UpstreamError("oauth", "token response missing access_token");
    }
    return json as OAuthTokenResponse;
  }
}
