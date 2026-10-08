"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, Loader2 } from "lucide-react";
import {
  SETTING_DEFINITIONS,
  DEFAULT_PRODUCT_SETTINGS,
  normalizeSetting,
} from "@/lib/settings-schema";
import type { useSettings } from "@/contexts/settings-context";
import type { useSettingsForm } from "./use-settings-form";
import { LANGUAGE_POLICY_SETTING_KEY, type LanguagePolicy } from "@/lib/language-policy";

const TOLERANCE_CONTROLS = [
  {
    key: "matching.movie.tolerancePercent",
    id: "movie-tolerance",
    label: "Film-Laufzeittoleranz (%)",
  },
  {
    key: "matching.sonarr.tolerancePercent",
    id: "series-tolerance",
    label: "Serien-Laufzeittoleranz (%)",
  },
  {
    key: "matching.movie.yearTolerance",
    id: "movie-year-tolerance",
    label: "Film-Erscheinungsjahr (± Jahre)",
  },
] as const;

const LANGUAGE_PREFERENCES: {
  key: Exclude<keyof LanguagePolicy, "version">;
  title: string;
  description: string;
}[] = [
  {
    key: "includeOriginalAudio",
    title: "Originalton ohne deutsche Tonspur",
    description: "Als neutrale OV-Fassung anbieten, niemals als GERMAN kennzeichnen.",
  },
  {
    key: "includeGermanSubtitleOnly",
    title: "Originalton mit deutschen Untertiteln",
    description: "Als eigene Untertitel-Fassung anbieten, nicht als deutschsprachigen Ton.",
  },
  {
    key: "includeAudioDescription",
    title: "Audiodeskription",
    description: "Nur als eigene Variante anbieten, wenn deutscher Ton nachgewiesen ist.",
  },
  {
    key: "includeSignLanguage",
    title: "Gebärdenfassung",
    description: "Nur als eigene Variante anbieten, wenn deutscher Ton nachgewiesen ist.",
  },
  {
    key: "includeClearSpeech",
    title: "Klare Sprache",
    description: "Nur als eigene Variante anbieten, wenn deutscher Ton nachgewiesen ist.",
  },
  {
    key: "includeUnverifiedLegacy",
    title: "Altbestand ohne belastbaren Sprachnachweis",
    description: "Als neutrale, ungeprüfte Fassung anbieten; niemals als GERMAN kennzeichnen.",
  },
];

type MatchingCardProps = {
  form: ReturnType<typeof useSettingsForm>;
  settings: NonNullable<ReturnType<typeof useSettings>["settings"]>;
  arrCredentials: ReturnType<typeof useSettings>["arrCredentials"];
};

export function ToleranceSettingsCard({ form, settings }: MatchingCardProps) {
  const { getFieldValue, setFieldValue, formState, formError, handleSave, isSaving } = form;
  const toleranceFormError = formError(TOLERANCE_CONTROLS.map(({ key }) => key));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Identitäts-Toleranzen</CardTitle>
        <CardDescription>
          Film, Serie und Filmjahr getrennt prüfen – unabhängig von optionalen Arr-Anbindungen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {TOLERANCE_CONTROLS.map(({ key, id, label }) => {
          const definition = SETTING_DEFINITIONS[key];
          const invalid = normalizeSetting(key, getFieldValue(key)) === null;
          return (
            <div key={key}>
              <label htmlFor={id} className="text-sm font-medium">
                {label}
              </label>
              <Input
                id={id}
                type="number"
                min={definition.min}
                max={definition.max}
                step="1"
                value={getFieldValue(key)}
                aria-invalid={invalid}
                aria-describedby={`${id}-help`}
                onChange={(event) => setFieldValue(key, event.target.value)}
                className="mt-1"
              />
              <p id={`${id}-help`} className="text-xs text-muted-foreground mt-1">
                Ganze Werte {definition.min}–{definition.max}; Produktdefault{" "}
                {DEFAULT_PRODUCT_SETTINGS[key]}
                {definition.unit === "percent" ? " %" : " Jahr"}.
                {formState[key] !== undefined && formState[key] !== settings[key]
                  ? ` Gespeichert: ${settings[key]}.`
                  : ""}
              </p>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Laufzeit: 0 % verlangt exakte Dauer. Sonst gilt ein 5-Sekunden-Boden, gedeckelt auf 25 %
          der belegten Solldauer. Die Mindestdauer oben ist eine andere Regel. Jedes belegte
          Filmjahr wird direkt gegen das kanonische Filmjahr geprüft, nicht gegen ein bereits
          toleriertes anderes Jahr.
        </p>
        <p className="text-xs text-muted-foreground">
          Neue Downloadaufträge halten ihre Regeln fest. Die technische Prüfung gegen die Quelldauer
          bleibt unabhängig davon bei 10 %. Bereits gespeicherte v1/v2- und unversionierte Aufträge
          behalten ihren dynamischen Altvertrag.
        </p>
        <Button
          onClick={() => handleSave(TOLERANCE_CONTROLS.map(({ key }) => key))}
          disabled={toleranceFormError}
          aria-disabled={isSaving}
          aria-busy={isSaving}
        >
          <Save className="w-4 h-4 mr-2" />
          Toleranzen speichern
        </Button>
        {toleranceFormError && (
          <p role="alert" className="text-sm text-destructive">
            Ganze Werte innerhalb der angegebenen Grenzen eingeben; leere Felder wählen keinen
            Default.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function SonarrMetadataCard({ form, arrCredentials }: MatchingCardProps) {
  const { getFieldValue, setFieldValue, handleSave, isSaving, sonarrFormError } = form;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Optionale Sonarr-Metadaten</CardTitle>
        <CardDescription>
          Ergänzt fehlende Episoden aus einer Sonarr-3/4-Instanz, ohne vorhandene Metadaten zu
          ersetzen. Kein zusätzliches TVDB-/TMDB-Konto erforderlich.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={getFieldValue("integration.sonarr.enabled") === "true"}
            onChange={(event) =>
              setFieldValue("integration.sonarr.enabled", String(event.target.checked))
            }
            className="h-4 w-4 rounded border-input"
          />
          <span className="text-sm font-medium">Sonarr-Ergänzung aktivieren</span>
        </label>
        <div>
          <label htmlFor="sonarr-url" className="text-sm font-medium">
            Sonarr-Basis-URL
          </label>
          <Input
            id="sonarr-url"
            type="url"
            value={getFieldValue("integration.sonarr.url")}
            onChange={(event) => setFieldValue("integration.sonarr.url", event.target.value)}
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            HTTP(S), optional mit Unterpfad. Keine Zugangsdaten oder API-Keys in der URL.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          API-Key ausschließlich serverseitig über <code>PINGUFUNK_SONARR_API_KEY</code>
          oder <code>PINGUFUNK_SONARR_API_KEY_FILE</code> konfigurieren. Status:{" "}
          {
            {
              present: "vorhanden (verborgen)",
              missing: "fehlend",
              invalid: "ungültige serverseitige Konfiguration",
              unknown: "unbekannt",
            }[arrCredentials.sonarr]
          }
          . Speichern führt keine Sonarr-Abfrage aus.
        </p>
        <div>
          <label htmlFor="sonarr-window" className="text-sm font-medium">
            RSS-Aktualitätsfenster (Tage)
          </label>
          <Input
            id="sonarr-window"
            type="number"
            min="1"
            max="90"
            step="1"
            value={getFieldValue("integration.sonarr.windowDays")}
            onChange={(event) => setFieldValue("integration.sonarr.windowDays", event.target.value)}
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            1–90 Tage; nur überwachte Serien. Snapshots sind zeit- und mengenbegrenzt.
          </p>
        </div>

        <Button
          onClick={() =>
            handleSave([
              "integration.sonarr.enabled",
              "integration.sonarr.url",
              "integration.sonarr.windowDays",
            ])
          }
          disabled={sonarrFormError !== null}
          aria-disabled={isSaving}
          aria-busy={isSaving}
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Sonarr-Einstellungen speichern
        </Button>
        {sonarrFormError && (
          <p role="alert" className="text-sm text-destructive">
            {sonarrFormError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function RadarrMetadataCard({ form, arrCredentials }: MatchingCardProps) {
  const { getFieldValue, setFieldValue, handleSave, isSaving, radarrFormError } = form;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Optionale Radarr-Metadaten</CardTitle>
        <CardDescription>
          Ergänzt belegte Filmidentität aus einer Radarr-Instanz. Keine zweite Suchroute;
          ausschließlich lesende API-Anbindung.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={getFieldValue("integration.radarr.enabled") === "true"}
            onChange={(event) =>
              setFieldValue("integration.radarr.enabled", String(event.target.checked))
            }
          />
          <span className="text-sm font-medium">Radarr-Ergänzung aktivieren</span>
        </label>
        <div>
          <label htmlFor="radarr-url" className="text-sm font-medium">
            Radarr-Basis-URL
          </label>
          <Input
            id="radarr-url"
            type="url"
            value={getFieldValue("integration.radarr.url")}
            onChange={(event) => setFieldValue("integration.radarr.url", event.target.value)}
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            HTTP(S), optional mit Unterpfad. Keine Zugangsdaten, API-Keys, Query oder Fragment.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          API-Key ausschließlich serverseitig über <code>PINGUFUNK_RADARR_API_KEY</code> oder{" "}
          <code>PINGUFUNK_RADARR_API_KEY_FILE</code> konfigurieren. Status:{" "}
          {
            {
              present: "vorhanden (verborgen)",
              missing: "fehlend",
              invalid: "ungültige serverseitige Konfiguration",
              unknown: "unbekannt",
            }[arrCredentials.radarr]
          }
          . Speichern führt keine Radarr-Abfrage aus.
        </p>
        <div>
          <label htmlFor="radarr-inventory" className="text-sm font-medium">
            Maximales Radarr-Inventar (MiB)
          </label>
          <Input
            id="radarr-inventory"
            type="number"
            step="1"
            min={SETTING_DEFINITIONS["integration.radarr.inventoryMaxMiB"].min}
            max={SETTING_DEFINITIONS["integration.radarr.inventoryMaxMiB"].max}
            value={getFieldValue("integration.radarr.inventoryMaxMiB")}
            onChange={(event) =>
              setFieldValue("integration.radarr.inventoryMaxMiB", event.target.value)
            }
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            1–64 MiB; Produktdefault 10 MiB. Obergrenze für die API-Antwort, keine Anzahl von
            Filmen.
          </p>
        </div>
        <Button
          onClick={() =>
            handleSave([
              "integration.radarr.enabled",
              "integration.radarr.url",
              "integration.radarr.inventoryMaxMiB",
            ])
          }
          disabled={radarrFormError !== null}
          aria-disabled={isSaving}
          aria-busy={isSaving}
        >
          <Save className="w-4 h-4 mr-2" />
          Radarr-Einstellungen speichern
        </Button>
        {radarrFormError && (
          <p role="alert" className="text-sm text-destructive">
            {radarrFormError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function LanguageSettingsCard({ form }: MatchingCardProps) {
  const { getLanguagePolicy, setLanguagePreference, handleSave, isSaving } = form;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sprache und Fassungen</CardTitle>
        <CardDescription>
          Bestimmt, welche zusätzlichen Fassungen in deutschen Feeds sichtbar sind. Deutsch als
          Tonspur wird ausschließlich bei belastbarem Nachweis angegeben; diese Schutzregel lässt
          sich hier nicht abschalten.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {LANGUAGE_PREFERENCES.map(({ key, title, description }) => (
          <label key={key} className="flex items-start gap-3 rounded-md border p-3">
            <input
              type="checkbox"
              checked={getLanguagePolicy()[key]}
              onChange={(event) => setLanguagePreference(key, event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-input"
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">{title}</span>
              <span className="block text-xs text-muted-foreground">{description}</span>
            </span>
          </label>
        ))}
        <Button
          onClick={() => handleSave([LANGUAGE_POLICY_SETTING_KEY])}
          aria-disabled={isSaving}
          aria-busy={isSaving}
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Sprachpräferenzen speichern
        </Button>
      </CardContent>
    </Card>
  );
}
