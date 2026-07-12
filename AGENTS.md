# AGENTS.md — Tatufa

> Guia para agentes de IA e desenvolvedores. Leia antes de mexer no código.

---

## 🏗️ Arquitetura

```
Browser (React SPA) ←HTTP→ Nginx :8085 ←proxy /api/*→ FastAPI :6001 (Docker)
                                                          │
                              ESP32 (Wi-Fi) ←──MQTT──→ Mosquitto :1883
```

- **Frontend**: React 19 + Vite 8 + Tailwind CSS v4 (JSX, sem TypeScript) — raiz do repo
- **Backend**: Python 3.12 + FastAPI + SQLite + MQTT — diretório `api/`
- **Hardware**: ESP32 DevKit com 5 relés (módulo 8ch), DHT22 (dentro), DHT22 (fora), LCD 16x2 I2C
- **Comunicação**: Frontend↔Backend via HTTP REST, Backend↔ESP32 via MQTT
- **Design system**: Solarpunk/glassmorphism definido por CSS variables em `src/index.css`

---

## 📂 Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/App.jsx` | Root: 4 tabs, estado global, polling, todos os callbacks |
| `src/index.css` | Design system completo (~460 linhas): variáveis CSS, tema dark/light, animações |
| `src/components/Dashboard.jsx` | Grid de 3 ZoneCards + LightCard + SensorPanel, calcula próxima rega |
| `src/components/ZoneCard.jsx` | Card de zona: ON/OFF toggle, timer irrigação, rename, emoji edit |
| `src/components/LightCard.jsx` | Card da luz de crescimento: toggle ON/OFF (glow âmbar), espelho visual do ZoneCard |
| `src/components/SensorPanel.jsx` | 4 cards: temp/umid dentro e fora da estufa |
| `src/components/SensorCharts.jsx` | Gráficos Chart.js: temperatura + umidade, períodos 1h/24h/7d/30d, botão limpar |
| `src/components/ScheduleList.jsx` | Lista de agendamentos por zona/luz, toggle enable, CRUD |
| `src/components/ScheduleForm.jsx` | Modal criar/editar schedule: zona/luz, dias, hora, duração |
| `src/components/ClimatePanel.jsx` | Controle de exaustor (auto/on/off) + thresholds de temperatura (luz foi movida p/ Dashboard) |
| `src/components/StatusBar.jsx` | Header: título "TATUFA", toggle tema ☀️/🌙, status ESP, relógio |
| `api/server.py` | FastAPI app: 18 endpoints REST, lifespan (MQTT+scheduler+histórico) |
| `api/models.py` | Schemas Pydantic: zonas, sensores, schedules, clima, luz, histórico |
| `api/database.py` | SQLAlchemy ORM: 5 tabelas, auto-migration, seed data, auto-cleanup |
| `api/mqtt_client.py` | `MockMQTT` (dev) + `RealMQTT` (prod): sensores, zones, clima, luz |
| `api/scheduler.py` | Agendador: loop a cada 5s, dias em inglês (hardcoded), remaining dinâmico |
| `esp32-firmware/greenhouse_lucor_esp32/greenhouse_lucor_esp32.ino` | Firmware ESP32 principal (irrigação/clima/luz): autônomo, NTP, NVS, scheduler local, MQTT |
| `esp32-firmware/greenhouse_lucor_esp32/platformio.ini` | Config PlatformIO: board `esp32dev`, libs, `src_dir=.` (compat Arduino IDE) |
| `esp32-firmware/greenhouse_lucor_esp32/build/esp32.esp32.esp32dev/` | Artefatos de build commitados: `.bin` (app), `bootloader.bin`, `partitions.bin`, `boot_app0.bin`, `.elf`, `.map`, `flash_args` |
| `esp32-firmware/greenhouse_cam_esp32cam.ino` | Firmware ESP32-CAM (câmera): stream MJPEG → HTTPS POST `/api/camera/frame` |
| `esp32-firmware/greenhouse_cam_esp32cam/build/esp32.esp32.esp32cam/` | Artefatos de build do CAM commitados (mesmo layout do firmware principal) |
| `docker-compose.yml` | Stack Docker do backend (container único) |
| `greenhouse-lucor.nginx.conf` | Config Nginx: porta 8085, proxy /api/* → :6001, `client_max_body_size 20M` (uploads de firmware/frames) |
| `deploy.sh` | Script de deploy: build frontend + copia dist + instala nginx config |

---

## 🛠️ Comandos

```bash
# Desenvolvimento
npm run dev              # Frontend (Vite) + backend (mock) — não precisa de hardware
npm run dev:frontend     # Só Vite
npm run dev:backend      # Só backend Python (MQTT_MODE=mock)

# Build & Deploy (Frontend)
npm run build            # Vite → dist/
npm run deploy           # build + cp dist/* → /var/www/greenhouse-lucor/
npm run preview          # Preview local do build (sem backend)

# Docker (backend)
docker compose up -d --build   # Build + start
docker compose logs -f          # Logs em tempo real
docker restart greenhouse-backend   # Reiniciar
docker inspect --format='{{.State.Health.Status}}' greenhouse-backend  # healthcheck

# Firmware ESP32 (ver seção 🔩 abaixo para detalhes)
pio run -d esp32-firmware/greenhouse_lucor_esp32                              # build → .bin
pio run -d esp32-firmware/greenhouse_lucor_esp32 -t upload                     # flash via USB
pio run -d esp32-firmware/greenhouse_cam_esp32cam                             # build ESP32-CAM
```

### Deploy completo (produção)

```bash
# 1. Backend
cd GreenhouseLucor
docker build -t greenhouse-lucor-backend:latest ./api/
docker stop greenhouse-backend && docker rm greenhouse-backend
docker run -d --name greenhouse-backend --restart unless-stopped \
  -p 6001:6001 -v greenhouse-data:/app/data \
  -e MQTT_MODE=real -e MQTT_BROKER=<ip-do-broker> \
  --network greenhouse greenhouse-lucor-backend:latest

# 2. Frontend
npm run deploy
sudo nginx -t && sudo systemctl reload nginx

# 3. Firmware (opcional — só se mudou código C/C++ do ESP32)
pio run -d esp32-firmware/greenhouse_lucor_esp32 -t upload        # USB
# ..ou via OTA remoto (ver seção 🔩 Firmware ESP32 abaixo)
```

---

## 🔩 Firmware ESP32 (build, flash e OTA)

O firmware do ESP32 principal vive em `esp32-firmware/greenhouse_lucor_esp32/`. É um projeto PlatformIO + Arduino IDE (o `.ino` está na raiz da pasta, não em `src/`, porque o `platformio.ini` define `src_dir = .` — isso preserva a convenção do Arduino IDE onde o nome do arquivo `.ino` deve bater com o nome da pasta).

### Pré-requisitos

- **PlatformIO Core** instalado (`pip install platformio` ou `pio` no PATH). No primeiro build, a toolchain `espressif32@^6.7.0` (~300-500 MB) é baixada automaticamente em `~/.platformio/`.
- **Drivers USB** pro conversor CP2102 / CH340 do ESP32 DevKit (no Linux: `udevadm` + `dialout` group; a porta aparece em `/dev/ttyUSB0` ou `/dev/ttyACM0`).
- **Backend no ar** (para OTA remoto) com o endpoint `POST /api/firmware/upload` escutando — já implementado em `api/server.py:497`.

### Como compilar (gerar o `.bin`)

```bash
# Esp32 principal (irrigação/clima/luz)
pio run -d esp32-firmware/greenhouse_lucor_esp32

# ESP32-CAM (câmera)
pio run -d esp32-firmware/greenhouse_cam_esp32cam
```

Saída do build principal:
- Intermediários: `esp32-firmware/greenhouse_lucor_esp32/.pio/build/esp32dev/` (ignorado por `.gitignore`)
- Artefatos flashables: `esp32-firmware/greenhouse_lucor_esp32/build/esp32.esp32.esp32dev/`:
  - `greenhouse_lucor_esp32.ino.bin` (app, ~1.06 MB, vai em `0x10000`)
  - `greenhouse_lucor_esp32.ino.bootloader.bin` (~17 KB, em `0x1000`)
  - `greenhouse_lucor_esp32.ino.partitions.bin` (3 KB, em `0x8000`)
  - `boot_app0.bin` (8 KB, em `0xe000` — copiado do framework Arduino)
  - `greenhouse_lucor_esp32.ino.elf` + `.map` (debugging/símbolos)
  - `flash_args` (argumentos prontos pra `esptool.py`)

Ao final do build, copie os artefatos de `.pio/build/esp32dev/` para `build/esp32.esp32.esp32dev/` (mantendo os nomes `greenhouse_lucor_esp32.ino.*`) para que fiquem commitados e disponíveis pra flash/OTA sem precisar rebuildar em outra máquina.

### Flash via USB (serial)

**Opção A — PlatformIO (recomendado, automatizado):**
```bash
# Conecte o ESP32 via USB e identifique a porta (ex.: /dev/ttyUSB0)
pio run -d esp32-firmware/greenhouse_lucor_esp32 -t upload \
  --upload-port /dev/ttyUSB0
```
PlatformIO grava bootloader + partitions + app + boot_app0 automaticamente.

**Opção B — esptool.py manual (flash full com os artefatos commitados):**
```bash
cd esp32-firmware/greenhouse_lucor_esp32/build/esp32.esp32.esp32dev
esptool.py --chip esp32 --port /dev/ttyUSB0 --baud 921600 \
  write_flash --flash-mode dio --flash-freq 40m --flash-size 4MB \
  0x1000  greenhouse_lucor_esp32.ino.bootloader.bin \
  0x8000  greenhouse_lucor_esp32.ino.partitions.bin \
  0xe000  boot_app0.bin \
  0x10000 greenhouse_lucor_esp32.ino.bin
```

**Opção C — só o app (quando muda só o código, bootloader já estava gravado):**
```bash
esptool.py --chip esp32 --port /dev/ttyUSB0 --baud 921600 \
  write_flash 0x10000 greenhouse_lucor_esp32.ino.bin
```

### Flash via OTA (remoto, pelo backend)

O fluxo OTA está implementado no backend (`api/server.py:497-547`) e no firmware (`HTTPUpdate` + tópico MQTT `greenhouse/ota/update`). Requer que o ESP32 esteja **online** e ouvindo o broker MQTT.

```bash
# 1. Upload do .bin pro backend
curl -F "file=@esp32-firmware/greenhouse_lucor_esp32/build/esp32.esp32.esp32dev/greenhouse_lucor_esp32.ino.bin" \
  "https://greenhouse.cortada-server.ddns.net/api/firmware/upload?version=1.1.0&device=greenhouse"

# 2. Disparar o update via MQTT (o ESP32 baixa e flasheia sozinho)
curl -X POST "https://greenhouse.cortada-server.ddns.net/api/firmware/deploy?filename=greenhouse_v1.1.0.bin&version=1.1.0&device=greenhouse"

# 3. Acompanhar o status (idle/downloading/flashing/rebooting/error)
curl "https://greenhouse.cortada-server.ddns.net/api/firmware/status?device=greenhouse"
```

`device` aceita `greenhouse` (irrigação) ou `camera` (ESP32-CAM). Para o CAM use `device=camera` e o `.ino` em `esp32-firmware/greenhouse_cam_esp32cam.ino`.

### Pinos do ESP32 principal

| GPIO | Função |
|---|---|
| 19 | Relé Zone 1 |
| 18 | Relé Zone 2 |
| 5  | Relé Zone 3 |
| 17 | Relé exaustor |
| 16 | Relé luz de crescimento |
| 32 | DHT22 (interno) |
| 33 | DHT22 (externo) |
| 14 (SDA) / 27 (SCL) | LCD 16x2 I2C (addr 0x27) |

Relés são **active-LOW**: `RELAY_ON = LOW`, `RELAY_OFF = HIGH`.

### Bibliotecas Arduino (declaradas em `platformio.ini`)

- **WiFiManager** (tzapu) — captive portal Wi-Fi provisioning
- **PubSubClient** (Nick O'Leary) — MQTT
- **DHT sensor library** (Adafruit) + Adafruit Unified Sensor — DHT22/DHT11
- **ArduinoJson** v6 (Benoit Blanchon) — parse JSON. **Atenção:** o firmware usa `StaticJsonDocument<>` (API v6); não subir pra v7 sem refactor
- **LiquidCrystal_I2C** (marcoschwartz) — LCD 16x2 via PCF8574

### Particionamento e tamanho

`default.csv` (Arduino core) — OTA-capaz:
```
app0      ota_0   0x10000    1.28 MB
app1      ota_1   0x150000   1.28 MB
otadata   data     0xe000    8 KB
nvs       data     0x9000    20 KB  ← climate, schedules, (futuro) wifi
spiffs    data     0x290000   1.5 MB
```

Uso atual do firmware: **Flash 82.5% (~1.06 MB / 1.28 MB)**, **RAM 16.4%**. OTA funciona porque o `.bin` cabe no slot `ota_0` com folga.

### Gotchas de firmware

1. **Bug conhecido — Wi-Fi não persiste entre reboots**: o `connectWiFi()` em `greenhouse_lucor_esp32.ino` chama só `wifiManager.autoConnect()` sem `setSaveConfigCallback` nem `WiFiManagerParameter`, e sem namespace `"wifi"` no NVS. A senha não é recuperável pelo `WiFi.SSID()` no cold boot, então o AP "Tatufa-Setup" reabre a cada reboot. **Fix planejado:** salvar SSID/pass no NVS via callback do portal e chamar `WiFi.begin(loadedSsid, loadedPass)` antes de `autoConnect()`.
2. **ArduinoJson v6**: o firmware usa `StaticJsonDocument<N>`, `deserializeJson`, ` JsonObject` — API v6. NÃO subir pra ArduinoJson v7 no `platformio.ini` sem refatorar (v7 remove esses tipos).
3. **`setBreakAfterConfig(true)` + `ESP.restart()`** em `connectWiFi()` criam reboot loop se o usuário errar a senha no portal — ao fixar o item 1, considere trocar pra `setBreakAfterConfig(false)`.
4. **Build/commit de artefatos**: os `.bin`/`.elf`/`.map`/`bootloader.bin`/`partitions.bin`/`boot_app0.bin` em `build/` são commitados intencionalmente (para flash/OTA sem rebuild). Já `.pio/` está no `.gitignore` (intermediários descartáveis).
5. **PlatformIO + Arduino IDE coexistem**: o `platformio.ini` usa `src_dir = .` pra que o `.ino` continue funcionando na Arduino IDE (que exige nome da pasta = nome do arquivo). Não mover o `.ino` pra `src/`.
6. **ESP32-CAM tem firmware separado** (`esp32-firmware/greenhouse_cam_esp32cam.ino`): stream MJPEG → HTTPS POST `/api/camera/frame`. Não tem OTA USB wired além do `pio run -t upload` — o upload OTA usa `device=camera` no endpoint do backend.

---

## 🗄️ Banco de Dados (SQLite)

Arquivo: `api/data/greenhouse.db` (volume Docker persistente)

| Tabela | Colunas principais | Índice |
|---|---|---|
| `schedules` | id, zone_id (nullable), target_type, days, time, duration, enabled | PK id |
| `zone_names` | id, zone_id (unique), name, icon (default 🟩) | PK id, UNIQUE zone_id |
| `climate_rules` | id, temp_high (30.0), temp_low (28.0), hum_high, hum_low, fan_mode (auto) | PK id |
| `light_state` | id, state (off) | PK id |
| `sensor_history` | id, source, metric, value (Float), recorded_at | PK id, filter por source/metric/time |

Auto-criação em `database.py:Base.metadata.create_all()`. Auto-limpeza de `sensor_history` >30 dias no startup. **Sem Alembic** — migrações manuais via funções `_migrate_*()`.

---

## 📡 Tópicos MQTT

```
Sensores (ESP → Broker, 30s):
  greenhouse/sensor/inside/temperature    "24.5"
  greenhouse/sensor/inside/humidity       "65.0"
  greenhouse/sensor/outside/temperature   "18.2"
  greenhouse/sensor/outside/humidity      "72.0"

Zonas (bidirecional):
  greenhouse/zone{1,2,3}/command   Broker→ESP  ON/OFF
  greenhouse/zone{1,2,3}/state     ESP→Broker  ON/OFF

Clima (bidirecional):
  greenhouse/climate/status        ESP→Broker  JSON: {fan, mode, reason, temp, hum}
  greenhouse/climate/fan/cmd       Broker→ESP  JSON: {mode: auto|on|off}
  greenhouse/climate/thresholds    Broker→ESP  JSON: {temp_high, temp_low, ...}
  greenhouse/climate/request       ESP→Broker  "{}" (solicita thresholds)

Luz (bidirecional):
  greenhouse/light/cmd             Broker→ESP  ON/OFF
  greenhouse/light/status          ESP→Broker  ON/OFF

Sistema:
  greenhouse/status                ESP→Broker  "online" (heartbeat)
  greenhouse/schedules/sync        Broker→ESP  JSON array de schedules
  greenhouse/schedules/request     ESP→Broker  "{}" (solicita sync)

Irrigação autônoma:
  greenhouse/irrigation/started    ESP→Broker  {"zone":1,"duration":5}
  greenhouse/irrigation/stopped    ESP→Broker  "1"
  greenhouse/zone{1,2,3}/remaining ESP→Broker "120"
```

---

## 🤖 Modo Autônomo do ESP32

O ESP32 NÃO depende do servidor para irrigar:

1. **NTP**: Sincroniza com `pool.ntp.org` + `a.st1.ntp.br` no boot, re-sinc a cada 24h
2. **NVS (Preferences)**: Schedules salvos em flash (`namespace: "schedules"`)
3. **Scheduler local**: Loop a cada 10s — compara dia/hora → aciona relé direto
4. **Countdown**: Timer decremental por zona — desliga quando zera
5. **Sync**: No boot/reconnect → publica `greenhouse/schedules/request` → backend responde `greenhouse/schedules/sync` → salva no NVS

### Formato NVS das schedules

```
Namespace: "schedules"
Key: "count"       → int (quantidade)
Key: "s0_id"       → int (id do schedule)
Key: "s0_zone"     → int (1-3)
Key: "s0_days"     → string ("mon,wed,fri")
Key: "s0_time"     → string ("08:00")
Key: "s0_dur"      → int (minutos)
Key: "s0_en"       → bool
... até s19_*
```

As bibliotecas Arduino e a board (`esp32dev`) estão declaradas no `platformio.ini` — ver seção 🔩 Firmware ESP32 acima.

---

## 🎨 Design System (Solarpunk Glassmorphism)

### Variáveis CSS (definidas em `src/index.css`)

Todas as cores usam `var(--sp-*)` — suportam dark/light via `[data-theme="light"]`.

| Categoria | Exemplos |
|---|---|
| Background | `--sp-bg`, `--sp-surface`, `--sp-tab-panel-bg` |
| Texto | `--sp-text`, `--sp-text-dim`, `--sp-text-muted` |
| Acento (verde) | `--sp-accent`, `--sp-accent-dim`, `--sp-accent-muted`, `--sp-accent-bg`, `--sp-accent-border` |
| Danger (vermelho) | `--sp-danger`, `--sp-danger-dim` |
| Warning (amarelo) | `--sp-warning`, `--sp-warning-bg` |
| Bordas | `--sp-border-subtle`, `--sp-border-subtle-strong` |

### Classes utilitárias

| Classe | Efeito |
|---|---|
| `sp-glass` | backdrop-blur(16px) + borda translúcida + bg semi-transparente |
| `sp-glass-sm` | Versão menor (12px blur) |
| `sp-glow-green` | Sombra verde pulsante ao redor |
| `sp-bg` | Background principal com gradiente radial + grid hexagonal SVG |
| `sp-tab-active` / `sp-tab-inactive` | Botões de tab |
| `sp-btn-primary` / `sp-btn-secondary` | Botões |
| `sp-input` | Campo de input estilizado |
| `sp-toggle` | Toggle switch checkbox |
| `sp-overlay` | Overlay modal com blur |
| `sp-irrigation-bar` | Barra de progresso da irrigação |
| `scrollbar-hide` | Esconde scrollbar (para tabs mobile) |

### Animações

- `animate-spin` — spinner de carregamento
- `animate-fade-in` — entrada suave de componentes
- `sp-drip` — gota d'água pulsando (botão irrigando)
- `sp-dot-pulse` — indicador de status ESP32

### Tailwind v4 — sem arquivo de config

Este projeto usa Tailwind v4 com plugin `@tailwindcss/vite`. **Não existe** `tailwind.config.js`. Toda customização é feita via blocos `@theme` no `src/index.css`.

---

## 🔧 Padrões e convenções

### Frontend

- **Sem router**: Troca de "páginas" via estado `tab` (string: `'dashboard'`, `'schedules'`, `'climate'`, `'charts'`)
- **Sem state management**: Todo estado no `App.jsx`, passado como props
- **API calls**: `fetch()` nativo (sem Axios), com `Promise.all` para paralelismo
- **Polling**: `setInterval` de 3s (sensores/zones/schedules) e 5s (status/hora). Gráficos: 30s.
- **API base**: `import.meta.env.BASE_URL + 'api'` → resolve pra `/api` em prod/dev
- **Tema**: `localStorage` key `'greenhouse-theme'`, aplicado via `data-theme` no `<html>`

### Backend

- **MQTT_MODE**: `mock` (dev, sem hardware) ou `real` (produção, com broker)
- **Lifespan**: `MockMQTT`/`RealMQTT` + `Scheduler` + thread de histórico iniciam no `lifespan` do FastAPI
- **DB sessions**: Sempre `SessionLocal()` com try/finally para fechar. Endpoints usam `Depends(get_db)`.
- **Dias da semana**: Usar **inglês** (`mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`). O frontend manda em inglês, o scheduler compara com array hardcoded `WEEKDAYS`. NÃO usar `locale.setlocale()`.
- **Schedule days**: String separada por vírgula: `"mon,wed,fri"` (sem espaços extras? O scheduler faz `.strip()` então tanto faz)
- **Schedule target_type**: `"zone"` (zone_id obrigatório 1-3) ou `"light"` (zone_id = null)

### ESP32

- **Relés active-LOW**: `#define RELAY_ON LOW`, `#define RELAY_OFF HIGH`
- **Pinos GPIO**: ver tabela "Pinos do ESP32 principal" na seção 🔩 Firmware ESP32 acima (valores autoritativos vindos dos `#define` no `.ino` — não confiar no comentário de cabeçalho do `.ino`, que está stale)
- **LCD I2C**: 16x2, address 0x27, 3 páginas rotativas (sensores, zonas, conectividade), refresh a cada 500ms, troca de página a cada 3s
- **MQTT buffer**: 4096 bytes (para receber array JSON de schedules)
- **NVS namespaces**: `"climate"`, `"schedules"` (não colidir; `"wifi"` planejado pro fix de persistência Wi-Fi)

---

## 🔮 Futuro: Spider Cam + Timelapse (NÃO implementado — referência)

### Arquitetura física

```
SPIDER CAM (pendurada no teto)
  DevModule M3 (P4 + C6 onboard)
    ├─ P4: TFLite inference (ESP-NN), MIPI CSI camera
    ├─ C6: Wi-Fi 6 (HTTP + MQTT → backend)
    └─ I2C → Arduino Nano → 2x servo (pan/tilt)

CABINET (fixa, junto ao relay ESP32 existente)
  ESP32 DevKit (relay)
    ├─ MQTT: recebe greenhouse/camera/move/*
    └─ I2C → Arduino Uno → CNC Shield V3 → 4x A4988 → 4x NEMA 17
```

### Regra de ouro: P4 NÃO toca na cadeia de movimento do gantry

O gantry é controlado pelo ESP32 do cabinet via MQTT direto. O P4 apenas:
- Captura fotos (MIPI CSI)
- Roda TFLite on-device (MobileNet, int8, ~200KB)
- Controla servos locais via I2C → Nano
- Sobe frames via HTTPS POST /api/camera/frame (mesmo endpoint da câmera fixa)
- Publica resultados de inferência via MQTT

### Backend — O que precisa ser adicionado

| Arquivo | Adição |
|---|---|
| `api/database.py` | Tabelas: `plant_inspections` (id, position, image_path, label, confidence, timestamp), `timelapse_positions` (id, x, y, z, label) |
| `api/models.py` | Schemas: `InspectionResult`, `TimelapsePosition`, `CameraMoveCommand` |
| `api/server.py` | Endpoints: `GET /api/inspections`, `POST /api/camera/move`, `POST /api/camera/inspect`, `GET /api/timelapse`, `POST /api/timelapse/start` |
| `src/components/` | Novo componente: `SpiderCamPanel.jsx` (para dashboard tab de inspeção) |
| `src/App.jsx` | Nova tab: `'spidercam'` com controle manual + galeria de timelapse + grade de diagnósticos |

### MQTT — Tópicos novos

```
greenhouse/camera/move              Broker→ESP32  {"x":45,"y":30,"z":-50}
greenhouse/camera/move/position/1   Broker→ESP32  {"x":45,...}
greenhouse/camera/arrived           ESP32→Broker  "1"
greenhouse/camera/stop              Broker→ESP32  "1"
greenhouse/camera/status            ESP32→Broker  "idle"|"moving"|"error"
greenhouse/camera/capture           Broker→P4     "1"
greenhouse/camera/inspect           Broker→P4     "1"
greenhouse/camera/result            P4→Broker     {"pos":3,"label":"blight","confidence":0.87}
greenhouse/camera/timelapse/start   Broker→P4     "1"
```

### TFLite — Especificações

| Aspecto | Valor |
|---|---|
| Modelo | MobileNetV2 ou V3-Small (classificação) |
| Precisão | int8 quantizado (ESP-NN) |
| Tamanho | ~200-500KB (cabe na PSRAM do P4) |
| Entrada | 224×224×3, crop do frame MIPI |
| Saída | Top-K labels com confidence |
| Dataset | PlantVillage + fotos próprias da estufa |
| Treino | Colab ou local → converter com `tflite_convert` → deploy via OTA ou flash |

### Firmware — Notas importantes (ESP32 core 3.x)

- `WiFiClientSecure` agora é `NetworkClientSecure`
- `setFingerprint()` removido → usar `setInsecure()` para testes
- `WebServer::on()` não aceita lambda com `Stream&` → usar função global
- `client.printf()` sobre SSL pode corromper dados → usar `print()`/`println()` + `flush()`
- `setSSL()` / `setServername()` não existem mais
- `configTime(0, 0, "pool.ntp.org", "time.nist.gov")` obrigatório antes de TLS
- Nanos/I2C: manter cabo < 30cm. Usar 100kHz. Enviar JSON compacto (`{"x":45}`)

### Checklist de implementação (futuro)

1. [ ] ESP32 cabinet recebe `greenhouse/camera/move` → publica `arrived`
2. [ ] P4 se conecta ao Wi-Fi via C6 onboard → NTP → HTTPS POST funcional
3. [ ] P4 captura MIPI CSI → JPEG → HTTPS POST `/api/camera/frame`
4. [ ] P4 roda TFLite → publica resultado via MQTT `greenhouse/camera/result`
5. [ ] P4 implementa loop de timelapse (3 posições, N minutos)
6. [ ] P4 implementa rotina de inspeção (10 posições, sob demanda)
7. [ ] Backend: migration DB + endpoints REST
8. [ ] Frontend: tab Spider Cam + galeria + diagnósticos

---

## ⚠️ Gotchas

1. **Dias da semana**: Sempre em inglês (`mon`/`tue`/`wed`...). O locale não é mais usado.
2. **DHT22 externo**: Usa GPIO 33 (era DHT11 na GPIO 4). DHT22 geralmente vem em módulo breakout com pull-up 10KΩ onboard — se for sensor avulso, use 10KΩ (não 2.2KΩ como o DHT11 antigo). Cabo longo ainda pode afetar o sinal — considerar DS18B20 como fallback se falhar.
3. **Docker precisa de rebuild**: O container carrega o código no build. Mudanças em `api/*.py` exigem `docker build` + restart.
4. **Volume do SQLite**: O volume `greenhouse-data` é persistente. Se precisar resetar o banco: `docker volume rm greenhouse-data`.
5. **Porta 6001 já em uso?**: O Docker mapeia 6001. Se rodar backend local (sem Docker), mate o container primeiro.
6. **CORS**: `allow_origins=["*"]` — aberto pra desenvolvimento. Em produção, restrinja.
7. **Sem testes**: Não há framework de teste configurado. Teste manualmente via `curl` ou pelo frontend.
8. **Schedule Form — dias da semana**: As chaves são `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`. Os labels em português (`Segunda`, `Terça`, etc.) são só para exibição.
9. **Tabs mobile**: A barra de tabs é scrollável horizontalmente (`overflow-x-auto scrollbar-hide`). Botões têm `flex-shrink-0` e `whitespace-nowrap`.
10. **NVS ESP32**: O namespace `"schedules"` é limpo e regravado a cada sync. Não acumula lixo.

---

## 🚀 Fluxo de deploy completo (checklist)

1. Mosquitto rodando: `systemctl status mosquitto`
2. `.env` configurado: `MQTT_MODE=real`, `MQTT_BROKER=<ip>`
3. Backend no Docker: `docker compose up -d --build`
4. Frontend deploy: `npm run deploy`
5. Nginx reload: `sudo nginx -t && sudo systemctl reload nginx`
6. ESP32 flashado com Wi-Fi + broker IP configurados
7. Verificar: `curl http://localhost:8085/api/time`
8. Verificar health: `docker inspect greenhouse-backend | grep Health`
