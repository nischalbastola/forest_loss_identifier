import dynamic from "next/dynamic";
import { readFileSync } from "node:fs";
import path from "node:path";

import { LabFallback } from "@/components/lab-fallback";
import { displayName, HECTARES_PER_PATCH } from "@/lib/landcover";

const Lab = dynamic(() => import("@/components/lab").then((mod) => mod.Lab), {
  loading: () => <LabFallback />,
});

type Metrics = {
  testAccuracy: number;
  testImages: number;
  parameters: number;
};

function loadMetrics(): Metrics | null {
  try {
    const raw = readFileSync(path.join(process.cwd(), "src/data/metrics.json"), "utf8");
    return JSON.parse(raw) as Metrics;
  } catch {
    return null;
  }
}

const classes = [
  "AnnualCrop",
  "Forest",
  "HerbaceousVegetation",
  "Highway",
  "Industrial",
  "Pasture",
  "PermanentCrop",
  "Residential",
  "River",
  "SeaLake",
];

export default function Home() {
  const metrics = loadMetrics();
  const accuracy = metrics ? `${(metrics.testAccuracy * 100).toFixed(1)}%` : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Clearcut",
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    description:
      "Browser lab that classifies EuroSAT Sentinel-2 chips into 10 land-cover classes and flags forest loss between two passes.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 sm:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <a
        href="#lab"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to the lab
      </a>

      <header className="mb-8 flex flex-col gap-6 sm:mb-10">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-medium tracking-wide text-primary uppercase">
            <span className="inline-block size-2.5 rounded-sm bg-primary" aria-hidden />
            Clearcut
          </p>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <a href="/test" className="underline-offset-4 hover:underline">
              Test set
            </a>
            <a href="#method" className="underline-offset-4 hover:underline">
              Method
            </a>
          </nav>
        </div>
        <div className="max-w-3xl">
          <h1 className="font-heading text-4xl leading-[1.05] tracking-tight sm:text-6xl">
            Read a satellite chip. Then see what the forest became.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-foreground/80 sm:text-lg">
            Clearcut classifies Sentinel-2 land cover in the browser and flags stands that turn into
            farmland, pasture, or built ground between two passes. The chips are the public EuroSAT set:
            27,000 labeled 64×64 patches, ten land types, ten meters a pixel.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact term="Labeled chips" detail="27,000" />
          <Fact term="Land types" detail="10" />
          <Fact term="Held-out accuracy" detail={accuracy ?? "Measured on test chips"} />
          <Fact term="Patch area" detail={`${HECTARES_PER_PATCH} ha`} />
        </dl>
      </header>

      <div id="lab">
        <Lab />
      </div>

      <section id="method" className="mt-14 border-t border-border pt-10 sm:mt-20">
        <h2 className="font-heading text-3xl tracking-tight sm:text-4xl">How the reading is made</h2>
        <div className="mt-6 grid gap-8 lg:grid-cols-2">
          <article className="flex flex-col gap-3">
            <h3 className="font-heading text-2xl">The dataset</h3>
            <p className="leading-relaxed text-foreground/80">
              EuroSAT is a benchmark of Sentinel-2 patches published by Helber, Bischke, Dengel, and Borth.
              Each image is 64×64 pixels from the visible bands. The ten classes are{" "}
              {classes.map(displayName).join(", ")}. Nothing here is a private satellite feed. The sample
              strip and the study grid are drawn from the held-out test split, not the images the net trained on.
            </p>
            <p className="leading-relaxed text-foreground/80">
              Paper:{" "}
              <a className="underline underline-offset-4" href="https://arxiv.org/abs/1709.00029">
                EuroSAT: A Novel Dataset and Deep Learning Benchmark
              </a>
              . Files:{" "}
              <a className="underline underline-offset-4" href="https://github.com/phelber/eurosat">
                phelber/eurosat
              </a>
              .
            </p>
          </article>
          <article className="flex flex-col gap-3">
            <h3 className="font-heading text-2xl">The model</h3>
            <p className="leading-relaxed text-foreground/80">
              The walkthrough this lab follows fine-tunes ResNet-50 and quotes accuracy above 95 percent.
              Clearcut trains a smaller convolutional net on the same RGB chips so the weights can live in
              the page
              {metrics
                ? ` (${metrics.parameters.toLocaleString("en-US")} parameters, ${accuracy} on ${metrics.testImages.toLocaleString("en-US")} test chips)`
                : ""}
              . Batch-norm is folded into the convolutions. TensorFlow.js runs the forward pass on your GPU.
              A photo you upload is not sent to a server.
            </p>
            <p className="leading-relaxed text-foreground/80">
              Forest loss means the earlier chip is forest and the later chip is annual crop, permanent crop,
              pasture, residential, industrial, or highway. At 10 m pixels, one patch covers {HECTARES_PER_PATCH}{" "}
              hectares. That number is a patch area, not a surveyed polygon.
            </p>
          </article>
          <article className="flex flex-col gap-3 lg:col-span-2">
            <h3 className="font-heading text-2xl">What this is not</h3>
            <p className="leading-relaxed text-foreground/80">
              EuroSAT chips are single-date snapshots. The 2018 and 2024 grid is a practice layout of those
              chips, not two registered scenes of one place. A field study would swap the grid for two real
              Sentinel-2 dates and score the calls against{" "}
              <a className="underline underline-offset-4" href="https://www.globalforestwatch.org/">
                Global Forest Watch
              </a>
              . Student journals named in the walkthrough, including the Journal of Emerging Investigators,
              expect that outside check. Treat the hectares on this page as a reading of the practice grid.
            </p>
          </article>
        </div>
      </section>

      <footer className="mt-12 border-t border-border py-6 text-sm text-muted-foreground">
        <p>Clearcut. Sentinel-2 land cover, read in the browser.</p>
      </footer>
    </div>
  );
}

function Fact({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="rounded-xl bg-card px-3 py-3 ring-1 ring-foreground/10">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="font-heading text-xl leading-tight sm:text-2xl">{detail}</dd>
    </div>
  );
}
