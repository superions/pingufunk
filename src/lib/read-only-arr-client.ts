import { externalCredential, CredentialConfigurationError } from "./credential-settings";
import { fetchWithRetry, type RetryOptions } from "./fetch-retry";

export class ArrRequestError extends Error {
  constructor() {
    super("Metadata request failed");
  }
}

/** Keep reverse-proxy subpaths; never accept userinfo, a query, or redirects. */
export function arrApiUrl(baseUrl: string, route: string, query?: URLSearchParams): string {
  try {
    const base = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !/^[a-zA-Z0-9/_-]+$/.test(route) ||
      route.includes("//")
    ) {
      throw new ArrRequestError();
    }
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/${route.replace(/^\/+/, "")}`;
    if (query) {
      if ([...query.keys()].some((key) => /^(api_?key|token|secret)$/i.test(key))) {
        throw new ArrRequestError();
      }
      base.search = query.toString();
    }
    return base.toString();
  } catch {
    throw new ArrRequestError();
  }
}

/** The Sonarr key has broad rights; this adapter intentionally exposes GET only. */
export async function fetchReadOnlyArr(
  baseUrl: string,
  route: string,
  credentialEnvName: string,
  query?: URLSearchParams,
  budget?: RetryOptions
): Promise<Response> {
  const credential = await externalCredential(credentialEnvName);
  if (!credential.configured || !credential.value) throw new CredentialConfigurationError();
  const url = arrApiUrl(baseUrl, route, query);
  try {
    const response = await fetchWithRetry(
      url,
      { method: "GET", headers: { "X-Api-Key": credential.value } },
      budget
    );
    if (!response.ok) throw new ArrRequestError();
    return response;
  } catch {
    throw new ArrRequestError();
  }
}
