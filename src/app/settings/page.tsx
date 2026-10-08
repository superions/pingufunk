"use client";

import { useRef, useState } from "react";
import { useSettings } from "@/contexts/settings-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Settings,
  Key,
  Sliders,
  Database,
  Info,
  Loader2,
  Save,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useSettingsForm } from "./use-settings-form";
import {
  ToleranceSettingsCard,
  SonarrMetadataCard,
  RadarrMetadataCard,
  LanguageSettingsCard,
} from "./matching-settings-cards";
import packageJson from "../../../package.json";
import { parseSystemInformation, type SystemInformation } from "@/lib/system-information";

// Helper functions
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function SettingsPage() {
  const {
    settings,
    isLoading,
    error,
    invalidKeys,
    arrCredentials,
    updateSettings,
    refreshSettings,
  } = useSettings();
  const form = useSettingsForm({ settings, updateSettings });
  const { getFieldValue, setFieldValue, handleSave, isSaving, saveFeedback } = form;
  const refreshing = useRef(false);
  const handleRefresh = async () => {
    if (refreshing.current || isSaving) return;
    refreshing.current = true;
    try {
      await refreshSettings();
    } finally {
      refreshing.current = false;
    }
  };
  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearResult, setClearResult] = useState<{
    show: boolean;
    success: boolean;
    message: string;
  }>({
    show: false,
    success: false,
    message: "",
  });
  const [systemInfo, setSystemInfo] = useState<SystemInformation | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [isReadingSystem, setIsReadingSystem] = useState(false);
  const systemGeneration = useRef(0);

  // Fetch system info when System tab is viewed
  const fetchSystemInfo = async () => {
    const generation = ++systemGeneration.current;
    setIsReadingSystem(true);
    setSystemError(null);
    try {
      const res = await fetch("/api/system", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = parseSystemInformation(await res.json());
      if (!data) throw new Error("System snapshot unconfirmed");
      if (generation === systemGeneration.current) setSystemInfo(data);
    } catch {
      if (generation === systemGeneration.current) {
        setSystemInfo(null);
        setSystemError(
          "Systeminformationen sind unbestätigt: Datenbank/Schema oder Antwort derzeit nicht verfügbar. Kein bestätigter gesunder Zustand."
        );
      }
    } finally {
      if (generation === systemGeneration.current) setIsReadingSystem(false);
    }
  };

  const handleClearCache = async () => {
    setShowClearConfirm(false);
    setIsClearing(true);
    try {
      const res = await fetch("/api/cache", { method: "DELETE" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();

      if (data.success) {
        setClearResult({
          show: true,
          success: true,
          message:
            "Temporäre Such- und Metadaten-Caches geleert; historische Datenbankzeilen bleiben erhalten.",
        });
      } else {
        setClearResult({
          show: true,
          success: false,
          message: "Fehler beim Leeren des Caches.",
        });
      }
    } catch (error) {
      console.error("Failed to clear cache:", error);
      setClearResult({
        show: true,
        success: false,
        message: "Fehler beim Leeren des Caches.",
      });
    } finally {
      setIsClearing(false);
    }
  };

  if (isLoading && !settings) {
    return (
      <div className="p-4 md:p-6 lg:p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="p-8 space-y-4">
        <p role="alert">
          Einstellungen konnten nicht geladen werden. Es werden keine Ersatzwerte gespeichert.
        </p>
        <Button onClick={refreshSettings}>Erneut laden</Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm">Konfiguriere RundfunkArr</p>
      </div>

      {invalidKeys.length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          Ungültiger gespeicherter Stand: {invalidKeys.join(", ")}. Die Daten bleiben erhalten.
          Betroffene Werte ausdrücklich korrigieren; Matching verwendet keine stillen Ersatzregeln.
        </p>
      )}
      {error && !saveFeedback?.error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        variant="outline"
        onClick={handleRefresh}
        aria-disabled={isSaving || isLoading}
        aria-busy={isLoading}
      >
        Gespeicherten Stand neu laden
      </Button>
      {saveFeedback && (
        <p
          role={saveFeedback.error ? "alert" : "status"}
          className={
            saveFeedback.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"
          }
        >
          {saveFeedback.message}
        </p>
      )}

      {/* Tabs */}
      <Card>
        <CardContent className="p-6">
          <Tabs
            defaultValue="general"
            onValueChange={(value) => value === "system" && fetchSystemInfo()}
          >
            <TabsList className="grid w-full grid-cols-5 mb-6">
              <TabsTrigger value="general" className="flex items-center gap-2">
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Allgemein</span>
              </TabsTrigger>
              <TabsTrigger value="api" className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                <span className="hidden sm:inline">API-Keys</span>
              </TabsTrigger>
              <TabsTrigger value="matching" className="flex items-center gap-2">
                <Sliders className="w-4 h-4" />
                <span className="hidden sm:inline">Matching</span>
              </TabsTrigger>
              <TabsTrigger value="cache" className="flex items-center gap-2">
                <Database className="w-4 h-4" />
                <span className="hidden sm:inline">Cache</span>
              </TabsTrigger>
              <TabsTrigger value="system" className="flex items-center gap-2">
                <Info className="w-4 h-4" />
                <span className="hidden sm:inline">System</span>
              </TabsTrigger>
            </TabsList>

            {/* General Tab */}
            <TabsContent value="general" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Allgemeine Einstellungen</CardTitle>
                  <CardDescription>Download-Pfad und Qualitätspräferenzen</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Download-Pfad</label>
                    <Input
                      value={getFieldValue("download.path")}
                      onChange={(e) => setFieldValue("download.path", e.target.value)}
                      placeholder="/downloads"
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Verzeichnis für heruntergeladene Dateien
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Bevorzugte Qualität</label>
                    <select
                      value={getFieldValue("download.quality")}
                      onChange={(e) => setFieldValue("download.quality", e.target.value)}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="all">Alle Qualitäten</option>
                      <option value="best">Nur beste verfügbare</option>
                      <option value="1080p">Nur 1080p (Full HD)</option>
                      <option value="720p">Nur 720p (HD)</option>
                      <option value="480p">Nur 480p (SD)</option>
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Welche Qualitäten sollen im Newznab-Feed angezeigt werden?
                    </p>
                  </div>
                  <label className="flex items-center justify-between gap-4 rounded-md border border-input p-3">
                    <span>
                      <span className="block text-sm font-medium">MP4 in MKV konvertieren</span>
                      <span className="block text-xs text-muted-foreground mt-1">
                        Deaktivieren, wenn ein externes Tool wie Tdarr die Medienverarbeitung
                        übernimmt. Heruntergeladene MP4-Dateien bleiben dann unverändert.
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={getFieldValue("download.convertToMkv") !== "false"}
                      onChange={(e) =>
                        setFieldValue("download.convertToMkv", String(e.target.checked))
                      }
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                  </label>

                  <Button
                    onClick={() =>
                      handleSave(["download.path", "download.quality", "download.convertToMkv"])
                    }
                    aria-disabled={isSaving}
                    aria-busy={isSaving}
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    Speichern
                  </Button>
                </CardContent>
              </Card>

              {/* HLS/Streaming Settings Card */}
              <Card>
                <CardHeader>
                  <CardTitle>Streaming-Einstellungen</CardTitle>
                  <CardDescription>
                    HLS-Streaming und Proxy-Konfiguration für SRF/ORF-Inhalte
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium">HLS-Streams aktivieren</label>
                      <p className="text-xs text-muted-foreground">
                        Ermöglicht das Herunterladen von HLS-Streams (z. B. SRF, ORF)
                      </p>
                    </div>
                    <select
                      value={getFieldValue("download.enableHLS")}
                      onChange={(e) => setFieldValue("download.enableHLS", e.target.value)}
                      className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="false">Aus</option>
                      <option value="true">An</option>
                    </select>
                  </div>
                  <label className="flex items-center justify-between gap-4 text-sm">
                    ORF-Suche aktivieren (benötigt HLS)
                    <input
                      type="checkbox"
                      checked={getFieldValue("provider.orf.enabled") === "true"}
                      onChange={(e) =>
                        setFieldValue("provider.orf.enabled", String(e.target.checked))
                      }
                      className="h-4 w-4 accent-primary"
                    />
                  </label>
                  <div>
                    <label className="text-sm font-medium">yt-dlp Pfad (optional)</label>
                    <Input
                      value={getFieldValue("download.ytdlpPath")}
                      onChange={(e) => setFieldValue("download.ytdlpPath", e.target.value)}
                      placeholder="Leer = automatischer Download"
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Pfad zur yt-dlp-Binary. Leer lassen für automatischen Download.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Streaming-Proxy (optional)</label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Serverseitig über PINGUFUNK_STREAMING_PROXY_URL_FILE konfigurieren. Proxy-URLs
                      mit Zugangsdaten werden abgelehnt, da yt-dlp sie sonst in Prozessargumenten
                      führen würde.
                    </p>
                    <Badge variant="outline">
                      {settings?.["download.proxyUrl"] ? "Konfiguriert" : "Nicht konfiguriert"}
                    </Badge>
                  </div>
                  <Button
                    onClick={() =>
                      handleSave([
                        "download.enableHLS",
                        "download.ytdlpPath",
                        "provider.orf.enabled",
                      ])
                    }
                    aria-disabled={isSaving}
                    aria-busy={isSaving}
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    Speichern
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* API Keys Tab */}
            <TabsContent value="api" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>TVDB API</CardTitle>
                  <CardDescription>
                    TheTVDB.com API-Zugangsdaten für Show-Metadaten. Project API Keys funktionieren
                    ohne PIN; Subscriber-Keys können weiterhin eine PIN verwenden.{" "}
                    <a
                      href="https://thetvdb.com/api-information"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      API-Key beantragen
                    </a>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm">
                    Zugang serverseitig über PINGUFUNK_TVDB_KEY_FILE konfigurieren; PIN optional
                    über PINGUFUNK_TVDB_PIN_FILE.
                  </p>
                  <Badge variant="outline">
                    {settings?.["api.tvdb.key"] ? "Konfiguriert" : "Nicht konfiguriert"}
                  </Badge>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>TMDB API</CardTitle>
                  <CardDescription>
                    TheMovieDB.org API für Film-Metadaten.{" "}
                    <a
                      href="https://www.themoviedb.org/settings/api"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      API-Key beantragen
                    </a>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm">
                    TMDB Read Access Token serverseitig über PINGUFUNK_TMDB_READ_TOKEN_FILE
                    konfigurieren. Ein alter v3-API-Key in der Datenbank wird nicht mehr für
                    URL-Authentifizierung verwendet.
                  </p>
                  <Badge variant="outline">
                    {settings?.["api.tmdb.key"] ? "Konfiguriert" : "Nicht konfiguriert"}
                  </Badge>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>SRG-SSR API (SRF/RTS/RSI)</CardTitle>
                  <CardDescription>
                    Schweizer Sender API für SRF, RTS, RSI Inhalte.{" "}
                    <a
                      href="https://developer.srgssr.ch/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      API-Zugang beantragen
                    </a>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm">
                    Consumer Key und Secret serverseitig über PINGUFUNK_SRGSSR_CONSUMER_KEY_FILE und
                    PINGUFUNK_SRGSSR_CONSUMER_SECRET_FILE konfigurieren.
                  </p>
                  <Badge variant="outline">
                    {settings?.["api.srgssr.consumerKey"] && settings?.["api.srgssr.consumerSecret"]
                      ? "Konfiguriert"
                      : "Nicht konfiguriert"}
                  </Badge>
                  <p className="text-xs text-muted-foreground">
                    Hinweis: Inhalte von SRF sind oft geo-blockiert. Konfiguriere einen Schweizer
                    Proxy in den Streaming-Einstellungen für Zugriff aus dem Ausland.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Matching Tab */}
            <TabsContent value="matching" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Matching-Einstellungen</CardTitle>
                  <CardDescription>Konfiguriere wie Shows abgeglichen werden</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Matching-Strategie</label>
                    <select
                      value={getFieldValue("matching.strategy")}
                      onChange={(e) => setFieldValue("matching.strategy", e.target.value)}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="fuzzy">Fuzzy (flexibel)</option>
                      <option value="strict">Strict (exakt)</option>
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Fuzzy: Erlaubt ähnliche Titel-Matches. Strict: Nur exakte Übereinstimmungen.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Schwellwert</label>
                    <Input
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={getFieldValue("matching.threshold")}
                      onChange={(e) => setFieldValue("matching.threshold", e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      0.0 = sehr locker, 1.0 = exakte Übereinstimmung
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Mindestdauer (Sekunden)</label>
                    <Input
                      type="number"
                      value={getFieldValue("matching.minDuration")}
                      onChange={(e) => setFieldValue("matching.minDuration", e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Ignoriere Videos kürzer als diese Dauer
                    </p>
                  </div>
                  <Button
                    onClick={() =>
                      handleSave([
                        "matching.strategy",
                        "matching.threshold",
                        "matching.minDuration",
                      ])
                    }
                    aria-disabled={isSaving}
                    aria-busy={isSaving}
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    Speichern
                  </Button>
                </CardContent>
              </Card>

              <ToleranceSettingsCard
                form={form}
                settings={settings}
                arrCredentials={arrCredentials}
              />

              <SonarrMetadataCard form={form} settings={settings} arrCredentials={arrCredentials} />

              <RadarrMetadataCard form={form} settings={settings} arrCredentials={arrCredentials} />

              <LanguageSettingsCard
                form={form}
                settings={settings}
                arrCredentials={arrCredentials}
              />
            </TabsContent>

            {/* Cache Tab */}
            <TabsContent value="cache" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Cache-Einstellungen</CardTitle>
                  <CardDescription>
                    Der Cache speichert Daten temporär, um wiederholte Anfragen zu beschleunigen.
                    Die TTL (Time-to-Live) bestimmt, wie lange Daten im Cache bleiben bevor sie neu
                    geladen werden.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Such-Cache (Sekunden)</label>
                    <Input
                      type="number"
                      value={getFieldValue("cache.ttl.search")}
                      onChange={(e) => setFieldValue("cache.ttl.search", e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Wie lange Suchergebnisse von der Mediathek zwischengespeichert werden.
                      Standard: 3600 (1 Stunde). Niedrigere Werte = aktuellere Ergebnisse, mehr
                      API-Anfragen.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Metadaten-Cache (Sekunden)</label>
                    <Input
                      type="number"
                      value={getFieldValue("cache.ttl.metadata")}
                      onChange={(e) => setFieldValue("cache.ttl.metadata", e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Wie lange Show-Informationen (Episodenlisten, Titel) gespeichert werden.
                      Standard: 86400 (24 Stunden). Diese Daten ändern sich selten.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleSave(["cache.ttl.search", "cache.ttl.metadata"])}
                      aria-disabled={isSaving}
                      aria-busy={isSaving}
                    >
                      {isSaving ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-2" />
                      )}
                      Speichern
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setShowClearConfirm(true)}
                      disabled={isClearing}
                    >
                      {isClearing ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4 mr-2" />
                      )}
                      {isClearing ? "Wird geleert..." : "Cache leeren"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tipp: &quot;Cache leeren&quot; erneuert die temporären Caches bei der nächsten
                    Anfrage.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            {/* System Tab */}
            <TabsContent value="system" className="space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>System-Informationen</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={fetchSystemInfo}
                    disabled={isReadingSystem}
                    aria-label="Systeminformationen aktualisieren"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-6">
                  {systemError && (
                    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                      {systemError}
                    </p>
                  )}
                  {isReadingSystem && (
                    <p role="status" className="text-sm text-muted-foreground">
                      Systeminformationen werden geprüft…
                    </p>
                  )}
                  {systemInfo && (
                    <div className="space-y-1 text-sm" role="status">
                      <p>
                        Liveness: Prozess antwortet. DB/Schema:{" "}
                        {systemInfo.runtime.schema.ready
                          ? "kompatibel (kurz gecachte Leseprüfung)"
                          : "unbestätigt"}
                        .
                      </p>
                      <p>
                        Schreibbetrieb:{" "}
                        {systemInfo.runtime.writesEnabled
                          ? "freigegeben"
                          : "Maintenance / gesperrt"}
                        . Prozesslokaler Worker:{" "}
                        {systemInfo.runtime.worker.state === "disabled"
                          ? "deaktiviert"
                          : systemInfo.runtime.worker.state === "idle"
                            ? "wartend"
                            : systemInfo.runtime.worker.state === "paused"
                              ? "pausiert"
                              : "Verarbeitung aktiv"}
                        .
                      </p>
                      <p className="text-muted-foreground">
                        Dies ist kein prozessübergreifender Besitz- oder Arr-Importnachweis.
                      </p>
                    </div>
                  )}
                  {/* Version Info */}
                  <div>
                    <h4 className="text-sm font-medium mb-3">Versionen</h4>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">RundfunkArr</p>
                        <p className="font-medium">{packageJson.version}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Node.js</p>
                        <p className="font-medium">{systemInfo?.version.node || "..."}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">FFmpeg</p>
                        <p className="font-medium">
                          {systemInfo?.version.ffmpeg ? (
                            <span className="text-green-500">{systemInfo.version.ffmpeg}</span>
                          ) : systemInfo ? (
                            <span className="text-red-500">
                              {systemInfo.capabilities.ffmpeg.state === "missing"
                                ? "Nicht gefunden"
                                : systemInfo.capabilities.ffmpeg.state === "timeout"
                                  ? "Zeitlimit"
                                  : "Unbestätigt"}
                            </span>
                          ) : (
                            "..."
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">ffprobe</p>
                        <p className="font-medium">
                          {systemInfo?.capabilities.ffprobe.version ||
                            (systemInfo
                              ? systemInfo.capabilities.ffprobe.state === "missing"
                                ? "Nicht gefunden"
                                : systemInfo.capabilities.ffprobe.state === "timeout"
                                  ? "Zeitlimit"
                                  : "Unbestätigt"
                              : "...")}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">yt-dlp</p>
                        <p className="font-medium">
                          {systemInfo?.version.ytdlp ? (
                            <span className="text-green-500">{systemInfo.version.ytdlp}</span>
                          ) : systemInfo ? (
                            <span className="text-red-500">
                              {systemInfo.capabilities.ytdlp.state === "missing"
                                ? "Nicht gefunden"
                                : systemInfo.capabilities.ytdlp.state === "timeout"
                                  ? "Zeitlimit"
                                  : "Unbestätigt"}
                            </span>
                          ) : (
                            "..."
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Uptime</p>
                        <p className="font-medium">
                          {systemInfo ? formatUptime(systemInfo.uptime) : "..."}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Database Stats */}
                  <div>
                    <h4 className="text-sm font-medium mb-3">Datenbank</h4>
                    <p className="text-xs text-muted-foreground mb-3">
                      Historische TVDB-Zeilen sind kein aktiver Metadaten-Cache.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Größe</p>
                        <p className="font-medium">
                          {systemInfo ? formatBytes(systemInfo.database.sizeBytes) : "..."}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Historische Shows</p>
                        <p className="font-medium">{systemInfo?.database.shows ?? "..."}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Historische Episoden</p>
                        <p className="font-medium">{systemInfo?.database.episodes ?? "..."}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Einstellungen</p>
                        <p className="font-medium">{systemInfo?.database.configEntries ?? "..."}</p>
                      </div>
                    </div>
                  </div>

                  {/* Downloads Stats */}
                  <div>
                    <h4 className="text-sm font-medium mb-3">Downloads</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Abgeschlossen</p>
                        <p className="font-medium text-green-500">
                          {systemInfo?.downloads.completed ?? "..."}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">In Warteschlange</p>
                        <p className="font-medium text-blue-500">
                          {systemInfo?.downloads.inQueue ?? "..."}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Fehlgeschlagen</p>
                        <p className="font-medium text-red-500">
                          {systemInfo?.downloads.failed ?? "..."}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Clear Cache Confirmation Dialog */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cache leeren?</AlertDialogTitle>
            <AlertDialogDescription>
              Nur temporäre Such- und Metadaten-Caches werden geleert. Historische
              Serien-/Episodenzeilen in der Datenbank bleiben erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearCache}>Cache leeren</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear Cache Result Dialog */}
      <AlertDialog
        open={clearResult.show}
        onOpenChange={(open) => setClearResult({ ...clearResult, show: open })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{clearResult.success ? "Cache geleert" : "Fehler"}</AlertDialogTitle>
            <AlertDialogDescription>{clearResult.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
