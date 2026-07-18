from pydantic import BaseModel
from typing import Optional

class ZoneState(BaseModel):
    zone1: str = "OFF"
    zone2: str = "OFF"
    zone3: str = "OFF"

class SensorReadings(BaseModel):
    inside_temperature: str = "--"
    inside_humidity: str = "--"
    outside_temperature: str = "--"
    outside_humidity: str = "--"

class SensorHistoryPoint(BaseModel):
    source: str
    metric: str
    value: float
    recorded_at: str

class SensorHistoryResponse(BaseModel):
    inside: list[dict] = []
    outside: list[dict] = []

class StatusResponse(BaseModel):
    esp: str = "offline"

class ScheduleCreate(BaseModel):
    zone_id: Optional[int] = None
    target_type: str = "zone"
    days: str
    time: str
    duration: int
    enabled: bool = True

class ScheduleUpdate(BaseModel):
    zone_id: Optional[int] = None
    target_type: Optional[str] = None
    days: Optional[str] = None
    time: Optional[str] = None
    duration: Optional[int] = None
    enabled: Optional[bool] = None

class ScheduleResponse(BaseModel):
    id: int
    zone_id: Optional[int] = None
    target_type: str = "zone"
    days: str
    time: str
    duration: int
    enabled: bool

class IrrigationZoneStatus(BaseModel):
    remaining: float = 0.0
    total: float = 0.0

class IrrigationStatus(BaseModel):
    zone1: IrrigationZoneStatus = IrrigationZoneStatus()
    zone2: IrrigationZoneStatus = IrrigationZoneStatus()
    zone3: IrrigationZoneStatus = IrrigationZoneStatus()

class ZoneNameUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None

class ZoneNameResponse(BaseModel):
    zone_id: int
    name: str
    icon: str

class ClimateRuleUpdate(BaseModel):
    temp_high: Optional[float] = None
    temp_low: Optional[float] = None
    hum_high: Optional[float] = None
    hum_low: Optional[float] = None
    fan_mode: Optional[str] = None

class ClimateRuleResponse(BaseModel):
    temp_high: float = 30.0
    temp_low: float = 28.0
    hum_high: Optional[float] = None
    hum_low: Optional[float] = None
    fan_mode: str = "auto"

class ClimateStatus(BaseModel):
    fan: str = "off"
    mode: str = "auto"
    reason: str = ""
    temp: str = "--"
    hum: str = "--"

class LightState(BaseModel):
    state: str = "off"

class CameraStatusResponse(BaseModel):
    ip: str = ""
    capture: str = ""
    stream: str = ""


class FirmwareUploadResponse(BaseModel):
    status: str
    filename: str
    version: str

class FirmwareDeployResponse(BaseModel):
    status: str
    url: str
    version: str

class FirmwareStatusResponse(BaseModel):
    status: str
    reason: Optional[str] = None
    error: Optional[str] = None
    rebooting: Optional[bool] = None
    current_version: Optional[str] = None


class LoginRequest(BaseModel):
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class SetPasswordRequest(BaseModel):
    current_password: str
    new_password: str


class AuthStatusResponse(BaseModel):
    authenticated: bool