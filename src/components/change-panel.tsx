"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  displayName,
  formatHectares,
  formatPercent,
  isForestLoss,
  type Prediction,
  type SceneManifest,
} from "@/lib/landcover";
import { frameSize, loadImage, predictImageData, tileChips } from "@/lib/predict";

type Scan = {
  cols: number;
  rows: number;
  patch: number;
  beforeUrl: string;
  afterUrl: string;
  beforePred: Prediction[];
  afterPred: Prediction[];
  reference: { before: string; after: string }[] | null;
  disclaimer: string | null;
  years: [number, number] | null;
  cropped: boolean;
};

type CellFlag = {
  model: boolean;
  reference: boolean | null;
};

function scoreScan(scan: Scan) {
  let modelLoss = 0;
  let referenceLoss = 0;
  let truePositive = 0;
  let stableForest = 0;
  let regrowth = 0;
  const transitions = new Map<string, number>();
  const flags: CellFlag[] = [];

  scan.beforePred.forEach((before, index) => {
    const after = scan.afterPred[index];
    const model = isForestLoss(before.label, after.label);
    const reference = scan.reference
      ? isForestLoss(scan.reference[index].before, scan.reference[index].after)
      : null;
    if (model) modelLoss += 1;
    if (reference) referenceLoss += 1;
    if (model && reference) truePositive += 1;
    if (before.label === "Forest" && after.label === "Forest") stableForest += 1;
    if (before.label !== "Forest" && after.label === "Forest") regrowth += 1;
    if (before.label !== after.label) {
      const key = `${displayName(before.label)} → ${displayName(after.label)}`;
      transitions.set(key, (transitions.get(key) ?? 0) + 1);
    }
    flags.push({ model, reference });
  });

  const precision = modelLoss === 0 ? 0 : truePositive / modelLoss;
  const recall = referenceLoss === 0 ? 0 : truePositive / referenceLoss;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const topTransitions = [...transitions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  return {
    modelLoss,
    referenceLoss,
    truePositive,
    stableForest,
    regrowth,
    precision,
    recall,
    f1,
    flags,
    topTransitions,
  };
}

function ChipCanvas({
  src,
  row,
  col,
  patch,
  label,
}: {
  src: string;
  row: number;
  col: number;
  patch: number;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancel = false;
    const image = new Image();
    image.onload = () => {
      if (cancel) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.imageSmoothingEnabled = true;
      context.drawImage(image, col * patch, row * patch, patch, patch, 0, 0, canvas.width, canvas.height);
    };
    image.src = src;
    return () => {
      cancel = true;
    };
  }, [src, row, col, patch]);

  return <canvas ref={ref} width={192} height={192} className="aspect-square w-full rounded-lg bg-muted" role="img" aria-label={label} />;
}

export function ChangePanel({
  ready,
  active,
  accuracy,
}: {
  ready: boolean;
  active: boolean;
  accuracy: number | null;
}) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const beforeRef = useRef<HTMLInputElement>(null);
  const afterRef = useRef<HTMLInputElement>(null);
  const beforeFile = useRef<File | null>(null);
  const afterFile = useRef<File | null>(null);
  const uploadUrls = useRef<string[]>([]);
  const [beforeName, setBeforeName] = useState<string | null>(null);
  const [afterName, setAfterName] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    return () => {
      for (const url of uploadUrls.current) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    if (!ready || !active || started.current) return;
    started.current = true;
    void runStudy();
  }, [ready, active]);

  async function runStudy() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/scene/manifest.json");
      if (!response.ok) throw new Error("The study grid is missing.");
      const manifest = (await response.json()) as SceneManifest;
      const [before, after] = await Promise.all([loadImage(manifest.before), loadImage(manifest.after)]);
      const beforeTiles = tileChips(before, 0, 0, manifest.cols, manifest.rows, manifest.patch);
      const afterTiles = tileChips(after, 0, 0, manifest.cols, manifest.rows, manifest.patch);
      const [beforePred, afterPred] = await Promise.all([
        predictImageData(beforeTiles),
        predictImageData(afterTiles),
      ]);
      setScan({
        cols: manifest.cols,
        rows: manifest.rows,
        patch: manifest.patch,
        beforeUrl: manifest.before,
        afterUrl: manifest.after,
        beforePred,
        afterPred,
        reference: manifest.cells.map((cell) => ({ before: cell.before, after: cell.after })),
        disclaimer: manifest.disclaimer,
        years: manifest.years,
        cropped: false,
      });
      setSelected(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The study grid could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function runUploads() {
    const earlier = beforeFile.current;
    const later = afterFile.current;
    if (!earlier || !later) {
      setError("Add both years before running the pair.");
      return;
    }
    setBusy(true);
    setError(null);
    const urls: string[] = [];
    try {
      for (const url of uploadUrls.current) URL.revokeObjectURL(url);
      const [beforeUrl, afterUrl] = [URL.createObjectURL(earlier), URL.createObjectURL(later)];
      urls.push(beforeUrl, afterUrl);
      uploadUrls.current = urls;
      const [before, after] = await Promise.all([loadImage(beforeUrl), loadImage(afterUrl)]);
      if (before.naturalWidth !== after.naturalWidth || before.naturalHeight !== after.naturalHeight) {
        throw new Error("Those two images are different sizes. Use the same frame for both years.");
      }
      const frame = frameSize(before.naturalWidth, before.naturalHeight);
      const beforeTiles = tileChips(before, frame.originX, frame.originY, frame.cols, frame.rows, frame.patch);
      const afterTiles = tileChips(after, frame.originX, frame.originY, frame.cols, frame.rows, frame.patch);
      const [beforePred, afterPred] = await Promise.all([
        predictImageData(beforeTiles),
        predictImageData(afterTiles),
      ]);
      setScan({
        cols: frame.cols,
        rows: frame.rows,
        patch: frame.patch,
        beforeUrl,
        afterUrl,
        beforePred,
        afterPred,
        reference: null,
        disclaimer: null,
        years: null,
        cropped: frame.cropped,
      });
      setSelected(0);
    } catch (reason) {
      for (const url of urls) URL.revokeObjectURL(url);
      uploadUrls.current = [];
      setError(reason instanceof Error ? reason.message : "Those images could not be read.");
    } finally {
      setBusy(false);
    }
  }

  const stats = useMemo(() => (scan ? scoreScan(scan) : null), [scan]);
  const cell = scan && stats ? scan.beforePred[selected] : null;
  const later = scan ? scan.afterPred[selected] : null;
  const row = scan ? Math.floor(selected / scan.cols) : 0;
  const col = scan ? selected % scan.cols : 0;
  const referenceCell = scan?.reference?.[selected] ?? null;

  function findingsText() {
    if (!scan || !stats) return "";
    const lines = [
      "Clearcut study reading",
      scan.years
        ? `${scan.cols}×${scan.rows} held-out EuroSAT chips laid out as a ${scan.years[0]} and ${scan.years[1]} pass.`
        : `${scan.cols}×${scan.rows} chips from the uploaded pair.`,
      `Model forest loss: ${stats.modelLoss} patches, ${formatHectares(stats.modelLoss)}.`,
    ];
    if (scan.reference) {
      lines.push(`Label reference forest loss: ${stats.referenceLoss} patches, ${formatHectares(stats.referenceLoss)}.`);
      lines.push(
        `Against that reference: precision ${formatPercent(stats.precision)}, recall ${formatPercent(stats.recall)}, F1 ${formatPercent(stats.f1)}.`,
      );
    }
    if (accuracy !== null) lines.push(`Chip classifier held-out accuracy: ${formatPercent(accuracy)}.`);
    lines.push(
      "Each patch is 64×64 pixels at 10 m, so 40.96 hectares. This practice grid is not a Global Forest Watch polygon.",
    );
    return lines.join("\n");
  }

  async function copyFindings() {
    const text = findingsText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Clipboard is blocked in this browser. Select the findings and copy them manually.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-2xl">Two passes, one grid</CardTitle>
          <CardDescription>
            Forest in the earlier pass that becomes farmland, pasture, or built ground is the loss call.
            The built-in grid uses held-out chips, so the score is not memorized training data.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Button type="button" className="!h-11 px-4" disabled={!ready || busy} onClick={() => void runStudy()}>
              {busy ? "Reading patches…" : "Run the study grid"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="!h-11 max-w-full truncate bg-card px-4"
              disabled={!ready || busy}
              onClick={() => beforeRef.current?.click()}
            >
              {beforeName ? `Earlier: ${beforeName}` : "Upload earlier year"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="!h-11 max-w-full truncate bg-card px-4"
              disabled={!ready || busy}
              onClick={() => afterRef.current?.click()}
            >
              {afterName ? `Later: ${afterName}` : "Upload later year"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="!h-11 px-4"
              disabled={!ready || busy}
              onClick={() => void runUploads()}
            >
              Read my pair
            </Button>
            <input
              ref={beforeRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                beforeFile.current = file;
                setBeforeName(file?.name ?? null);
                event.target.value = "";
              }}
            />
            <input
              ref={afterRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                afterFile.current = file;
                setAfterName(file?.name ?? null);
                event.target.value = "";
              }}
            />
          </div>
          {busy ? <Progress value={null} aria-label="Reading the grid" className="max-w-xs" /> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {!scan && !error ? (
            <p className="text-sm text-muted-foreground">
              {ready ? "Laying out the 2018 and 2024 passes…" : "Loading the land-cover weights…"}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {scan && stats && cell && later ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <YearMap
              title={scan.years ? String(scan.years[0]) : "Earlier"}
              src={scan.beforeUrl}
              scan={scan}
              flags={stats.flags}
              selected={selected}
              onSelect={setSelected}
              tone="before"
            />
            <YearMap
              title={scan.years ? String(scan.years[1]) : "Later"}
              src={scan.afterUrl}
              scan={scan}
              flags={stats.flags}
              selected={selected}
              onSelect={setSelected}
              tone="after"
            />
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <span className="size-3 rounded-sm bg-[rgba(196,107,74,0.7)]" aria-hidden />
              Model calls forest loss
            </span>
            {scan.reference ? (
              <>
                <span className="inline-flex items-center gap-2">
                  <span className="size-3 rounded-sm border-2 border-[#c4922a]" aria-hidden />
                  Reference loss the model missed
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="size-3 rounded-sm border-2 border-[#1d4e89]" aria-hidden />
                  Model loss the labels do not call
                </span>
              </>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.7fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="font-heading text-xl">
                  Row {row + 1}, column {col + 1}
                </CardTitle>
                <CardDescription>
                  {referenceCell
                    ? `Labels say ${displayName(referenceCell.before)} then ${displayName(referenceCell.after)}.`
                    : "No label reference for an uploaded pair. This cell is the model only."}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <figure>
                  <ChipCanvas
                    src={scan.beforeUrl}
                    row={row}
                    col={col}
                    patch={scan.patch}
                    label={`${scan.years?.[0] ?? "Earlier"} chip, read as ${displayName(cell.label)}`}
                  />
                  <figcaption className="mt-2 text-sm">
                    <span className="text-muted-foreground">{scan.years?.[0] ?? "Earlier"} · </span>
                    {displayName(cell.label)} · {formatPercent(cell.confidence)}
                  </figcaption>
                </figure>
                <figure>
                  <ChipCanvas
                    src={scan.afterUrl}
                    row={row}
                    col={col}
                    patch={scan.patch}
                    label={`${scan.years?.[1] ?? "Later"} chip, read as ${displayName(later.label)}`}
                  />
                  <figcaption className="mt-2 text-sm">
                    <span className="text-muted-foreground">{scan.years?.[1] ?? "Later"} · </span>
                    {displayName(later.label)} · {formatPercent(later.confidence)}
                  </figcaption>
                </figure>
                <p className="text-sm sm:col-span-2">
                  {stats.flags[selected]?.model
                    ? "The model calls this cell forest loss: forest first, then farmland, pasture, or built ground."
                    : "The model does not call forest loss on this cell."}{" "}
                  {stats.flags[selected]?.reference === true
                    ? "The labels agree that the stand was cleared."
                    : stats.flags[selected]?.reference === false
                      ? "The labels do not call this cell forest loss."
                      : "Upload a registered pair when you want a real site instead of this practice grid."}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="font-heading text-xl">Score</CardTitle>
                <CardDescription>
                  {scan.cols * scan.rows} patches · {formatHectares(1)} each at 10 m pixels
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <Stat label="Model forest loss" value={`${stats.modelLoss} · ${formatHectares(stats.modelLoss)}`} />
                {scan.reference ? (
                  <>
                    <Stat label="Reference forest loss" value={`${stats.referenceLoss} · ${formatHectares(stats.referenceLoss)}`} />
                    <Stat label="Precision" value={formatPercent(stats.precision)} />
                    <Stat label="Recall" value={formatPercent(stats.recall)} />
                    <Stat label="F1" value={formatPercent(stats.f1)} />
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Uploaded scenes have no reference layer, so precision and recall stay hidden.
                  </p>
                )}
                <Stat label="Stable forest" value={String(stats.stableForest)} />
                <Stat label="Model regrowth" value={String(stats.regrowth)} />
                {stats.topTransitions.length > 0 ? (
                  <div>
                    <p className="mb-1 text-muted-foreground">Most common changes</p>
                    <ul>
                      {stats.topTransitions.map(([name, count]) => (
                        <li key={name} className="flex justify-between gap-3">
                          <span>{name}</span>
                          <span className="tabular-nums">{count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <Button type="button" variant="outline" className="!h-11 bg-card" onClick={() => void copyFindings()}>
                  {copied ? "Copied" : "Copy findings"}
                </Button>
                {scan.cropped ? (
                  <p className="text-muted-foreground">
                    The pair was center-cut into a {scan.cols}×{scan.rows} block of 64-pixel chips.
                  </p>
                ) : null}
                {scan.disclaimer ? <p className="text-muted-foreground">{scan.disclaimer}</p> : null}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  );
}

function YearMap({
  title,
  src,
  scan,
  flags,
  selected,
  onSelect,
  tone,
}: {
  title: string;
  src: string;
  scan: Scan;
  flags: CellFlag[];
  selected: number;
  onSelect: (index: number) => void;
  tone: "before" | "after";
}) {
  return (
    <figure className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <figcaption className="flex items-baseline justify-between px-4 py-3">
        <span className="font-heading text-xl">{title}</span>
        <span className="text-xs text-muted-foreground">{tone === "before" ? "Earlier pass" : "Later pass"}</span>
      </figcaption>
      <div className="relative mx-3 mb-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${title} mosaic of Sentinel-2 land-cover chips`} className="block h-auto w-full rounded-lg" />
        <div
          className="absolute inset-0 grid"
          style={{ gridTemplateColumns: `repeat(${scan.cols}, minmax(0, 1fr))` }}
          role="grid"
          aria-label={`${title} land-cover grid`}
          onKeyDown={(event) => {
            const moves: Record<string, [number, number]> = {
              ArrowUp: [-1, 0],
              ArrowDown: [1, 0],
              ArrowLeft: [0, -1],
              ArrowRight: [0, 1],
            };
            const move = moves[event.key];
            if (!move) return;
            event.preventDefault();
            const currentRow = Math.floor(selected / scan.cols);
            const currentCol = selected % scan.cols;
            const nextRow = Math.min(scan.rows - 1, Math.max(0, currentRow + move[0]));
            const nextCol = Math.min(scan.cols - 1, Math.max(0, currentCol + move[1]));
            const next = nextRow * scan.cols + nextCol;
            onSelect(next);
            event.currentTarget.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus();
          }}
        >
          {scan.beforePred.map((_, index) => {
            const flag = flags[index];
            const cellRow = Math.floor(index / scan.cols) + 1;
            const cellCol = (index % scan.cols) + 1;
            const isSelected = index === selected;
            const missed = flag.reference === true && !flag.model;
            const extra = flag.model && flag.reference === false;
            return (
              <button
                key={`${tone}-${index}`}
                type="button"
                role="gridcell"
                data-index={index}
                tabIndex={isSelected ? 0 : -1}
                aria-selected={isSelected}
                aria-label={`Row ${cellRow}, column ${cellCol}${flag.model ? ", model forest loss" : ""}`}
                className={`border border-white/25 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring ${isSelected ? "z-10 ring-2 ring-foreground ring-inset" : ""}`}
                style={{
                  backgroundColor: flag.model ? "rgba(196, 107, 74, 0.48)" : "transparent",
                  boxShadow: missed
                    ? "inset 0 0 0 2px #c4922a"
                    : extra
                      ? "inset 0 0 0 2px #1d4e89"
                      : undefined,
                }}
                onClick={() => onSelect(index)}
              />
            );
          })}
        </div>
      </div>
    </figure>
  );
}
