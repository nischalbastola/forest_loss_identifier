"""Train a compact EuroSAT land-cover CNN and export browser weights.

The Instagram lab this repo follows fine-tunes ResNet-50. This script trains a
much smaller conv net on the same 27,000 EuroSAT RGB chips so inference can
run in the page. Weights are fused (conv + batch-norm) and saved NHWC, which
is what TensorFlow.js conv2d expects.

Dataset layout (not committed):
  /tmp/eurosat/EuroSAT_RGB/<ClassName>/*.jpg
"""

from __future__ import annotations

import json
import random
import shutil
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms

ROOT = Path("/workspace")
DATA = Path("/tmp/eurosat/EuroSAT_RGB")
PUBLIC = ROOT / "public"
MODEL_DIR = PUBLIC / "model"
SCENE_DIR = PUBLIC / "scene"
SAMPLE_DIR = PUBLIC / "samples"

CLASSES = [
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
]

# Forest that becomes one of these is the deforestation call from the reel:
# farmland, pasture, built land, or a highway cutting the stand.
LOSS_TARGETS = {
    "AnnualCrop",
    "Pasture",
    "PermanentCrop",
    "Residential",
    "Industrial",
    "Highway",
}

SEED = 42
EPOCHS = 12
BATCH = 128
GRID = 8


class ChipDataset(Dataset):
    def __init__(self, rows: list[tuple[Path, int]], tfm: transforms.Compose):
        self.rows = rows
        self.tfm = tfm

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int):
        path, label = self.rows[index]
        image = Image.open(path).convert("RGB")
        return self.tfm(image), label


class Net(nn.Module):
    def __init__(self) -> None:
        super().__init__()

        def block(in_ch: int, out_ch: int, stride: int) -> nn.Sequential:
            return nn.Sequential(
                nn.Conv2d(in_ch, out_ch, 3, stride=stride, padding=1, bias=False),
                nn.BatchNorm2d(out_ch),
                nn.ReLU(inplace=True),
            )

        self.features = nn.Sequential(
            block(3, 32, 1),
            block(32, 32, 1),
            block(32, 64, 2),
            block(64, 64, 1),
            block(64, 96, 2),
            block(96, 96, 1),
            block(96, 128, 2),
            block(128, 128, 1),
        )
        self.head = nn.Linear(128, 10)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.features(x)
        x = x.mean(dim=(2, 3))
        return self.head(x)


def list_images() -> dict[str, list[Path]]:
    found = sorted(p.name for p in DATA.iterdir() if p.is_dir())
    if found != CLASSES:
        raise SystemExit(f"Unexpected class folders: {found}")
    grouped: dict[str, list[Path]] = {}
    for name in CLASSES:
        paths = sorted((DATA / name).glob("*.jpg"))
        if len(paths) < 100:
            raise SystemExit(f"{name} has too few images ({len(paths)})")
        grouped[name] = paths
    return grouped


def split_rows(
    grouped: dict[str, list[Path]],
) -> tuple[list[tuple[Path, int]], list[tuple[Path, int]], list[tuple[Path, int]]]:
    rng = random.Random(SEED)
    train: list[tuple[Path, int]] = []
    val: list[tuple[Path, int]] = []
    test: list[tuple[Path, int]] = []
    for index, name in enumerate(CLASSES):
        paths = grouped[name][:]
        rng.shuffle(paths)
        n = len(paths)
        n_test = int(round(n * 0.15))
        n_val = int(round(n * 0.10))
        test.extend((p, index) for p in paths[:n_test])
        val.extend((p, index) for p in paths[n_test : n_test + n_val])
        train.extend((p, index) for p in paths[n_test + n_val :])
    return train, val, test


def channel_stats(rows: list[tuple[Path, int]]) -> tuple[list[float], list[float]]:
    total = np.zeros(3, dtype=np.float64)
    total_sq = np.zeros(3, dtype=np.float64)
    count = 0
    for path, _ in rows:
        arr = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64) / 255.0
        total += arr.sum(axis=(0, 1))
        total_sq += np.square(arr).sum(axis=(0, 1))
        count += arr.shape[0] * arr.shape[1]
    mean = total / count
    var = total_sq / count - np.square(mean)
    std = np.sqrt(np.maximum(var, 1e-8))
    return mean.tolist(), std.tolist()


def accuracy(model: nn.Module, loader: DataLoader, device: torch.device) -> tuple[float, np.ndarray]:
    model.eval()
    correct = 0
    total = 0
    confusion = np.zeros((10, 10), dtype=np.int64)
    with torch.no_grad():
        for images, labels in loader:
            images = images.to(device)
            labels = labels.to(device)
            pred = model(images).argmax(dim=1)
            correct += int((pred == labels).sum())
            total += labels.shape[0]
            for truth, guess in zip(labels.tolist(), pred.tolist()):
                confusion[truth, guess] += 1
    return correct / max(total, 1), confusion


def fuse_conv_bn(conv: nn.Conv2d, bn: nn.BatchNorm2d) -> tuple[np.ndarray, np.ndarray]:
    weight = conv.weight.detach()
    gamma = bn.weight.detach()
    beta = bn.bias.detach()
    mean = bn.running_mean
    var = bn.running_var
    scale = gamma / torch.sqrt(var + bn.eps)
    fused_w = weight * scale.reshape(-1, 1, 1, 1)
    fused_b = beta - mean * scale
    # PyTorch NCHW [out, in, k, k] -> TF [k, k, in, out]
    nhwc = fused_w.permute(2, 3, 1, 0).contiguous().numpy().astype(np.float32)
    return nhwc, fused_b.numpy().astype(np.float32)


def export_model(
    model: Net,
    mean: list[float],
    std: list[float],
    test_accuracy: float,
    per_class: dict[str, dict[str, float]],
) -> tuple[dict, np.ndarray, np.ndarray]:
    model.eval()
    weight_parts: list[np.ndarray] = []
    bias_parts: list[np.ndarray] = []
    layers: list[dict] = []

    def append(weight: np.ndarray, bias: np.ndarray) -> tuple[int, int]:
        w_off = int(sum(part.size for part in weight_parts))
        b_off = int(sum(part.size for part in bias_parts))
        weight_parts.append(np.ascontiguousarray(weight, dtype=np.float32).ravel())
        bias_parts.append(np.ascontiguousarray(bias, dtype=np.float32).ravel())
        return w_off, b_off

    for block in model.features:
        conv, bn, _relu = block[0], block[1], block[2]
        weight, bias = fuse_conv_bn(conv, bn)
        w_off, b_off = append(weight, bias)
        layers.append(
            {
                "op": "conv",
                "k": int(conv.kernel_size[0]),
                "stride": int(conv.stride[0]),
                "pad": int(conv.padding[0]),
                "in": int(conv.in_channels),
                "out": int(conv.out_channels),
                "w": w_off,
                "b": b_off,
            }
        )
        layers.append({"op": "relu"})

    layers.append({"op": "gap"})
    linear_w = model.head.weight.detach().t().contiguous().numpy().astype(np.float32)
    linear_b = model.head.bias.detach().numpy().astype(np.float32)
    w_off, b_off = append(linear_w, linear_b)
    layers.append(
        {
            "op": "linear",
            "in": int(model.head.in_features),
            "out": int(model.head.out_features),
            "w": w_off,
            "b": b_off,
        }
    )

    manifest = {
        "dataset": "EuroSAT RGB",
        "images": 27000,
        "classes": CLASSES,
        "input": 64,
        "mean": mean,
        "std": std,
        "layout": "nhwc-tf",
        "testAccuracy": test_accuracy,
        "perClass": per_class,
        "layers": layers,
        "note": (
            "Compact CNN trained on EuroSAT RGB. Conv and batch-norm are fused. "
            "Convolution weights are [k, k, in, out]. Dense weights are [in, out]."
        ),
    }
    weights = np.concatenate(weight_parts)
    biases = np.concatenate(bias_parts)
    return manifest, weights, biases


def conv2d_nhwc(x: np.ndarray, weight: np.ndarray, bias: np.ndarray, stride: int, pad: int) -> np.ndarray:
    if pad:
        x = np.pad(x, ((pad, pad), (pad, pad), (0, 0)))
    k = weight.shape[0]
    windows = np.lib.stride_tricks.sliding_window_view(x, (k, k, weight.shape[2]))
    windows = windows[::stride, ::stride, 0]
    out_h, out_w = windows.shape[:2]
    flat = windows.reshape(out_h * out_w, -1)
    out = flat @ weight.reshape(-1, weight.shape[-1]) + bias
    return out.reshape(out_h, out_w, weight.shape[-1]).astype(np.float32)


def numpy_logits(rgb: np.ndarray, manifest: dict, weights: np.ndarray, biases: np.ndarray) -> np.ndarray:
    mean = np.asarray(manifest["mean"], dtype=np.float32)
    std = np.asarray(manifest["std"], dtype=np.float32)
    x: np.ndarray = (rgb.astype(np.float32) / 255.0 - mean) / std
    flat: np.ndarray | None = None
    for layer in manifest["layers"]:
        op = layer["op"]
        if op == "conv":
            w = weights[layer["w"] : layer["w"] + layer["k"] ** 2 * layer["in"] * layer["out"]]
            b = biases[layer["b"] : layer["b"] + layer["out"]]
            w = w.reshape(layer["k"], layer["k"], layer["in"], layer["out"])
            x = conv2d_nhwc(x, w, b, layer["stride"], layer["pad"])
        elif op == "relu":
            x = np.maximum(x, 0)
        elif op == "gap":
            flat = x.mean(axis=(0, 1)).astype(np.float32)
        elif op == "linear":
            assert flat is not None
            w = weights[layer["w"] : layer["w"] + layer["in"] * layer["out"]].reshape(layer["in"], layer["out"])
            b = biases[layer["b"] : layer["b"] + layer["out"]]
            flat = flat @ w + b
        else:
            raise RuntimeError(op)
    assert flat is not None
    return flat


def verify_export(model: Net, manifest: dict, weights: np.ndarray, biases: np.ndarray, rows: list[tuple[Path, int]], mean, std) -> None:
    tfm = transforms.Compose(
        [
            transforms.ToTensor(),
            transforms.Normalize(mean, std),
        ]
    )
    model.eval()
    worst = 0.0
    with torch.no_grad():
        for path, _label in rows[:24]:
            pil = Image.open(path).convert("RGB")
            rgb = np.asarray(pil)
            logits_np = numpy_logits(rgb, manifest, weights, biases)
            logits_pt = model(tfm(pil).unsqueeze(0)).numpy()[0]
            worst = max(worst, float(np.max(np.abs(logits_np - logits_pt))))
    print(f"export max abs logit drift: {worst:.6f}")
    if worst > 1e-3:
        raise SystemExit("Exported weights do not match the PyTorch net")


def per_class_report(confusion: np.ndarray) -> dict[str, dict[str, float]]:
    report: dict[str, dict[str, float]] = {}
    for index, name in enumerate(CLASSES):
        tp = float(confusion[index, index])
        support = float(confusion[index].sum())
        predicted = float(confusion[:, index].sum())
        precision = tp / predicted if predicted else 0.0
        recall = tp / support if support else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if precision + recall else 0.0
        report[name] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "support": int(support),
        }
    return report


def slug(name: str) -> str:
    return (
        name.replace("HerbaceousVegetation", "herbaceous")
        .replace("AnnualCrop", "annual-crop")
        .replace("PermanentCrop", "permanent-crop")
        .replace("SeaLake", "sea-lake")
        .lower()
    )


def write_samples(test_rows: list[tuple[Path, int]]) -> list[dict]:
    if SAMPLE_DIR.exists():
        shutil.rmtree(SAMPLE_DIR)
    SAMPLE_DIR.mkdir(parents=True)
    by_class: dict[int, list[Path]] = defaultdict(list)
    for path, label in test_rows:
        by_class[label].append(path)
    gallery = []
    for index, name in enumerate(CLASSES):
        picks = sorted(by_class[index])[:3]
        for nth, path in enumerate(picks):
            filename = f"{slug(name)}-{nth}.jpg"
            shutil.copy(path, SAMPLE_DIR / filename)
            gallery.append({"src": f"/samples/{filename}", "label": name, "file": path.name})
    return gallery


def write_scene(test_rows: list[tuple[Path, int]]) -> None:
    by_name: dict[str, list[Path]] = defaultdict(list)
    for path, label in test_rows:
        by_name[CLASSES[label]].append(path)
    for name in CLASSES:
        by_name[name] = sorted(by_name[name])

    rng = random.Random(7)
    recipes: list[tuple[str, str]] = []
    # 18 cleared stands, 16 forest that stays, 8 regrowth, 10 water, 12 other stable.
    recipes += [("Forest", "AnnualCrop")] * 7
    recipes += [("Forest", "Pasture")] * 4
    recipes += [("Forest", "Residential")] * 3
    recipes += [("Forest", "Industrial")] * 2
    recipes += [("Forest", "Highway")] * 2
    recipes += [("Forest", "Forest")] * 16
    recipes += [("AnnualCrop", "Forest")] * 4
    recipes += [("Pasture", "Forest")] * 2
    recipes += [("HerbaceousVegetation", "Forest")] * 2
    recipes += [("River", "River")] * 5
    recipes += [("SeaLake", "SeaLake")] * 5
    recipes += [("Residential", "Residential")] * 4
    recipes += [("Highway", "Highway")] * 2
    recipes += [("PermanentCrop", "PermanentCrop")] * 3
    recipes += [("Pasture", "Pasture")] * 2
    recipes += [("Industrial", "Industrial")] * 1
    if len(recipes) != GRID * GRID:
        raise SystemExit(f"grid recipe count {len(recipes)} != {GRID * GRID}")
    rng.shuffle(recipes)

    cursors = {name: 0 for name in CLASSES}

    def take(name: str) -> Image.Image:
        pool = by_name[name]
        image = Image.open(pool[cursors[name] % len(pool)]).convert("RGB")
        cursors[name] += 1
        return image

    before = Image.new("RGB", (GRID * 64, GRID * 64))
    after = Image.new("RGB", (GRID * 64, GRID * 64))
    cells = []
    for index, (earlier, later) in enumerate(recipes):
        row, col = divmod(index, GRID)
        before.paste(take(earlier), (col * 64, row * 64))
        after.paste(take(later), (col * 64, row * 64))
        cells.append({"r": row, "c": col, "before": earlier, "after": later})

    SCENE_DIR.mkdir(parents=True, exist_ok=True)
    before.save(SCENE_DIR / "before.png")
    after.save(SCENE_DIR / "after.png")
    manifest = {
        "id": "study-grid",
        "title": "Held-out study grid",
        "years": [2018, 2024],
        "cols": GRID,
        "rows": GRID,
        "patch": 64,
        "metersPerPixel": 10,
        "squareMetersPerPatch": 409600,
        "before": "/scene/before.png",
        "after": "/scene/after.png",
        "cells": cells,
        "disclaimer": (
            "EuroSAT chips are single-date 64×64 Sentinel-2 patches, not a registered pair "
            "from one place. This grid lays held-out chips into a 2018 and a 2024 pass so "
            "you can run the forest-to-farmland test. A field study would swap the grid for "
            "two real scenes and score them against Global Forest Watch."
        ),
    }
    (SCENE_DIR / "manifest.json").write_text(json.dumps(manifest))


def train() -> None:
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("cpu")
    torch.set_num_threads(4)

    grouped = list_images()
    train_rows, val_rows, test_rows = split_rows(grouped)
    print(f"splits train={len(train_rows)} val={len(val_rows)} test={len(test_rows)}")
    print("measuring channel mean and std...")
    mean, std = channel_stats(train_rows)
    print("mean", [round(v, 4) for v in mean], "std", [round(v, 4) for v in std])

    train_tf = transforms.Compose(
        [
            transforms.RandomHorizontalFlip(),
            transforms.RandomVerticalFlip(),
            transforms.ToTensor(),
            transforms.Normalize(mean, std),
        ]
    )
    eval_tf = transforms.Compose(
        [
            transforms.ToTensor(),
            transforms.Normalize(mean, std),
        ]
    )
    train_loader = DataLoader(ChipDataset(train_rows, train_tf), batch_size=BATCH, shuffle=True, num_workers=2)
    val_loader = DataLoader(ChipDataset(val_rows, eval_tf), batch_size=BATCH, shuffle=False, num_workers=2)
    test_loader = DataLoader(ChipDataset(test_rows, eval_tf), batch_size=BATCH, shuffle=False, num_workers=2)

    model = Net().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=EPOCHS)
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.05)

    best_state = None
    best_val = -1.0
    for epoch in range(1, EPOCHS + 1):
        model.train()
        running = 0.0
        seen = 0
        for images, labels in train_loader:
            images = images.to(device)
            labels = labels.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = loss_fn(model(images), labels)
            loss.backward()
            optimizer.step()
            running += float(loss.detach()) * labels.shape[0]
            seen += labels.shape[0]
        scheduler.step()
        val_acc, _ = accuracy(model, val_loader, device)
        print(f"epoch {epoch:02d} loss {running / seen:.4f} val {val_acc:.4f}")
        if val_acc > best_val:
            best_val = val_acc
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    assert best_state is not None
    model.load_state_dict(best_state)
    test_acc, confusion = accuracy(model, test_loader, device)
    report = per_class_report(confusion)
    print(f"best val {best_val:.4f} test {test_acc:.4f}")

    manifest, weights, biases = export_model(model, mean, std, test_acc, report)
    verify_export(model, manifest, weights, biases, test_rows, mean, std)

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    weights.tofile(MODEL_DIR / "weights.bin")
    biases.tofile(MODEL_DIR / "bias.bin")
    (MODEL_DIR / "manifest.json").write_text(json.dumps(manifest))

    gallery = write_samples(test_rows)
    (MODEL_DIR / "gallery.json").write_text(json.dumps(gallery))
    write_scene(test_rows)

    metrics = {
        "testAccuracy": round(test_acc, 4),
        "valAccuracy": round(best_val, 4),
        "perClass": report,
        "trainImages": len(train_rows),
        "valImages": len(val_rows),
        "testImages": len(test_rows),
        "parameters": int(sum(p.numel() for p in model.parameters())),
        "epochs": EPOCHS,
    }
    (ROOT / "src" / "data").mkdir(parents=True, exist_ok=True)
    (ROOT / "src" / "data" / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print("wrote weights, gallery, scene, metrics")


if __name__ == "__main__":
    train()
