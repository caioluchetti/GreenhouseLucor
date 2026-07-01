/*
 * Tatufa — ESP32-CAM firmware (câmera fixa no topo da estufa)
 *
 * Hardware: ESP32-CAM (AI Thinker) com OV2640
 *
 * Funcionalidades:
 *   - Wi-Fi
 *   - Servidor HTTP na porta 80:
 *       /capture  → snapshot JPEG
 *       /stream   → MJPEG stream (abre no navegador)
 *   - Envia frames via HTTPS POST para o backend (DDNS)
 *   - A cada ~500ms captura e envia um frame JPEG
 *
 * Build: Arduino IDE, board: "AI Thinker ESP32-CAM"
 *
 * Dependências:
 *   - (esp_camera.h — built-in on ESP32 Arduino core 2.0+)
 *   - (WiFi.h — built-in)
 *   - (WebServer.h — built-in)
 *   - (WiFiClientSecure.h — built-in)
 */

#include <WiFi.h>
#include <WebServer.h>
#include <esp_camera.h>
#include <WiFiClientSecure.h>
#include <time.h>

// ── Configuração ──────────────────────────────────────────
const char* WIFI_SSID     = "SEU_WIFI";
const char* WIFI_PASS     = "SUA_SENHA";
const char* BACKEND_HOST  = "grenhousemqtt.cortada-server.ddns.net";
const int   BACKEND_PORT  = 443;
const char* BACKEND_PATH  = "/api/camera/frame";

// ── Stream settings ───────────────────────────────────────
#define STREAM_QUALITY 25       // JPEG quality 0-63 (25 = compact)
#define FRAME_INTERVAL  500     // ms between frame uploads

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
WiFiClientSecure client;
unsigned long lastFrameMs = 0;
bool cameraOk = false;

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
  config.fb_count     = 1;
  config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;

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

// ── Frame upload ───────────────────────────────────────────
bool uploadFrame() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) return false;

  Serial.printf("[Upload] Capture %dB, heap=%d, connecting...\n", fb->len, ESP.getFreeHeap());

  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
    IPAddress resolved;
    if (WiFi.hostByName(BACKEND_HOST, resolved)) {
      Serial.printf("[DNS] %s → %s\n", BACKEND_HOST, resolved.toString().c_str());
    } else {
      Serial.printf("[DNS] %s FAILED\n", BACKEND_HOST);
    }
    Serial.println("[Upload] Connection failed");
    esp_camera_fb_return(fb);
    return false;
  }

  client.printf("POST %s HTTP/1.1\r\n", BACKEND_PATH);
  client.printf("Host: %s\r\n", BACKEND_HOST);
  client.printf("Content-Type: image/jpeg\r\n");
  client.printf("Content-Length: %d\r\n", fb->len);
  client.print("Connection: close\r\n\r\n");
  client.write(fb->buf, fb->len);

  unsigned long timeout = millis() + 5000;
  while (millis() < timeout && !client.available()) delay(10);
  if (client.available()) {
    String line = client.readStringUntil('\r');
    Serial.printf("[Upload] %s\n", line.c_str());
    while (client.available()) client.read();
  } else {
    Serial.println("[Upload] No response (timeout)");
  }
  client.stop();
  esp_camera_fb_return(fb);
  return true;
}

// ── Wi-Fi ──────────────────────────────────────────────────
void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500); Serial.print("."); attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" OK");
    Serial.print("IP: "); Serial.println(WiFi.localIP());

    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    Serial.print("NTP");
    time_t now = time(nullptr);
    int ntpAttempts = 0;
    while (now < 1000000000 && ntpAttempts < 20) {
      delay(500); Serial.print(".");
      now = time(nullptr); ntpAttempts++;
    }
    if (now > 1000000000) {
      Serial.println(" OK");
    } else {
      Serial.println(" FAILED");
    }
  } else {
    Serial.println(" FAILED");
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

  client.setInsecure();
  Serial.println("[HTTPS] TLS verification disabled (insecure)");

  if (cameraOk) {
    server.on("/capture", HTTP_GET, handleCapture);
    server.on("/stream",  HTTP_GET, handleStream);
    server.begin();
    Serial.println("[HTTP] Server started on :80");
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (cameraOk) server.handleClient();

  if (cameraOk && WiFi.status() == WL_CONNECTED && millis() - lastFrameMs > FRAME_INTERVAL) {
    lastFrameMs = millis();
    uploadFrame();
  }
}
