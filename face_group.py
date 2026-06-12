"""Group deskmate and group photos by face recognition (InsightFace / ArcFace).

Approach:
    1. Build a face descriptor (512-d ArcFace vector) for each person from the
       photos under data/个人照/<name>/.
    2. Walk the photos under data/同桌照/ and data/小组照/ with one unified rule:
       every detected face must be recognized, then the recognized set of people
       selects the partners.json / groups.json entry whose members contain them.
    3. Matched photos are moved into the matching subdirectory.

Notes:
    - Face descriptors are cached in data/.face-cache/; unchanged sources and
      detection params are not rescanned.
    - Every face in a photo must be recognized before it is classified, which
      keeps results accurate (relax with --max-unknown-faces).
    - By default the model is loaded once and photos are processed sequentially
      in a single process (InsightFace memory usage stays flat); use
      --per-image-process for strict isolation (one subprocess per photo).

Usage:
    python face_group.py
    python face_group.py --threshold 0.5 --det-size 1024
    python face_group.py --dry-run          # only print results, do not move files
    python face_group.py --rescan           # ignore cache and re-detect
    python face_group.py --per-image-process --concurrency 4
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import warnings
from concurrent.futures import ThreadPoolExecutor

import numpy as np

warnings.filterwarnings("ignore")

DATA_DIR = "data"
PERSON_DIR = os.path.join(DATA_DIR, "个人照")
PARTNER_PHOTO_DIR = os.path.join(DATA_DIR, "同桌照")
GROUP_PHOTO_DIR = os.path.join(DATA_DIR, "小组照")
PARTNERS_FILE = os.path.join(DATA_DIR, "partners.json")
GROUPS_FILE = os.path.join(DATA_DIR, "groups.json")

CACHE_DIR = os.path.join(DATA_DIR, ".face-cache")
EMB_CACHE_FILE = os.path.join(CACHE_DIR, "embeddings.json")
PERSON_CACHE_FILE = os.path.join(CACHE_DIR, "persons.json")
REPORT_FILE = os.path.join(DATA_DIR, "face-group-report.json")

WORKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "face_worker.py")
RESULT_MARKER = "__FACE_RESULT__"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
SPLIT_RE = re.compile(r"[\s,，]+")


# ----------------------------- Basic utilities -----------------------------

def ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def is_image(name):
    return os.path.splitext(name)[1].lower() in IMAGE_EXTS


def list_images(directory):
    """List image files directly inside a directory (non-recursive, so already-sorted photos are not reprocessed)."""
    if not os.path.isdir(directory):
        return []
    out = []
    for name in sorted(os.listdir(directory)):
        full = os.path.join(directory, name)
        if os.path.isfile(full) and is_image(name):
            out.append(full)
    return out


def hash_file(path):
    h = hashlib.sha1()
    with open(path, "rb") as fp:
        for chunk in iter(lambda: fp.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def signature_of_files(files):
    parts = []
    for f in sorted(files):
        st = os.stat(f)
        parts.append(f"{os.path.basename(f)}:{st.st_size}:{int(st.st_mtime)}")
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()


def sanitize_name(raw):
    cleaned = re.sub(r'[/\\:：*?"<>|,，]', "", raw).strip()
    return re.sub(r"\s+", "_", cleaned)


def load_json_safe(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as fp:
            return json.load(fp)
    except Exception:  # noqa: BLE001
        return fallback


# ----------------------------- Roster parsing -----------------------------

def parse_partners():
    data = load_json_safe(PARTNERS_FILE, None)
    if not data or not isinstance(data.get("PartnerList"), list):
        sys.exit(f"❌ 无法读取 {PARTNERS_FILE}（缺少 PartnerList）")
    result = []
    for raw in data["PartnerList"]:
        tokens = [t for t in SPLIT_RE.split(str(raw).strip()) if t]
        # a leading token like "01:" is the label; the rest are member names
        has_label = bool(tokens) and re.search(r"[0-9:：]", tokens[0])
        members = tokens[1:] if has_label else tokens
        if members:
            result.append({"members": members, "subdir": sanitize_name(raw), "raw": raw})
    return result


def parse_groups():
    data = load_json_safe(GROUPS_FILE, None)
    if not data or not isinstance(data.get("GroupList"), list):
        sys.exit(f"❌ 无法读取 {GROUPS_FILE}（缺少 GroupList）")
    result = []
    for raw in data["GroupList"]:
        tokens = [t for t in SPLIT_RE.split(str(raw).strip()) if t]
        label = tokens[0] if tokens else raw
        members = tokens[1:]
        if members:
            result.append(
                {"label": label, "members": members, "subdir": sanitize_name(label), "raw": raw}
            )
    return result


# ----------------------------- Feature extraction (two modes) -----------------------------

class Detector:
    """Face detection / feature extraction; supports in-process inference and one-subprocess-per-image modes."""

    def __init__(self, config):
        self.config = config
        self._app = None

    def _ensure_app(self):
        if self._app is None:
            from insightface.app import FaceAnalysis

            app = FaceAnalysis(
                name=self.config.model, allowed_modules=["detection", "recognition"]
            )
            app.prepare(
                ctx_id=-1,
                det_size=(self.config.det_size, self.config.det_size),
                det_thresh=self.config.det_thresh,
            )
            self._app = app
        return self._app

    def detect(self, image_path):
        """Return [{embedding: [512], score, area}]."""
        if self.config.per_image_process:
            return self._detect_subprocess(image_path)
        return self._detect_in_process(image_path)

    def _detect_in_process(self, image_path):
        import cv2

        img = cv2.imread(image_path)
        if img is None:
            raise RuntimeError(f"无法读取图片: {image_path}")
        faces = []
        for f in self._ensure_app().get(img):
            x1, y1, x2, y2 = f.bbox
            faces.append(
                {
                    "embedding": [float(v) for v in f.normed_embedding],
                    "score": float(f.det_score),
                    "area": float((x2 - x1) * (y2 - y1)),
                }
            )
        return faces

    def _detect_subprocess(self, image_path):
        proc = subprocess.run(
            [
                sys.executable,
                WORKER,
                "--image",
                image_path,
                "--model",
                self.config.model,
                "--det-size",
                str(self.config.det_size),
                "--det-thresh",
                str(self.config.det_thresh),
            ],
            capture_output=True,
            text=True,
        )
        line = next(
            (l for l in proc.stdout.splitlines() if l.startswith(RESULT_MARKER)), None
        )
        if not line:
            raise RuntimeError(f"worker 无输出: {image_path} ({proc.stderr.strip()[:200]})")
        parsed = json.loads(line[len(RESULT_MARKER):])
        if not parsed.get("ok"):
            raise RuntimeError(parsed.get("error", "未知错误"))
        return parsed["faces"]


# ----------------------------- Feature cache -----------------------------

class Cache:
    def __init__(self, config):
        self.config = config
        self.detector_params = {
            "model": config.model,
            "det_size": config.det_size,
            "det_thresh": config.det_thresh,
        }
        self.images = {}
        ensure_dir(CACHE_DIR)
        cached = load_json_safe(EMB_CACHE_FILE, None)
        if (
            not config.rescan
            and cached
            and cached.get("detectorParams") == self.detector_params
        ):
            self.images = cached.get("images", {})

    def save(self):
        ensure_dir(CACHE_DIR)
        with open(EMB_CACHE_FILE, "w", encoding="utf-8") as fp:
            json.dump({"detectorParams": self.detector_params, "images": self.images}, fp)

    def get_faces(self, detector, image_path):
        key = hash_file(image_path)
        if key in self.images:
            return self.images[key]["faces"]
        faces = detector.detect(image_path)
        self.images[key] = {"faces": faces}
        self.save()  # flush after each image so an interrupted run can resume
        return faces


# ----------------------------- Person references -----------------------------

def build_person_references(detector, cache, config):
    """name -> np.ndarray(N, 512). For each reference photo, take the largest face."""
    if not os.path.isdir(PERSON_DIR):
        sys.exit(f"❌ 找不到个人照目录: {PERSON_DIR}")

    detector_params = cache.detector_params
    person_cache = None if config.rescan else load_json_safe(PERSON_CACHE_FILE, None)
    cache_valid = bool(person_cache) and person_cache.get("detectorParams") == detector_params
    cached_persons = person_cache.get("persons", {}) if cache_valid else {}
    next_persons = {}

    person_dirs = sorted(
        d for d in os.listdir(PERSON_DIR) if os.path.isdir(os.path.join(PERSON_DIR, d))
    )
    refs = {}
    print(f"\n📇 建立个人特征（共 {len(person_dirs)} 人）...")

    for name in person_dirs:
        directory = os.path.join(PERSON_DIR, name)
        images = list_images(directory)
        if not images:
            print(f"  ⚠️  {name}: 没有照片，跳过")
            continue
        sig = signature_of_files(images)

        if name in cached_persons and cached_persons[name].get("sig") == sig:
            embeddings = cached_persons[name]["embeddings"]
            next_persons[name] = cached_persons[name]
            refs[name] = np.array(embeddings, dtype=np.float32)
            print(f"  ♻️  {name}: 命中缓存（{len(embeddings)} 个特征）")
            continue

        embeddings = []
        for img in images:
            try:
                faces = cache.get_faces(detector, img)
            except Exception as exc:  # noqa: BLE001
                print(f"  ⚠️  {name}: 处理 {os.path.basename(img)} 失败: {exc}")
                continue
            if not faces:
                continue
            main = max(faces, key=lambda f: f["area"])  # largest face by area
            embeddings.append(main["embedding"])

        if not embeddings:
            print(f"  ⚠️  {name}: 未检测到人脸，跳过")
            continue
        next_persons[name] = {"sig": sig, "embeddings": embeddings}
        refs[name] = np.array(embeddings, dtype=np.float32)
        print(f"  ✅ {name}: {len(embeddings)} 个特征")

    ensure_dir(CACHE_DIR)
    with open(PERSON_CACHE_FILE, "w", encoding="utf-8") as fp:
        json.dump({"detectorParams": detector_params, "persons": next_persons}, fp)

    return refs


# ----------------------------- Matching and grouping -----------------------------

def identify_faces(faces, person_refs, threshold):
    """Assign each face the most similar person (highest cosine similarity and >= threshold), else None.

    Descriptors are L2-normalized, so cosine similarity is the dot product (higher is more similar).
    Returns a list the same length as faces: [(name | None, similarity), ...]
    """
    if not faces:
        return []
    face_mat = np.array([f["embedding"] for f in faces], dtype=np.float32)  # (F, 512)
    best_name = [None] * len(faces)
    best_sim = [-1.0] * len(faces)
    for name, refs in person_refs.items():
        col = (face_mat @ refs.T).max(axis=1)  # best similarity of each face to this person (F,)
        for i in range(len(faces)):
            s = float(col[i])
            if s > best_sim[i]:
                best_sim[i] = s
                best_name[i] = name
    return [
        (best_name[i] if best_sim[i] >= threshold else None, best_sim[i])
        for i in range(len(faces))
    ]


def pick_entry(entries, present):
    """Pick the deskmate/group entry for the recognized people (present: {name: similarity}).

    Prefer an entry whose members fully contain the recognized people (present ⊆ members),
    so a group photo with only some members present still classifies correctly; when one
    person belongs to several entries, the full recognized set disambiguates them
    (e.g. {A,B}->desk07, {A,C}->desk08).
    If no entry fully contains them (people from another group may have leaked in), fall back
    to the entry with the largest overlap, but require at least 2 matched people to avoid misclassification.
    """
    pset = set(present)
    if not pset:
        return None
    best = None
    best_key = None
    for entry in entries:
        members = set(entry["members"])
        overlap = pset & members
        if not overlap:
            continue
        all_in = pset <= members
        avg_sim = sum(present[m] for m in overlap) / len(overlap)
        # sort key: fully-contains > overlap size > tighter fit (fewer extra members) > avg similarity
        key = (1 if all_in else 0, len(overlap), -len(members - pset), avg_sim)
        if best_key is None or key > best_key:
            best_key = key
            best = {"entry": entry, "matched": sorted(overlap), "all_in": all_in}
    if best is None:
        return None
    if best["all_in"] or len(best["matched"]) >= 2:
        return best
    return None


def move_into(file_path, base_dir, subdir):
    target_dir = os.path.join(base_dir, subdir)
    ensure_dir(target_dir)
    stem, ext = os.path.splitext(os.path.basename(file_path))
    dest = os.path.join(target_dir, stem + ext)
    i = 1
    while os.path.exists(dest):
        dest = os.path.join(target_dir, f"{stem}_{i}{ext}")
        i += 1
    shutil.move(file_path, dest)
    return dest


def process_photo_dir(directory, entries, kind, detector, cache, config, person_refs):
    images = list_images(directory)
    print(f"\n🗂️  处理{kind}（{directory}）：共 {len(images)} 张待分组照片")
    if not images:
        return []

    results = [None] * len(images)
    total = len(images)

    def handle(index_path):
        index, image_path = index_path
        name = os.path.basename(image_path)
        try:
            faces = cache.get_faces(detector, image_path)
        except Exception as exc:  # noqa: BLE001
            print(f"  [{index + 1}/{total}] ❌ {name}: {exc}")
            return index, {"image": image_path, "status": "error", "error": str(exc)}

        ids = identify_faces(faces, person_refs, config.threshold)
        present = {}
        for nm, s in ids:
            if nm:
                present[nm] = max(present.get(nm, -1.0), s)
        unknown = sum(1 for nm, _ in ids if nm is None)

        if not faces:
            print(f"  [{index + 1}/{total}] ❓ {name}: 未检测到人脸")
            return index, {
                "image": image_path, "status": "unmatched", "reason": "no_face",
                "faces": 0, "present": [],
            }

        # Require every face in the photo to be recognized (matches == faces); otherwise leave it unsorted
        if unknown > config.max_unknown_faces:
            print(
                f"  [{index + 1}/{total}] ❓ {name}: 未全部识别"
                f"（检出 {len(faces)} 张脸，识别出 {len(present)} 人，{unknown} 张未识别）"
            )
            return index, {
                "image": image_path, "status": "unmatched", "reason": "faces_unrecognized",
                "faces": len(faces), "present": list(present.keys()), "unknown": unknown,
            }

        best = pick_entry(entries, present)
        if best is None:
            print(
                f"  [{index + 1}/{total}] ❓ {name}: 未匹配到同桌/小组"
                f"（识别出 {'、'.join(present.keys())}）"
            )
            return index, {
                "image": image_path, "status": "unmatched", "reason": "no_entry",
                "faces": len(faces), "present": list(present.keys()),
            }

        subdir = best["entry"]["subdir"]
        dest = None
        if not config.dry_run:
            dest = move_into(image_path, directory, subdir)
        # Flag photos classified despite unrecognized faces, for manual review (profiles / reflective surfaces / distant bystanders)
        flag = f" ⚠️ 有 {unknown} 张未识别人脸，建议二次查验" if unknown else ""
        print(
            f"  [{index + 1}/{total}] ✅ {name} → {subdir}/  "
            f"(匹配: {'、'.join(best['matched'])}){flag}"
        )
        return index, {
            "image": image_path,
            "status": "matched(dry-run)" if config.dry_run else "moved",
            "subdir": subdir,
            "matched": best["matched"],
            "unknown": unknown,
            "dest": dest,
        }

    items = list(enumerate(images))
    if config.per_image_process and config.concurrency > 1:
        with ThreadPoolExecutor(max_workers=config.concurrency) as pool:
            for index, res in pool.map(handle, items):
                results[index] = res
    else:
        for item in items:
            index, res = handle(item)
            results[index] = res

    return results


# ----------------------------- Main -----------------------------

def parse_config():
    p = argparse.ArgumentParser(description="人脸分组（InsightFace）")
    p.add_argument("--threshold", type=float, default=0.5, help="余弦相似度阈值，越大越严格")
    p.add_argument("--det-size", type=int, default=640, help="检测输入尺寸")
    p.add_argument("--det-thresh", type=float, default=0.5, help="人脸检测置信度阈值")
    p.add_argument("--model", default="buffalo_l", help="InsightFace 模型包名")
    p.add_argument(
        "--max-unknown-faces", type=int, default=0,
        help="允许照片中未被识别的人脸数上限（默认 0，即要求全部识别）",
    )
    p.add_argument("--concurrency", type=int, default=1, help="并发数（仅 --per-image-process 生效）")
    p.add_argument("--per-image-process", action="store_true", help="每张图片用独立子进程处理")
    p.add_argument("--dry-run", action="store_true", help="只输出分组结果，不移动文件")
    p.add_argument("--rescan", action="store_true", help="忽略缓存，强制重新检测")
    cfg = p.parse_args()
    cfg.concurrency = max(1, cfg.concurrency)
    return cfg


def check_dependencies():
    """Check dependencies at startup and give an actionable hint if any are missing.

    The detection / feature-extraction imports are lazy (skipped on cache hits); without an
    upfront check, an environment missing dependencies could process many cache hits and only
    crash on the first uncached photo.
    """
    missing = []
    for mod, pkg in (("cv2", "opencv-python-headless"), ("onnxruntime", "onnxruntime"),
                     ("insightface", "insightface")):
        try:
            __import__(mod)
        except ImportError:
            missing.append((mod, pkg))
    if missing:
        names = "、".join(m for m, _ in missing)
        sys.exit(
            f"❌ 缺少依赖：{names}。请先安装依赖再运行：\n"
            f"   python3 -m venv .venv && source .venv/bin/activate  "
            f"(Windows: .venv\\Scripts\\activate)\n"
            f"   pip install -r requirements.txt"
        )


def main():
    config = parse_config()
    check_dependencies()
    print("🚀 人脸分组开始（InsightFace / ArcFace）")
    print(
        f"   参数: threshold={config.threshold}, det_size={config.det_size}, "
        f"det_thresh={config.det_thresh}, model={config.model}, "
        f"max_unknown_faces={config.max_unknown_faces}, "
        f"per_image_process={config.per_image_process}, concurrency={config.concurrency}, "
        f"dry_run={config.dry_run}, rescan={config.rescan}"
    )

    detector = Detector(config)
    cache = Cache(config)

    partners = parse_partners()
    groups = parse_groups()
    person_refs = build_person_references(detector, cache, config)

    all_members = set()
    for p in partners:
        all_members.update(p["members"])
    for g in groups:
        all_members.update(g["members"])
    missing = sorted(m for m in all_members if m not in person_refs)
    if missing:
        print(f"\n⚠️  以下人员在名单中但没有可用的个人特征，可能影响匹配：{'、'.join(missing)}")

    # Deskmate and group photos share one rule: require all faces recognized, then find the entry for the recognized people
    partner_results = process_photo_dir(
        PARTNER_PHOTO_DIR, partners, "同桌照", detector, cache, config, person_refs,
    )
    group_results = process_photo_dir(
        GROUP_PHOTO_DIR, groups, "小组照", detector, cache, config, person_refs,
    )

    report = {
        "config": vars(config),
        "partner": partner_results,
        "group": group_results,
    }
    with open(REPORT_FILE, "w", encoding="utf-8") as fp:
        json.dump(report, fp, ensure_ascii=False, indent=2)

    def summarize(rs):
        moved = sum(1 for r in rs if r and r["status"] in ("moved", "matched(dry-run)"))
        flagged = sum(1 for r in rs if r and r["status"] in ("moved", "matched(dry-run)") and r.get("unknown"))
        unmatched = sum(1 for r in rs if r and r["status"] == "unmatched")
        errored = sum(1 for r in rs if r and r["status"] == "error")
        return f"已分组 {moved}（其中 {flagged} 张含未识别人脸待查），未匹配 {unmatched}，出错 {errored}"

    print("\n📊 汇总")
    print(f"   同桌照: {summarize(partner_results)}")
    print(f"   小组照: {summarize(group_results)}")
    print(f"   详细报告: {REPORT_FILE}")
    print("🏁 完成")


if __name__ == "__main__":
    main()
