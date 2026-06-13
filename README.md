# zhuanjiao365

https://plexart.github.io/zhuanjiao365/

## Prepare Data

1. Deskmate List
   Edit `data/partners.json` to provide the deskmate list.

2. Group List
   Edit `data/groups.json` to provide the group list.

## Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your values:

- `orderID` - Your order ID (e.g., `88888`)
- `editOrderAlbumInfoSigner` - Signer for the edit API (sync selections)
- `infoOrderAlbumListSigner` - Signer for the info API (download photo list)
- `selectMID` - Your selectMID for syncing selections

> **Note:** You only need to provide these values once. They will be saved to `.env` for future use.

## Download Photo List

Download the latest photo list from the server:

```bash
npm run download
```

This will fetch `response.json` and save it to `data/`.

## Download Photos

Download all photos organized by category:

```bash
npm run download-images
```

Photos are downloaded to subdirectories under `data/`:

| AlbumType | Directory         | Notes                                          |
| --------- | ----------------- | ---------------------------------------------- |
| 0         | `data/校园风景`   | Campus scenery                                 |
| 1         | `data/集体造型照` | Group poses                                    |
| 2         | `data/小组照`     | Small group photos                             |
| 3         | `data/个人照`     | Individual photos (with Remark subdirectories) |
| 4         | `data/同桌照`     | Deskmate photos                                |

- Existing files are skipped (no re-download)
- Progress is shown during download

## Group Photos by Face Recognition

Automatically sort the photos in `data/同桌照` and `data/小组照` into subdirectories using face
recognition. Built on [InsightFace](https://github.com/deepinsight/insightface) (ArcFace `buffalo_l`);
high accuracy, pure Python, no Docker required.

Setup (first time):

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Run (activate the venv first):

```bash
npm run face-group                 # same as python3 face_group.py
# or directly: python3 face_group.py
```

How it works:

1. Build a face descriptor for each person from `data/个人照/<name>/` (one subdirectory per person, holding several photos of that person).
2. Walk `data/同桌照/` and `data/小组照/` with **one unified rule**:
   - Every face detected in a photo must be recognized (matches == detected faces); if any face is left unrecognized, the photo is treated as unmatched, which keeps results accurate (relax with `--max-unknown-faces`).
   - The recognized set of people then selects the entry in `data/partners.json` / `data/groups.json` whose members contain them, so a group photo that captured only part of the group is still classified correctly.
   - When the same person belongs to two deskmate pairs, the full recognized set disambiguates them (e.g. `{A, B}` → desk 07, `{A, C}` → desk 08).
   - If the recognized people span multiple entries and none fully contains them, fall back to the entry with the largest overlap, but require at least 2 matched people; otherwise the photo is left unmatched.
3. Matched photos are moved into a subdirectory named after the deskmate pair / group (e.g. `01_王琪_李轩/`, `第一组/`).
4. When `--max-unknown-faces` lets a photo through with unrecognized faces still present, it is flagged for manual review (a `⚠️` note in the console, an `unknown` count in `data/face-group-report.json`, and a flagged tally in the summary). Those extra faces are usually profiles, faces reflected off surfaces such as car bodies, or bystanders in the background.
5. After all photos are grouped, a separate pass scans the subdirectories (so photos sorted in earlier runs are included too — re-runs always produce a complete result) and clusters the matched photos into **scenes** — bursts of the same people in one setup, where usually only the best frame is kept — writing a `scene_id` for each photo in `data/face-group-report.json`. Photos are ordered by their EXIF `DateTimeOriginal`; a new scene starts when:
   - **deskmate photos**: the gap to the previous photo exceeds 15s (configurable via `--scene-gap-partner`);
   - **group photos**: the gap exceeds 50s (configurable via `--scene-gap-group`), or (within that window) the set of people changes. "Same people" is judged by the recognized identities, not the total face count, so an unrelated bystander wandering into one frame does not split a scene: when both photos are fully recognized the recognized sets must be equal, and when either has unrecognized faces the recognized sets only need to be compatible (both non-empty and one a subset of the other).
   - A photo with no EXIF capture time becomes its own scene.
     `build-data.js` then propagates each `scene_id` to `AlbumList` as `SceneId`, and the selection page (`index.html`) shows one stacked thumbnail per scene (the first selected photo if any, else the first), with the big-view prev/next navigating only within that scene.

Notes:

- **Caching**: face descriptors are cached in `data/.face-cache/`. As long as the source photos and detection parameters are unchanged, re-runs skip rescanning (already-sorted photos inside subdirectories are not reprocessed either).
- **Bounded memory**: by default the model is loaded once and photos are processed sequentially in a single process (InsightFace memory usage stays flat). For strict isolation, add `--per-image-process` to run each photo in its own subprocess (`face_worker.py`) that exits when done.
- **Accuracy**: every face in a photo must be recognized before the photo is classified; each person can have multiple reference photos. Matching uses cosine similarity (descriptors are L2-normalized).
- **Image resolution**: for group photos with many people, use the **full-resolution** originals rather than thumbnails — faces that are too small fail to be recognized (in practice a 6-person photo at 400×267 is almost unrecognizable, while the original resolves the whole group reliably).

The InsightFace model is downloaded to `~/.insightface/models/` on the first run.

Options:

| Option                    | Description                                                                                     | Default     |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ----------- |
| `--threshold <n>`         | Cosine similarity threshold for a face match; higher is stricter                                | `0.5`       |
| `--det-size <n>`          | Detector input size; larger detects small faces better (raise it for group photos, e.g. `1024`) | `640`       |
| `--det-thresh <n>`        | Face detection confidence threshold                                                             | `0.5`       |
| `--model <name>`          | InsightFace model pack name                                                                     | `buffalo_l` |
| `--max-unknown-faces <n>` | Max number of unrecognized faces allowed in a photo (default 0, i.e. require all recognized)    | `0`         |
| `--per-image-process`     | Process each photo in its own subprocess (strict memory isolation)                              | off         |
| `--concurrency <n>`       | Number of photos processed in parallel (only with `--per-image-process`)                        | `1`         |
| `--scene-gap-partner <n>` | Deskmate scene gap in seconds; a larger gap starts a new scene                                  | `15`        |
| `--scene-gap-group <n>`   | Group scene gap in seconds; a larger gap starts a new scene                                     | `50`        |
| `--dry-run`               | Only print the grouping result, do not move files                                               | off         |
| `--rescan`                | Ignore the cache and force re-detection                                                         | off         |

Example (recommended for full-resolution group photos): `python3 face_group.py --det-size 1024 --threshold 0.5 --dry-run`

A detailed grouping report is written to `data/face-group-report.json` on every run.

## Build

```bash
npm run build-data
```

## Sync Selected Photos

Sync your photo selections with the server:

```bash
npm run sync
```

**Before running**, create `data/selected.txt` with the photo IDs you want to select:

```
16: 张三, 李四:
  - 12345678
15: 王五, 赵六, 孙七:
  - 87654321
第三组: 周八, 吴九, 郑十:
  - 11111111
  - 22222222
```

The script will:

1. Compare `selected.txt` with the current state in `response.json`
2. Show you which photos will be selected/deselected
3. Send requests to sync your selections using credentials from `.env`

## Check Personal Photo Selections

Check personal photo selection status:

```bash
npm run check-personal
```

This analyzes `data/response.json` and shows:

- **Students** (photos ≥ 7): need to select 2 photos each
- **Teachers** (photos < 7): need to select 1 photo each

Output includes three sections for each group:

- 🔴 Not enough selected
- 🟡 Too many selected
- 🟢 Exactly the required amount

Example output:

```
📊 个人照选择情况统计（学生）
========================

🔴 未选够2张的学生 (2人):
------------------------
张三　　：1/2
李四　　：0/2

🟡 超过2张的学生 (1人):
------------------------
王五　　：3/2

🟢 刚好选2张的学生 (1人):
------------------------
赵六　　：2/2

========================
📈 学生总计: 1/4  (25%)

📊 老师选择情况
========================

🔴 未选够1张的老师 (2人):
------------------------
孙七　　：0/1
周八　　：0/1

========================
📈 老师总计: 0/2  (0%)

========================
📈 全体总计: 1/6  (17%)
```
