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

export const METERS_PER_PIXEL = 10;
export const PATCH_PIXELS = 64;
export const SQUARE_METERS_PER_PATCH = PATCH_PIXELS * METERS_PER_PIXEL * PATCH_PIXELS * METERS_PER_PIXEL;

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
  squareMetersPerPatch: number;
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

export function formatSquareMeters(patches: number, squareMetersPerPatch = SQUARE_METERS_PER_PATCH): string {
  const value = patches * squareMetersPerPatch;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} m²`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
