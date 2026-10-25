"use client";

import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CLASS_COLOR,
  displayName,
  formatPercent,
  type GalleryItem,
  type Prediction,
} from "@/lib/landcover";
import { loadImage, loadModel, predictImageData, squareChip, type ModelManifest } from "@/lib/predict";

type Status = "idle" | "reading" | "done" | "error";

export function ClassifyPanel({ ready }: { ready: boolean }) {
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [activeSrc, setActiveSrc] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [truth, setTruth] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [perClass, setPerClass] = useState<ModelManifest["perClass"] | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ownedUrl = useRef<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    let cancel = false;
    fetch("/model/gallery.json")
      .then((response) => {
        if (!response.ok) throw new Error("The sample chips are missing.");
        return response.json() as Promise<GalleryItem[]>;
      })
      .then((items) => {
        if (!cancel) setGallery(items);
      })
      .catch((reason: unknown) => {
        if (!cancel) setGalleryError(reason instanceof Error ? reason.message : "The sample chips are missing.");
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancel = false;
    loadModel()
      .then((session) => {
        if (cancel) return;
        setPerClass(session.manifest.perClass);
        setAccuracy(session.manifest.testAccuracy);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [ready]);

  useEffect(() => {
    if (!ready || gallery.length === 0 || started.current) return;
    started.current = true;
    const firstForest = gallery.find((item) => item.label === "Forest") ?? gallery[0];
    void classifySrc(firstForest.src, firstForest.label);
  }, [ready, gallery]);

  useEffect(() => {
    return () => {
      if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    };
  }, []);

  async function classifySrc(src: string, knownLabel: string | null) {
    setStatus("reading");
    setError(null);
    setPrediction(null);
    setActiveSrc(src);
    setPreview(src);
    setTruth(knownLabel);
    try {
      const image = await loadImage(src);
      const chip = squareChip(image, image.naturalWidth, image.naturalHeight, 64);
      const [next] = await predictImageData([chip]);
      setPrediction(next);
      setStatus("done");
    } catch (reason) {
      setPrediction(null);
      setStatus("error");
      setError(reason instanceof Error ? reason.message : "The chip could not be read.");
    }
  }

  async function classifyFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setStatus("error");
      setError("That file isn't an image. Use a JPEG, PNG, or WebP chip.");
      return;
    }
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    const url = URL.createObjectURL(file);
    ownedUrl.current = url;
    await classifySrc(url, null);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-2xl">One Sentinel-2 chip</CardTitle>
          <CardDescription>
            Held-out EuroSAT patches, or a chip of your own. The net sees a 64×64 center square.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div
            className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file) void classifyFile(file);
            }}
          >
            {preview ? (
              // Native img so the same decode path feeds the canvas reader.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt={truth ? `Sentinel-2 chip labeled ${displayName(truth)}` : "Uploaded satellite chip"}
                className="h-36 w-36 rounded-lg object-cover shadow-sm"
              />
            ) : (
              <p className="max-w-xs text-sm text-muted-foreground">
                Drop a satellite chip here, or pick one from the strip below.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              className="!h-11 bg-card px-4"
              disabled={!ready || status === "reading"}
              onClick={() => fileRef.current?.click()}
            >
              Upload a chip
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void classifyFile(file);
                event.target.value = "";
              }}
            />
          </div>

          {galleryError ? <p className="text-sm text-destructive">{galleryError}</p> : null}

          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Sample chips">
            {gallery.map((item) => {
              const selected = item.src === activeSrc;
              return (
                <button
                  key={item.src}
                  type="button"
                  disabled={!ready || status === "reading"}
                  onClick={() => void classifySrc(item.src, item.label)}
                  className={`w-16 shrink-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${selected ? "opacity-100" : "opacity-80 hover:opacity-100"}`}
                  aria-pressed={selected}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.src}
                    alt=""
                    className={`h-16 w-16 rounded-md object-cover ring-2 ${selected ? "ring-primary" : "ring-transparent"}`}
                  />
                  <span className="mt-1 block truncate text-[10px] leading-tight text-muted-foreground">
                    {displayName(item.label)}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-2xl">Reading</CardTitle>
          <CardDescription>
            {accuracy !== null
              ? `Held-out test accuracy ${formatPercent(accuracy)} on chips this page never trained on.`
              : "Weights load once, then every reading stays in the browser."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4" aria-live="polite">
          {status === "idle" || status === "reading" ? (
            <p className="text-sm text-muted-foreground">
              {ready ? "Reading the chip…" : "Loading the land-cover weights…"}
            </p>
          ) : null}
          {status === "error" && error ? <p className="text-sm text-destructive">{error}</p> : null}
          {prediction ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs tracking-wide text-muted-foreground uppercase">Top class</p>
                  <p className="font-heading text-3xl leading-tight">{displayName(prediction.label)}</p>
                </div>
                <Badge variant={truth && truth !== prediction.label ? "destructive" : "secondary"}>
                  {formatPercent(prediction.confidence)}
                  {truth ? ` · label ${displayName(truth)}` : ""}
                </Badge>
              </div>
              <ul className="flex flex-col gap-2">
                {prediction.scores.map((score) => (
                  <li key={score.label}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: CLASS_COLOR[score.label] ?? "#888" }}
                          aria-hidden
                        />
                        {displayName(score.label)}
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

          {perClass ? (
            <details className="rounded-lg border border-border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">Per-class test scores</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[22rem] text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Class</th>
                      <th className="py-1 pr-3 font-medium">Precision</th>
                      <th className="py-1 pr-3 font-medium">Recall</th>
                      <th className="py-1 font-medium">F1</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(perClass).map(([label, row]) => (
                      <tr key={label} className="border-t border-border">
                        <td className="py-1.5 pr-3">{displayName(label)}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{formatPercent(row.precision)}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{formatPercent(row.recall)}</td>
                        <td className="py-1.5 tabular-nums">{formatPercent(row.f1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
