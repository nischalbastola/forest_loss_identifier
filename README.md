# Clearcut

Clearcut is a browser lab for Sentinel-2 land cover. It classifies a 64×64 satellite chip into one of ten EuroSAT classes, then reads two passes of the same grid and flags forest that became farmland, pasture, or built ground.

The model runs in the page with TensorFlow.js. An uploaded chip is not sent to a server.

EuroSAT is the public benchmark from Helber, Bischke, Dengel, and Borth: 27,000 labeled Sentinel-2 patches. The sample strip and the study grid are held-out test chips, not images the net trained on. The 2018 / 2024 grid is a practice layout of those single-date chips. It is not a registered pair from one place, and it is not a Global Forest Watch polygon. A field study would swap in two real scenes and score them against [Global Forest Watch](https://www.globalforestwatch.org/).

## Run

```bash
npm install
npm run dev
```

The dev server listens on port 41731. Open [http://127.0.0.1:41731](http://127.0.0.1:41731).

## Test set

Every held-out chip is in [`public/test-set`](public/test-set), 4,050 JPEGs, same 15% split the accuracy number uses (seed 42). The list is [`public/test-set/index.json`](public/test-set/index.json).

Open `/test` in the running app to browse them, click any chip, and see the true class against the model’s call plus all ten probabilities. That page also prints the confusion matrix for the full test split.

## What you can do

- Classify a held-out chip, or drop in your own image. The net reads a 64×64 center square.
- Open **Two-year change** to scan the study grid. Clay cells are the model’s forest-loss calls. Gold outlines are reference losses it missed. Blue outlines are calls the labels do not support.
- Upload two images of the same pixel size to tile your own pair. That path has no label reference, so precision and recall stay hidden.
- Copy a plain-text findings note from the score card.

Each patch is 64×64 pixels at 10 m, which is 40.96 hectares. That figure is the patch area, not a surveyed clearing.

## Retrain

The committed weights score 95.9% on 4,050 held-out chips (forest F1 98.9%). They were produced by `scripts/train_classifier.py`. To train again, put the EuroSAT RGB folders at `/tmp/eurosat/EuroSAT_RGB/<Class>/*.jpg` (the Zenodo RGB zip unpacks into that layout) and run:

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
python3 scripts/train_classifier.py
```

The script writes `public/model`, `public/samples`, `public/scene`, and `src/data/metrics.json`. Test accuracy is whatever that run measures. The page reads it from the metrics file and from the model manifest.

## Dataset

- Paper: [EuroSAT (arXiv:1709.00029)](https://arxiv.org/abs/1709.00029)
- Files: [phelber/eurosat](https://github.com/phelber/eurosat)
