import { clearTokenCache as clearSrfTokenCache } from "@/services/srgssr-api";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { writesEnabled } from "@/lib/write-gate";
import { CredentialConfigurationError } from "@/lib/credential-settings";
import {
  DEFAULT_PRODUCT_SETTINGS,
  normalizeSetting,
  invalidSettingKeys,
  isWritableSettingKey,
} from "@/lib/settings-schema";
import { clearSettingsCache, getSetting } from "@/lib/settings";
import { clearTTLCache, clearMetadataCaches, mediathekCache, rulesetsCache } from "@/lib/cache";
import {
  CREDENTIAL_ENV,
  isCredentialSettingKey,
  isMaskedSetting,
  maskSetting,
} from "@/lib/settings-redaction";

// Default settings
const DEFAULT_SETTINGS: Record<string, string> = {
  ...DEFAULT_PRODUCT_SETTINGS,
  ...Object.fromEntries(Object.keys(CREDENTIAL_ENV).map((key) => [key, ""])),
};

function isHiddenSettingKey(key: string): boolean {
  return key === "tvdb_token" || key === "tvdb_token_expiry";
}

function visibleSetting(key: string, value: string): string {
  // Legacy malformed integration URLs may contain credentials. Keep the row
  // untouched, expose only its invalid-key status, never the unsafe URL.
  if (key === "integration.sonarr.url" || key === "integration.radarr.url") {
    return normalizeSetting(key, value) ?? "";
  }
  // A legacy TMDB v3 key is preserved in storage but cannot be used without
  // putting it in a query URL. Do not describe it as an active credential.
  if (key === "api.tmdb.key" && !value.startsWith("eyJ")) return "";
  return maskSetting(key, value);
}

function invalidateSettingConsumers(keys: string[]): void {
  clearSettingsCache();
  mediathekCache.clear();
  clearMetadataCaches();
  rulesetsCache.clear();
  clearSrfTokenCache();
  if (keys.some((key) => key.startsWith("cache."))) clearTTLCache();
}

function settingsHeaders(settings: Record<string, string>): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "X-Pingufunk-Invalid-Settings": invalidSettingKeys(settings).join(","),
  };
}

async function credentialPresence(key: string) {
  try {
    const value = (await getSetting(key)) ?? "";
    return { value: visibleSetting(key, value), status: value ? "present" : "missing" };
  } catch (error) {
    if (
      (key === "api.sonarr.key" || key === "api.radarr.key") &&
      error instanceof CredentialConfigurationError
    )
      return { value: "", status: "invalid" };
    throw error;
  }
}

// GET /api/settings - Fetch all settings or specific key
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  try {
    if (key) {
      if (isHiddenSettingKey(key)) {
        return NextResponse.json({ error: "Setting is not available" }, { status: 404 });
      }
      // Fetch single setting
      const config = await prisma.config.findUnique({
        where: { key },
      });
      let value: string | null = config?.value ?? DEFAULT_SETTINGS[key] ?? null;
      const credential = isCredentialSettingKey(key) ? await credentialPresence(key) : null;
      if (credential) value = credential.value;
      return NextResponse.json(
        {
          key,
          value:
            value === null
              ? null
              : credential
                ? credential.value
                : visibleSetting(key, normalizeSetting(key, value) ?? value),
        },
        {
          headers: {
            ...settingsHeaders(value === null ? {} : { [key]: value }),
            ...(credential && ["api.sonarr.key", "api.radarr.key"].includes(key)
              ? { "X-Pingufunk-Arr-Credentials": `${key.split(".")[1]}=${credential.status}` }
              : {}),
          },
        }
      );
    }

    // Fetch all settings
    const configs = await prisma.config.findMany();
    const settings: Record<string, string> = { ...DEFAULT_SETTINGS };

    for (const config of configs) {
      if (isHiddenSettingKey(config.key)) continue;
      settings[config.key] = config.value;
    }
    const arrCredentials: string[] = [];
    for (const key of Object.keys(CREDENTIAL_ENV)) {
      const credential = await credentialPresence(key);
      settings[key] = credential.value;
      if (["api.sonarr.key", "api.radarr.key"].includes(key))
        arrCredentials.push(`${key.split(".")[1]}=${credential.status}`);
    }
    return NextResponse.json(
      Object.fromEntries(
        Object.entries(settings).map(([key, value]) => [
          key,
          isCredentialSettingKey(key)
            ? value
            : visibleSetting(key, normalizeSetting(key, value) ?? value),
        ])
      ),
      {
        headers: {
          ...settingsHeaders(settings),
          "X-Pingufunk-Arr-Credentials": arrCredentials.join(","),
        },
      }
    );
  } catch {
    console.error("Failed to fetch settings");
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

// POST /api/settings - Update settings
export async function POST(request: NextRequest) {
  if (!writesEnabled()) {
    return NextResponse.json({ error: "Maintenance: writes disabled" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const single = Object.hasOwn(input, "key");
  if (
    single &&
    (typeof input.key !== "string" ||
      !input.key ||
      !Object.hasOwn(input, "value") ||
      Object.keys(input).some((key) => !["key", "value"].includes(key)))
  ) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const submitted = single ? [[input.key as string, input.value] as const] : Object.entries(input);
  const entries: [string, string][] = [];
  for (const [key, value] of submitted) {
    if (isHiddenSettingKey(key)) {
      return NextResponse.json({ error: "Setting is not available" }, { status: 404 });
    }
    // Legacy masked bulk readback is a no-op, never a credential update.
    if (isMaskedSetting(key, value) || (!single && isCredentialSettingKey(key) && value === ""))
      continue;
    if (isCredentialSettingKey(key)) {
      return NextResponse.json({ error: "Configure credentials outside the UI" }, { status: 400 });
    }
    const normalized = normalizeSetting(key, value);
    if (normalized === undefined || normalized === null) {
      return NextResponse.json({ error: "Invalid or unknown setting" }, { status: 400 });
    }
    entries.push([key, normalized]);
  }
  const changedKeys = entries.map(([key]) => key);
  try {
    // Sequential statements in one transaction: a later failure cannot leave a
    // partially persisted policy. Return the actual rows, not submitted inputs.
    const confirmed = entries.length
      ? await prisma.$transaction(async (tx) => {
          const rows: [string, string][] = [];
          for (const [key, value] of entries) {
            const row = await tx.config.upsert({
              where: { key },
              update: { value },
              create: { key, value },
              select: { key: true, value: true },
            });
            if (row.key !== key || normalizeSetting(row.key, row.value) !== row.value)
              throw new Error("Invalid persisted setting");
            rows.push([row.key, row.value]);
          }
          return Object.fromEntries(rows);
        })
      : {};
    if (changedKeys.length) invalidateSettingConsumers(changedKeys);
    return NextResponse.json(
      {
        success: true,
        updated: changedKeys.length,
        ...(single ? { key: input.key } : {}),
        settings: confirmed,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    // A lost commit acknowledgement is not a proven rollback. Invalidate even
    // on uncertainty and require readback; never silently retry a settings write.
    invalidateSettingConsumers(changedKeys);
    console.error("Settings commit unconfirmed");
    return NextResponse.json(
      { error: "Settings commit unconfirmed; refresh before retrying", committed: "unknown" },
      { status: 500 }
    );
  }
}

// DELETE /api/settings - Delete a setting (reset to default)
export async function DELETE(request: NextRequest) {
  if (!writesEnabled()) {
    return NextResponse.json({ error: "Maintenance: writes disabled" }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (!key) {
    return NextResponse.json({ error: "Key parameter required" }, { status: 400 });
  }
  if (isCredentialSettingKey(key) || isHiddenSettingKey(key)) {
    return NextResponse.json({ error: "Configure credentials outside the UI" }, { status: 400 });
  }

  if (!isWritableSettingKey(key)) {
    return NextResponse.json({ error: "Unknown setting is read-only" }, { status: 400 });
  }
  try {
    await prisma.config.delete({
      where: { key },
    });
    invalidateSettingConsumers([key]);
    return NextResponse.json({ success: true, key });
  } catch (error) {
    // Only an absent key is an idempotent success; DB failure is not a reset.
    if (error instanceof Error && "code" in error && error.code === "P2025") {
      invalidateSettingConsumers([key]);
      return NextResponse.json({ success: true, key });
    }
    console.error("Failed to reset setting");
    return NextResponse.json({ error: "Failed to reset setting" }, { status: 500 });
  }
}
