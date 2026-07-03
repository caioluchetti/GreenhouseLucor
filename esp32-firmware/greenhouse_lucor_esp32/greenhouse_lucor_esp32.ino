/*
 * Tatufa — ESP32 firmware (autonomous mode)
 *
 * Hardware:
 *   - 8-channel relay module (5 of 8 channels used):
 *       CH1 = Zone 1 irrigation (GPIO 26)
 *       CH2 = Zone 2 irrigation (GPIO 27)
 *       CH3 = Zone 3 irrigation (GPIO 14)
 *       CH4 = Exhaust fan       (GPIO 25)
 *       CH5 = Grow light        (GPIO 33)
 *       CH6-CH8 = spare (not wired)
 *   - DHT22: temperature + humidity inside (GPIO 15)
 *   - DHT11: temperature + humidity outside (GPIO 4)
 *   - LCD 16x2 with I2C backpack (address 0x27, GPIO 21=SDA, GPIO 22=SCL)
 *
 * Autonomous mode:
 *   - NTP time sync on boot + daily resync
 *   - Schedules stored in NVS (Preferences) — survive power loss
 *   - Local scheduler loop: checks schedule day/time → activates relay
 *   - Backend pushes full schedule list via greenhouse/schedules/sync
 *   - On (re)connect, ESP32 requests sync via greenhouse/schedules/request
 *   - Wi-Fi / MQTT / backend DOWN → irrigation continues from NVS
 *   - Wi-Fi / MQTT / backend BACK → re-syncs schedules with backend
 *
 * Climate control (autonomous):
 *   - Thresholds + fan_mode stored in NVS
 *   - Evaluated locally every DHT read — no backend needed
 *
 * Build with: Arduino IDE or PlatformIO (board: esp32dev, framework: arduino)
 *
 * Depends on:
 *   - WiFi           (built-in)
 *   - PubSubClient   (Library Manager — MQTT)
 *   - DHT sensor library by Adafruit
 *   - ArduinoJson    (Library Manager — parsing JSON)
 *   - LiquidCrystal_I2C (Library Manager — LCD 16x2 via PCF8574)
 *   - Preferences    (built-in, for NVS)
 *   - time.h         (built-in, for NTP)
 *
 * Copy to esp32-firmware/greenhouse_lucor_esp32.ino, fill in
 * WIFI_SSID / WIFI_PASS / MQTT_BROKER, and flash.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <LiquidCrystal_I2C.h>
#include <Wire.h>

// ── Configuração ──────────────────────────────────────────
const char* WIFI_SSID     = "Toca do Tatu 2.4G";
const char* WIFI_PASS     = "tamandua123";
const char* MQTT_BROKER   = "greenhousemqtt.cortada-server.ddns.net";
const int   MQTT_PORT     = 8883;
const char* MQTT_CLIENT   = "esp32-greenhouse";

// Fingerprint SHA1 do certificado TLS (gerado em /etc/mosquitto/certs/server.crt)
// Para desabilitar verificação de certificado, deixe string vazia "".  O
// firmware usará setInsecure() nesse caso.  Prefira preencher com o fingerprint
// real quando disponível.
const char* MQTT_TLS_FINGERPRINT = "55:3C:48:09:40:6C:C9:04:59:68:F0:C4:C4:CD:D9:96:23:E6:F7:74";

// ── Pinos ─────────────────────────────────────────────────
// ── Pinos ─────────────────────────────────────────────────
#define DHTPIN       32  // Inside DHT
#define DHTPIN_OUT   33  // Outside DHT
#define DHTTYPE_IN   DHT11
#define DHTTYPE_OUT  DHT11

// Relays
#define RELAY_Z1    26
#define RELAY_Z2    18   // Moved from 27 (freed for LCD_SCL)
#define RELAY_Z3    19   // Moved from 14 (freed for LCD_SDA)
#define RELAY_FAN   25
#define RELAY_LIGHT 15   // Moved from 33 (freed for DHTPIN_OUT)

#define RELAY_ON    LOW
#define RELAY_OFF   HIGH

// ── LCD I2C ───────────────────────────────────────────────
#define LCD_ADDR    0x27
#define LCD_COLS    16
#define LCD_ROWS    2
#define LCD_SDA     14   // Your chosen left-side pin
#define LCD_SCL     27   // Your chosen left-side pin

// ── Scheduler ──────────────────────────────────────────────
#define MAX_SCHEDULES  20
#define SCHED_INTERVAL_MS  10000   // check schedules every 10s

// ── Globals ────────────────────────────────────────────────
DHT dhtIn(DHTPIN, DHTTYPE_IN);
DHT dhtOut(DHTPIN_OUT, DHTTYPE_OUT);
WiFiClientSecure espClient;
PubSubClient mqtt(espClient);
Preferences prefs;

const char* zoneStates[3] = {"OFF", "OFF", "OFF"};
const int   zonePins[3]   = {RELAY_Z1, RELAY_Z2, RELAY_Z3};

// ── Climate ───────────────────────────────────────────────
float   climateThrHigh  = 30.0;
float   climateThrLow   = 28.0;
float   climateHumHigh  = -1.0;
float   climateHumLow   = -1.0;
String  fanMode         = "auto";
bool    fanState        = false;

// ── Light ──────────────────────────────────────────────────
bool    lightState      = false;

// ── Schedules (local NVS) ─────────────────────────────────
struct LocalSchedule {
  int    id;
  int    zone;
  char   days[32];
  char   time[6];
  int    duration;
  bool   enabled;
};
LocalSchedule scheds[MAX_SCHEDULES];
int schedCount = 0;

// ── Active irrigation timers (seconds remaining) ──────────
long   zoneTimer[3]     = {0, 0, 0};
long   zoneTimerTotal[3] = {0, 0, 0};

// ── Timing ─────────────────────────────────────────────────
unsigned long lastSensorPublish  = 0;
unsigned long lastSchedCheck     = 0;
unsigned long lastNtpSync        = 0;
bool          timeSynced         = false;

const unsigned long SENSOR_INTERVAL_MS  = 3000;
const unsigned long NTP_INTERVAL_MS     = 86400000;  // daily

// ── LCD ────────────────────────────────────────────────────
LiquidCrystal_I2C lcd(LCD_ADDR, LCD_COLS, LCD_ROWS);

unsigned long lastLcdPageSwitch = 0;
unsigned long lastLcdRefresh    = 0;
int           lcdPage           = 0;
const int     LCD_PAGE_COUNT    = 3;
const unsigned long LCD_PAGE_MS = 3000;   // switch page every 3s
const unsigned long LCD_REFRESH_MS = 500; // refresh content every 500ms

// Cached sensor values for LCD (updated by sensor read)
float lcdTempIn  = NAN;
float lcdHumIn   = NAN;
float lcdTempOut = NAN;
float lcdHumOut  = NAN;

// ── LCD display ───────────────────────────────────────────
void lcdShowBoot() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Tatufa  boot...");
  lcd.setCursor(0, 1);
  lcd.print("Connecting WiFi");
}

void lcdPrintFloat(float v, int dec) {
  if (isnan(v)) {
    lcd.print("--");
  } else {
    char buf[8];
    dtostrf(v, 4, dec, buf);
    lcd.print(buf);
  }
}

void lcdRenderPage() {
  char line[17];

  switch (lcdPage) {
    case 0:  // Sensors inside + outside
      lcd.clear();
      lcd.setCursor(0, 0);
      snprintf(line, sizeof(line), "In: ");
      lcd.print(line);
      lcdPrintFloat(lcdTempIn, 1);
      lcd.print("C ");
      lcdPrintFloat(lcdHumIn, 0);
      lcd.print("%");
      lcd.setCursor(0, 1);
      lcd.print("Out:");
      lcdPrintFloat(lcdTempOut, 1);
      lcd.print("C ");
      lcdPrintFloat(lcdHumOut, 0);
      lcd.print("%");
      break;

    case 1:  // Zone + fan status
      lcd.clear();
      lcd.setCursor(0, 0);
      snprintf(line, sizeof(line), "Z1:%s Z2:%s",
               zoneStates[0], zoneStates[1]);
      lcd.print(line);
      lcd.setCursor(0, 1);
      snprintf(line, sizeof(line), "Z3:%s Fan:%s",
               zoneStates[2], fanState ? "ON" : "OFF");
      lcd.print(line);
      break;

    case 2: {  // Light + connectivity status
      lcd.clear();
      lcd.setCursor(0, 0);
      snprintf(line, sizeof(line), "Light:%s",
               lightState ? "ON" : "OFF");
      lcd.print(line);
      lcd.setCursor(0, 1);
      bool wifiOk = (WiFi.status() == WL_CONNECTED);
      bool mqttOk = mqtt.connected();
      snprintf(line, sizeof(line), "W%c M%c N%c",
               wifiOk ? '+' : '-',
               mqttOk ? '+' : '-',
               timeSynced ? '+' : '-');
      lcd.print(line);
      break;
    }
  }
}

void updateLcd(unsigned long now) {
  if (now - lastLcdPageSwitch > LCD_PAGE_MS) {
    lastLcdPageSwitch = now;
    lcdPage = (lcdPage + 1) % LCD_PAGE_COUNT;
    lcdRenderPage();
  } else if (now - lastLcdRefresh > LCD_REFRESH_MS) {
    lastLcdRefresh = now;
    lcdRenderPage();  // refresh in-place so live values update
  }
}

// ── NTP ────────────────────────────────────────────────────
void syncTime() {
  configTime(-3 * 3600, 0, "pool.ntp.org", "time.nist.gov", "a.st1.ntp.br");
  struct tm ti;
  int retries = 20;
  while (!getLocalTime(&ti) && retries-- > 0) {
    delay(500);
  }
  timeSynced = (retries >= 0);
  lastNtpSync = millis();
  if (timeSynced) {
    Serial.printf("[NTP] Synced: %04d-%02d-%02d %02d:%02d:%02d\n",
      ti.tm_year+1900, ti.tm_mon+1, ti.tm_mday, ti.tm_hour, ti.tm_min, ti.tm_sec);
  } else {
    Serial.println("[NTP] Sync failed — schedules won't fire");
  }
}

// ── NVS: Climate ──────────────────────────────────────────
void loadClimatePrefs() {
  prefs.begin("climate", true);
  climateThrHigh  = prefs.getFloat("thr_high", 30.0);
  climateThrLow   = prefs.getFloat("thr_low",  28.0);
  climateHumHigh  = prefs.getFloat("hum_high", -1.0);
  climateHumLow   = prefs.getFloat("hum_low",  -1.0);
  fanMode         = prefs.getString("fan_mode", "auto");
  fanState        = prefs.getBool("fan_state", false);
  prefs.end();
}

void saveClimatePrefs() {
  prefs.begin("climate", false);
  prefs.putFloat("thr_high", climateThrHigh);
  prefs.putFloat("thr_low",  climateThrLow);
  prefs.putFloat("hum_high", climateHumHigh);
  prefs.putFloat("hum_low",  climateHumLow);
  prefs.putString("fan_mode", fanMode);
  prefs.putBool("fan_state", fanState);
  prefs.end();
}

// ── NVS: Schedules ────────────────────────────────────────
void loadSchedules() {
  prefs.begin("schedules", true);
  schedCount = prefs.getInt("count", 0);
  if (schedCount > MAX_SCHEDULES) schedCount = MAX_SCHEDULES;
  for (int i = 0; i < schedCount; i++) {
    char key[16];
    snprintf(key, sizeof(key), "s%d_id", i);
    scheds[i].id = prefs.getInt(key, 0);
    snprintf(key, sizeof(key), "s%d_zone", i);
    scheds[i].zone = prefs.getInt(key, 0);
    snprintf(key, sizeof(key), "s%d_days", i);
    prefs.getString(key, scheds[i].days, sizeof(scheds[i].days));
    snprintf(key, sizeof(key), "s%d_time", i);
    prefs.getString(key, scheds[i].time, sizeof(scheds[i].time));
    snprintf(key, sizeof(key), "s%d_dur", i);
    scheds[i].duration = prefs.getInt(key, 0);
    snprintf(key, sizeof(key), "s%d_en", i);
    scheds[i].enabled = prefs.getBool(key, true);
  }
  prefs.end();
  Serial.printf("[Schedules] Loaded %d from NVS\n", schedCount);
}

void saveSchedules() {
  prefs.begin("schedules", false);
  prefs.clear();
  prefs.putInt("count", schedCount);
  for (int i = 0; i < schedCount; i++) {
    char key[16];
    snprintf(key, sizeof(key), "s%d_id", i);
    prefs.putInt(key, scheds[i].id);
    snprintf(key, sizeof(key), "s%d_zone", i);
    prefs.putInt(key, scheds[i].zone);
    snprintf(key, sizeof(key), "s%d_days", i);
    prefs.putString(key, scheds[i].days);
    snprintf(key, sizeof(key), "s%d_time", i);
    prefs.putString(key, scheds[i].time);
    snprintf(key, sizeof(key), "s%d_dur", i);
    prefs.putInt(key, scheds[i].duration);
    snprintf(key, sizeof(key), "s%d_en", i);
    prefs.putBool(key, scheds[i].enabled);
  }
  prefs.end();
}

// ── Relays ─────────────────────────────────────────────────
void applyFan() {
  digitalWrite(RELAY_FAN, fanState ? RELAY_ON : RELAY_OFF);
}
void applyLight() {
  digitalWrite(RELAY_LIGHT, lightState ? RELAY_ON : RELAY_OFF);
}
void setRelay(int zone, bool on) {
  digitalWrite(zonePins[zone], on ? RELAY_ON : RELAY_OFF);
  zoneStates[zone] = on ? "ON" : "OFF";
  char topic[64];
  snprintf(topic, sizeof(topic), "greenhouse/zone%d/state", zone + 1);
  mqtt.publish(topic, on ? "ON" : "OFF");
  if (lcdPage == 1) lcdRenderPage();  // refresh zone status on LCD
}

// ── Climate ────────────────────────────────────────────────
void evaluateClimate(float temp, float hum) {
  if (fanMode == "on")       fanState = true;
  else if (fanMode == "off") fanState = false;
  else if (!isnan(temp)) {
    if (temp > climateThrHigh) fanState = true;
    else if (temp < climateThrLow) fanState = false;
  }
  applyFan();
  saveClimatePrefs();
}

// ── Local Scheduler ────────────────────────────────────────
void checkLocalSchedules() {
  if (!timeSynced) return;

  struct tm ti;
  if (!getLocalTime(&ti)) return;

  char today[4];
  const char* DAYS_SHORT[] = {"dom","seg","ter","qua","qui","sex","sab"};
  strcpy(today, DAYS_SHORT[ti.tm_wday]);

  char nowStr[6];
  snprintf(nowStr, sizeof(nowStr), "%02d:%02d", ti.tm_hour, ti.tm_min);

  for (int i = 0; i < schedCount; i++) {
    LocalSchedule* s = &scheds[i];
    if (!s->enabled) continue;
    if (s->zone < 1 || s->zone > 3) continue;
    if (strstr(s->days, today) == NULL) continue;
    if (strcmp(s->time, nowStr) != 0) continue;

    int zIdx = s->zone - 1;
    if (zoneTimer[zIdx] > 0) continue;

    setRelay(zIdx, true);
    zoneTimer[zIdx] = s->duration * 60;
    zoneTimerTotal[zIdx] = zoneTimer[zIdx];

    char buf[64];
    snprintf(buf, sizeof(buf), "{\"zone\":%d,\"duration\":%d}", s->zone, s->duration);
    mqtt.publish("greenhouse/irrigation/started", buf);
    Serial.printf("[Scheduler] Zone %d ON — %dmin (local)\n", s->zone, s->duration);
  }
}

void tickIrrigationTimers(unsigned long deltaMs) {
  long deltaSec = deltaMs / 1000;
  for (int i = 0; i < 3; i++) {
    if (zoneTimer[i] <= 0) continue;
    zoneTimer[i] -= deltaSec;
    if (zoneTimer[i] <= 0) {
      zoneTimer[i] = 0;
      zoneTimerTotal[i] = 0;
      setRelay(i, false);
      char buf[32];
      snprintf(buf, sizeof(buf), "%d", i + 1);
      mqtt.publish("greenhouse/irrigation/stopped", buf);
      Serial.printf("[Scheduler] Zone %d OFF — finished (local)\n", i + 1);
    } else {
      char topic[64], buf[16];
      snprintf(topic, sizeof(topic), "greenhouse/zone%d/remaining", i + 1);
      snprintf(buf, sizeof(buf), "%ld", zoneTimer[i]);
      mqtt.publish(topic, buf);
    }
  }
}

// ── Wi-Fi ──────────────────────────────────────────────────
void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println(" OK");
  Serial.print("IP: "); Serial.println(WiFi.localIP());

  // TLS para MQTT remoto via greenhousemqtt.cortada-server.ddns.net:8883

    espClient.setInsecure();
    Serial.println("[TLS] WARNING: Certificate verification disabled (insecure)");
  
}

// ── MQTT Publish ───────────────────────────────────────────
void publishClimateStatus(float temp, float hum) {
  StaticJsonDocument<256> doc;
  doc["fan"]    = fanState ? "on" : "off";
  doc["mode"]   = fanMode;
  doc["reason"] = "";
  doc["temp"]   = isnan(temp) ? String("--") : String(temp, 1);
  doc["hum"]    = isnan(hum)  ? String("--") : String(hum, 1);
  char buf[256];
  serializeJson(doc, buf, sizeof(buf));
  mqtt.publish("greenhouse/climate/status", buf);
}

void publishLightStatus() {
  mqtt.publish("greenhouse/light/status", lightState ? "ON" : "OFF");
}

// ── MQTT Callback ──────────────────────────────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String t(topic);
  String p;
  for (unsigned int i = 0; i < length; i++) p += (char)payload[i];

  // ── Irrigation commands (from backend scheduler / manual) ──
  if (t == "greenhouse/zone1/command" || t == "greenhouse/zone2/command" || t == "greenhouse/zone3/command") {
    int zone = (t == "greenhouse/zone1/command") ? 0 :
               (t == "greenhouse/zone2/command") ? 1 : 2;
    if (p == "ON") {
      setRelay(zone, true);
      zoneTimer[zone] = 3600;
      zoneTimerTotal[zone] = 3600;
    } else {
      setRelay(zone, false);
      zoneTimer[zone] = 0;
      zoneTimerTotal[zone] = 0;
    }
    return;
  }

  // ── Light command ──
  if (t == "greenhouse/light/cmd") {
    lightState = (p == "ON");
    applyLight();
    publishLightStatus();
    return;
  }

  // ── Climate fan mode ──
  if (t == "greenhouse/climate/fan/cmd") {
    StaticJsonDocument<128> doc;
    if (deserializeJson(doc, p) == DeserializationError::Ok) {
      const char* mode = doc["mode"] | "";
      if (strcmp(mode, "auto") == 0 || strcmp(mode, "on") == 0 || strcmp(mode, "off") == 0) {
        fanMode = String(mode);
        float temp = dhtIn.readTemperature();
        float hum  = dhtIn.readHumidity();
        evaluateClimate(temp, hum);
        publishClimateStatus(temp, hum);
      }
    }
    return;
  }

  // ── Climate thresholds ──
  if (t == "greenhouse/climate/thresholds") {
    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, p) == DeserializationError::Ok) {
      if (doc.containsKey("temp_high")) climateThrHigh = doc["temp_high"].as<float>();
      if (doc.containsKey("temp_low"))  climateThrLow  = doc["temp_low"].as<float>();
      if (doc.containsKey("hum_high"))  climateHumHigh = doc["hum_high"].as<float>();
      if (doc.containsKey("hum_low"))   climateHumLow  = doc["hum_low"].as<float>();
      saveClimatePrefs();
      float temp = dhtIn.readTemperature();
      float hum  = dhtIn.readHumidity();
      evaluateClimate(temp, hum);
      publishClimateStatus(temp, hum);
    }
    return;
  }

  // ── Schedule sync from backend ──
  if (t == "greenhouse/schedules/sync") {
    StaticJsonDocument<4096> doc;
    if (deserializeJson(doc, p) == DeserializationError::Ok) {
      JsonArray arr = doc.as<JsonArray>();
      schedCount = arr.size();
      if (schedCount > MAX_SCHEDULES) schedCount = MAX_SCHEDULES;
      int idx = 0;
      for (JsonObject s : arr) {
        scheds[idx].id       = s["id"]       | 0;
        scheds[idx].zone     = s["zone_id"]  | 1;
        strncpy(scheds[idx].days, s["days"] | "seg", sizeof(scheds[idx].days) - 1);
        strncpy(scheds[idx].time, s["time"] | "08:00", sizeof(scheds[idx].time) - 1);
        scheds[idx].duration = s["duration"] | 5;
        scheds[idx].enabled  = s["enabled"]  | true;
        idx++;
      }
      saveSchedules();
      Serial.printf("[Schedules] Synced %d from backend\n", schedCount);
    }
    return;
  }
}

void reconnectMQTT() {
  while (!mqtt.connected()) {
    Serial.print("MQTT connect...");
    if (mqtt.connect(MQTT_CLIENT)) {
      Serial.println(" OK");
      mqtt.subscribe("greenhouse/zone1/command");
      mqtt.subscribe("greenhouse/zone2/command");
      mqtt.subscribe("greenhouse/zone3/command");
      mqtt.subscribe("greenhouse/light/cmd");
      mqtt.subscribe("greenhouse/climate/fan/cmd");
      mqtt.subscribe("greenhouse/climate/thresholds");
      mqtt.subscribe("greenhouse/schedules/sync");
      mqtt.publish("greenhouse/climate/request", "{}");
      mqtt.publish("greenhouse/schedules/request", "{}");
      Serial.println("[MQTT] Reconnected — requested sync");
    } else {
      Serial.print("failed rc=");
      Serial.print(mqtt.state());
      Serial.println(" retry in 2s");
      delay(2000);
    }
  }
}

// ── Setup / Loop ───────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(50);

  // LCD
  Wire.begin(LCD_SDA, LCD_SCL);
  lcd.init();
  lcd.backlight();
  lcdShowBoot();

  for (int i = 0; i < 3; i++) {
    pinMode(zonePins[i], OUTPUT);
    digitalWrite(zonePins[i], RELAY_OFF);
  }
  pinMode(RELAY_FAN, OUTPUT);
  pinMode(RELAY_LIGHT, OUTPUT);

  dhtIn.begin();
  dhtOut.begin();

  loadClimatePrefs();
  loadSchedules();
  applyFan();
  applyLight();

  connectWiFi();
  syncTime();

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(4096);
}

void loop() {
  unsigned long now = millis();

  // ── MQTT keep-alive ──
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }
  if (!mqtt.connected()) {
    reconnectMQTT();
  }
  mqtt.loop();

  // ── NTP daily resync ──
  if (timeSynced && now - lastNtpSync > NTP_INTERVAL_MS) {
    syncTime();
  }

  // ── Local scheduler (runs even if MQTT/WiFi down) ──
  if (now - lastSchedCheck > SCHED_INTERVAL_MS) {
    unsigned long delta = now - lastSchedCheck;
    lastSchedCheck = now;
    checkLocalSchedules();
    tickIrrigationTimers(delta);
  }

  // ── LCD update (non-blocking) ──
  updateLcd(now);

  // ── Sensor publish (only when MQTT connected) ──
  if (mqtt.connected() && now - lastSensorPublish > SENSOR_INTERVAL_MS) {
    lastSensorPublish = now;
    float tempIn  = dhtIn.readTemperature();
    float humIn   = dhtIn.readHumidity();
    float tempOut = dhtOut.readTemperature();
    float humOut  = dhtOut.readHumidity();
    Serial.printf("DHT Published %.1f In  %.1f hum In %.1f Out  %.1f hum out\n", tempIn, humIn, tempOut, humOut);
    // Cache for LCD display
    lcdTempIn  = tempIn;
    lcdHumIn   = humIn;
    lcdTempOut = tempOut;
    lcdHumOut  = humOut;

    char buf[16];
    if (!isnan(tempIn))  { dtostrf(tempIn, 4, 1, buf); mqtt.publish("greenhouse/sensor/inside/temperature", buf); }
    if (!isnan(humIn))   { dtostrf(humIn,  4, 1, buf); mqtt.publish("greenhouse/sensor/inside/humidity",    buf); }
    if (!isnan(tempOut)) { dtostrf(tempOut, 4, 1, buf); mqtt.publish("greenhouse/sensor/outside/temperature", buf); }
    if (!isnan(humOut))  { dtostrf(humOut,  4, 1, buf); mqtt.publish("greenhouse/sensor/outside/humidity",    buf); }

    evaluateClimate(tempIn, humIn);
    publishClimateStatus(tempIn, humIn);

    for (int i = 0; i < 3; i++) {
      char topic[64];
      snprintf(topic, sizeof(topic), "greenhouse/zone%d/state", i + 1);
      mqtt.publish(topic, zoneStates[i]);
    }
    publishLightStatus();
    mqtt.publish("greenhouse/status", "online");
  }
}
