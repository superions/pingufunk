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
  const reading = useRef(false);

  const fetchData = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      const signal = AbortSignal.timeout(15000);
      const [queueRes, historyRes] = await Promise.all([
        fetch("/api/download?mode=queue", { signal }),
        fetch("/api/download?mode=history", { signal }),
      ]);
      if (!queueRes.ok || !historyRes.ok) throw new Error("Download API unavailable");
      const queueData = await queueRes.json();
      const historyData = await historyRes.json();
      if (!Array.isArray(queueData.queue?.slots) || !Array.isArray(historyData.history?.slots)) {
        throw new Error("Invalid download response");
      }
      setQueue(queueData.queue.slots);
      setHistory(historyData.history.slots);
      setReadError(null);
      setLastRefresh(new Date());
    } catch {
      setReadError("Downloads konnten nicht aktualisiert werden. Ein angezeigter Bestand kann veraltet sein.");
    } finally {
      reading.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleDelete = async (nzoId: string, delFiles: boolean = false) => {
    setActionError(null);
    setPendingIds(prev => new Set(prev).add(nzoId));
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
      setActionError("Löschen wurde nicht bestätigt. Bestand prüfen, bevor du es erneut versuchst.");
    } finally {
      setPendingIds(prev => { const next = new Set(prev); next.delete(nzoId); return next; });
    }
  };

  const handleRetry = async (nzoId: string) => {
    setActionError(null);
    setPendingIds(prev => new Set(prev).add(nzoId));
    try {
      const res = await fetch(`/api/download?mode=history&name=retry&value=${encodeURIComponent(nzoId)}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.status) throw new Error("Retry rejected");
      await fetchData();
    } catch {
      setActionError("Erneuter Download wurde nicht bestätigt. Queue prüfen, bevor du erneut einreihst.");
    } finally {
      setPendingIds(prev => { const next = new Set(prev); next.delete(nzoId); return next; });
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
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Aktualisieren
          </Button>
        </div>
      </div>

      {(readError || actionError) && <p role="alert" className="text-sm text-destructive">{actionError || readError}</p>}

      {/* Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Download-Verwaltung</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="queue">
            <TabsList className="mb-4">
              <TabsTrigger value="queue">Queue ({queue.length})</TabsTrigger>
              <TabsTrigger value="history">History ({history.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="queue">
              {isLoading ? (
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
                          <TableCell className="font-medium max-w-xs truncate">
                            {item.filename}
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
              {isLoading ? (
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
                              <span className="text-xs text-destructive">{item.fail_message}</span>
                            )}
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
