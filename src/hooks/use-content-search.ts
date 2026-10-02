"use client";

import { useEffect, useRef, useState } from "react";

/** UI transport only: matching and release authorship remain on the server. */
export function useContentSearch<T>(type?: "movie") {
  const [results, setResults] = useState<T[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);

  useEffect(() => () => active.current?.abort(), []);

  const search = async (query: string) => {
    // Keyboard submissions must obey the same in-flight guard as the button.
    if (!query.trim() || active.current) return;
    if (query.trim().length < 2) {
      setResults([]);
      setError("Bitte mindestens zwei Zeichen für die Suche eingeben.");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setSubmittedQuery(query);
    setError(null);
    setResults([]);
    setIsSearching(true);
    try {
      const params = new URLSearchParams({ q: query, limit: "50" });
      if (type) params.set("type", type);
      const response = await fetch(`/api/search?${params}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (!response.ok) throw new Error("Search unavailable");
      const data = await response.json();
      if (!Array.isArray(data.results)) throw new Error("Invalid search response");
      if (!controller.signal.aborted) setResults(data.results);
    } catch {
      if (!controller.signal.aborted) {
        setError("Die Suche ist fehlgeschlagen. Bitte erneut versuchen.");
      }
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setIsSearching(false);
    }
  };

  return { results, isSearching, submittedQuery, error, search };
}
