import type { Metadata } from "next";
import Link from "next/link";

import { TestBrowser } from "@/components/test-browser";
import {
  CONFUSION_CORRECT,
  CONFUSION_LABELS,
  CONFUSION_MATRIX,
  CONFUSION_TOTAL,
} from "@/data/confusion";
import { displayName } from "@/lib/landcover";

const description =
  "All 4,050 held-out EuroSAT test chips. Open any image and see the land-cover call plus the full probability breakdown.";

export const metadata: Metadata = {
  title: "Test set",
  description,
  openGraph: { title: "Clearcut test set", description },
};

export default function TestPage() {
  const accuracy = CONFUSION_CORRECT / CONFUSION_TOTAL;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-8 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 text-sm font-medium tracking-wide text-primary uppercase">
            <span className="inline-block size-2.5 rounded-sm bg-primary" aria-hidden />
            Clearcut
          </Link>
          <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Lab
          </Link>
        </div>
        <div className="max-w-3xl">
          <h1 className="font-heading text-4xl leading-tight tracking-tight sm:text-5xl">The held-out test set</h1>
          <p className="mt-4 text-base leading-relaxed text-foreground/80 sm:text-lg">
            These {CONFUSION_TOTAL.toLocaleString("en-US")} Sentinel-2 chips were never used to update the weights.
            Pick one. The page runs the same model and shows every class score, including the ones it almost chose.
          </p>
        </div>
      </header>

      <section aria-labelledby="matrix-heading" className="mb-10">
        <h2 id="matrix-heading" className="font-heading text-3xl tracking-tight">
          Confusion matrix
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Rows are the true class. Columns are the model’s call. The diagonal is correct.{" "}
          {CONFUSION_CORRECT.toLocaleString("en-US")} of {CONFUSION_TOTAL.toLocaleString("en-US")} chips are on that
          diagonal, which is {(accuracy * 100).toFixed(2)}% accuracy. The other{" "}
          {(CONFUSION_TOTAL - CONFUSION_CORRECT).toLocaleString("en-US")} are the misses.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
          <table className="w-full min-w-[46rem] border-collapse text-left text-xs sm:text-sm">
            <caption className="sr-only">
              Confusion matrix for the 4,050-image EuroSAT test split. Rows are truth, columns are predictions.
            </caption>
            <thead>
              <tr>
                <th className="sticky left-0 bg-card px-3 py-2 font-medium">True \ Called</th>
                {CONFUSION_LABELS.map((label) => (
                  <th key={label} className="px-2 py-2 font-medium">
                    {displayName(label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CONFUSION_MATRIX.map((row, rowIndex) => (
                <tr key={CONFUSION_LABELS[rowIndex]} className="border-t border-border">
                  <th className="sticky left-0 bg-card px-3 py-2 text-left font-medium">{displayName(CONFUSION_LABELS[rowIndex])}</th>
                  {row.map((value, columnIndex) => {
                    const diagonal = rowIndex === columnIndex;
                    return (
                      <td
                        key={`${rowIndex}-${columnIndex}`}
                        className={`px-2 py-2 tabular-nums ${diagonal ? "bg-primary/15 font-medium" : value > 0 ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="browse-heading">
        <h2 id="browse-heading" className="mb-4 font-heading text-3xl tracking-tight">
          Every test chip
        </h2>
        <TestBrowser />
      </section>
    </div>
  );
}
