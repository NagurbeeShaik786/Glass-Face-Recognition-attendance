"""Face Recognition Attendance System - Flask backend.

Uses OpenCV's Haar cascade for face detection and LBPH for face recognition.
Stores enrolled people in JSON, attendance in CSV, and trained model on disk.
"""
from __future__ import annotations

import base64
import csv
import io
import json
import os
import re
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS
from PIL import Image

ROOT = Path(__file__).parent.resolve()
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
FACES_DIR = DATA_DIR / "faces"
PEOPLE_FILE = DATA_DIR / "people.json"
ATTENDANCE_FILE = DATA_DIR / "attendance.csv"
MODEL_FILE = DATA_DIR / "trainer.yml"

DATA_DIR.mkdir(parents=True, exist_ok=True)
FACES_DIR.mkdir(parents=True, exist_ok=True)

CASCADE_PATH = (
    Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
)
face_cascade = cv2.CascadeClassifier(str(CASCADE_PATH))

# LBPH face recognizer (from opencv-contrib).
try:
    recognizer = cv2.face.LBPHFaceRecognizer_create()
except AttributeError as exc:
    raise RuntimeError(
        "OpenCV is missing the cv2.face module. "
        "Install opencv-contrib-python and restart the app."
    ) from exc

_lock = threading.Lock()
_model_loaded = False

BASE_PATH = os.environ.get("BASE_PATH", "/").rstrip("/") or ""

app = Flask(__name__, static_folder=None)
CORS(app)

# ---------- Persistence helpers ----------


def _load_people() -> list[dict[str, Any]]:
    if not PEOPLE_FILE.exists():
        return []
    try:
        return json.loads(PEOPLE_FILE.read_text() or "[]")
    except json.JSONDecodeError:
        return []


def _save_people(people: list[dict[str, Any]]) -> None:
    PEOPLE_FILE.write_text(json.dumps(people, indent=2))


def _ensure_attendance_file() -> None:
    if not ATTENDANCE_FILE.exists():
        with ATTENDANCE_FILE.open("w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(
                [
                    "id",
                    "person_id",
                    "name",
                    "role",
                    "date",
                    "time",
                    "timestamp",
                    "confidence",
                ]
            )


def _local_now() -> datetime:
    return datetime.now().astimezone()


def _parse_timestamp(value: str) -> datetime | None:
    if not value:
        return None
    if value.endswith("Z"):
        try:
            return datetime.fromisoformat(value[:-1]).replace(
                tzinfo=timezone.utc
            ).astimezone()
        except ValueError:
            return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    return dt.astimezone() if dt.tzinfo is None else dt


def _read_attendance() -> list[dict[str, str]]:
    _ensure_attendance_file()
    with ATTENDANCE_FILE.open(newline="") as f:
        return list(csv.DictReader(f))


def _append_attendance(record: dict[str, Any]) -> None:
    _ensure_attendance_file()
    with ATTENDANCE_FILE.open("a", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "id",
                "person_id",
                "name",
                "role",
                "date",
                "time",
                "timestamp",
                "confidence",
            ],
        )
        writer.writerow(record)


# ---------- Image / face helpers ----------


def _decode_data_url(data_url: str) -> np.ndarray:
    """Decode a base64 data-URL into a BGR OpenCV image."""
    match = re.match(r"data:image/[^;]+;base64,(.*)$", data_url, re.DOTALL)
    if match:
        b64 = match.group(1)
    else:
        b64 = data_url
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    arr = np.array(img)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def _detect_faces(gray: np.ndarray) -> list[tuple[int, int, int, int]]:
    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.2,
        minNeighbors=5,
        minSize=(80, 80),
    )
    return [tuple(int(v) for v in f) for f in faces]


def _largest_face(
    faces: list[tuple[int, int, int, int]],
) -> tuple[int, int, int, int] | None:
    if not faces:
        return None
    return max(faces, key=lambda f: f[2] * f[3])


def _crop_and_normalize(
    gray: np.ndarray, box: tuple[int, int, int, int]
) -> np.ndarray:
    x, y, w, h = box
    crop = gray[y : y + h, x : x + w]
    return cv2.resize(crop, (200, 200))


def _crop_thumbnail(bgr: np.ndarray, box: tuple[int, int, int, int]) -> str:
    x, y, w, h = box
    pad = int(0.2 * max(w, h))
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(bgr.shape[1], x + w + pad)
    y1 = min(bgr.shape[0], y + h + pad)
    crop = bgr[y0:y1, x0:x1]
    crop = cv2.resize(crop, (240, 240))
    success, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not success:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()


# ---------- Training ----------


def _person_int_id(person_id: str, people: list[dict[str, Any]]) -> int:
    for idx, p in enumerate(people):
        if p["id"] == person_id:
            return idx + 1
    raise KeyError(person_id)


def _train_model() -> dict[str, Any]:
    """Re-train LBPH model from all stored face samples."""
    global _model_loaded
    people = _load_people()
    samples: list[np.ndarray] = []
    labels: list[int] = []

    for idx, person in enumerate(people):
        label = idx + 1
        person_dir = FACES_DIR / person["id"]
        if not person_dir.exists():
            continue
        for img_path in sorted(person_dir.glob("*.jpg")):
            img = cv2.imread(str(img_path), cv2.IMREAD_GRAYSCALE)
            if img is None:
                continue
            if img.shape != (200, 200):
                img = cv2.resize(img, (200, 200))
            samples.append(img)
            labels.append(label)

    if not samples:
        if MODEL_FILE.exists():
            MODEL_FILE.unlink()
        _model_loaded = False
        return {"trained": False, "samples": 0, "people": len(people)}

    recognizer.train(samples, np.array(labels))
    recognizer.save(str(MODEL_FILE))
    _model_loaded = True
    return {"trained": True, "samples": len(samples), "people": len(people)}


def _ensure_model_loaded() -> bool:
    global _model_loaded
    if _model_loaded:
        return True
    if MODEL_FILE.exists():
        try:
            recognizer.read(str(MODEL_FILE))
            _model_loaded = True
            return True
        except cv2.error:
            return False
    return False


# ---------- Routes ----------


@app.get("/srv/health")
def health() -> Response:
    return jsonify(
        {
            "status": "ok",
            "people": len(_load_people()),
            "model_trained": MODEL_FILE.exists(),
        }
    )


@app.post("/srv/detect")
def detect() -> Response:
    """Quick endpoint used by the enroll page to give live feedback."""
    payload = request.get_json(force=True, silent=True) or {}
    image_data = payload.get("image")
    if not image_data:
        return jsonify({"error": "Missing image"}), 400
    bgr = _decode_data_url(image_data)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    faces = _detect_faces(gray)
    h, w = gray.shape
    return jsonify(
        {
            "faces": [
                {"x": x, "y": y, "w": fw, "h": fh} for (x, y, fw, fh) in faces
            ],
            "width": w,
            "height": h,
        }
    )


@app.get("/srv/people")
def list_people() -> Response:
    people = _load_people()
    # Strip large fields not needed for listing.
    summary = [
        {
            "id": p["id"],
            "name": p["name"],
            "role": p.get("role", ""),
            "department": p.get("department", ""),
            "enrolled_at": p["enrolled_at"],
            "samples": p.get("samples", 0),
            "thumbnail": p.get("thumbnail", ""),
        }
        for p in people
    ]
    return jsonify({"people": summary})


@app.post("/srv/people")
def create_person() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    name = (payload.get("name") or "").strip()
    role = (payload.get("role") or "").strip()
    department = (payload.get("department") or "").strip()
    images = payload.get("images") or []

    if not name:
        return jsonify({"error": "Name is required"}), 400
    if len(images) < 3:
        return (
            jsonify({"error": "At least 3 face samples are required"}),
            400,
        )

    bgr_images = []
    grays_with_face: list[tuple[np.ndarray, tuple[int, int, int, int]]] = []
    for data_url in images:
        bgr = _decode_data_url(data_url)
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        face = _largest_face(_detect_faces(gray))
        if face is None:
            continue
        bgr_images.append(bgr)
        grays_with_face.append((gray, face))

    if len(grays_with_face) < 3:
        return (
            jsonify(
                {
                    "error": (
                        "Could not detect a face in enough samples. "
                        "Capture at least 3 clear, front-facing shots."
                    )
                }
            ),
            400,
        )

    person_id = uuid.uuid4().hex[:12]
    person_dir = FACES_DIR / person_id
    person_dir.mkdir(parents=True, exist_ok=True)

    thumbnail = _crop_thumbnail(bgr_images[0], grays_with_face[0][1])

    for i, (gray, face) in enumerate(grays_with_face):
        sample = _crop_and_normalize(gray, face)
        cv2.imwrite(str(person_dir / f"{i:03d}.jpg"), sample)

    person = {
        "id": person_id,
        "name": name,
        "role": role,
        "department": department,
        "enrolled_at": _local_now().isoformat(),
        "samples": len(grays_with_face),
        "thumbnail": thumbnail,
    }

    with _lock:
        people = _load_people()
        people.append(person)
        _save_people(people)
        train_info = _train_model()

    return jsonify({"person": person, "training": train_info})


@app.delete("/srv/people/<person_id>")
def delete_person(person_id: str) -> Response:
    with _lock:
        people = _load_people()
        new_people = [p for p in people if p["id"] != person_id]
        if len(new_people) == len(people):
            return jsonify({"error": "Not found"}), 404
        _save_people(new_people)
        person_dir = FACES_DIR / person_id
        if person_dir.exists():
            for f in person_dir.iterdir():
                f.unlink()
            person_dir.rmdir()
        train_info = _train_model()
    return jsonify({"deleted": person_id, "training": train_info})


@app.post("/srv/recognize")
def recognize() -> Response:
    """Recognize faces in a frame and (optionally) mark attendance."""
    payload = request.get_json(force=True, silent=True) or {}
    image_data = payload.get("image")
    auto_mark = bool(payload.get("auto_mark", True))
    cooldown_minutes = int(payload.get("cooldown_minutes", 5))
    if not image_data:
        return jsonify({"error": "Missing image"}), 400

    bgr = _decode_data_url(image_data)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    boxes = _detect_faces(gray)
    h, w = gray.shape

    people = _load_people()
    if not _ensure_model_loaded() or not people:
        return jsonify(
            {
                "faces": [
                    {
                        "x": x,
                        "y": y,
                        "w": fw,
                        "h": fh,
                        "label": "Unknown",
                        "person_id": None,
                        "confidence": 0,
                    }
                    for (x, y, fw, fh) in boxes
                ],
                "width": w,
                "height": h,
                "marked": [],
                "model_ready": False,
            }
        )

    # LBPH "confidence" is actually distance (lower = better).
    # Convert to a 0-100 similarity score.
    THRESHOLD = 75.0  # distance above which we treat as Unknown
    results = []
    marked = []

    existing = _read_attendance()
    cutoff = _local_now() - timedelta(minutes=cooldown_minutes)
    recent_ids: set[str] = set()
    for r in existing:
        ts = _parse_timestamp(r.get("timestamp", ""))
        if ts is None:
            continue
        if ts >= cutoff:
            recent_ids.add(r["person_id"])

    for box in boxes:
        sample = _crop_and_normalize(gray, box)
        try:
            label, distance = recognizer.predict(sample)
        except cv2.error:
            label, distance = -1, 999.0

        person = None
        if 0 < label <= len(people):
            person = people[label - 1]

        if person is None or distance > THRESHOLD:
            results.append(
                {
                    "x": box[0],
                    "y": box[1],
                    "w": box[2],
                    "h": box[3],
                    "label": "Unknown",
                    "person_id": None,
                    "confidence": max(0.0, 100.0 - distance),
                    "distance": distance,
                }
            )
            continue

        confidence = max(0.0, min(100.0, 100.0 - distance))
        results.append(
            {
                "x": box[0],
                "y": box[1],
                "w": box[2],
                "h": box[3],
                "label": person["name"],
                "person_id": person["id"],
                "confidence": confidence,
                "distance": distance,
            }
        )

        if auto_mark and person["id"] not in recent_ids:
            now = _local_now()
            record = {
                "id": uuid.uuid4().hex[:12],
                "person_id": person["id"],
                "name": person["name"],
                "role": person.get("role", ""),
                "date": now.strftime("%Y-%m-%d"),
                "time": now.strftime("%H:%M:%S"),
                "timestamp": now.isoformat(),
                "confidence": f"{confidence:.1f}",
            }
            with _lock:
                _append_attendance(record)
            recent_ids.add(person["id"])
            marked.append(record)

    return jsonify(
        {
            "faces": results,
            "width": w,
            "height": h,
            "marked": marked,
            "model_ready": True,
        }
    )


@app.get("/srv/attendance")
def list_attendance() -> Response:
    records = _read_attendance()
    records.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    return jsonify({"records": records})


@app.get("/srv/attendance/today")
def attendance_today() -> Response:
    today = _local_now().strftime("%Y-%m-%d")
    records = [r for r in _read_attendance() if r.get("date") == today]
    records.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    return jsonify({"records": records, "date": today})


@app.get("/srv/attendance/export")
def export_attendance() -> Response:
    _ensure_attendance_file()
    csv_bytes = ATTENDANCE_FILE.read_bytes()
    today = _local_now().strftime("%Y-%m-%d")
    return Response(
        csv_bytes,
        mimetype="text/csv",
        headers={
            "Content-Disposition": (
                f'attachment; filename="attendance-{today}.csv"'
            )
        },
    )


@app.get("/srv/stats")
def stats() -> Response:
    people = _load_people()
    today = _local_now().strftime("%Y-%m-%d")
    today_records = [
        r for r in _read_attendance() if r.get("date") == today
    ]
    present_today = len({r["person_id"] for r in today_records})
    return jsonify(
        {
            "enrolled": len(people),
            "present_today": present_today,
            "checkins_today": len(today_records),
            "model_trained": MODEL_FILE.exists(),
        }
    )


# ---------- Static frontend ----------


@app.get("/")
def index() -> Response:
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/<path:filename>")
def static_files(filename: str) -> Response:
    target = STATIC_DIR / filename
    if target.is_file():
        return send_from_directory(STATIC_DIR, filename)
    # Fallback to SPA shell for client-side routes.
    return send_from_directory(STATIC_DIR, "index.html")


# Try to load the model on startup so first recognition is instant.
_ensure_model_loaded()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))  # default to 5000
    app.run(host="0.0.0.0", port=port, debug=True, threaded=True)