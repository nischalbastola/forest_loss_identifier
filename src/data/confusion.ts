/** Held-out confusion matrix for the shipped weights. Rows are the true class, columns are the prediction. */
export const CONFUSION_LABELS = [
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

export const CONFUSION_MATRIX: number[][] = [
  [421, 2, 3, 1, 0, 6, 8, 0, 4, 5],
  [0, 447, 1, 0, 0, 1, 0, 0, 0, 1],
  [0, 1, 433, 0, 1, 5, 7, 2, 1, 0],
  [4, 2, 2, 345, 6, 0, 7, 2, 7, 0],
  [0, 0, 0, 2, 365, 0, 3, 3, 2, 0],
  [3, 1, 5, 0, 0, 286, 0, 0, 5, 0],
  [3, 0, 16, 0, 1, 0, 351, 0, 4, 0],
  [0, 0, 5, 0, 1, 0, 0, 444, 0, 0],
  [7, 0, 5, 10, 0, 3, 3, 0, 345, 2],
  [3, 1, 0, 0, 0, 1, 0, 0, 0, 445],
];

export const CONFUSION_CORRECT = 3882;
export const CONFUSION_TOTAL = 4050;
