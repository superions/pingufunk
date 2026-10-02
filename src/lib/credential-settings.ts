import { open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { CREDENTIAL_ENV } from "./settings-redaction";

export class CredentialConfigurationError extends Error {
  constructor() {
    super("Credential configuration is invalid");
  }
}

/** External credentials override legacy DB settings; ambiguity fails closed. */
export async function credentialOverride(
  key: string
): Promise<{ configured: boolean; value: string | null }> {
  const name = CREDENTIAL_ENV[key];
  if (!name) return { configured: false, value: null };
  return externalCredential(name);
}

/** Read an env or mounted-file credential without ever exposing the source path. */
export async function externalCredential(
  name: string
): Promise<{ configured: boolean; value: string | null }> {
  const direct = process.env[name];
  const file = process.env[`${name}_FILE`];
  if (direct === undefined && file === undefined) return { configured: false, value: null };
  if (direct !== undefined && file !== undefined) throw new CredentialConfigurationError();
  try {
    if (file !== undefined) {
      if (!path.isAbsolute(file)) throw new CredentialConfigurationError();
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      let value: string;
      try {
        if (!(await handle.stat()).isFile()) throw new CredentialConfigurationError();
        value = (await handle.readFile("utf8")).trim();
      } finally {
        await handle.close();
      }
      if (!value) throw new CredentialConfigurationError();
      return { configured: true, value };
    }
    const value = direct!.trim();
    if (!value) throw new CredentialConfigurationError();
    return { configured: true, value };
  } catch {
    // Never include the secret, its path, or an underlying I/O error in logs.
    throw new CredentialConfigurationError();
  }
}
