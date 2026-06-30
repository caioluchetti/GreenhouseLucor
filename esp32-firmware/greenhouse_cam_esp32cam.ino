/*
 * Tatufa — ESP32-CAM firmware (câmera fixa no topo da estufa)
 *
 * Hardware: ESP32-CAM (AI Thinker) com OV2640
 *
 * Funcionalidades:
 *   - Wi-Fi + MQTT (conecta ao broker da estufa)
 *   - Servidor HTTP na porta 80:
 *       /capture  → snapshot JPEG
 *       /stream   → MJPEG stream (abre no navegador)
 *   - Publica greenhouse/camera/fixed/status com URLs da câmera
 *   - Assina greenhouse/camera/fixed/capture → tira foto → POST /api/camera/upload
 *   - Heartbeat a cada 30s
 *
 * Build: Arduino IDE, board: "AI Thinker ESP32-CAM"
 *
 * Depends on (Library Manager):
 *   - PubSubClient (Nick O'Leary)
 *   - (esp_camera.h — built-in on ESP32 Arduino core 2.0+)
 *   - (WiFi.h — built-in)
 *   - (WebServer.h — built-in)
 */
#include <WiFi.h>
#include <WebServer.h>
#include <esp_camera.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>

// ── Configuração ──────────────────────────────────────────
const char* WIFI_SSID     = "SEU_WIFI";
const char* WIFI_PASS     = "SUA_SENHA";
const char* MQTT_BROKER   = "greenhousemqtt.cortada-server.ddns.net";
const int   MQTT_PORT     = 8883;
const char* MQTT_CLIENT   = "esp32cam-greenhouse";

// Fingerprint SHA1 do certificado TLS (deixe "" para insecure)
const char* MQTT_TLS_FINGERPRINT = "36:12:05:B8:85:08:C1:9B:A0:F0:FA:6B:CC:C2:F2:8B:79:56:23:E7";

const char* BACKEND_HOST  = "192.168.1.100";   // IP do servidor backend
const int   BACKEND_PORT  = 6001;

// ── Camera pinout (AI Thinker ESP32-CAM) ─────────────────
#define CAM_PIN_PWDN    -1
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
WiFiClientSecure espClient;
PubSubClient mqtt(espClient);
unsigned long lastPublish = 0;
bool cameraOk = false;
String streamUrl = "";
String captureUrl = "";

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
  config.frame_size   = FRAMESIZE_SVGA;       // 800x600
  config.jpeg_quality = 10;                   // 0-63, menor = melhor (10 = alta qualidade)
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
  WiFiClient client = server.client();
  client.println("HTTP/1.1 200 OK");
  client.println("Content-Type: multipart/x-mixed-replace; boundary=frame");
  client.println();

  while (client.connected()) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) { delay(100); continue; }
    client.printf("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n", fb->len);
    client.write(fb->buf, fb->len);
    client.print("\r\n");
    esp_camera_fb_return(fb);
    delay(50);
  }
}

// ── Image upload to backend ─────────────────────────────────
void uploadToBackend(camera_fb_t* fb, const char* endpoint) {
  WiFiClient http;
  if (!http.connect(BACKEND_HOST, BACKEND_PORT)) {
    Serial.println("[Upload] Connection failed");
    return;
  }

  String boundary = "tatufaBoundary";
  String head = "--" + boundary + "\r\n";
  head += "Content-Disposition: form-data; name=\"image\"; filename=\"capture.jpg\"\r\n";
  head += "Content-Type: image/jpeg\r\n\r\n";
  String tail = "\r\n--" + boundary + "--\r\n";

  size_t totalLen = head.length() + fb->len + tail.length();

  http.printf("POST %s HTTP/1.1\r\n", endpoint);
  http.printf("Host: %s:%d\r\n", BACKEND_HOST, BACKEND_PORT);
  http.printf("Content-Type: multipart/form-data; boundary=%s\r\n", boundary.c_str());
  http.printf("Content-Length: %d\r\n", totalLen);
  http.print("Connection: close\r\n\r\n");

  http.print(head);
  http.write(fb->buf, fb->len);
  http.print(tail);

  while (http.connected() && !http.available()) delay(10);
  String resp = http.readString();
  Serial.printf("[Upload] %d bytes → %s response\n", fb->len, endpoint);
  http.stop();
}

// ── MQTT ────────────────────────────────────────────────────
void publishCameraStatus() {
  if (WiFi.status() != WL_CONNECTED) return;
  String ip = WiFi.localIP().toString();
  captureUrl = "http://" + ip + "/capture";
  streamUrl  = "http://" + ip + "/stream";

  String payload = "{\"ip\":\"" + ip + "\",\"capture\":\"" + captureUrl + "\",\"stream\":\"" + streamUrl + "\"}";
  mqtt.publish("greenhouse/camera/fixed/status", payload.c_str());
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String t(topic);
  if (t == "greenhouse/camera/fixed/capture") {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) { Serial.println("[Capture] Failed"); return; }
    uploadToBackend(fb, "/api/camera/upload");
    esp_camera_fb_return(fb);
  }
}

void reconnectMQTT() {
  while (!mqtt.connected()) {
    Serial.print("MQTT...");
    if (mqtt.connect(MQTT_CLIENT)) {
      Serial.println(" OK");
      mqtt.subscribe("greenhouse/camera/fixed/capture");
      publishCameraStatus();
    } else { delay(2000); }
  }
}

// ── Wi-Fi ────────────────────────────────────────────────────
void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println(" OK");
  Serial.print("IP: "); Serial.println(WiFi.localIP());

  // TLS para MQTT remoto
  if (strlen(MQTT_TLS_FINGERPRINT) > 0) {
    espClient.setFingerprint(MQTT_TLS_FINGERPRINT);
    Serial.println("[TLS] Fingerprint verification enabled");
  } else {
    espClient.setInsecure();
    Serial.println("[TLS] WARNING: Certificate verification disabled (insecure)");
  }
}

// ── Setup / Loop ─────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(50);

  cameraOk = initCamera();
  if (cameraOk) {
    sensor_t* s = esp_camera_sensor_get();
    if (s) {
      s->set_vflip(s, 1);     // corrige orientação (câmera de ponta-cabeça)
      s->set_brightness(s, 1);
      s->set_saturation(s, 0);
    }
  }

  connectWiFi();

  if (cameraOk) {
    server.on("/capture", HTTP_GET, handleCapture);
    server.on("/stream",  HTTP_GET, [](Stream& s){ handleStream(); });
    server.begin();
    Serial.println("[HTTP] Server started on :80");
  }

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (!mqtt.connected()) reconnectMQTT();
  mqtt.loop();

  if (cameraOk) server.handleClient();

  if (millis() - lastPublish > 30000) {
    lastPublish = millis();
    publishCameraStatus();
  }
}
