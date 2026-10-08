"use client";

import { useRef, useState } from "react";
import type { useSettings } from "@/contexts/settings-context";
import { normalizeSetting, type WritableSettingKey } from "@/lib/settings-schema";
import {
  DEFAULT_LANGUAGE_POLICY,
  LANGUAGE_POLICY_SETTING_KEY,
  readLanguagePolicy,
  serializeLanguagePolicy,
  type LanguagePolicy,
} from "@/lib/language-policy";

/** A confirmed card write clears only its unchanged submitted fields. */
export function clearSubmittedFields(
  previous: Record<string, string>,
  submitted: Record<string, string>
): Record<string, string> {
  const remaining = { ...previous };
  for (const [key, value] of Object.entries(submitted)) {
    if (remaining[key] === value) delete remaining[key];
  }
  return remaining;
}

/** Draft state only; server validation and confirmed persistence remain in SettingsContext. */
export function useSettingsForm({
  settings,
  updateSettings,
}: Pick<ReturnType<typeof useSettings>, "settings" | "updateSettings">) {
  const [isSaving, setIsSaving] = useState(false);
  const saving = useRef(false);
  const [saveFeedback, setSaveFeedback] = useState<{ error: boolean; message: string } | null>(
    null
  );
  // Local form state
  const [formState, setFormState] = useState<Record<string, string>>({});

  const getFieldValue = (key: string) => {
    return formState[key] ?? settings?.[key] ?? "";
  };

  const setFieldValue = (key: string, value: string) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const formError = (keys: readonly WritableSettingKey[]) =>
    keys.some((key) => normalizeSetting(key, getFieldValue(key)) === null);
  const integrationFormError = (app: "sonarr" | "radarr") => {
    const urlKey = `integration.${app}.url` as WritableSettingKey;
    const enabledKey = `integration.${app}.enabled` as WritableSettingKey;
    const sizeKey =
      app === "sonarr" ? "integration.sonarr.windowDays" : "integration.radarr.inventoryMaxMiB";
    if (formError([enabledKey, urlKey, sizeKey]))
      return "Ungültige Eingabe: Grenzen und HTTP(S)-URL ohne Zugangsdaten, Query oder Fragment prüfen.";
    if (getFieldValue(enabledKey) === "true" && !getFieldValue(urlKey).trim())
      return "Zum Aktivieren eine Basis-URL eingeben.";
    return null;
  };
  const sonarrFormError = integrationFormError("sonarr");
  const radarrFormError = integrationFormError("radarr");

  const getLanguagePolicy = () =>
    readLanguagePolicy(getFieldValue(LANGUAGE_POLICY_SETTING_KEY) || DEFAULT_LANGUAGE_POLICY);

  const setLanguagePreference = (key: Exclude<keyof LanguagePolicy, "version">, value: boolean) => {
    const current = getLanguagePolicy();
    setFieldValue(
      LANGUAGE_POLICY_SETTING_KEY,
      serializeLanguagePolicy({ ...current, [key]: value })
    );
  };

  const handleSave = async (keys: string[]) => {
    // Keep the focused button mounted/enabled while rejecting repeated activation.
    // State alone is too late for two activations in the same render turn.
    if (saving.current) return;
    saving.current = true;
    setIsSaving(true);
    setSaveFeedback(null);
    try {
      const updates: Record<string, string> = {};
      for (const key of keys) {
        if (formState[key] !== undefined) {
          updates[key] = formState[key];
        }
      }
      if (Object.keys(updates).length > 0) {
        await updateSettings(updates);
        // Saving one card must not discard unsaved changes in another card.
        setFormState((previous) => clearSubmittedFields(previous, updates));
      }
      setSaveFeedback({
        error: false,
        message: Object.keys(updates).length
          ? "Einstellungen gespeichert."
          : "Keine Änderungen zum Speichern.",
      });
    } catch {
      setSaveFeedback({
        error: true,
        message:
          "Speichern nicht bestätigt. Gespeicherten Stand neu laden, bevor du erneut speicherst. Eingaben bleiben zur Korrektur erhalten.",
      });
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };

  return {
    formState,
    getFieldValue,
    setFieldValue,
    formError,
    sonarrFormError,
    radarrFormError,
    getLanguagePolicy,
    setLanguagePreference,
    handleSave,
    isSaving,
    saveFeedback,
  };
}
