"use client";

import { apiFetch } from "@/lib/api-fetch";
import Link from "next/link";
import { BookOpen, FileText, GraduationCap, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchResult } from "@/server/services/search";
import { getMessages, type AppLocale } from "@/lib/i18n";

const kindIcons = { course: GraduationCap, assignment: FileText, lesson: BookOpen } as const;

export function GlobalSearch({ locale }: { locale: AppLocale }) {
  const messages = getMessages(locale);
  const kindLabels = {
    course: messages.searchCourse,
    assignment: messages.searchAssignment,
    lesson: messages.searchLesson,
  };
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultsFor, setResultsFor] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = "global-search-results";
  const term = query.trim();
  const errorLabel = {
    ru: "Не удалось выполнить поиск. Попробуйте ещё раз.",
    kk: "Іздеу орындалмады. Қайта көріңіз.",
    en: "Search failed. Please try again.",
  }[locale];
  const groupLabel = {
    ru: "Группы",
    kk: "Топтар",
    en: "Groups",
  }[locale];
  const noGroupLabel = {
    ru: "не назначены",
    kk: "тағайындалмаған",
    en: "not assigned",
  }[locale];
  const visibleResults = resultsFor === term ? results : [];
  const hasVisibleResults = visibleResults.length > 0;

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
        setActiveIndex(0);
      }
      if (event.key === "Escape") setIsOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    window.addEventListener("keydown", onShortcut);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onShortcut);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  useEffect(() => {
    if (!term || !isOpen) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoading(true);
      setSearchError(false);
      try {
        const response = await apiFetch(`/api/v1/search?q=${encodeURIComponent(term)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Search failed");
        const items: unknown = await response.json();
        if (!Array.isArray(items)) throw new Error("Invalid search response");
        if (controller.signal.aborted) return;
        setResults(items as SearchResult[]);
        setResultsFor(term);
      } catch (error) {
        if (
          !controller.signal.aborted &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setResults([]);
          setResultsFor(term);
          setSearchError(true);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isOpen, term]);

  return (
    <div className="global-search" ref={rootRef}>
      <label className="sr-only" htmlFor="global-search-input">
        {messages.searchLabel}
      </label>
      <Search aria-hidden="true" className="global-search-icon" size={17} />
      <input
        aria-autocomplete="list"
        aria-controls={isOpen && hasVisibleResults ? listId : undefined}
        aria-activedescendant={
          hasVisibleResults ? `global-search-option-${activeIndex}` : undefined
        }
        aria-expanded={isOpen && hasVisibleResults}
        autoComplete="off"
        maxLength={80}
        id="global-search-input"
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setIsOpen(false);
          if (event.key === "ArrowDown" && visibleResults.length) {
            event.preventDefault();
            setActiveIndex((index) => Math.min(index + 1, visibleResults.length - 1));
          }
          if (event.key === "ArrowUp" && visibleResults.length) {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          }
          if (event.key === "Enter" && visibleResults[activeIndex]) {
            event.preventDefault();
            setIsOpen(false);
            router.push(visibleResults[activeIndex].href);
          }
        }}
        placeholder={messages.searchPlaceholder}
        ref={inputRef}
        role="combobox"
        value={query}
      />
      {query && (
        <button
          aria-label={messages.clearSearch}
          className="global-search-clear"
          onClick={() => {
            setQuery("");
            setActiveIndex(0);
          }}
          type="button"
        >
          <X size={15} />
        </button>
      )}
      {isOpen &&
        term.length >= 1 &&
        (isLoading || resultsFor !== term ? (
          <p aria-live="polite" className="global-search-popover global-search-empty" role="status">
            {messages.searching}
          </p>
        ) : searchError && resultsFor === term ? (
          <p aria-live="polite" className="global-search-popover global-search-empty" role="alert">
            {errorLabel}
          </p>
        ) : hasVisibleResults ? (
          <div
            className="global-search-popover"
            id={listId}
            role="listbox"
            aria-label={messages.searchResults}
          >
            {visibleResults.map((item, index) => {
              const Icon = kindIcons[item.kind];
              return (
                <Link
                  className={
                    index === activeIndex
                      ? "global-search-result global-search-result-active"
                      : "global-search-result"
                  }
                  href={item.href}
                  id={`global-search-option-${index}`}
                  key={`${item.kind}-${item.id}`}
                  onClick={() => setIsOpen(false)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                >
                  <span className="global-search-result-icon">
                    <Icon aria-hidden="true" size={16} />
                  </span>
                  <span className="global-search-result-copy">
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                    {item.kind === "course" ? (
                      <span className="global-search-result-groups">
                        {groupLabel}: {item.groups?.join(", ") || noGroupLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="global-search-kind">{kindLabels[item.kind]}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p aria-live="polite" className="global-search-popover global-search-empty" role="status">
            {messages.noResults}
          </p>
        ))}
    </div>
  );
}
