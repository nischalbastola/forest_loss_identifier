export const CLASSES = [
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
] as const;

export type LandClass = (typeof CLASSES)[number];

export const DISPLAY_NAME: Record<string, string> = {
  AnnualCrop: "Annual crop",
  Forest: "Forest",
  HerbaceousVegetation: "Herbaceous vegetation",
  Highway: "Highway",
  Industrial: "Industrial",
  Pasture: "Pasture",
  PermanentCrop: "Permanent crop",
  Residential: "Residential",
  River: "River",
  SeaLake: "Sea & lake",
};

export const CLASS_COLOR: Record<string, string> = {
  AnnualCrop: "#c4922a",
  Forest: "#1f7a45",
  HerbaceousVegetation: "#7eae62",
  Highway: "#5e584f",
  Industrial: "#8d5b6c",
  Pasture: "#b7c56a",
  PermanentCrop: "#5f8a38",
  Residential: "#c46b4a",
  River: "#3d7ea6",
  SeaLake: "#1d4e89",
};

/** Forest that becomes farmland, pasture, or built ground. */
export const LOSS_TARGETS = new Set<string>([
  "AnnualCrop",
  "Pasture",
  "PermanentCrop",
  "Residential",
  "Industrial",
  "Highway",
]);

export const HECTARES_PER_PATCH = 40.96;

export function displayName(label: string): string {
  return DISPLAY_NAME[label] ?? label;
}

export function isForestLoss(before: string, after: string): boolean {
  return before === "Forest" && LOSS_TARGETS.has(after);
}

export type Prediction = {
  label: string;
  confidence: number;
  scores: { label: string; probability: number }[];
};

export type SceneCell = {
  r: number;
  c: number;
  before: string;
  after: string;
};

export type SceneManifest = {
  id: string;
  title: string;
  years: [number, number];
  cols: number;
  rows: number;
  patch: number;
  metersPerPixel: number;
  hectaresPerPatch: number;
  before: string;
  after: string;
  cells: SceneCell[];
  disclaimer: string;
};

export type GalleryItem = {
  src: string;
  label: string;
  file: string;
};

export function formatHectares(patches: number, hectaresPerPatch = HECTARES_PER_PATCH): string {
  const value = patches * hectaresPerPatch;
  return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
