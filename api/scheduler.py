import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from database import SessionLocal, ScheduleRow

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


class Scheduler:
    def __init__(self, mqtt):
        self.mqtt = mqtt
        self._running = True
        self._pending_off = {}
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self):
        while self._running:
            self._check_schedules()
            time.sleep(5)

    def _check_schedules(self):
        now = datetime.now(ZoneInfo("America/Sao_Paulo"))
        current_day = WEEKDAYS[now.weekday()]
        current_time = now.strftime("%H:%M")
        minute_key = now.strftime("%Y-%m-%d %H:%M")

        db = SessionLocal()
        try:
            schedules = db.query(ScheduleRow).filter(ScheduleRow.enabled == True).all()
            for s in schedules:
                days = [d.strip().lower() for d in s.days.split(",")]
                if current_day not in days or s.time != current_time:
                    continue
                target_type = (s.target_type or "zone").lower()
                zone_id = s.zone_id or 0
                key = f"{target_type}_{zone_id}_{minute_key}"
                if key in self._pending_off:
                    continue
                if target_type == "light":
                    print(f"[Scheduler] Ligando Luz — {s.time} ({s.duration}min)", flush=True)
                    self.mqtt.publish("greenhouse/light/cmd", "ON")
                else:
                    print(f"[Scheduler] Ligando Zona {zone_id} — {s.time} ({s.duration}min)", flush=True)
                    self.mqtt.publish(f"greenhouse/zone{zone_id}/command", "ON")
                self._pending_off[key] = {
                    "target_type": target_type,
                    "zone_id": zone_id,
                    "duration": float(s.duration),
                    "remaining": float(s.duration),
                    "started_at": now,
                }
        finally:
            db.close()

        expired = []
        for key, data in list(self._pending_off.items()):
            elapsed = (now - data["started_at"]).total_seconds() / 60.0
            remaining = max(0, data["duration"] - elapsed)
            data["remaining"] = remaining
            if remaining <= 0:
                if data["target_type"] == "light":
                    print("[Scheduler] Desligando Luz — fim do schedule", flush=True)
                    self.mqtt.publish("greenhouse/light/cmd", "OFF")
                else:
                    zid = data["zone_id"]
                    print(f"[Scheduler] Desligando Zona {zid} — fim do schedule", flush=True)
                    self.mqtt.publish(f"greenhouse/zone{zid}/command", "OFF")
                expired.append(key)

        for key in expired:
            del self._pending_off[key]

    def get_irrigation_status(self):
        zones = {
            "zone1": {"remaining": 0.0, "total": 0.0},
            "zone2": {"remaining": 0.0, "total": 0.0},
            "zone3": {"remaining": 0.0, "total": 0.0},
        }
        for key, data in self._pending_off.items():
            if data["target_type"] != "zone":
                continue
            zid = data["zone_id"]
            zone_key = f"zone{zid}"
            remaining = data.get("remaining", data["duration"])
            zones[zone_key]["remaining"] += remaining
            zones[zone_key]["total"] += data["duration"]
        return zones

    def stop(self):
        self._running = False
