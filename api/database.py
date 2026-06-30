from sqlalchemy import create_engine, Column, Integer, String, Boolean, Float, text
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import NullPool
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "greenhouse.db")
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False}, poolclass=NullPool)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class ScheduleRow(Base):
    __tablename__ = "schedules"
    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(Integer, nullable=True)
    target_type = Column(String, nullable=False, default="zone")
    days = Column(String, nullable=False)
    time = Column(String, nullable=False)
    duration = Column(Integer, nullable=False)
    enabled = Column(Boolean, default=True)


class ZoneNameRow(Base):
    __tablename__ = "zone_names"
    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(Integer, nullable=False, unique=True)
    name = Column(String, nullable=False)
    icon = Column(String, nullable=False, default="🌱")


class ClimateRuleRow(Base):
    __tablename__ = "climate_rules"
    id = Column(Integer, primary_key=True)
    temp_high = Column(Float, default=30.0)
    temp_low = Column(Float, default=28.0)
    hum_high = Column(Float, nullable=True, default=None)
    hum_low = Column(Float, nullable=True, default=None)
    fan_mode = Column(String, default="auto")


class LightStateRow(Base):
    __tablename__ = "light_state"
    id = Column(Integer, primary_key=True)
    state = Column(String, default="off")


class SensorHistoryRow(Base):
    __tablename__ = "sensor_history"
    id = Column(Integer, primary_key=True, index=True)
    source = Column(String, nullable=False)
    metric = Column(String, nullable=False)
    value = Column(Float, nullable=False)
    recorded_at = Column(String, nullable=False)


Base.metadata.create_all(bind=engine)


def _migrate_zone_names():
    db = SessionLocal()
    try:
        try:
            db.execute(text("ALTER TABLE zone_names ADD COLUMN icon VARCHAR DEFAULT '🌱'"))
            db.commit()
        except Exception:
            db.rollback()
        for row in db.query(ZoneNameRow).filter(ZoneNameRow.icon == None).all():
            row.icon = "🌱"
        db.commit()
    finally:
        db.close()


def _migrate_schedule_target_type():
    db = SessionLocal()
    try:
        try:
            db.execute(text("ALTER TABLE schedules ADD COLUMN target_type VARCHAR DEFAULT 'zone'"))
            db.commit()
        except Exception:
            db.rollback()
        for row in db.query(ScheduleRow).filter(ScheduleRow.target_type == None).all():
            row.target_type = "zone"
        db.commit()
    finally:
        db.close()


def _migrate_schedule_nullable_zone_id():
    """SQLite cannot drop NOT NULL via ALTER. Rebuild the schedules table when
    zone_id is still NOT NULL so light schedules (zone_id=NULL) can be inserted.
    Idempotent: only runs if a NOT NULL constraint is detected on zone_id."""
    db = SessionLocal()
    try:
        cols = db.execute(text("PRAGMA table_info(schedules)")).fetchall()
        zone_id_notnull = False
        for cid, name, ctype, notnull, dflt, pk in cols:
            if name == "zone_id" and notnull:
                zone_id_notnull = True
                break
        if not zone_id_notnull:
            return  # already migrated

        db.execute(text(
            "CREATE TABLE schedules_new ("
            "id INTEGER PRIMARY KEY, "
            "zone_id INTEGER NULL, "
            "target_type VARCHAR NOT NULL DEFAULT 'zone', "
            "days VARCHAR NOT NULL, "
            "time VARCHAR NOT NULL, "
            "duration INTEGER NOT NULL, "
            "enabled BOOLEAN DEFAULT 1)"
        ))
        db.execute(text(
            "INSERT INTO schedules_new (id, zone_id, target_type, days, time, duration, enabled) "
            "SELECT id, zone_id, target_type, days, time, duration, enabled FROM schedules"
        ))
        db.execute(text("DROP TABLE schedules"))
        db.execute(text("ALTER TABLE schedules_new RENAME TO schedules"))
        db.commit()
        print("[DB] schedules table rebuilt: zone_id is now nullable")
    except Exception as e:
        db.rollback()
        print(f"[DB] schedules nullable-zone_id migration failed: {e}")
    finally:
        db.close()


def ensure_default_zone_names():
    _migrate_zone_names()
    db = SessionLocal()
    try:
        defaults = {1: ("Zona 1", "🥬"), 2: ("Zona 2", "🌿"), 3: ("Zona 3", "🍓")}
        for zone_id, (name, icon) in defaults.items():
            existing = db.query(ZoneNameRow).filter(ZoneNameRow.zone_id == zone_id).first()
            if not existing:
                db.add(ZoneNameRow(zone_id=zone_id, name=name, icon=icon))
        db.commit()
    finally:
        db.close()


def ensure_default_climate_rules():
    db = SessionLocal()
    try:
        row = db.query(ClimateRuleRow).first()
        if not row:
            db.add(ClimateRuleRow())
            db.commit()
    finally:
        db.close()


def ensure_default_light_state():
    db = SessionLocal()
    try:
        row = db.query(LightStateRow).first()
        if not row:
            db.add(LightStateRow())
            db.commit()
    finally:
        db.close()


def cleanup_old_sensor_history(days=30):
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    db = SessionLocal()
    try:
        cutoff = (datetime.now(ZoneInfo("America/Sao_Paulo")) - timedelta(days=days)).isoformat()
        deleted = db.query(SensorHistoryRow).filter(SensorHistoryRow.recorded_at < cutoff).delete()
        db.commit()
        if deleted:
            print(f"[DB] Limpeza: {deleted} registros sensor_history removidos (> {days} dias)")
    finally:
        db.close()


ensure_default_zone_names()
_migrate_schedule_target_type()
_migrate_schedule_nullable_zone_id()
ensure_default_climate_rules()
ensure_default_light_state()
cleanup_old_sensor_history()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()