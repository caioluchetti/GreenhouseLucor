from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, Response
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo
import os
import json
import threading
import time
import shutil
import urllib.request

from models import (
    ZoneState, SensorReadings, StatusResponse,
    ScheduleCreate, ScheduleUpdate, ScheduleResponse,
    IrrigationStatus, ZoneNameUpdate, ZoneNameResponse,
    ClimateRuleUpdate, ClimateRuleResponse, ClimateStatus, LightState,
    SensorHistoryPoint, SensorHistoryResponse, CameraStatusResponse,
    FirmwareUploadResponse, FirmwareDeployResponse, FirmwareStatusResponse,
    CameraScheduleUpdate, CameraScheduleResponse,
    LoginRequest, TokenResponse, SetPasswordRequest, AuthStatusResponse

)
from database import (
    SessionLocal, ScheduleRow, ZoneNameRow, ClimateRuleRow, LightStateRow, CameraScheduleRow, SensorHistoryRow, get_db, AuthConfigRow
)
from mqtt_client import MockMQTT, RealMQTT
from scheduler import Scheduler
from sqlalchemy.orm import Session
from auth import get_current_user, verify_password, create_access_token, verify_token, hash_password, ensure_default_password, _get_config_value, _set_config_value

MODE = os.environ.get("MQTT_MODE", "mock")
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "data", "captures")
INTERVAL_UPLOAD_DIR = os.path.join(UPLOAD_DIR, "interval")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(INTERVAL_UPLOAD_DIR, exist_ok=True)

mqt = None
mqtt = None
scheduler = None
_history_running = True
_camera_stream_running = True
_camera_capture_running = True
_drive_upload_running = True

_latest_frame: bytes | None = None
_last_frame_time: float = 0.0


def _camera_stream_loop():
    """Background thread: opens ONE persistent connection to the ESP32-CAM
    MJPEG stream, parses individual JPEG frames from the multipart response,
    and stores the latest frame in _latest_frame. This lets /api/camera/proxy
    fan-out to N viewers without each viewer hitting the camera directly
    (the ESP32-CAM WebServer is single-threaded and can only handle one
    /stream client at a time)."""
    global _latest_frame, _last_frame_time, _camera_stream_running
    stream_url = os.environ.get("CAMERA_STREAM_URL", "http://tatufa-cam.ddns.net:8085/stream")
    while _camera_stream_running:
        try:
            req = urllib.request.Request(stream_url)
            with urllib.request.urlopen(req, timeout=15) as resp:
                buf = b""
                while _camera_stream_running:
                    chunk = resp.read(4096)
                    if not chunk:
                        break
                    buf += chunk
                    # Parse MJPEG frames: "--frame\r\nContent-Type: ...\r\nContent-Length: N\r\n\r\n<jpeg>\r\n"
                    while True:
                        boundary = buf.find(b"--frame\r\n")
                        if boundary == -1:
                            break
                        # Find end of headers (double CRLF after headers)
                        header_end = buf.find(b"\r\n\r\n", boundary)
                        if header_end == -1:
                            break
                        header_str = buf[boundary:header_end].decode("ascii", errors="ignore")
                        # Extract Content-Length
                        cl_match = ""
                        for line in header_str.split("\r\n"):
                            if line.lower().startswith("content-length:"):
                                cl_match = line.split(":", 1)[1].strip()
                                break
                        if not cl_match:
                            # Not a data frame (could be text/plain "Waiting")
                            buf = buf[header_end + 4:]
                            continue
                        content_len = int(cl_match)
                        frame_start = header_end + 4
                        frame_end = frame_start + content_len
                        if len(buf) < frame_end:
                            break  # need more data
                        jpeg = buf[frame_start:frame_end]
                        _latest_frame = jpeg
                        _last_frame_time = time.time()
                        buf = buf[frame_end:]
                        # Skip trailing \r\n after frame
                        if buf[:2] == b"\r\n":
                            buf = buf[2:]
        except Exception as e:
            print(f"[Camera Stream] Connection error: {e} — retrying in 2s")
            time.sleep(2)


def _camera_capture_loop():
    """Save one recent camera frame at each configured daily time."""
    global _camera_capture_running
    captured_slots = set()
    interval_captured_slots = set()

    while _camera_capture_running:
        now = datetime.now(ZoneInfo("America/Sao_Paulo"))
        slot = f"{now:%Y-%m-%d} {now:%H:%M}"
        db = SessionLocal()
        try:
            schedule = db.query(CameraScheduleRow).first()
            capture_times = {schedule.morning_time, schedule.afternoon_time} if schedule else {"09:00", "16:00"}
        finally:
            db.close()

        if now.strftime("%H:%M") in capture_times and slot not in captured_slots:
            frame = _latest_frame
            frame_age = time.time() - _last_frame_time
            if frame and frame_age <= 120:
                timestamp = now.strftime("%Y%m%d_%H%M%S")
                filename = f"camera_{timestamp}.jpg"
                filepath = os.path.join(UPLOAD_DIR, filename)
                try:
                    with open(filepath, "wb") as image_file:
                        image_file.write(frame)
                    captured_slots.add(slot)
                    print(f"[Camera Capture] Saved {filename}", flush=True)
                except OSError as exc:
                    print(f"[Camera Capture] Could not save {filename}: {exc}", flush=True)
            else:
                print("[Camera Capture] No recent frame available", flush=True)

        minutes = now.hour * 60 + now.minute
        interval_slot = f"{now:%Y-%m-%d} {now:%H:%M}"
        is_interval_time = 330 <= minutes <= 1110 and now.minute in (0, 30)
        if is_interval_time and interval_slot not in interval_captured_slots:
            frame = _latest_frame
            frame_age = time.time() - _last_frame_time
            if frame and frame_age <= 120:
                timestamp = now.strftime("%Y%m%d_%H%M%S")
                filename = f"interval_{timestamp}.jpg"
                filepath = os.path.join(INTERVAL_UPLOAD_DIR, filename)
                try:
                    with open(filepath, "wb") as image_file:
                        image_file.write(frame)
                    interval_captured_slots.add(interval_slot)
                    print(f"[Camera Interval] Saved {filename}", flush=True)
                except OSError as exc:
                    print(f"[Camera Interval] Could not save {filename}: {exc}", flush=True)
            else:
                print("[Camera Interval] No recent frame available", flush=True)

        # Keep the set bounded while retaining enough history to prevent duplicates.
        if len(captured_slots) > 14:
            captured_slots = {item for item in captured_slots if item >= f"{now:%Y-%m-%d} 00:00"}
        if len(interval_captured_slots) > 60:
            interval_captured_slots = {item for item in interval_captured_slots if item >= f"{now:%Y-%m-%d} 00:00"}
        time.sleep(5)


def _drive_upload_loop():
    """Upload saved camera photos to the configured Google Drive folder."""
    global _drive_upload_running
    token_file = os.environ.get("GOOGLE_DRIVE_TOKEN", "/run/secrets/google-drive-token.json")
    folder_id = os.environ.get("GOOGLE_DRIVE_FOLDER_ID", "1jRKgLSOn3UbpcbKn84WUrCrvQxpH3d3Y")
    uploaded = set()
    service = None

    while _drive_upload_running:
        try:
            if service is None:
                from google.auth.transport.requests import Request
                from google.oauth2.credentials import Credentials
                from googleapiclient.discovery import build

                credentials = Credentials.from_authorized_user_file(
                    token_file,
                    ["https://www.googleapis.com/auth/drive"],
                )
                if credentials.expired and credentials.refresh_token:
                    credentials.refresh(Request())
                    with open(token_file, "w", encoding="utf-8") as token:
                        token.write(credentials.to_json())
                if not credentials.valid:
                    raise RuntimeError("Google Drive OAuth token is invalid or expired")
                service = build("drive", "v3", credentials=credentials, cache_discovery=False)

            capture_sources = [
                (UPLOAD_DIR, "camera_"),
                (INTERVAL_UPLOAD_DIR, "interval_"),
            ]
            for source_dir, filename_prefix in capture_sources:
                for filename in sorted(os.listdir(source_dir)):
                    if not filename.startswith(filename_prefix) or not filename.endswith(".jpg"):
                        continue
                    if filename in uploaded:
                        continue

                    filepath = os.path.join(source_dir, filename)
                    if not os.path.isfile(filepath):
                        continue

                    query = (
                        f"name = '{filename}' and '{folder_id}' in parents "
                        "and trashed = false"
                    )
                    existing = service.files().list(
                        q=query,
                        spaces="drive",
                        fields="files(id)",
                        pageSize=1,
                    ).execute().get("files", [])
                    if not existing:
                        from googleapiclient.http import MediaFileUpload

                        service.files().create(
                            body={"name": filename, "parents": [folder_id]},
                            media_body=MediaFileUpload(filepath, mimetype="image/jpeg"),
                            fields="id",
                        ).execute()
                        print(f"[Google Drive] Uploaded {filename}", flush=True)
                    uploaded.add(filename)
        except Exception as exc:
            service = None
            print(f"[Google Drive] Upload error: {exc} — retrying in 5m", flush=True)

        time.sleep(300)


def _sensor_history_loop():
    while _history_running:
        time.sleep(300)
        if mqtt is None:
            continue
        sensors = mqtt.get_sensors()
        now = datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat()
        db = SessionLocal()
        try:
            for key, val in sensors.items():
                try:
                    numeric = float(val)
                    source = "inside" if "inside" in key else "outside"
                    metric = "temperature" if "temperature" in key else "humidity"
                    db.add(SensorHistoryRow(
                        source=source, metric=metric, value=numeric, recorded_at=now
                    ))
                except (ValueError, TypeError):
                    pass
            db.commit()
        finally:
            db.close()


def on_zone_state(zone_id, state):
    pass


def on_climate_request():
    if mqtt is None:
        return
    db = SessionLocal()
    try:
        row = db.query(ClimateRuleRow).first()
    finally:
        db.close()
    if not row:
        return
    payload = {
        "temp_high": row.temp_high,
        "temp_low": row.temp_low,
        "hum_high": row.hum_high,
        "hum_low": row.hum_low,
    }
    mqtt.publish("greenhouse/climate/thresholds", json.dumps(payload))
    mqtt.publish("greenhouse/climate/fan/cmd", json.dumps({"mode": row.fan_mode}))


def on_schedule_request():
    _publish_schedule_sync()


def _publish_schedule_sync():
    if mqtt is None:
        return
    db = SessionLocal()
    try:
        rows = db.query(ScheduleRow).all()
        data = [{
            "id": r.id,
            "zone_id": r.zone_id,
            "target_type": r.target_type or "zone",
            "days": r.days,
            "time": r.time,
            "duration": r.duration,
            "enabled": r.enabled,
        } for r in rows]
        mqtt.publish("greenhouse/schedules/sync", json.dumps(data))
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global mqtt, scheduler, _history_running, _camera_stream_running, _camera_capture_running, _drive_upload_running
    ensure_default_password()
    print(f"[MQTT] Modo: {MODE}")
    if MODE == "real":
        broker = os.environ.get("MQTT_BROKER", "localhost")
        broker_port = int(os.environ.get("MQTT_PORT", "1884"))
        mqtt = RealMQTT(broker_host=broker, broker_port=broker_port, on_zone_state=on_zone_state, on_climate_request=on_climate_request, on_schedule_request=on_schedule_request)
    else:
        mqtt = MockMQTT(on_zone_state=on_zone_state, on_climate_request=on_climate_request, on_schedule_request=on_schedule_request)
    scheduler = Scheduler(mqtt)
    threading.Thread(target=_sensor_history_loop, daemon=True).start()
    threading.Thread(target=_camera_stream_loop, daemon=True).start()
    threading.Thread(target=_camera_capture_loop, daemon=True).start()
    threading.Thread(target=_drive_upload_loop, daemon=True).start()
    yield
    _history_running = False
    _camera_stream_running = False
    _camera_capture_running = False
    _drive_upload_running = False
    mqtt.stop()
    scheduler.stop()


app = FastAPI(title="Greenhouse Lucor API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/time")
async def get_time():
    now = datetime.now(ZoneInfo("America/Sao_Paulo"))
    return {
        "datetime": now.strftime("%Y-%m-%d %H:%M:%S"),
        "time": now.strftime("%H:%M"),
        "date": now.strftime("%d/%m/%Y"),
        "weekday": now.strftime("%a").capitalize(),
        "formatted": now.strftime("%a, %d %b %H:%M")
    }


@app.get("/api/status")
async def get_status():
    return StatusResponse(esp="online" if mqtt.is_esp_online() else "offline")


@app.post("/api/auth/login", response_model=TokenResponse)
async def login(data: LoginRequest):
    hashed = _get_config_value("hashed_password")
    if not hashed or not verify_password(data.password, hashed):
        raise HTTPException(status_code=401, detail="Senha incorreta")
    return TokenResponse(access_token=create_access_token())


@app.get("/api/auth/verify", response_model=AuthStatusResponse)
async def verify_auth(user: str = Depends(get_current_user)):
    return AuthStatusResponse(authenticated=True)


@app.put("/api/auth/set-password")
async def set_password(data: SetPasswordRequest, user: str = Depends(get_current_user)):
    hashed = _get_config_value("hashed_password")
    if not hashed or not verify_password(data.current_password, hashed):
        raise HTTPException(status_code=401, detail="Senha atual incorreta")
    if len(data.new_password) < 3:
        raise HTTPException(status_code=400, detail="Nova senha deve ter pelo menos 3 caracteres")
    _set_config_value("hashed_password", hash_password(data.new_password))
    return {"status": "ok", "message": "Senha alterada com sucesso"}


@app.get("/api/zones")
async def get_zones():
    zones = mqtt.get_zones()
    return ZoneState(**zones)


@app.post("/api/zones/{zone_id}/{action}")
async def control_zone(zone_id: int, action: str, user: str = Depends(get_current_user)):
    if zone_id not in [1, 2, 3]:
        raise HTTPException(status_code=400, detail="Zona inválida (1-3)")
    if action.upper() not in ["ON", "OFF"]:
        raise HTTPException(status_code=400, detail="Ação inválida (ON/OFF)")
    mqtt.publish(f"greenhouse/zone{zone_id}/command", action.upper())
    return {"status": "ok", "zone": zone_id, "action": action.upper()}


@app.get("/api/zones/names", response_model=list[ZoneNameResponse])
async def get_zone_names(db: Session = Depends(get_db)):
    rows = db.query(ZoneNameRow).order_by(ZoneNameRow.zone_id).all()
    return [ZoneNameResponse(zone_id=r.zone_id, name=r.name, icon=r.icon) for r in rows]


@app.put("/api/zones/{zone_id}/name", response_model=ZoneNameResponse)
async def update_zone_name(zone_id: int, data: ZoneNameUpdate, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    if zone_id not in [1, 2, 3]:
        raise HTTPException(status_code=400, detail="Zona inválida (1-3)")
    row = db.query(ZoneNameRow).filter(ZoneNameRow.zone_id == zone_id).first()
    if not row:
        row = ZoneNameRow(zone_id=zone_id, name=data.name or f"Zona {zone_id}", icon=data.icon or "🌱")
        db.add(row)
    else:
        if data.name is not None:
            row.name = data.name
        if data.icon is not None:
            row.icon = data.icon
    db.commit()
    db.refresh(row)
    return ZoneNameResponse(zone_id=row.zone_id, name=row.name, icon=row.icon)


@app.get("/api/sensors")
async def get_sensors():
    sensors = mqtt.get_sensors()
    return SensorReadings(**sensors)


@app.get("/api/irrigation", response_model=IrrigationStatus)
async def get_irrigation():
    return scheduler.get_irrigation_status()


# ────────────────────────────────────────────────
# Schedules (now with target_type: zone | light)
# ────────────────────────────────────────────────

@app.get("/api/schedules", response_model=list[ScheduleResponse])
async def list_schedules(db: Session = Depends(get_db)):
    rows = db.query(ScheduleRow).all()
    return [ScheduleResponse(
        id=r.id,
        zone_id=r.zone_id,
        target_type=r.target_type or "zone",
        days=r.days, time=r.time, duration=r.duration, enabled=r.enabled
    ) for r in rows]


@app.post("/api/schedules", response_model=ScheduleResponse)
async def create_schedule(data: ScheduleCreate, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    if data.target_type not in ("zone", "light"):
        raise HTTPException(status_code=400, detail="target_type inválido (zone|light)")
    if data.target_type == "zone" and data.zone_id not in [1, 2, 3]:
        raise HTTPException(status_code=400, detail="Zona inválida (1-3)")
    if data.target_type == "light":
        data.zone_id = None
    row = ScheduleRow(
        zone_id=data.zone_id, target_type=data.target_type,
        days=data.days, time=data.time, duration=data.duration, enabled=data.enabled
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _publish_schedule_sync()
    return ScheduleResponse(
        id=row.id, zone_id=row.zone_id, target_type=row.target_type,
        days=row.days, time=row.time, duration=row.duration, enabled=row.enabled
    )


@app.put("/api/schedules/{schedule_id}", response_model=ScheduleResponse)
async def update_schedule(schedule_id: int, data: ScheduleUpdate, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    row = db.query(ScheduleRow).filter(ScheduleRow.id == schedule_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Schedule não encontrado")
    if data.target_type is not None:
        if data.target_type not in ("zone", "light"):
            raise HTTPException(status_code=400, detail="target_type inválido (zone|light)")
        row.target_type = data.target_type
        if data.target_type == "light":
            row.zone_id = None
    if data.zone_id is not None:
        if row.target_type == "zone" and data.zone_id not in [1, 2, 3]:
            raise HTTPException(status_code=400, detail="Zona inválida (1-3)")
        if row.target_type == "zone":
            row.zone_id = data.zone_id
    if data.days is not None: row.days = data.days
    if data.time is not None: row.time = data.time
    if data.duration is not None: row.duration = data.duration
    if data.enabled is not None: row.enabled = data.enabled
    db.commit()
    db.refresh(row)
    _publish_schedule_sync()
    return ScheduleResponse(
        id=row.id, zone_id=row.zone_id, target_type=row.target_type or "zone",
        days=row.days, time=row.time, duration=row.duration, enabled=row.enabled
    )


@app.delete("/api/schedules/{schedule_id}")
async def delete_schedule(schedule_id: int, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    row = db.query(ScheduleRow).filter(ScheduleRow.id == schedule_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Schedule não encontrado")
    db.delete(row)
    db.commit()
    _publish_schedule_sync()
    return {"status": "deleted", "id": schedule_id}


# ────────────────────────────────────────────────
# Climate control (fan + thresholds)
# ────────────────────────────────────────────────

@app.get("/api/climate/rules", response_model=ClimateRuleResponse)
async def get_climate_rules(db: Session = Depends(get_db)):
    row = db.query(ClimateRuleRow).first()
    if not row:
        row = ClimateRuleRow()
        db.add(row)
        db.commit()
        db.refresh(row)
    return ClimateRuleResponse(
        temp_high=row.temp_high, temp_low=row.temp_low,
        hum_high=row.hum_high, hum_low=row.hum_low, fan_mode=row.fan_mode
    )


@app.put("/api/climate/rules", response_model=ClimateRuleResponse)
async def update_climate_rules(data: ClimateRuleUpdate, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    row = db.query(ClimateRuleRow).first()
    if not row:
        row = ClimateRuleRow()
        db.add(row)
    if data.temp_high is not None: row.temp_high = data.temp_high
    if data.temp_low is not None: row.temp_low = data.temp_low
    if data.hum_high is not None: row.hum_high = data.hum_high
    if data.hum_low is not None: row.hum_low = data.hum_low
    if data.fan_mode is not None:
        if data.fan_mode not in ("auto", "on", "off"):
            raise HTTPException(status_code=400, detail="fan_mode inválido (auto|on|off)")
        row.fan_mode = data.fan_mode
    db.commit()
    db.refresh(row)

    payload = {
        "temp_high": row.temp_high, "temp_low": row.temp_low,
        "hum_high": row.hum_high, "hum_low": row.hum_low,
    }
    mqtt.publish("greenhouse/climate/thresholds", json.dumps(payload))

    return ClimateRuleResponse(
        temp_high=row.temp_high, temp_low=row.temp_low,
        hum_high=row.hum_high, hum_low=row.hum_low, fan_mode=row.fan_mode
    )


@app.post("/api/climate/fan/{mode}")
async def set_fan_mode(mode: str, user: str = Depends(get_current_user)):
    if mode not in ("auto", "on", "off"):
        raise HTTPException(status_code=400, detail="Modo inválido (auto|on|off)")
    db = SessionLocal()
    try:
        row = db.query(ClimateRuleRow).first()
        if row:
            row.fan_mode = mode
            db.commit()
    finally:
        db.close()
    mqtt.publish("greenhouse/climate/fan/cmd", json.dumps({"mode": mode}))
    return {"status": "ok", "mode": mode}


@app.get("/api/climate/status", response_model=ClimateStatus)
async def get_climate_status():
    s = mqtt.get_climate_status()
    return ClimateStatus(
        fan=s.get("fan", "off"),
        mode=s.get("mode", "auto"),
        reason=s.get("reason", ""),
        temp=s.get("temp", "--"),
        hum=s.get("hum", "--"),
    )


# ────────────────────────────────────────────────
# Light control
# ────────────────────────────────────────────────

@app.post("/api/light/{state}")
async def set_light(state: str, user: str = Depends(get_current_user)):
    if state.upper() not in ("ON", "OFF"):
        raise HTTPException(status_code=400, detail="Estado inválido (ON|OFF)")
    mqtt.publish("greenhouse/light/cmd", state.upper())
    db = SessionLocal()
    try:
        row = db.query(LightStateRow).first()
        if not row:
            row = LightStateRow()
            db.add(row)
        row.state = state.lower()
        db.commit()
    finally:
        db.close()
    return {"status": "ok", "state": state.upper()}


@app.get("/api/light/status", response_model=LightState)
async def get_light_status():
    return LightState(**mqtt.get_light_state())


# ────────────────────────────────────────────────
# Sensor history (for charts)
# ────────────────────────────────────────────────

@app.get("/api/sensors/history")
async def get_sensor_history(period: str = "24h", db: Session = Depends(get_db)):
    from datetime import timedelta

    hours = {"1h": 1, "24h": 24, "7d": 168, "30d": 720}.get(period, 24)
    cutoff = (datetime.now(ZoneInfo("America/Sao_Paulo")) - timedelta(hours=hours)).isoformat()

    rows = db.query(SensorHistoryRow).filter(
        SensorHistoryRow.recorded_at >= cutoff
    ).order_by(SensorHistoryRow.recorded_at.asc()).all()

    result = {"inside": [], "outside": []}
    for r in rows:
        point = {"value": r.value, "recorded_at": r.recorded_at}
        if r.source in result:
            existing = next((m for m in result[r.source] if m["metric"] == r.metric), None)
            if existing:
                existing["points"].append(point)
            else:
                result[r.source].append({"metric": r.metric, "points": [point]})

    return result


@app.get("/api/sensors/history/csv")
async def get_sensor_history_csv(period: str = "24h", db: Session = Depends(get_db)):
    import csv
    import io
    from datetime import timedelta

    if period == "all":
        rows = db.query(SensorHistoryRow).order_by(
            SensorHistoryRow.recorded_at.asc()
        ).all()
    else:
        hours = {"1h": 1, "24h": 24, "7d": 168, "30d": 720}.get(period, 24)
        cutoff = (datetime.now(ZoneInfo("America/Sao_Paulo")) - timedelta(hours=hours)).isoformat()
        rows = db.query(SensorHistoryRow).filter(
            SensorHistoryRow.recorded_at >= cutoff
        ).order_by(SensorHistoryRow.recorded_at.asc()).all()

    col_keys = [
        "inside_temperature", "inside_humidity",
        "outside_temperature", "outside_humidity",
    ]
    pivot = {}
    for r in rows:
        ts = r.recorded_at
        if ts not in pivot:
            pivot[ts] = {}
        pivot[ts][f"{r.source}_{r.metric}"] = r.value

    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["timestamp"] + col_keys)
    for ts in sorted(pivot.keys()):
        row = pivot[ts]
        writer.writerow([ts] + [row.get(k, "") for k in col_keys])

    stamp = datetime.now(ZoneInfo("America/Sao_Paulo")).strftime("%Y%m%d_%H%M")
    filename = f"sensores_{period}_{stamp}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.delete("/api/sensors/history")
async def clear_sensor_history(db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    deleted = db.query(SensorHistoryRow).delete()
    db.commit()
    return {"status": "deleted", "count": deleted}


# ────────────────────────────────────────────────
# Camera
# ────────────────────────────────────────────────

@app.get("/api/camera/schedule", response_model=CameraScheduleResponse)
async def get_camera_schedule(db: Session = Depends(get_db)):
    row = db.query(CameraScheduleRow).first()
    if not row:
        row = CameraScheduleRow(morning_time="09:00", afternoon_time="16:00")
        db.add(row)
        db.commit()
        db.refresh(row)
    return CameraScheduleResponse(morning_time=row.morning_time, afternoon_time=row.afternoon_time)


@app.put("/api/camera/schedule", response_model=CameraScheduleResponse)
async def update_camera_schedule(data: CameraScheduleUpdate, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    for name, value in (("morning_time", data.morning_time), ("afternoon_time", data.afternoon_time)):
        try:
            parsed = datetime.strptime(value, "%H:%M")
            if parsed.strftime("%H:%M") != value:
                raise ValueError
        except ValueError:
            raise HTTPException(status_code=400, detail=f"{name} deve estar no formato HH:MM")
    if data.morning_time == data.afternoon_time:
        raise HTTPException(status_code=400, detail="Os horários das fotos devem ser diferentes")

    row = db.query(CameraScheduleRow).first()
    if not row:
        row = CameraScheduleRow()
        db.add(row)
    row.morning_time = data.morning_time
    row.afternoon_time = data.afternoon_time
    db.commit()
    db.refresh(row)
    return CameraScheduleResponse(morning_time=row.morning_time, afternoon_time=row.afternoon_time)

@app.get("/api/camera/status", response_model=CameraStatusResponse)
async def camera_status():
    status = dict(mqtt.get_camera_status())
    if not status.get("ip") and time.time() - _last_frame_time < 10:
        status["ip"] = "connected"
        status["capture"] = "/api/camera/image"
        status["stream"] = "/api/camera/live"
    return CameraStatusResponse(**status)

@app.post("/api/camera/capture")
async def camera_capture(user: str = Depends(get_current_user)):
    mqtt.publish("greenhouse/camera/fixed/capture", "1")
    return {"status": "ok", "message": "Capture command sent"}

@app.post("/api/camera/upload")
async def camera_upload(image: UploadFile = File(...)):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"capture_{timestamp}.jpg"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        shutil.copyfileobj(image.file, f)
    latest_path = os.path.join(UPLOAD_DIR, "latest.jpg")
    shutil.copyfile(filepath, latest_path)
    return {"status": "saved", "filename": filename}

@app.post("/api/camera/frame")
async def camera_frame(request: Request):
    global _latest_frame, _last_frame_time
    _latest_frame = await request.body()
    _last_frame_time = time.time()
    return {"status": "ok", "size": len(_latest_frame)}

@app.get("/api/camera/image")
async def camera_image():
    latest_path = os.path.join(UPLOAD_DIR, "latest.jpg")
    if not os.path.exists(latest_path):
        raise HTTPException(status_code=404, detail="No image available")
    return FileResponse(latest_path, media_type="image/jpeg")

@app.get("/api/camera/live")
async def camera_live():
    def frame_generator():
        sent = False
        while True:
            frame = _latest_frame
            if frame:
                sent = True
                yield (b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n" +
                    f"Content-Length: {len(frame)}\r\n\r\n".encode() + frame + b"\r\n")
            elif not sent:
                yield b"--frame\r\nContent-Type: text/plain\r\nContent-Length: 7\r\n\r\nWaiting\r\n"
            time.sleep(0.1)   # was 0.2 — now matches ~10fps
    return StreamingResponse(
        frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

FIRMWARE_DIR = os.path.join(os.path.dirname(__file__), "data", "firmware")
os.makedirs(FIRMWARE_DIR, exist_ok=True)
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "https://greenhouse.cortada-server.ddns.net")

CAMERA_STREAM_URL = os.environ.get("CAMERA_STREAM_URL", "http://tatufa-cam.ddns.net:8085/stream")


@app.get("/api/camera/proxy")
async def camera_proxy():
    def frame_generator():
        sent = False
        while True:
            frame = _latest_frame
            if frame:
                sent = True
                yield (b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n" +
                    f"Content-Length: {len(frame)}\r\n\r\n".encode() + frame + b"\r\n")
            elif not sent:
                yield b"--frame\r\nContent-Type: text/plain\r\nContent-Length: 7\r\n\r\nWaiting\r\n"
            time.sleep(0.1)   # ~10fps poll of _latest_frame (camera produces ~5fps)
    return StreamingResponse(
        frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

OTA_TOPICS = {
    "greenhouse": "greenhouse/ota/update",
    "camera": "greenhouse/camera/ota/update",
}

@app.post("/api/firmware/upload", response_model=FirmwareUploadResponse)
async def upload_firmware(version: str, device: str = "greenhouse", file: UploadFile = File(...), user: str = Depends(get_current_user)):
    if device not in OTA_TOPICS:
        raise HTTPException(status_code=400, detail="device inválido (greenhouse|camera)")
    if not file.filename.endswith(".bin"):
        raise HTTPException(status_code=400, detail="Arquivo deve ser .bin")
    filename = f"{device}_v{version}.bin"   # prefix avoids overwriting the other device's binary
    filepath = os.path.join(FIRMWARE_DIR, filename)
    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return FirmwareUploadResponse(status="uploaded", filename=filename, version=version)


@app.post("/api/firmware/deploy", response_model=FirmwareDeployResponse)
async def deploy_firmware(filename: str, version: str, device: str = "greenhouse", user: str = Depends(get_current_user)):
    if device not in OTA_TOPICS:
        raise HTTPException(status_code=400, detail="device inválido (greenhouse|camera)")
    filepath = os.path.join(FIRMWARE_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Firmware não encontrado")
    fw_url = f"{PUBLIC_BASE_URL}/api/firmware/download/{filename}"
    mqtt.publish(OTA_TOPICS[device], json.dumps({"url": fw_url, "version": version}))
    return FirmwareDeployResponse(status="ok", url=fw_url, version=version)

@app.get("/api/firmware/download/{filename}")
async def download_firmware(filename: str):
    filepath = os.path.join(FIRMWARE_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(filepath, media_type="application/octet-stream")



@app.get("/api/firmware/status", response_model=FirmwareStatusResponse)
async def firmware_status(device: str = "greenhouse"):
    if device not in OTA_TOPICS:
        raise HTTPException(status_code=400, detail="device inválido (greenhouse|camera)")
    ota = mqtt.get_ota_status(device)
    ver = mqtt.get_firmware_version(device)
    return FirmwareStatusResponse(
        status=ota.get("status", "idle"),
        reason=ota.get("reason"),
        error=ota.get("error"),
        rebooting=ota.get("rebooting"),
        current_version=ver.get("version"),
    )

@app.get("/api/firmware/list")
async def list_firmware():
    files = sorted(os.listdir(FIRMWARE_DIR)) if os.path.isdir(FIRMWARE_DIR) else []
    return {"files": files}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=6001)
