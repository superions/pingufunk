import { clearTokenCache as clearSrfTokenCache } from "@/services/srgssr-api";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clearSettingsCache, getSetting } from "@/lib/settings";
import { clearTTLCache, mediathekCache, tvdbCache, rulesetsCache } from "@/lib/cache";
import { isTvdbCredentialSettingKey } from "@/lib/tvdb-auth";
import { clearTvdbTokenCache } from "@/services/tvdb";
import {
  CREDENTIAL_ENV,
  isCredentialSettingKey,
  isMaskedSetting,
  maskSetting,
} from "@/lib/settings-redaction";
import {
  decodeLanguagePolicy,
  LANGUAGE_POLICY_SETTING_KEY,
  serializeLanguagePolicy,
  DEFAULT_LANGUAGE_POLICY,
} from "@/lib/language-policy";

// Default settings
const DEFAULT_SETTINGS: Record<string, string> = {
  // General
  "download.path": "/downloads",
  "download.quality": "all",
  "download.convertToMkv": "true",

  // API Keys
  "api.tvdb.key": "",
  "api.tvdb.pin": "",
  "api.tmdb.key": "",

  // Matching
  "matching.strategy": "fuzzy",
  "matching.threshold": "0.7",
  "matching.minDuration": "300",
  [LANGUAGE_POLICY_SETTING_KEY]: serializeLanguagePolicy(DEFAULT_LANGUAGE_POLICY),

  // Cache
  "cache.ttl.search": "3600",
  "cache.ttl.metadata": "86400",

  // System
  "system.setupComplete": "false",
};

function isHiddenSettingKey(key: string): boolean {
  return key === "tvdb_token" || key === "tvdb_token_expiry";
}

function visibleSetting(key: string, value: string): string {
  // A legacy TMDB v3 key is preserved in storage but cannot be used without
  // putting it in a query URL. Do not describe it as an active credential.
  if (key === "api.tmdb.key" && !value.startsWith("eyJ")) return "";
  return maskSetting(key, value);
}

function invalidateSettingConsumers(keys: string[]): void {
  clearSettingsCache();
  mediathekCache.clear();
  tvdbCache.clear();
  rulesetsCache.clear();
  clearSrfTokenCache();
  if (keys.some((key) => key.startsWith("cache."))) clearTTLCache();
}

function validateSettingValue(key: string, value: unknown): string | null {
  if (key !== LANGUAGE_POLICY_SETTING_KEY) return String(value);
  if (typeof value !== "string") return null;

  const policy = decodeLanguagePolicy(value);
  return policy ? serializeLanguagePolicy(policy) : null;
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
      if (key === LANGUAGE_POLICY_SETTING_KEY && value !== null) {
        value = validateSettingValue(key, value) ?? DEFAULT_SETTINGS[key];
      }
      if (isCredentialSettingKey(key)) value = await getSetting(key);
      return NextResponse.json({
        key,
        value: value === null ? null : visibleSetting(key, value),
      });
    }

    // Fetch all settings
    const configs = await prisma.config.findMany();
    const settings: Record<string, string> = { ...DEFAULT_SETTINGS };

    for (const config of configs) {
      if (isHiddenSettingKey(config.key)) continue;
      settings[config.key] = visibleSetting(config.key, config.value);
    }
    for (const key of Object.keys(CREDENTIAL_ENV)) {
      settings[key] = visibleSetting(key, (await getSetting(key)) ?? "");
    }
    settings[LANGUAGE_POLICY_SETTING_KEY] =
      validateSettingValue(LANGUAGE_POLICY_SETTING_KEY, settings[LANGUAGE_POLICY_SETTING_KEY]) ??
      DEFAULT_SETTINGS[LANGUAGE_POLICY_SETTING_KEY];

    return NextResponse.json(settings);
  } catch {
    console.error("Failed to fetch settings");
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

// POST /api/settings - Update settings
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Handle single key-value pair
    if (body.key && body.value !== undefined) {
      const key = String(body.key);
      if (isHiddenSettingKey(key)) {
        return NextResponse.json({ error: "Setting is not available" }, { status: 404 });
      }
      if (isMaskedSetting(key, body.value)) {
        return NextResponse.json({ success: true, key });
      }
      if (isCredentialSettingKey(key)) {
        return NextResponse.json(
          { error: "Configure credentials outside the UI" },
          { status: 400 }
        );
      }
      const value = validateSettingValue(key, body.value);
      if (value === null) {
        return NextResponse.json({ error: "Invalid language policy" }, { status: 400 });
      }
      await prisma.config.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
      invalidateSettingConsumers([key]);
      if (isTvdbCredentialSettingKey(key)) {
        await clearTvdbTokenCache();
      }
      return NextResponse.json({ success: true, key });
    }

    // Handle multiple settings
    if (!body.key) {
      const entries: [string, string][] = [];
      for (const [key, value] of Object.entries(body)) {
        if (isHiddenSettingKey(key)) {
          return NextResponse.json({ error: "Setting is not available" }, { status: 404 });
        }
        if (isMaskedSetting(key, value)) continue;
        if (isCredentialSettingKey(key) && value === "") continue;
        if (isCredentialSettingKey(key)) {
          return NextResponse.json(
            { error: "Configure credentials outside the UI" },
            { status: 400 }
          );
        }
        const normalizedValue = validateSettingValue(key, value);
        if (normalizedValue === null) {
          return NextResponse.json({ error: "Invalid language policy" }, { status: 400 });
        }
        entries.push([key, normalizedValue]);
      }
      const changedKeys = entries.map(([key]) => key);
      const updates = entries.map(([key, value]) =>
        prisma.config.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        })
      );
      await Promise.all(updates);
      invalidateSettingConsumers(changedKeys);
      if (changedKeys.some(isTvdbCredentialSettingKey)) {
        await clearTvdbTokenCache();
      }
      return NextResponse.json({ success: true, updated: changedKeys.length });
    }

    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  } catch {
    console.error("Failed to update settings");
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}

// DELETE /api/settings - Delete a setting (reset to default)
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (!key) {
    return NextResponse.json({ error: "Key parameter required" }, { status: 400 });
  }
  if (isCredentialSettingKey(key) || isHiddenSettingKey(key)) {
    return NextResponse.json({ error: "Configure credentials outside the UI" }, { status: 400 });
  }

  try {
    await prisma.config.delete({
      where: { key },
    });
    invalidateSettingConsumers([key]);
    if (isTvdbCredentialSettingKey(key)) {
      await clearTvdbTokenCache();
    }
    return NextResponse.json({ success: true, key });
  } catch {
    // Key might not exist, which is fine
    invalidateSettingConsumers([key]);
    if (isTvdbCredentialSettingKey(key)) {
      await clearTvdbTokenCache();
    }
    return NextResponse.json({ success: true, key });
  }
}
