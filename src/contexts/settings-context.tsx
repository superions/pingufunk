"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { confirmedSettings } from "@/lib/settings-confirmation";
import { invalidSettingKeys, isWritableSettingKey } from "@/lib/settings-schema";
import { SettingsResponseOrder } from "@/lib/settings-response-order";

interface Settings {
  // General
  "download.path": string;
  "download.quality": string;
  "download.convertToMkv": string;

  // API Keys
  "api.tvdb.key": string;
  "api.tvdb.pin": string;
  "api.tmdb.key": string;

  // Matching
  "matching.strategy": string;
  "matching.threshold": string;
  "matching.minDuration": string;
  "matching.languagePolicy": string;

  // Cache
  "cache.ttl.search": string;
  "cache.ttl.metadata": string;

  // System
  "system.setupComplete": string;

  [key: string]: string;
}

interface SettingsContextType {
  settings: Settings | null;
  isLoading: boolean;
  error: string | null;
  invalidKeys: string[];
  arrCredentials: Record<"sonarr" | "radarr", "present" | "missing" | "invalid" | "unknown">;
  updateSetting: (key: string, value: string) => Promise<void>;
  updateSettings: (updates: Partial<Settings>) => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storedInvalidKeys, setStoredInvalidKeys] = useState<string[]>([]);
  const [arrCredentials, setArrCredentials] = useState<SettingsContextType["arrCredentials"]>({
    sonarr: "unknown",
    radarr: "unknown",
  });
  const responseOrder = useRef(new SettingsResponseOrder());

  const fetchSettings = useCallback(async () => {
    const epoch = responseOrder.current.beginRead();
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch settings");
      const data = await res.json();
      if (responseOrder.current.isCurrent(epoch)) {
        setSettings(data);
        setStoredInvalidKeys(
          (res.headers.get("X-Pingufunk-Invalid-Settings") ?? "")
            .split(",")
            .filter(isWritableSettingKey)
        );
        const states = Object.fromEntries(
          (res.headers.get("X-Pingufunk-Arr-Credentials") ?? "")
            .split(",")
            .map((row) => row.split("="))
        );
        const state = (app: "sonarr" | "radarr") =>
          ["present", "missing", "invalid"].includes(states[app])
            ? (states[app] as "present" | "missing" | "invalid")
            : "unknown";
        setArrCredentials({ sonarr: state("sonarr"), radarr: state("radarr") });
      }
    } catch (err) {
      if (responseOrder.current.isCurrent(epoch))
        setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (responseOrder.current.isCurrent(epoch)) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = useCallback((updates: Partial<Settings>): Promise<void> => {
    // Preserve response order, including successive writes of the same key.
    // A failed batch does not poison the queue and is never retried automatically.
    const submitted = { ...updates };
    return responseOrder.current.enqueueWrite(async () => {
      setIsLoading(false);
      try {
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(submitted),
        });
        if (!res.ok)
          throw new Error(
            "Speichern nicht bestätigt; Einstellungen neu laden, bevor du erneut speicherst"
          );
        const confirmed = confirmedSettings(await res.json(), submitted);
        setError(null);
        setSettings((prev) => (prev ? { ...prev, ...confirmed } : null));
        setStoredInvalidKeys((previous) =>
          previous.filter((key) => !Object.hasOwn(confirmed, key))
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        throw err;
      } finally {
        setIsLoading(false);
      }
    });
  }, []);

  const updateSetting = useCallback(
    (key: string, value: string) => updateSettings({ [key]: value }),
    [updateSettings]
  );

  return (
    <SettingsContext.Provider
      value={{
        settings,
        isLoading,
        error,
        arrCredentials,
        invalidKeys: [
          ...new Set([...storedInvalidKeys, ...(settings ? invalidSettingKeys(settings) : [])]),
        ],
        updateSetting,
        updateSettings,
        refreshSettings: fetchSettings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
