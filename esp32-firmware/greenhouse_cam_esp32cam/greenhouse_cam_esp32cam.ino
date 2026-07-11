/*
 * Tatufa — ESP32-CAM firmware (câmera fixa no topo da estufa)
 *
 * Hardware: ESP32-CAM (AI Thinker) com OV2640
 *
 * Funcionalidades:
 *   - Wi-Fi com fallback de configuração via portal AP (NEW)
 *   - Servidor HTTP na porta 80:
 *       /capture  → snapshot JPEG
 *       /stream   → MJPEG stream (abre no navegador, direto na LAN)
 *   - Envia frames via HTTPS POST (conexão persistente) para o backend — NEW: mais rápido e estável
 *   - OTA: ArduinoOTA (LAN) + atualização remota via MQTT/HTTPS (NEW)
 *
 * FIX (crash on upload):
 *   The stock 8KB loop-task stack is not enough for
 *   camera + WiFi + TLS handshake together on this board — it was
 *   resetting silently right as the TLS handshake started. Fixed via
 *   SET_LOOP_TASK_STACK_SIZE below (official Espressif mechanism), plus
 *   using PSRAM for the frame buffer instead of scarce internal RAM.
 *   If you still see resets after this, it's most likely power — the
 *   AI Thinker's onboard 3.3V regulator is weak. Use a proper 5V/2A
 *   supply (not a USB-serial adapter's 3.3V pin) and add a 470uF cap
 *   across 3V3/GND if it persists.
 *
 * Build: Arduino IDE, board: "AI Thinker ESP32-CAM"
 *   IMPORTANT: Tools → Partition Scheme → pick one with OTA space,
 *   e.g. "Minimal SPIFFS (1.9MB APP with OTA)". Without this, OTA will
 *   fail even though everything else compiles and flashes fine.
 *
 * Dependências:
 *   - esp_camera.h, WiFi.h, WebServer.h, WiFiClientSecure.h — built-in
 *   - WiFiManager (Library Manager — "WiFiManager" by tzapu) — NEW
 *   - PubSubClient (Library Manager — MQTT) — NEW
 *   - ArduinoJson (Library Manager) — NEW
 *   - ArduinoOTA, HTTPUpdate — built-in — NEW
 */

#include <Arduino.h>
// Fixes the stack-overflow crash on connect() — must be a top-level
// statement, before setup(). See header comment above for details.
SET_LOOP_TASK_STACK_SIZE(16 * 1024);

#include <WiFi.h>
#include <WebServer.h>
#include <esp_camera.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include <WiFiManager.h>       // NEW — captive portal WiFi setup
#include <PubSubClient.h>      // NEW — MQTT for remote OTA trigger
#include <ArduinoJson.h>       // NEW
#include <ArduinoOTA.h>        // NEW — LAN OTA
#include <HTTPUpdate.h>        // NEW — remote HTTPS OTA

// Explicit forward declarations (FIX for compile error) — Arduino's
// auto-prototype generator gets confused by the SET_LOOP_TASK_STACK_SIZE
// statement above sitting among the #includes, and inserts its own
// auto-generated prototypes for these two functions too early — before
// WiFiClientSecure/WiFiManager are defined. Declaring them ourselves here,
// after all includes, makes Arduino skip its broken auto-generated ones.
void drainHttpResponse(WiFiClientSecure& c);
void onConfigPortalStart(WiFiManager* mgr);

// ── Firmware version ───────────────────────────────────────
#define FW_VERSION "1.1.0"

// ── Configuração ──────────────────────────────────────────
// NOTE: WIFI_SSID/WIFI_PASS are now only used as a first-boot seed —
// WiFiManager takes over credential storage after that (see WiFi section).
const char* WIFI_SSID     = "Toca do Tatu 2.4G";
const char* WIFI_PASS     = "tamandua123";
const char* BACKEND_HOST  = "greenhouse.cortada-server.ddns.net";
const int   BACKEND_PORT  = 443;
const char* BACKEND_PATH  = "/api/camera/frame";

// ── MQTT (NEW — only used to trigger remote OTA) ────────────
const char* MQTT_BROKER   = "greenhousemqtt.cortada-server.ddns.net";
const int   MQTT_PORT     = 8883;
const char* MQTT_CLIENT   = "esp32-cam-greenhouse";

// ── Wi-Fi provisioning (NEW) ────────────────────────────────
const char* WIFI_AP_NAME  = "Tatufa-Cam-Setup";
const char* WIFI_AP_PASS  = "tatufa1234";       // change before deploying
const int   WIFI_CONNECT_TIMEOUT_S = 10;
const int   WIFI_PORTAL_TIMEOUT_S  = 180;

// ── OTA (NEW) ────────────────────────────────────────────────
const char* OTA_HOSTNAME  = "tatufa-cam";
const char* OTA_PASSWORD  = "tatufa-ota-2026";  // change before deploying

// ── Stream settings ───────────────────────────────────────
#define STREAM_QUALITY 25       // JPEG quality 0-63 (25 = compact)
#define FRAME_INTERVAL  200     // ms between frame uploads (was 500 — now ~5fps)

// ── Camera pinout (AI Thinker ESP32-CAM) ─────────────────
#define CAM_PIN_PWDN    32
#define CAM_PIN_RESET   -1
#define CAM_PIN_XCLK    0
#define CAM_PIN_SIOD    26
#define CAM_PIN_SIOC    27
#define CAM_PIN_D7      35
#define CAM_PIN_D6      34
#define CAM_PIN_D5      39
#define CAM_PIN_D4      36
#define CAM_PIN_D3      21
#define CAM_PIN_D2      19
#define CAM_PIN_D1      18
#define CAM_PIN_D0      5
#define CAM_PIN_VSYNC   25
#define CAM_PIN_HREF    23
#define CAM_PIN_PCLK    22

// ── Globals ────────────────────────────────────────────────
WebServer server(80);
WiFiClientSecure uploadClient;     // persistent upload connection (NEW: reused, not reconnected per-frame)
bool uploadClientConnected = false;
WiFiClientSecure mqttTlsClient;    // NEW
PubSubClient mqtt(mqttTlsClient);  // NEW
WiFiManager wifiManager;           // NEW
unsigned long lastFrameMs = 0;
bool cameraOk = false;
bool otaInProgress = false;        // NEW

// ── Camera init ────────────────────────────────────────────
bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = CAM_PIN_D0;    config.pin_d1  = CAM_PIN_D1;
  config.pin_d2       = CAM_PIN_D2;    config.pin_d3  = CAM_PIN_D3;
  config.pin_d4       = CAM_PIN_D4;    config.pin_d5  = CAM_PIN_D5;
  config.pin_d6       = CAM_PIN_D6;    config.pin_d7  = CAM_PIN_D7;
  config.pin_xclk     = CAM_PIN_XCLK;
  config.pin_pclk     = CAM_PIN_PCLK;
  config.pin_vsync    = CAM_PIN_VSYNC;
  config.pin_href     = CAM_PIN_HREF;
  config.pin_sccb_sda = CAM_PIN_SIOD;
  config.pin_sccb_scl = CAM_PIN_SIOC;
  config.pin_pwdn     = CAM_PIN_PWDN;
  config.pin_reset    = CAM_PIN_RESET;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size   = FRAMESIZE_QVGA;       // 320x240
  config.jpeg_quality = STREAM_QUALITY;

  // NEW — use PSRAM if available (AI Thinker has it, original code never
  // checked). Frees up scarce internal RAM for WiFi/TLS, reduces crashes,
  // and allows double-buffering for smoother capture.
  if (psramFound()) {
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.fb_count     = 2;
    config.grab_mode    = CAMERA_GRAB_LATEST;
    Serial.println("[Camera] PSRAM found — using double buffer");
  } else {
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.fb_count     = 1;
    config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
    Serial.println("[Camera] No PSRAM — single buffer (check board config!)");
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }
  return true;
}

// ── HTTP handlers ──────────────────────────────────────────
void handleCapture() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { server.send(500, "text/plain", "Camera capture failed"); return; }
  server.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

void handleStream() {
  WiFiClient streamClient = server.client();
  streamClient.println("HTTP/1.1 200 OK");
  streamClient.println("Content-Type: multipart/x-mixed-replace; boundary=frame");
  streamClient.println();

  while (streamClient.connected()) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) { delay(100); continue; }
    streamClient.printf("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n", fb->len);
    streamClient.write(fb->buf, fb->len);
    streamClient.print("\r\n");
    esp_camera_fb_return(fb);
    delay(50);
  }
}

// ── Frame upload (NEW — persistent connection instead of reconnect+TLS per frame) ──
bool ensureUploadConnection() {
  if (uploadClientConnected && uploadClient.connected()) return true;
  uploadClientConnected = uploadClient.connect(BACKEND_HOST, BACKEND_PORT);
  if (!uploadClientConnected) {
    IPAddress resolved;
    if (WiFi.hostByName(BACKEND_HOST, resolved)) {
      Serial.printf("[DNS] %s -> %s\n", BACKEND_HOST, resolved.toString().c_str());
    } else {
      Serial.printf("[DNS] %s FAILED\n", BACKEND_HOST);
    }
  }
  return uploadClientConnected;
}

// Reads and discards the HTTP response so the keep-alive connection stays
// in sync for the next request. Assumes a small, non-chunked response
// (true for the backend's JSON reply).
void drainHttpResponse(WiFiClientSecure& c) {
  unsigned long timeout = millis() + 3000;
  int contentLength = -1;
  while (millis() < timeout && c.connected()) {
    if (c.available()) {
      String line = c.readStringUntil('\n');
      line.trim();
      if (line.length() == 0) break;  // end of headers
      if (line.startsWith("Content-Length:")) {
        contentLength = line.substring(16).toInt();
      }
    }
  }
  if (contentLength > 0) {
    int remaining = contentLength;
    timeout = millis() + 3000;
    while (remaining > 0 && millis() < timeout && c.connected()) {
      if (c.available()) { c.read(); remaining--; }
    }
  }
}

bool uploadFrame() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) return false;

  if (!ensureUploadConnection()) {
    Serial.println("[Upload] Connection failed");
    esp_camera_fb_return(fb);
    return false;
  }

  uploadClient.print("POST ");
  uploadClient.print(BACKEND_PATH);
  uploadClient.println(" HTTP/1.1");
  uploadClient.print("Host: ");
  uploadClient.println(BACKEND_HOST);
  uploadClient.println("Content-Type: image/jpeg");
  uploadClient.print("Content-Length: ");
  uploadClient.println(fb->len);
  uploadClient.println("Connection: keep-alive");  // NEW — was "close"
  uploadClient.println();
  size_t written = uploadClient.write(fb->buf, fb->len);
  uploadClient.flush();

  if (written != fb->len || !uploadClient.connected()) {
    Serial.println("[Upload] Write failed — will reconnect next frame");
    uploadClientConnected = false;
    esp_camera_fb_return(fb);
    return false;
  }

  drainHttpResponse(uploadClient);
  esp_camera_fb_return(fb);
  return true;
}

// ── Wi-Fi (NEW — WiFiManager with AP-portal fallback) ───────
void onConfigPortalStart(WiFiManager* mgr) {
  Serial.println("[WiFi] No connection — opened config portal AP");
  Serial.printf("[WiFi] Connect to \"%s\" and go to 192.168.4.1\n", WIFI_AP_NAME);
}

void connectWiFi() {
  wifiManager.setConnectTimeout(WIFI_CONNECT_TIMEOUT_S);
  wifiManager.setConfigPortalTimeout(WIFI_PORTAL_TIMEOUT_S);
  wifiManager.setAPCallback(onConfigPortalStart);
  wifiManager.setBreakAfterConfig(true);

  bool connected = wifiManager.autoConnect(WIFI_AP_NAME, WIFI_AP_PASS);

  if (!connected) {
    Serial.println("[WiFi] Config portal timed out — rebooting to retry");
    delay(1000);
    ESP.restart();
  }

  Serial.println("WiFi OK");
  Serial.print("IP: "); Serial.println(WiFi.localIP());

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("NTP");
  time_t now = time(nullptr);
  int ntpAttempts = 0;
  while (now < 1000000000 && ntpAttempts < 20) {
    delay(500); Serial.print(".");
    now = time(nullptr); ntpAttempts++;
  }
  Serial.println(now > 1000000000 ? " OK" : " FAILED");
}

// ── OTA (NEW) ────────────────────────────────────────────────
void setupArduinoOTA() {
  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPassword(OTA_PASSWORD);

  ArduinoOTA.onStart([]() {
    otaInProgress = true;
    Serial.println("[OTA] LAN update starting...");
  });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("[OTA] %u%%\r", (progress * 100) / total);
  });
  ArduinoOTA.onEnd([]() {
    Serial.println("\n[OTA] LAN update complete — rebooting");
  });
  ArduinoOTA.onError([](ota_error_t error) {
    otaInProgress = false;
    Serial.printf("[OTA] Error[%u]\n", error);
  });

  ArduinoOTA.begin();
  Serial.println("[OTA] ArduinoOTA ready (LAN updates)");
}

// Triggered by MQTT: greenhouse/camera/ota/update
// payload: {"url":"https://host/path/firmware.bin","version":"1.2.0"}
void handleRemoteOta(const String& url, const String& version) {
  if (url.length() == 0) {
    mqtt.publish("greenhouse/camera/ota/status", "{\"status\":\"error\",\"reason\":\"missing url\"}");
    return;
  }

  Serial.printf("[OTA] Remote update requested: %s (v%s)\n", url.c_str(), version.c_str());
  otaInProgress = true;
  mqtt.publish("greenhouse/camera/ota/status", "{\"status\":\"starting\"}");

  // FIX — free the persistent frame-upload TLS connection before opening
  // another one for the OTA download. This board is memory-constrained;
  // running the upload connection + MQTT connection + a fresh OTA
  // connection all at once can exhaust heap and make the OTA connect()
  // fail outright (reported generically as "connection refused").
  uploadClient.stop();
  uploadClientConnected = false;
  Serial.printf("[OTA] Free heap before download: %u\n", ESP.getFreeHeap());

  // Diagnostics — same host as the frame-upload connection, which works
  // fine, so this narrows down whether OTA's failure is really network-
  // level or something specific to the update path.
  IPAddress otaResolved;
  if (WiFi.hostByName(BACKEND_HOST, otaResolved)) {
    Serial.printf("[OTA][DNS] %s -> %s\n", BACKEND_HOST, otaResolved.toString().c_str());
  } else {
    Serial.println("[OTA][DNS] resolution FAILED");
  }

  WiFiClientSecure otaClient;
  otaClient.setInsecure();  // matches the rest of this firmware's TLS handling

  bool testConnect = otaClient.connect(BACKEND_HOST, BACKEND_PORT);
  Serial.printf("[OTA] Test connect to %s:%d -> %s (heap now: %u)\n",
                BACKEND_HOST, BACKEND_PORT, testConnect ? "OK" : "FAILED", ESP.getFreeHeap());
  otaClient.stop();

  t_httpUpdate_return ret = httpUpdate.update(otaClient, url);

  switch (ret) {
    case HTTP_UPDATE_FAILED: {
      Serial.printf("[OTA] Failed (%d): %s\n",
                     httpUpdate.getLastError(),
                     httpUpdate.getLastErrorString().c_str());
      char buf[160];
      snprintf(buf, sizeof(buf), "{\"status\":\"failed\",\"error\":\"%s\"}",
               httpUpdate.getLastErrorString().c_str());
      mqtt.publish("greenhouse/camera/ota/status", buf);
      otaInProgress = false;
      break;
    }
    case HTTP_UPDATE_NO_UPDATES:
      mqtt.publish("greenhouse/camera/ota/status", "{\"status\":\"no_update\"}");
      otaInProgress = false;
      break;
    case HTTP_UPDATE_OK:
      mqtt.publish("greenhouse/camera/ota/status", "{\"status\":\"ok\",\"rebooting\":true}");
      delay(500);
      ESP.restart();
      break;
  }
}

// ── MQTT (NEW — only used for OTA trigger) ──────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String t(topic);
  String p;
  for (unsigned int i = 0; i < length; i++) p += (char)payload[i];

  if (t == "greenhouse/camera/ota/update") {
    StaticJsonDocument<384> doc;
    if (deserializeJson(doc, p) == DeserializationError::Ok) {
      String url     = doc["url"]     | "";
      String version = doc["version"] | "";
      handleRemoteOta(url, version);
    }
  }
}

void reconnectMQTT() {
  if (mqtt.connected()) return;
  Serial.print("MQTT connect...");
  if (mqtt.connect(MQTT_CLIENT)) {
    Serial.println(" OK");
    mqtt.subscribe("greenhouse/camera/ota/update");
    char verBuf[48];
    snprintf(verBuf, sizeof(verBuf), "{\"version\":\"%s\"}", FW_VERSION);
    mqtt.publish("greenhouse/camera/firmware/version", verBuf);
  } else {
    Serial.print("failed rc=");
    Serial.println(mqtt.state());
  }
}

// ── Setup / Loop ───────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(50);

  cameraOk = initCamera();
  if (cameraOk) {
    sensor_t* s = esp_camera_sensor_get();
    if (s) {
      s->set_vflip(s, 1);
      s->set_brightness(s, 1);
      s->set_saturation(s, 0);
    }
    Serial.println("[Camera] OK");
  }

  connectWiFi();

  uploadClient.setInsecure();
  mqttTlsClient.setInsecure();
  Serial.println("[HTTPS] TLS verification disabled (insecure)");

  setupArduinoOTA();
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);

  if (cameraOk) {
    server.on("/capture", HTTP_GET, handleCapture);
    server.on("/stream",  HTTP_GET, handleStream);
    server.begin();
    Serial.println("[HTTP] Server started on :80");
  }
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    ArduinoOTA.handle();
  }
  if (otaInProgress) return;  // httpUpdate.update() blocks anyway, but stay safe

  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (!mqtt.connected()) reconnectMQTT();
  mqtt.loop();

  if (cameraOk) server.handleClient();

  if (cameraOk && WiFi.status() == WL_CONNECTED && millis() - lastFrameMs > FRAME_INTERVAL) {
    lastFrameMs = millis();
    uploadFrame();
  }
}
