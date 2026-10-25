import type * as Tf from "@tensorflow/tfjs";

import type { Prediction } from "@/lib/landcover";

type ConvLayer = {
  op: "conv";
  k: number;
  stride: number;
  pad: number;
  in: number;
  out: number;
  w: number;
  b: number;
};

type LinearLayer = {
  op: "linear";
  in: number;
  out: number;
  w: number;
  b: number;
};

type Layer = ConvLayer | LinearLayer | { op: "relu" } | { op: "gap" };

export type ModelManifest = {
  classes: string[];
  input: number;
  mean: number[];
  std: number[];
  testAccuracy: number;
  perClass: Record<string, { precision: number; recall: number; f1: number; support: number }>;
  layers: Layer[];
};

type ConvParam = { w: Tf.Tensor4D; b: Tf.Tensor1D };
type LinearParam = { w: Tf.Tensor2D; b: Tf.Tensor1D };

type Session = {
  tf: typeof Tf;
  manifest: ModelManifest;
  convs: ConvParam[];
  linear: LinearParam;
};

let sessionPromise: Promise<Session> | null = null;
let queue: Promise<unknown> = Promise.resolve();

export function loadModel(): Promise<Session> {
  if (!sessionPromise) {
    sessionPromise = createSession().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

async function createSession(): Promise<Session> {
  const tf = await import("@tensorflow/tfjs");
  try {
    await tf.setBackend("webgl");
  } catch {
    await tf.setBackend("cpu");
  }
  await tf.ready();

  const [manifestRes, weightsRes, biasRes] = await Promise.all([
    fetch("/model/manifest.json"),
    fetch("/model/weights.bin"),
    fetch("/model/bias.bin"),
  ]);
  if (!manifestRes.ok || !weightsRes.ok || !biasRes.ok) {
    throw new Error("The land-cover weights did not load.");
  }

  const manifest = (await manifestRes.json()) as ModelManifest;
  const weights = new Float32Array(await weightsRes.arrayBuffer());
  const bias = new Float32Array(await biasRes.arrayBuffer());
  const convs: ConvParam[] = [];
  let linear: LinearParam | null = null;

  for (const layer of manifest.layers) {
    if (layer.op === "conv") {
      const count = layer.k * layer.k * layer.in * layer.out;
      convs.push({
        w: tf.tensor4d(weights.slice(layer.w, layer.w + count), [layer.k, layer.k, layer.in, layer.out]),
        b: tf.tensor1d(bias.slice(layer.b, layer.b + layer.out)),
      });
    } else if (layer.op === "linear") {
      linear = {
        w: tf.tensor2d(weights.slice(layer.w, layer.w + layer.in * layer.out), [layer.in, layer.out]),
        b: tf.tensor1d(bias.slice(layer.b, layer.b + layer.out)),
      };
    }
  }

  if (!linear) {
    throw new Error("The model file is missing its classifier head.");
  }

  return { tf, manifest, convs, linear };
}

function forward(session: Session, batch: Tf.Tensor4D): Tf.Tensor2D {
  const { tf, manifest, convs, linear } = session;
  return tf.tidy(() => {
    let x: Tf.Tensor = batch;
    let convIndex = 0;
    for (const layer of manifest.layers) {
      if (layer.op === "conv") {
        const param = convs[convIndex];
        convIndex += 1;
        if (layer.pad > 0) {
          x = tf.pad(x as Tf.Tensor4D, [
            [0, 0],
            [layer.pad, layer.pad],
            [layer.pad, layer.pad],
            [0, 0],
          ]);
        }
        const y = tf.conv2d(x as Tf.Tensor4D, param.w, [layer.stride, layer.stride], "valid");
        x = tf.add(y, param.b);
      } else if (layer.op === "relu") {
        x = tf.relu(x);
      } else if (layer.op === "gap") {
        x = tf.mean(x as Tf.Tensor4D, [1, 2]);
      } else {
        x = tf.add(tf.matMul(x as Tf.Tensor2D, linear.w), linear.b);
      }
    }
    return tf.softmax(x as Tf.Tensor2D);
  });
}

export function predictImageData(images: ImageData[]): Promise<Prediction[]> {
  const run = queue.then(() => predictNow(images));
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function predictNow(images: ImageData[]): Promise<Prediction[]> {
  if (images.length === 0) return [];
  const session = await loadModel();
  const { tf, manifest } = session;
  const size = manifest.input;
  for (const image of images) {
    if (image.width !== size || image.height !== size) {
      throw new Error(`The model reads ${size}×${size} chips. This one is ${image.width}×${image.height}.`);
    }
  }

  const probs = tf.tidy(() => {
    const chips = images.map((image) => {
      const pixels = tf.browser.fromPixels(image).toFloat().div(255);
      return pixels.sub(tf.tensor1d(manifest.mean)).div(tf.tensor1d(manifest.std));
    });
    return forward(session, tf.stack(chips) as Tf.Tensor4D);
  });

  const values = await probs.data();
  probs.dispose();

  const classCount = manifest.classes.length;
  const predictions: Prediction[] = [];
  for (let index = 0; index < images.length; index += 1) {
    const scores = manifest.classes.map((label, classIndex) => ({
      label,
      probability: values[index * classCount + classIndex] ?? 0,
    }));
    scores.sort((a, b) => b.probability - a.probability);
    predictions.push({
      label: scores[0]?.label ?? "Unknown",
      confidence: scores[0]?.probability ?? 0,
      scores,
    });
  }
  return predictions;
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode();
  return image;
}

export function squareChip(image: CanvasImageSource, width: number, height: number, size = 64): ImageData {
  const side = Math.min(width, height);
  const sx = Math.floor((width - side) / 2);
  const sy = Math.floor((height - side) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot read pixels from a canvas.");
  context.drawImage(image, sx, sy, side, side, 0, 0, size, size);
  return context.getImageData(0, 0, size, size);
}

export function tileChips(
  image: CanvasImageSource,
  originX: number,
  originY: number,
  cols: number,
  rows: number,
  patch = 64,
): ImageData[] {
  const canvas = document.createElement("canvas");
  canvas.width = patch;
  canvas.height = patch;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot read pixels from a canvas.");
  const tiles: ImageData[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      context.drawImage(
        image,
        originX + col * patch,
        originY + row * patch,
        patch,
        patch,
        0,
        0,
        patch,
        patch,
      );
      tiles.push(context.getImageData(0, 0, patch, patch));
    }
  }
  return tiles;
}

export function frameSize(width: number, height: number, patch = 64, maxTiles = 8) {
  const cols = Math.min(maxTiles, Math.floor(width / patch));
  const rows = Math.min(maxTiles, Math.floor(height / patch));
  if (cols < 1 || rows < 1) {
    throw new Error("Each image needs to be at least 64×64 pixels.");
  }
  const cropW = cols * patch;
  const cropH = rows * patch;
  return {
    cols,
    rows,
    patch,
    originX: Math.floor((width - cropW) / 2),
    originY: Math.floor((height - cropH) / 2),
    cropW,
    cropH,
    cropped: cropW !== width || cropH !== height,
  };
}
