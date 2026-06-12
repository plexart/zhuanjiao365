"""Face-recognition worker: each process handles exactly one image, then exits.

This bounds the memory used by a single image (model + inference) to one process,
avoiding memory accumulation over a long-running process (the "one process per
image" requirement).

Usage:
    python face_worker.py --image <image path> [--det-size 640] [--det-thresh 0.5]

Output: prints one line on stdout starting with RESULT_MARKER, e.g.
    __FACE_RESULT__{"ok": true, "faces": [{"embedding": [...512], "score": 0.9, "area": 12345}]}
Model / onnxruntime logs go to stderr so they do not pollute the result.
"""

import argparse
import json
import sys
import warnings

warnings.filterwarnings("ignore")

RESULT_MARKER = "__FACE_RESULT__"


def emit(result):
    sys.stdout.write(RESULT_MARKER + json.dumps(result) + "\n")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--model", default="buffalo_l")
    parser.add_argument("--det-size", type=int, default=640)
    parser.add_argument("--det-thresh", type=float, default=0.5)
    args = parser.parse_args()

    # lazy import so argument errors fail fast
    import cv2
    from insightface.app import FaceAnalysis

    img = cv2.imread(args.image)
    if img is None:
        emit({"ok": False, "error": f"无法读取图片: {args.image}"})
        sys.exit(1)

    app = FaceAnalysis(
        name=args.model, allowed_modules=["detection", "recognition"]
    )
    app.prepare(ctx_id=-1, det_size=(args.det_size, args.det_size), det_thresh=args.det_thresh)

    faces = []
    for f in app.get(img):
        x1, y1, x2, y2 = f.bbox
        faces.append(
            {
                "embedding": [round(float(v), 6) for v in f.normed_embedding],
                "score": float(f.det_score),
                "area": float((x2 - x1) * (y2 - y1)),
            }
        )

    emit({"ok": True, "faces": faces})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        emit({"ok": False, "error": str(exc)})
        sys.exit(1)
