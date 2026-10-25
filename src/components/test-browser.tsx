"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CLASS_COLOR,
  displayName,
  formatPercent,
  type Prediction,
} from "@/lib/landcover";
import { loadImage, loadModel, predictImageData, squareChip } from "@/lib/predict";

type TestImage = {
  src: string;
  label: string;
  file: string;
};

type Catalog = {
  count: number;
  counts: Record<string, number>;
  images: TestImage[];
};

const PAGE_SIZE = 24;

export function TestBrowser() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [klass, setKlass] = useState<string>("All");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<TestImage | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch("/test-set/index.json")
      .then((response) => {
        if (!response.ok) throw new Error("The test-image list did not load.");
        return response.json() as Promise<Catalog>;
      })
      .then((data) => {
        if (!cancel) setCatalog(data);
      })
      .catch((reason: unknown) => {
        if (!cancel) setCatalogError(reason instanceof Error ? reason.message : "The test-image list did not load.");
      });
    loadModel()
      .then(() => {
        if (!cancel) setReady(true);
      })
      .catch((reason: unknown) => {
        if (!cancel) setModelError(reason instanceof Error ? reason.message : "The model weights did not load.");
      });
    return () => {
      cancel = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const needle = query.trim().toLowerCase();
    return catalog.images.filter((image) => {
      if (klass !== "All" && image.label !== klass) return false;
      if (needle && !image.file.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [catalog, klass, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  async function choose(image: TestImage) {
    setSelected(image);
    setPrediction(null);
    setReadError(null);
    setReading(true);
    try {
      const loaded = await loadImage(image.src);
      const chip = squareChip(loaded, loaded.naturalWidth, loaded.naturalHeight, 64);
      const [next] = await predictImageData([chip]);
      setPrediction(next);
    } catch (reason) {
      setReadError(reason instanceof Error ? reason.message : "That chip could not be read.");
    } finally {
      setReading(false);
    }
  }

  const trueRank = prediction && selected
    ? prediction.scores.findIndex((score) => score.label === selected.label) + 1
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <label className="text-sm text-muted-foreground" htmlFor="test-search">
          Find a file name
        </label>
        <input
          id="test-search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder="Forest_1234"
          className="h-11 w-full rounded-lg border border-border bg-card px-3 text-base sm:max-w-sm"
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by true class">
          <FilterButton
            active={klass === "All"}
            label={`All ${catalog ? catalog.count.toLocaleString("en-US") : ""}`.trim()}
            onClick={() => {
              setKlass("All");
              setPage(0);
            }}
          />
          {catalog
            ? Object.entries(catalog.counts).map(([label, count]) => (
                <FilterButton
                  key={label}
                  active={klass === label}
                  label={`${displayName(label)} ${count}`}
                  onClick={() => {
                    setKlass(label);
                    setPage(0);
                  }}
                />
              ))
            : null}
        </div>
      </div>

      {catalogError ? <p className="text-sm text-destructive">{catalogError}</p> : null}
      {modelError ? <p className="text-sm text-destructive">{modelError}</p> : null}
      {!catalog && !catalogError ? <p className="text-sm text-muted-foreground">Loading the 4,050 test chips…</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {visible.map((image) => {
              const active = selected?.src === image.src;
              return (
                <button
                  key={image.src}
                  type="button"
                  onClick={() => void choose(image)}
                  disabled={!ready || reading}
                  aria-pressed={active}
                  className={`rounded-lg bg-card p-1 text-left ring-2 ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${active ? "ring-primary" : "ring-transparent"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.src}
                    alt={`Test chip ${image.file}, true class ${displayName(image.label)}`}
                    className="aspect-square w-full rounded-md object-cover"
                  />
                  <span className="mt-1 block truncate text-[10px] leading-tight text-muted-foreground">
                    {displayName(image.label)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-muted-foreground">
              {filtered.length.toLocaleString("en-US")} chips · page {safePage + 1} of {pageCount}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="!h-11 bg-card px-4" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                className="!h-11 bg-card px-4"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-2xl">This chip</CardTitle>
            <CardDescription>
              {ready ? "Pick any test image. The true label stays hidden from the weights." : "Loading the land-cover weights…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4" aria-live="polite">
            {!selected ? <p className="text-sm text-muted-foreground">Nothing selected yet.</p> : null}
            {selected ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selected.src}
                  alt={`Selected test chip ${selected.file}`}
                  className="h-40 w-40 rounded-lg object-cover"
                />
                <p className="text-sm text-muted-foreground">{selected.file}</p>
                <p>
                  True class <span className="font-medium">{displayName(selected.label)}</span>
                </p>
              </>
            ) : null}
            {reading ? <p className="text-sm text-muted-foreground">Reading the chip…</p> : null}
            {readError ? <p className="text-sm text-destructive">{readError}</p> : null}
            {prediction && selected ? (
              <>
                <p className="font-heading text-3xl leading-tight">
                  {prediction.label === selected.label ? "Correct" : "Miss"}
                  <span className="mt-1 block text-xl font-normal text-foreground">
                    Called {displayName(prediction.label)} · {formatPercent(prediction.confidence)}
                  </span>
                </p>
                {prediction.label !== selected.label ? (
                  <p className="text-sm text-muted-foreground">
                    {displayName(selected.label)} was guess {trueRank} at{" "}
                    {formatPercent(prediction.scores[trueRank - 1]?.probability ?? 0)}.
                  </p>
                ) : null}
                <ul className="flex flex-col gap-2">
                  {prediction.scores.map((score) => (
                    <li key={score.label}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2">
                          <span className="size-2.5 rounded-full" style={{ backgroundColor: CLASS_COLOR[score.label] ?? "#888" }} aria-hidden />
                          {displayName(score.label)}
                          {score.label === selected.label ? <span className="text-xs text-muted-foreground">true</span> : null}
                        </span>
                        <span className="tabular-nums text-muted-foreground">{formatPercent(score.probability)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(2, score.probability * 100)}%`,
                            backgroundColor: CLASS_COLOR[score.label] ?? "#888",
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FilterButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-11 rounded-full px-3 text-sm ring-1 ring-foreground/10 ${active ? "bg-primary text-primary-foreground" : "bg-card"}`}
    >
      {label}
    </button>
  );
}
