import threading
import time
import random
import os
import json
from typing import Callable, Optional

MODE = os.environ.get("MQTT_MODE", "mock")


class MockMQTT:
    def __init__(self, on_zone_state: Optional[Callable] = None, on_climate_request: Optional[Callable] = None, on_schedule_request: Optional[Callable] = None):
        self.on_zone_state = on_zone_state
        self.on_climate_request = on_climate_request
        self.on_schedule_request = on_schedule_request
        self.published_commands = {}
        self.zones = {1: "OFF", 2: "OFF", 3: "OFF"}
        self._running = True
        self._last_heartbeat = time.time()
        self._sensors = {
            "inside_temperature": 24.5,
            "inside_humidity": 65.0,
            "outside_temperature": 22.0,
            "outside_humidity": 70.0,
        }
        self._climate_status = {
            "fan": "off",
            "mode": "auto",
            "reason": "",
            "temp": "24.5",
            "hum": "65.0",
        }
        self._light_state = "off"
        self._thresholds = {"temp_high": 30.0, "temp_low": 28.0, "hum_high": None, "hum_low": None}
        self._camera_status = {"ip": "", "capture": "", "stream": ""}
        self._latest_frame: Optional[bytes] = None

        self._thread = threading.Thread(target=self._sensor_loop, daemon=True)
        self._thread.start()

    def _sensor_loop(self):
        while self._running:
            time.sleep(random.uniform(5, 10))
            self._sensors["inside_temperature"] = round(random.uniform(20, 35), 1)
            self._sensors["inside_humidity"] = round(random.uniform(40, 90), 1)
            self._sensors["outside_temperature"] = round(random.uniform(15, 35), 1)
            self._sensors["outside_humidity"] = round(random.uniform(30, 95), 1)
            self._last_heartbeat = time.time()
            self._evaluate_climate()

    def _evaluate_climate(self):
        temp = self._sensors["inside_temperature"]
        hum = self._sensors["inside_humidity"]
        self._climate_status["temp"] = str(temp)
        self._climate_status["hum"] = str(hum)
        mode = self._climate_status["mode"]
        if mode == "on":
            self._climate_status["fan"] = "on"
            self._climate_status["reason"] = "manual_on"
        elif mode == "off":
            self._climate_status["fan"] = "off"
            self._climate_status["reason"] = "manual_off"
        else:
            current = self._climate_status["fan"]
            thr_high = self._thresholds.get("temp_high", 30.0)
            thr_low = self._thresholds.get("temp_low", 28.0)
            if temp > thr_high:
                self._climate_status["fan"] = "on"
                self._climate_status["reason"] = "temp_high"
            elif temp < thr_low:
                self._climate_status["fan"] = "off"
                self._climate_status["reason"] = "temp_low"
            else:
                self._climate_status["reason"] = "hysteresis" if current == "on" else ""

    def publish(self, topic: str, payload: str):
        self.published_commands[topic] = payload
        if topic.endswith("/command"):
            for zone_id in [1, 2, 3]:
                if f"zone{zone_id}" in topic:
                    self.zones[zone_id] = payload
                    if self.on_zone_state:
                        threading.Timer(0.3, lambda: self.on_zone_state(zone_id, payload)).start()
        elif topic == "greenhouse/light/cmd":
            self._light_state = payload.lower()
        elif topic == "greenhouse/climate/fan/cmd":
            try:
                data = json.loads(payload)
                mode = data.get("mode", "auto")
                if mode in ("auto", "on", "off"):
                    self._climate_status["mode"] = mode
            except Exception:
                pass
            self._evaluate_climate()
        elif topic == "greenhouse/climate/thresholds":
            try:
                data = json.loads(payload)
                self._thresholds.update(data)
            except Exception:
                pass
            self._evaluate_climate()
        elif topic == "greenhouse/climate/request":
            if self.on_climate_request:
                threading.Timer(0.1, self.on_climate_request).start()
        elif topic == "greenhouse/schedules/request":
            if self.on_schedule_request:
                threading.Timer(0.1, self.on_schedule_request).start()

    def get_zones(self):
        return {f"zone{k}": v for k, v in self.zones.items()}

    def get_sensors(self):
        return {
            "inside_temperature": str(self._sensors["inside_temperature"]),
            "inside_humidity": str(self._sensors["inside_humidity"]),
            "outside_temperature": str(self._sensors["outside_temperature"]),
            "outside_humidity": str(self._sensors["outside_humidity"]),
        }

    def get_climate_status(self):
        return dict(self._climate_status)

    def get_light_state(self):
        return {"state": self._light_state}

    def get_camera_status(self):
        return dict(self._camera_status)

    def get_latest_frame(self) -> Optional[bytes]:
        return self._latest_frame

    def is_esp_online(self):
        return (time.time() - self._last_heartbeat) < 60

    def stop(self):
        self._running = False


class RealMQTT:
    def __init__(self, broker_host="localhost", broker_port=1883, on_zone_state=None, on_climate_request=None, on_schedule_request=None):
        import paho.mqtt.client as mqtt
        self.on_zone_state = on_zone_state
        self.on_climate_request = on_climate_request
        self.on_schedule_request = on_schedule_request
        self.zones = {1: "OFF", 2: "OFF", 3: "OFF"}
        self._sensors = {
            "inside_temperature": "--", "inside_humidity": "--",
            "outside_temperature": "--", "outside_humidity": "--",
        }
        self._ota_status = {"status": "idle"}
        self._firmware_version = {"version": "unknown"} 
        self._climate_status = {"fan": "off", "mode": "auto", "reason": "", "temp": "--", "hum": "--"}
        self._light_state = "off"
        self._last_heartbeat = 0
        self._camera_status = {"ip": "", "capture": "", "stream": ""}
        self._latest_frame: Optional[bytes] = None

        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="greenhouse-backend")
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.connect_async(broker_host, broker_port)
        self.client.loop_start()

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        client.subscribe("greenhouse/+/state")
        client.subscribe("greenhouse/sensor/#")
        client.subscribe("greenhouse/status")
        client.subscribe("greenhouse/climate/request")
        client.subscribe("greenhouse/climate/status")
        client.subscribe("greenhouse/light/status")
        client.subscribe("greenhouse/camera/fixed/status")
        client.subscribe("greenhouse/camera/fixed/frame")
        client.subscribe("greenhouse/ota/status")
        client.subscribe("greenhouse/firmware/version")

    def _on_message(self, client, userdata, msg):
        topic = msg.topic
        if topic == "greenhouse/camera/fixed/frame":
            self._latest_frame = bytes(msg.payload)
            return
        payload = msg.payload.decode()
        if topic == "greenhouse/status":
            self._last_heartbeat = time.time()
        elif "zone" in topic and "/state" in topic:
            for zid in [1, 2, 3]:
                if f"zone{zid}" in topic:
                    self.zones[zid] = payload
                    if self.on_zone_state:
                        self.on_zone_state(zid, payload)
        elif topic == "greenhouse/sensor/inside/temperature":
            self._sensors["inside_temperature"] = payload
        elif topic == "greenhouse/sensor/inside/humidity":
            self._sensors["inside_humidity"] = payload
        elif topic == "greenhouse/sensor/outside/temperature":
            self._sensors["outside_temperature"] = payload
        elif topic == "greenhouse/sensor/outside/humidity":
            self._sensors["outside_humidity"] = payload
        elif topic == "greenhouse/schedules/request":
            if self.on_schedule_request:
                self.on_schedule_request()
        elif topic == "greenhouse/climate/request":
            if self.on_climate_request:
                self.on_climate_request()
        elif topic == "greenhouse/climate/status":
            try:
                data = json.loads(payload)
                self._climate_status.update(data)
            except Exception:
                pass
        elif topic == "greenhouse/light/status":
            self._light_state = payload.lower()
        elif topic == "greenhouse/camera/fixed/status":
            try:
                data = json.loads(payload)
                self._camera_status.update(data)
            except Exception:
                pass
        elif topic == "greenhouse/ota/status":
            try:
                self._ota_status = json.loads(payload)
            except Exception:
                pass
        elif topic == "greenhouse/firmware/version":
            try:
                self._firmware_version = json.loads(payload)
            except Exception:
                pass    


    def publish(self, topic: str, payload: str):
        self.client.publish(topic, payload)

    def get_zones(self):
        return {f"zone{k}": v for k, v in self.zones.items()}

    def get_sensors(self):
        return self._sensors

    def get_climate_status(self):
        return dict(self._climate_status)

    def get_light_state(self):
        return {"state": self._light_state}

    def get_camera_status(self):
        return dict(self._camera_status)

    def get_latest_frame(self) -> Optional[bytes]:
        return self._latest_frame

    def is_esp_online(self):
        return (time.time() - self._last_heartbeat) < 60
  
    def get_ota_status(self):
        return dict(self._ota_status)

    def get_firmware_version(self):
        return dict(self._firmware_version)

    def stop(self):
        self.client.loop_stop()
        self.client.disconnect()