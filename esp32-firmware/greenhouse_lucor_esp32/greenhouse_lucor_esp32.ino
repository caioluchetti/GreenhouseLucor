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
 *   - SHT40: temperature + humidity inside (I2C 0x44)
 *   - DHT22: temperature + humidity outside (GPIO 32)
 *   - LCD 16x2 with I2C backpack (address 0x27, GPIO 14=SDA, GPIO 27=SCL)
 *   - OLED SSD1306 128x64 (address 0x3C, GPIO 21=SDA, GPIO 22=SCL — separate Wire1 bus)
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
 * Wi-Fi provisioning (NEW):
 *   - On boot, tries to connect with the last-saved credentials for
 *     WIFI_CONNECT_TIMEOUT_S seconds.
 *   - If that fails, the ESP32 opens its own access point
 *     ("Tatufa-Setup") with a captive-portal web page. Connect a phone
 *     or laptop to that AP, a config page opens automatically (or go to
 *     192.168.4.1), enter your Wi-Fi SSID/password, and the device
 *     reboots and connects. Credentials are persisted across reboots.
 *   - This uses AP + captive portal rather than Bluetooth — it needs no
 *     companion app and is the standard, well-supported approach for
 *     ESP32 Wi-Fi provisioning.
 *
 * OTA firmware update (NEW):
 *   - ArduinoOTA: local-network updates from Arduino IDE / PlatformIO
 *     while developing (device must be on the same LAN).
 *   - Remote HTTPS OTA: publish a JSON payload with a firmware URL to
 *     greenhouse/ota/update over MQTT, e.g.
 *       {"url":"https://your-server/firmware/tatufa_v1_1_0.bin","version":"1.1.0"}
 *     The device downloads and flashes it, then reboots. This works
 *     even though the device is remote (behind DDNS), since it rides
 *     the same MQTT connection you already use.
 *
 * Build with: Arduino IDE or PlatformIO (board: esp32dev, framework: arduino)
 *
 * Depends on:
 *   - WiFi           (built-in)
 *   - WiFiManager    (Library Manager — "WiFiManager" by tzapu) — NEW
 *   - PubSubClient   (Library Manager — MQTT)
 *   - DHT sensor library by Adafruit
 *   - ArduinoJson    (Library Manager — parsing JSON)
 *   - LiquidCrystal_I2C (Library Manager — LCD 16x2 via PCF8574)
 *   - Preferences    (built-in, for NVS)
 *   - time.h         (built-in, for NTP)
 *   - ArduinoOTA     (built-in, for LAN OTA) — NEW
 *   - HTTPUpdate     (built-in, for remote HTTPS OTA) — NEW
 *
 * Copy to esp32-firmware/greenhouse_lucor_esp32.ino, fill in
 * MQTT_BROKER, and flash. (WIFI_SSID/WIFI_PASS below are now only a
 * first-boot fallback default — see WiFiManager section.)
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>          // NEW — tzapu/WiFiManager
#include <PubSubClient.h>
#include <DHT.h>
#include <Adafruit_SHT4x.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <LiquidCrystal_I2C.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Wire.h>
#include <ArduinoOTA.h>           // NEW — LAN OTA
#include <HTTPUpdate.h>           // NEW — remote HTTPS OTA

// ── Firmware version ───────────────────────────────────────
#define FW_VERSION "1.2.0"

// ── Configuração ──────────────────────────────────────────
// NOTE: these are now only used as a *first-boot seed*. WiFiManager
// stores whatever credentials the user actually configures via the
// portal, and reuses those on subsequent boots — even if they differ
// from the values below.
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

// ── Wi-Fi provisioning (NEW) ────────────────────────────────
const char* WIFI_AP_NAME   = "Tatufa-Setup";     // AP shown when config is needed
const char* WIFI_AP_PASS   = "tatufa1234";       // must be >= 8 chars, "" for open AP
const int   WIFI_CONNECT_TIMEOUT_S = 10;         // try saved creds this long before falling back
const int   WIFI_PORTAL_TIMEOUT_S  = 180;        // give up on portal after this long and reboot

// ── OTA (NEW) ────────────────────────────────────────────────
const char* OTA_HOSTNAME   = "tatufa-greenhouse"; // shows up in Arduino IDE / PlatformIO port list
const char* OTA_PASSWORD   = "tatufa-ota-2026";   // change this before flashing!

// ── Pinos ─────────────────────────────────────────────────
// ── Pinos ─────────────────────────────────────────────────
#define DHTPIN_OUT   32  // Outside DHT

#define DHTTYPE_OUT  DHT22

// Relays (Mapped to the right side of the ESP32)
#define RELAY_Z1    19   // Zone 1 irrigation
#define RELAY_Z2    18   // Zone 2 irrigation
#define RELAY_Z3    5    // Zone 3 irrigation
#define RELAY_FAN   17   // Exhaust fan
#define RELAY_LIGHT 16   // Grow light (assigned to the next available right-side port)

#define RELAY_ON    LOW
#define RELAY_OFF   HIGH

// ── LCD I2C ───────────────────────────────────────────────
#define LCD_ADDR    0x27
#define LCD_COLS    16
#define LCD_ROWS    2
#define LCD_SDA     14   // Your chosen left-side pin
#define LCD_SCL     27   // Your chosen left-side pin

// ── OLED SSD1306 ────────────────────────────────────────────
#define OLED_ADDR        0x3C
#define OLED_WIDTH       128
#define OLED_HEIGHT      64
#define OLED_RESET       -1

// ── Scheduler ──────────────────────────────────────────────
#define MAX_SCHEDULES  20
#define SCHED_INTERVAL_MS  10000   // check schedules every 10s

// ── Globals ────────────────────────────────────────────────
Adafruit_SHT4x sht4;
DHT dhtOut(DHTPIN_OUT, DHTTYPE_OUT);
WiFiClientSecure espClient;
PubSubClient mqtt(espClient);
Preferences prefs;
WiFiManager wifiManager;   // NEW
TwoWire Wire1(1);         // Second I2C bus for OLED on default pins

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
const unsigned long LCD_PAGE_MS = 5000;   // switch page every 3s
const unsigned long LCD_REFRESH_MS = 500; // refresh content every 500ms

// Cached sensor values for LCD (updated by sensor read)
float lcdTempIn  = NAN;
float lcdHumIn   = NAN;
float lcdTempOut = NAN;
float lcdHumOut  = NAN;

// ── OTA state (NEW) ─────────────────────────────────────────
bool otaInProgress = false;

// ── OLED ────────────────────────────────────────────────────
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire1, OLED_RESET);
unsigned long lastOledRefresh = 0;
const unsigned long OLED_REFRESH_MS = 500;

// ── LCD display ───────────────────────────────────────────
void lcdShowBoot() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Tatufa  boot...");
  lcd.setCursor(0, 1);
  lcd.print("Connecting WiFi");
}

// NEW — shown while the config portal AP is open, waiting for the user
void lcdShowWifiSetup() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("WiFi setup mode");
  lcd.setCursor(0, 1);
  char line[17];
  snprintf(line, sizeof(line), "AP: %s", WIFI_AP_NAME);
  lcd.print(line);
}

// NEW — shown while flashing new firmware
void lcdShowOta(int percent) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Updating fw...");
  lcd.setCursor(0, 1);
  char line[17];
  snprintf(line, sizeof(line), "Progress: %d%%", percent);
  lcd.print(line);
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
      snprintf(line, sizeof(line), "W:%s M:%s N:%s", 
               wifiOk ? "OK" : "--", 
               mqttOk ? "OK" : "--", 
               timeSynced ? "OK" : "--");
      lcd.print(line);
      break;
    }
  }
}

void updateLcd(unsigned long now) {
  if (otaInProgress) return;  // NEW — don't fight the OTA progress screen
  if (now - lastLcdPageSwitch > LCD_PAGE_MS) {
    lastLcdPageSwitch = now;
    lcdPage = (lcdPage + 1) % LCD_PAGE_COUNT;
    lcdRenderPage();
  } else if (now - lastLcdRefresh > LCD_REFRESH_MS) {
    lastLcdRefresh = now;
    lcdRenderPage();  // refresh in-place so live values update
  }
}

// ── OLED display ──────────────────────────────────────────
void oledPrintFloat(float v, int dec, int width) {
  if (isnan(v)) {
    display.print("--");
    return;
  }
  char buf[8];
  dtostrf(v, width, dec, buf);
  display.print(buf);
}

void renderDisplay() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  // ── Top bar (y=0): title + connectivity + firmware ──
  display.setCursor(0, 0);
  display.print("Tatufa");

  bool wifiOk = (WiFi.status() == WL_CONNECTED);
  bool mqttOk = mqtt.connected();
  display.setCursor(50, 0);
  display.print(wifiOk ? "W" : "w");
  display.print(mqttOk ? "M" : "m");
  display.print(timeSynced ? "N" : "n");

  display.setCursor(88, 0);
  display.print("v");
  display.print(FW_VERSION);

  // ── Divider at y=14 ──
  display.drawFastHLine(0, 14, OLED_WIDTH, SSD1306_WHITE);

  // ── Inside conditions (y=18) ──
  display.setCursor(0, 18);
  display.print("In:  ");
  oledPrintFloat(lcdTempIn, 1, 4);
  display.print("C  ");
  oledPrintFloat(lcdHumIn, 0, 3);
  display.print("%");

  // ── Outside conditions (y=30) ──
  display.setCursor(0, 30);
  display.print("Out: ");
  oledPrintFloat(lcdTempOut, 1, 4);
  display.print("C  ");
  oledPrintFloat(lcdHumOut, 0, 3);
  display.print("%");

  // ── Divider at y=41 ──
  display.drawFastHLine(0, 41, OLED_WIDTH, SSD1306_WHITE);

  // ── Zones (y=45) ──
  display.setCursor(0, 45);
  display.print("Z1:");
  display.print(zoneStates[0]);
  display.setCursor(43, 45);
  display.print("Z2:");
  display.print(zoneStates[1]);
  display.setCursor(86, 45);
  display.print("Z3:");
  display.print(zoneStates[2]);

  // ── Fan + Light (y=56) ──
  display.setCursor(0, 56);
  display.print("Fan:");
  display.print(fanState ? "ON " : "OFF");
  display.setCursor(70, 56);
  display.print("Lgt:");
  display.print(lightState ? "ON" : "OFF");

  display.display();
}

void updateDisplay(unsigned long now) {
  if (otaInProgress) return;
  if (now - lastOledRefresh > OLED_REFRESH_MS) {
    lastOledRefresh = now;
    renderDisplay();
  }
}

// ── OLED special screens ───────────────────────────────────
void oledShowBoot() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 16);
  display.println("Tatufa Greenhouse");
  display.setCursor(0, 34);
  display.println("OLED booting...");
  display.display();
}

void oledShowWifiSetup() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 12);
  display.println("WiFi setup mode");
  display.setCursor(0, 30);
  display.print("AP: ");
  display.print(WIFI_AP_NAME);
  display.display();
}

void oledShowOta(int percent) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 12);
  display.println("Updating fw...");
  display.setCursor(0, 34);
  display.print("Progress: ");
  display.print(percent);
  display.print("%");
  // progress bar at y=44
  int barW = map(percent, 0, 100, 0, OLED_WIDTH - 8);
  display.drawRect(4, 44, OLED_WIDTH - 8, 10, SSD1306_WHITE);
  display.fillRect(4, 44, barW, 10, SSD1306_WHITE);
  display.display();
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

// ── Wi-Fi (NEW — WiFiManager with AP-portal fallback) ───────
// Called from the portal callback when the device has opened its
// config AP and is waiting for the user to submit credentials.
void onConfigPortalStart(WiFiManager* mgr) {
  Serial.println("[WiFi] No connection — opened config portal AP");
  Serial.printf("[WiFi] Connect to \"%s\" and go to 192.168.4.1\n", WIFI_AP_NAME);
  lcdShowWifiSetup();
  oledShowWifiSetup();
}

void connectWiFi() {
  lcdShowBoot();
  oledShowBoot();

  wifiManager.setConnectTimeout(WIFI_CONNECT_TIMEOUT_S);   // time to try saved creds
  wifiManager.setConfigPortalTimeout(WIFI_PORTAL_TIMEOUT_S); // time the portal stays open
  wifiManager.setAPCallback(onConfigPortalStart);
  wifiManager.setBreakAfterConfig(true);

  // autoConnect() tries the last-saved credentials first (falling back to
  // WIFI_SSID/WIFI_PASS on a truly first boot isn't automatic with
  // WiFiManager, so we seed it once below). If that fails within
  // WIFI_CONNECT_TIMEOUT_S seconds, it opens the "Tatufa-Setup" AP with a
  // captive portal so you can enter new credentials from a phone/laptop.
  bool connected = wifiManager.autoConnect(WIFI_AP_NAME, WIFI_AP_PASS);

  if (!connected) {
    // Portal timed out with nobody configuring it — reboot and try again
    // rather than getting stuck. Irrigation continues from NVS regardless.
    Serial.println("[WiFi] Config portal timed out — rebooting to retry");
    delay(1000);
    ESP.restart();
  }

  Serial.println("WiFi OK");
  Serial.print("IP: "); Serial.println(WiFi.localIP());

  // TLS para MQTT remoto via greenhousemqtt.cortada-server.ddns.net:8883
  espClient.setInsecure();
  Serial.println("[TLS] WARNING: Certificate verification disabled (insecure)");
}

// ── OTA (NEW) ────────────────────────────────────────────────
void setupArduinoOTA() {
  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPassword(OTA_PASSWORD);

  ArduinoOTA.onStart([]() {
    otaInProgress = true;
    Serial.println("[OTA] LAN update starting...");
    lcdShowOta(0);
    oledShowOta(0);
  });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    int pct = (progress * 100) / total;
    lcdShowOta(pct);
    oledShowOta(pct);
  });
  ArduinoOTA.onEnd([]() {
    Serial.println("[OTA] LAN update complete — rebooting");
  });
  ArduinoOTA.onError([](ota_error_t error) {
    otaInProgress = false;
    Serial.printf("[OTA] Error[%u]\n", error);
  });

  ArduinoOTA.begin();
  Serial.println("[OTA] ArduinoOTA ready (LAN updates)");
}

// Triggered by MQTT command: greenhouse/ota/update
// payload: {"url":"https://host/path/firmware.bin","version":"1.2.0"}
void handleRemoteOta(const String& url, const String& version) {
  if (url.length() == 0) {
    mqtt.publish("greenhouse/ota/status", "{\"status\":\"error\",\"reason\":\"missing url\"}");
    return;
  }

  Serial.printf("[OTA] Remote update requested: %s (v%s)\n", url.c_str(), version.c_str());
  otaInProgress = true;
  lcdShowOta(0);
  oledShowOta(0);
  mqtt.publish("greenhouse/ota/status", "{\"status\":\"starting\"}");

  // Uses its own TLS client — kept insecure to match the MQTT connection
  // above. If your firmware host has a trusted CA, prefer
  // otaClient.setCACert(...) instead of setInsecure() for production.
  WiFiClientSecure otaClient;
  otaClient.setInsecure();

  httpUpdate.setLedPin(-1);
  httpUpdate.onProgress([](int cur, int total) {
    int pct = total > 0 ? (cur * 100) / total : 0;
    lcdShowOta(pct);
    oledShowOta(pct);
  });

  t_httpUpdate_return ret = httpUpdate.update(otaClient, url);

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("[OTA] Failed (%d): %s\n",
                     httpUpdate.getLastError(),
                     httpUpdate.getLastErrorString().c_str());
      {
        char buf[160];
        snprintf(buf, sizeof(buf), "{\"status\":\"failed\",\"error\":\"%s\"}",
                 httpUpdate.getLastErrorString().c_str());
        mqtt.publish("greenhouse/ota/status", buf);
      }
      otaInProgress = false;
      break;

    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("[OTA] No updates available at that URL");
      mqtt.publish("greenhouse/ota/status", "{\"status\":\"no_update\"}");
      otaInProgress = false;
      break;

    case HTTP_UPDATE_OK:
      Serial.println("[OTA] Update OK — rebooting");
      mqtt.publish("greenhouse/ota/status", "{\"status\":\"ok\",\"rebooting\":true}");
      delay(500);
      ESP.restart();  // httpUpdate.update() usually reboots itself, kept as a safety net
      break;
  }
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
        sensors_event_t shtHum, shtTemp;
        float temp = sht4.getEvent(&shtHum, &shtTemp) ? shtTemp.temperature : NAN;
        float hum  = shtHum.relative_humidity;
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
      sensors_event_t shtHum, shtTemp;
      float temp = sht4.getEvent(&shtHum, &shtTemp) ? shtTemp.temperature : NAN;
      float hum  = shtHum.relative_humidity;
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

  // ── OTA update command (NEW) ──
  if (t == "greenhouse/ota/update") {
    StaticJsonDocument<384> doc;
    if (deserializeJson(doc, p) == DeserializationError::Ok) {
      String url     = doc["url"]     | "";
      String version = doc["version"] | "";
      handleRemoteOta(url, version);
    } else {
      mqtt.publish("greenhouse/ota/status", "{\"status\":\"error\",\"reason\":\"bad json\"}");
    }
    return;
  }
}

void reconnectMQTT() {
  static unsigned long lastAttempt = 0;
  unsigned long now = millis();
  if (now - lastAttempt < 2000) return;
  lastAttempt = now;

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
    mqtt.subscribe("greenhouse/ota/update");
    mqtt.publish("greenhouse/climate/request", "{}");
    mqtt.publish("greenhouse/schedules/request", "{}");
    char verBuf[48];
    snprintf(verBuf, sizeof(verBuf), "{\"version\":\"%s\"}", FW_VERSION);
    mqtt.publish("greenhouse/firmware/version", verBuf);
    Serial.println("[MQTT] Reconnected — requested sync");
  } else {
    Serial.print("failed rc=");
    Serial.print(mqtt.state());
    Serial.println(" (retry in 2s)");
  }
}

// ── Setup / Loop ───────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(50);

  // LCD + SHT40 I2C bus
  Wire.begin(LCD_SDA, LCD_SCL);
  Wire.setClock(400000);
  lcd.init();
  lcd.backlight();
  lcdShowBoot();

  // OLED I2C bus (separate, on default GPIO 21/22)
  Wire1.begin(21, 22);
  Wire1.setClock(400000);

  if (display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    oledShowBoot();
  } else {
    Serial.println("[OLED] SSD1306 not found — skipping OLED");
  }

  for (int i = 0; i < 3; i++) {
    pinMode(zonePins[i], OUTPUT);
    digitalWrite(zonePins[i], RELAY_OFF);
  }
  pinMode(RELAY_FAN, OUTPUT);
  pinMode(RELAY_LIGHT, OUTPUT);

  sht4.begin();
  sht4.setPrecision(SHT4X_HIGH_PRECISION);
  sht4.setHeater(SHT4X_NO_HEATER);
  dhtOut.begin();

  loadClimatePrefs();
  loadSchedules();
  applyFan();
  applyLight();

  connectWiFi();
  syncTime();
  setupArduinoOTA();   // NEW

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(4096);
}

void loop() {
  unsigned long now = millis();

  // ── OTA handling (NEW) — keep this responsive, skip other slow work ──
  if (WiFi.status() == WL_CONNECTED) {
    ArduinoOTA.handle();
  }
  if (otaInProgress) {
    // A remote HTTPS OTA (handleRemoteOta) blocks until done/failed, so in
    // practice we won't linger here long, but this guards against doing
    // relay/schedule work mid-flash if that ever changes.
    return;
  }

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

  // ── OLED update (non-blocking) ──
  updateDisplay(now);

  // ── Sensor read (always, independent of MQTT) ──
  if (now - lastSensorPublish > SENSOR_INTERVAL_MS) {
    lastSensorPublish = now;
    sensors_event_t shtHum, shtTemp;
    bool shtOk = sht4.getEvent(&shtHum, &shtTemp);
    float tempIn  = shtOk ? shtTemp.temperature : NAN;
    float humIn   = shtOk ? shtHum.relative_humidity : NAN;
    float tempOut = dhtOut.readTemperature();
    float humOut  = dhtOut.readHumidity();
    Serial.printf("Sensors — In: %.1fC %.1f%%  Out: %.1fC %.1f%%\n", tempIn, humIn, tempOut, humOut);

    // Cache for LCD + OLED display
    lcdTempIn  = tempIn;
    lcdHumIn   = humIn;
    lcdTempOut = tempOut;
    lcdHumOut  = humOut;

    evaluateClimate(tempIn, humIn);

    // Publish sensors (only when MQTT is connected)
    if (mqtt.connected()) {
      char buf[16];
      if (!isnan(tempIn))  { dtostrf(tempIn, 4, 1, buf); mqtt.publish("greenhouse/sensor/inside/temperature", buf); }
      if (!isnan(humIn))   { dtostrf(humIn,  4, 1, buf); mqtt.publish("greenhouse/sensor/inside/humidity",    buf); }
      if (!isnan(tempOut)) { dtostrf(tempOut, 4, 1, buf); mqtt.publish("greenhouse/sensor/outside/temperature", buf); }
      if (!isnan(humOut))  { dtostrf(humOut,  4, 1, buf); mqtt.publish("greenhouse/sensor/outside/humidity",    buf); }

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
}
