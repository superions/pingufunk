"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { RefreshCw, X, RotateCcw } from "lucide-react";
import { formatSize } from "@/lib/formatters";
import { getStatusBadge } from "@/components/shared/status-badge";
import { Input } from "@/components/ui/input";
import { downloadPollDelay } from "@/lib/download-read";
import { parseQueuePage, parseHistoryPage, type DownloadPageMeta } from "@/lib/download-page";
import { JobDiagnosis } from "@/components/job-diagnosis";

const pageSize = 50;
const emptyMeta: DownloadPageMeta = { noofslots: 0, noofslots_total: 0, start: 0, limit: pageSize };

function PageControls({
  meta,
  rows,
  change,
}: {
  meta: DownloadPageMeta;
  rows: number;
  change: (start: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mt-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {rows ? `${meta.start + 1}–${meta.start + rows}` : "0"} von {meta.noofslots} · höchstens{" "}
        {pageSize} pro Seite
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={meta.start === 0}
          onClick={() => change(Math.max(0, meta.start - pageSize))}
        >
          Zurück
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={meta.start + pageSize >= meta.noofslots}
          onClick={() => change(meta.start + pageSize)}
        >
          Weiter
        </Button>
      </div>
    </div>
  );
}

interface QueueSlot {
  nzo_id: string;
  filename: string;
  status: string;
  percentage: string;
  timeleft: string;
  cat: string;
  mb: string;
  mbleft: string;
  speed: string;
}

interface HistorySlot {
  nzo_id: string;
  name: string;
  status: string;
  completed: number;
  category: string;
  storage: string;
  bytes: number;
  fail_message: string;
}

export default function DownloadsPage() {
  const [queue, setQueue] = useState<QueueSlot[]>([]);
  const [history, setHistory] = useState<HistorySlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [readError, setReadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [queueStart, setQueueStart] = useState(0);
  const [historyStart, setHistoryStart] = useState(0);
  const [queueMeta, setQueueMeta] = useState(emptyMeta);
  const [historyMeta, setHistoryMeta] = useState(emptyMeta);
  const [filter, setFilter] = useState({ search: "", category: "", status: "" });
  const [draft, setDraft] = useState(filter);
  const [visible, setVisible] = useState(true);
  const generation = useRef(0);
  const pendingRead = useRef<AbortController | null>(null);
  const requestKey = `${queueStart}/${historyStart}/${JSON.stringify(filter)}`;
  const dataKey = useRef("");
  const cancelRead = useCallback(() => {
    generation.current++;
    pendingRead.current?.abort();
  }, []);

  const fetchData = useCallback(async () => {
    const current = ++generation.current;
    pendingRead.current?.abort();
    const controller = new AbortController();
    pendingRead.current = controller;
    setIsLoading(true);
    if (dataKey.current !== requestKey) {
      // Keep stale data only for the same page/filter. Never label the previous
      // page as the new window after a failed navigation request.
      setQueue([]);
      setHistory([]);
      setQueueMeta({ ...emptyMeta, start: queueStart });
      setHistoryMeta({ ...emptyMeta, start: historyStart });
    }
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
      const parameters = (mode: "queue" | "history", start: number) => {
        const params = new URLSearchParams({ mode, start: String(start), limit: String(pageSize) });
        if (filter.search) params.set("search", filter.search);
        if (filter.category) params.set("category", filter.category);
        if (mode === "history" && filter.status) params.set("status", filter.status);
        return params;
      };
      const [queueRes, historyRes] = await Promise.all([
        fetch(`/api/download?${parameters("queue", queueStart)}`, { signal, cache: "no-store" }),
        fetch(`/api/download?${parameters("history", historyStart)}`, {
          signal,
          cache: "no-store",
        }),
      ]);
      if (!queueRes.ok || !historyRes.ok) throw new Error("Download API unavailable");
      const queueData = await queueRes.json();
      const historyData = await historyRes.json();
      const nextQueue = parseQueuePage(queueData.queue, queueStart, pageSize);
      const nextHistory = parseHistoryPage(historyData.history, historyStart, pageSize);
      if (current !== generation.current) return;
      setQueue(nextQueue.slots);
      setQueueMeta(nextQueue.meta);
      setHistory(nextHistory.slots);
      setHistoryMeta(nextHistory.meta);
      dataKey.current = requestKey;
      setReadError(null);
      setLastRefresh(new Date());
    } catch {
      if (current === generation.current && !controller.signal.aborted)
        setReadError(
          "Downloads konnten nicht aktualisiert werden. Ein angezeigter Bestand kann veraltet sein."
        );
    } finally {
      if (current === generation.current) {
        pendingRead.current = null;
        setIsLoading(false);
      }
    }
  }, [queueStart, historyStart, filter, requestKey]);

  useEffect(() => {
    fetchData();
    return cancelRead;
  }, [fetchData, cancelRead]);

  useEffect(() => {
    const update = () => {
      const next = document.visibilityState === "visible";
      setVisible(next);
      if (next) void fetchData();
    };
    setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [fetchData]);

  useEffect(() => {
    const delay = downloadPollDelay(visible, queueMeta.noofslots_total, readError !== null);
    if (delay === null || isLoading) return;
    const timer = setTimeout(fetchData, delay);
    return () => clearTimeout(timer);
  }, [visible, queueMeta.noofslots_total, readError, isLoading, lastRefresh, fetchData]);

  const handleDelete = async (nzoId: string, delFiles: boolean = false) => {
    setActionError(null);
    setPendingIds((prev) => new Set(prev).add(nzoId));
    try {
      const res = await fetch(
        `/api/download?mode=history&name=delete&value=${encodeURIComponent(nzoId)}&del_files=${delFiles ? 1 : 0}`
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.status) throw new Error("Removal rejected");
      await fetchData();
    } catch {
      setActionError(
        "Löschen wurde nicht bestätigt. Bestand prüfen, bevor du es erneut versuchst."
      );
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(nzoId);
        return next;
      });
    }
  };

  const handleRetry = async (nzoId: string) => {
    setActionError(null);
    setPendingIds((prev) => new Set(prev).add(nzoId));
    try {
      const res = await fetch(
        `/api/download?mode=history&name=retry&value=${encodeURIComponent(nzoId)}`
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.status) throw new Error("Retry rejected");
      await fetchData();
    } catch {
      setActionError(
        "Erneuter Download wurde nicht bestätigt. Queue prüfen, bevor du erneut einreihst."
      );
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(nzoId);
        return next;
      });
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Downloads</h1>
          <p className="text-muted-foreground text-sm">Verwalte deine Downloads</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" suppressHydrationWarning>
            Aktualisiert: {lastRefresh.toLocaleTimeString("de-DE")}
          </span>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={isLoading}>
            <RefreshCw className="w-4 h-4 mr-1" />
            {isLoading ? "Aktualisiere…" : "Aktualisieren"}
          </Button>
        </div>
      </div>

      {(readError || actionError) && (
        <p role="alert" className="text-sm text-destructive">
          {actionError || readError}
        </p>
      )}

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setQueueStart(0);
          setHistoryStart(0);
          setFilter(draft);
        }}
      >
        <div className="space-y-1">
          <label htmlFor="download-search" className="text-sm font-medium">
            Name enthält
          </label>
          <Input
            id="download-search"
            maxLength={200}
            value={draft.search}
            onChange={(event) => setDraft({ ...draft, search: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="download-category" className="text-sm font-medium">
            Kategorie
          </label>
          <Input
            id="download-category"
            placeholder="Alle (z. B. sonarr)"
            maxLength={96}
            value={draft.category}
            onChange={(event) => setDraft({ ...draft, category: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="download-status" className="text-sm font-medium">
            History-Status
          </label>
          <select
            id="download-status"
            className="block h-9 rounded-md border bg-background px-3 text-sm"
            value={draft.status}
            onChange={(event) => setDraft({ ...draft, status: event.target.value })}
          >
            <option value="">Alle</option>
            <option value="Completed">Abgeschlossen</option>
            <option value="Failed">Fehlgeschlagen</option>
          </select>
        </div>
        <Button type="submit" variant="outline">
          Filtern
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const cleared = { search: "", category: "", status: "" };
            setDraft(cleared);
            setFilter(cleared);
            setQueueStart(0);
            setHistoryStart(0);
          }}
        >
          Zurücksetzen
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Sichtbarer Tab: aktive Jobs alle 5 Sekunden, sonst alle 30 Sekunden. Ausgeblendet kein
        Polling. Seiten sind aktuelle Lesestände; neue Abschlüsse können die Reihenfolge ändern. Ein
        Downloadabschluss ist kein bestätigter Sonarr-/Radarr-Import.
      </p>

      {/* Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Download-Verwaltung</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="queue">
            <TabsList className="mb-4">
              <TabsTrigger value="queue">Queue ({queueMeta.noofslots})</TabsTrigger>
              <TabsTrigger value="history">History ({historyMeta.noofslots})</TabsTrigger>
            </TabsList>

            <TabsContent value="queue">
              <PageControls meta={queueMeta} rows={queue.length} change={setQueueStart} />
              {isLoading && dataKey.current !== requestKey ? (
                <p className="text-muted-foreground text-center py-8">Laden...</p>
              ) : !readError && queue.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">Keine aktiven Downloads</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Fortschritt</TableHead>
                        <TableHead>Größe</TableHead>
                        <TableHead>Geschw.</TableHead>
                        <TableHead>Verbleibend</TableHead>
                        <TableHead className="w-20">Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {queue.map((item) => (
                        <TableRow key={item.nzo_id}>
                          <TableCell className="font-medium max-w-xs">
                            <span className="truncate block">{item.filename}</span>
                            <JobDiagnosis id={item.nzo_id} />
                          </TableCell>
                          <TableCell>{getStatusBadge(item.status)}</TableCell>
                          <TableCell>{item.percentage}%</TableCell>
                          <TableCell>{item.mb} MB</TableCell>
                          <TableCell>{item.speed}</TableCell>
                          <TableCell>{item.timeleft}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled
                              title="Aktive Downloads können hier nicht abgebrochen werden"
                              aria-label="Aktive Downloads können hier nicht abgebrochen werden"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="history">
              <PageControls meta={historyMeta} rows={history.length} change={setHistoryStart} />
              {isLoading && dataKey.current !== requestKey ? (
                <p className="text-muted-foreground text-center py-8">Laden...</p>
              ) : !readError && history.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Keine Downloads in der History
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Abgeschlossen</TableHead>
                        <TableHead>Größe</TableHead>
                        <TableHead className="w-24">Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((item) => (
                        <TableRow key={item.nzo_id}>
                          <TableCell className="font-medium max-w-xs">
                            <span className="truncate block">{item.name}</span>
                            {item.fail_message && (
                              <span className="text-xs text-destructive">
                                Fehler gemeldet – geschlossene Diagnose lesen.
                              </span>
                            )}
                            <JobDiagnosis id={item.nzo_id} />
                          </TableCell>
                          <TableCell>{getStatusBadge(item.status)}</TableCell>
                          <TableCell>
                            {new Date(item.completed * 1000).toLocaleDateString("de-DE", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </TableCell>
                          <TableCell>{formatSize(item.bytes)}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {item.status.toLowerCase() === "failed" && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRetry(item.nzo_id)}
                                  title="Erneut versuchen"
                                  disabled={pendingIds.has(item.nzo_id)}
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(item.nzo_id, true)}
                                title="Löschen"
                                disabled={pendingIds.has(item.nzo_id)}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
