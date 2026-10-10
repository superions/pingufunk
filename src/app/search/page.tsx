"use client";

import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Download } from "lucide-react";
import { formatDuration, formatSize, formatDate } from "@/lib/formatters";
import type { UiNzbDownloads } from "@/types";
import { useContentSearch } from "@/hooks/use-content-search";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import type {
  TvReviewPreview,
  TvReviewSummary,
  TvReviewSelector,
} from "@/services/tv-source-review";
import { submitTvReview } from "@/lib/tv-review-client";

interface SearchResult {
  id: string;
  channel: string;
  topic: string;
  title: string;
  description: string;
  timestamp: number;
  duration: number;
  size: number;
  url_video: string;
  url_video_hd: string;
  url_website: string;
  category?: "movie" | "tv" | "unknown";
  nzbDownloads: UiNzbDownloads;
  tvReview?: TvReviewSummary;
}

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const {
    results: searchResults,
    isSearching,
    submittedQuery,
    error: searchError,
    search,
  } = useContentSearch<SearchResult>();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<TvReviewPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [renditions, setRenditions] = useState<Record<string, TvReviewSelector["rendition"]>>({});
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);

  const handleSearch = async () => {
    setDownloadError(null);
    setConfirmation(null);
    await search(searchQuery);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const handleDownload = async (result: SearchResult) => {
    if (result.tvReview?.runtimeConflict) {
      setDownloadError(null);
      setConfirmation(null);
      setReviewError(null);
      setDownloadingIds((prev) => new Set(prev).add(result.id));
      try {
        const selector = {
          ...result.tvReview.selector,
          rendition: renditions[result.id] ?? result.tvReview.selector.rendition,
        };
        const response = await fetch(
          `/api/tv-source-review?selector=${encodeURIComponent(JSON.stringify(selector))}`,
          { cache: "no-store", signal: AbortSignal.timeout(25_000) }
        );
        if (!response.ok) throw new Error("Quelle nicht verifiziert");
        const next = (await response.json()) as TvReviewPreview;
        if (!next.runtimeConflict) throw new Error("Konflikt inzwischen geändert");
        setPreview(next);
      } catch {
        setDownloadError(
          "Diese Fassung konnte nicht frisch verifiziert werden. Erneut suchen oder eine andere Rendition prüfen; keine Freigabe erteilt."
        );
      } finally {
        setDownloadingIds((prev) => {
          const next = new Set(prev);
          next.delete(result.id);
          return next;
        });
      }
      return;
    }
    const nzbContent = result.nzbDownloads.hd || result.nzbDownloads.sd || result.nzbDownloads.low;
    if (!nzbContent) return;
    setDownloadError(null);
    setDownloadingIds((prev) => new Set(prev).add(result.id));

    // Use category for download folder: movie -> /movie, tv -> /tv
    const cat = result.category === "movie" ? "movie" : result.category === "tv" ? "tv" : "default";

    try {
      const res = await fetch(`/api/download?mode=addfile&cat=${cat}`, {
        method: "POST",
        body: nzbContent,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.status) {
        throw new Error("Download rejected");
      }
    } catch {
      setDownloadError(
        "Der Download wurde nicht bestätigt. Queue prüfen, bevor du erneut einreihst."
      );
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(result.id);
        return next;
      });
    }
  };

  const confirmSource = async (event: React.MouseEvent) => {
    event.preventDefault();
    if (!preview || confirming) return;
    setConfirming(true);
    setReviewError(null);
    try {
      const result = await submitTvReview(preview);
      setConfirmation(
        `Einzelauftrag bestätigt: ${result.id} (${result.status}). Dies ist noch kein Download- oder Importabschluss.`
      );
      setPreview(null);
    } catch {
      setReviewError(
        "Nicht bestätigt oder Quelle geändert. Queue prüfen. Erneute Bestätigung verwendet dieselbe Entscheidung und erzeugt keinen zweiten Auftrag. Bei geändertem Beleg abbrechen und erneut suchen."
      );
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Suche</h1>
        <p className="text-muted-foreground text-sm">Durchsuche die Mediatheken</p>
      </div>

      {/* Search Input */}
      <Card>
        <CardHeader>
          <CardTitle>Mediathek durchsuchen</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Suchbegriff eingeben..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="pl-10"
              />
            </div>
            <Button onClick={handleSearch} disabled={isSearching}>
              {isSearching ? "Suche..." : "Suchen"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {(searchError || downloadError) && (
        <p role="alert" className="text-sm text-destructive">
          {searchError || downloadError}
        </p>
      )}
      {confirmation && (
        <p role="status" className="text-sm">
          {confirmation}
        </p>
      )}
      <AlertDialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open && !confirming) setPreview(null);
        }}
      >
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Geprüfte Einzelquelle freigeben</AlertDialogTitle>
            <AlertDialogDescription>
              Nur der Laufzeitkonflikt dieses konkreten Auftrags wird ausgenommen. Keine
              automatische Ausnahme, keine Änderung der globalen Toleranz oder von Sonarr-Profilen.
              Sprache, Auflösung, Quelllaufzeit und tatsächliche Datei werden weiterhin geprüft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preview && (
            <div className="space-y-2 text-sm break-words">
              <p className="font-medium">{preview.title}</p>
              <p>
                Quelle: {formatDuration(preview.sourceSeconds)} ({preview.sourceSeconds} s)
              </p>
              <p>
                Episodenmetadaten: {formatDuration(preview.metadataSeconds)} (
                {preview.metadataSeconds} s)
              </p>
              <p>Unveränderte Serientoleranz: ±{preview.tolerancePercent} %</p>
              <p>
                Geprüfte Rendition: {preview.width} × {preview.height}, Ton: {preview.language}
              </p>
              <p>
                Der normale Sonarr-/Prowlarr-Grab bleibt gesperrt. Die Bestätigung reiht einen
                Download in Kategorie sonarr ein; Sonarr entscheidet anschließend über den Import.
              </p>
            </div>
          )}
          {reviewError && (
            <p role="alert" className="text-sm text-destructive">
              {reviewError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel ref={cancelRef} disabled={confirming}>
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmSource} disabled={confirming}>
              {confirming ? "Wird frisch geprüft…" : "Diese Quelle einmal freigeben"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{searchResults.length} Ergebnisse</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {searchResults.map((result) => (
              <Card key={result.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {result.channel}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{result.topic}</span>
                      {result.category === "movie" && (
                        <Badge className="text-xs bg-violet-600">Film</Badge>
                      )}
                      {result.category === "tv" && (
                        <Badge className="text-xs bg-sky-600">Serie</Badge>
                      )}
                      {result.title.includes("Gebärdensprache") && (
                        <Badge className="text-xs bg-purple-600">DGS</Badge>
                      )}
                      {(result.title.includes("Audiodeskription") ||
                        result.title.includes("Hörfassung")) && (
                        <Badge className="text-xs bg-blue-600">AD</Badge>
                      )}
                      {result.title.includes("Untertitel") && (
                        <Badge className="text-xs bg-green-600">UT</Badge>
                      )}
                    </div>
                    <h3 className="font-medium">{result.title}</h3>
                    {result.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {result.description}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground mt-2">
                      {formatDate(result.timestamp)} &bull; {formatDuration(result.duration)} &bull;{" "}
                      {formatSize(result.size)}
                    </p>
                    {result.tvReview?.runtimeConflict && (
                      <p className="text-sm mt-2 text-amber-600 dark:text-amber-400">
                        Laufzeitkonflikt: Quelle {formatDuration(result.tvReview.sourceSeconds)},
                        Metadaten {formatDuration(result.tvReview.metadataSeconds)}, Toleranz ±
                        {result.tvReview.tolerancePercent} %. Automatischer Download gesperrt.
                      </p>
                    )}
                  </div>
                  {result.tvReview?.runtimeConflict && (
                    <select
                      aria-label={`Rendition für ${result.title}`}
                      className="border rounded bg-background text-sm p-1"
                      value={renditions[result.id] ?? result.tvReview.selector.rendition}
                      onChange={(event) =>
                        setRenditions((prev) => ({
                          ...prev,
                          [result.id]: event.target.value as TvReviewSelector["rendition"],
                        }))
                      }
                    >
                      {result.tvReview.availableRenditions.map((key) => (
                        <option key={key} value={key}>
                          {key.toUpperCase()}-Quelle prüfen
                        </option>
                      ))}
                    </select>
                  )}
                  <Button
                    size="sm"
                    onClick={(event) => {
                      returnFocus.current = event.currentTarget;
                      void handleDownload(result);
                    }}
                    disabled={
                      downloadingIds.has(result.id) ||
                      (!result.tvReview?.runtimeConflict &&
                        Object.keys(result.nzbDownloads).length === 0)
                    }
                  >
                    <Download className="w-4 h-4 mr-1" />
                    {downloadingIds.has(result.id)
                      ? "Prüfe…"
                      : result.tvReview?.runtimeConflict
                        ? "Quelle prüfen"
                        : "Download"}
                  </Button>
                </div>
              </Card>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!isSearching && !searchError && searchResults.length === 0 && submittedQuery && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Keine Ergebnisse gefunden für &quot;{submittedQuery}&quot;
          </CardContent>
        </Card>
      )}
    </div>
  );
}
