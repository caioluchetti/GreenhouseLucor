# Tatufa

> *Tatufa* — do português "tatu" (armadillo). 🛡️ Pequeno blindado da nossa horta.

Painel de controle completo de estufa com visual Solarpunk. Controla irrigação (3 zonas), climatização (exaustor), iluminação (grow light) e monitoramento de temperatura/umidade dentro e fora da estufa. Tudo via ESP32 + MQTT, com **modo autônomo local** que funciona mesmo sem internet ou servidor.

---

## 🏗️ Arquitetura

```
┌──────────────┐     HTTP (8085)     ┌──────────────────────────────────┐
│   Browser    │ ◄─────────────────► │  Nginx :8085                     │
│  (Dashboard) │                     │  ├─ static files (React/Vite)     │
└──────────────┘                     │  └─ /api/* proxy → :6001          │
                                     └──────────────┬───────────────────┘
                                                    │
                                     ┌──────────────▼───────────────────┐
                                     │  FastAPI :6001 (Docker)          │
                                     │  ├─ REST API                     │
                                     │  ├─ Scheduler (irrigação)        │
                                     │  ├─ Climate control (exaustor)   │
                                     │  ├─ Light control                │
                                     │  ├─ Sensor history (SQLite)      │
                                     │  └─ ONNX ML (futuro)             │
                                     └──────────────┬───────────────────┘
                                                    │ MQTT
                                     ┌──────────────▼───────────────────┐
                                     │  Mosquitto :1883 (MQTT Broker)   │
                                     └──────────────┬───────────────────┘
                                                    │ MQTT (Wi-Fi)
                                     ┌──────────────▼───────────────────┐
                                     │  ESP32 DevKit (modo autônomo)    │
                                     │  ├─ 3x Relé irrigação (zonas)   │
                                     │  ├─ 1x Relé exaustor (clima)    │
                                     │  ├─ 1x Relé grow light (luz)    │
                                     │  ├─ DHT22 — temp/umid DENTRO    │
                                     │  └─ DHT11 — temp/umid FORA      │
                                     └──────────────────────────────────┘
```

O backend roda em **modo mock** (sensores simulados, sem hardware) para desenvolvimento, ou **modo real** conectando ao broker MQTT + ESP32.

---

## 📦 Hardware — Parte 1 (atual, funcionando)

### Componentes

| Componente | Qtd | Finalidade |
|---|---|---|
| **ESP32 DevKit** (30 pinos) | 1 | Microcontrolador Wi-Fi — cérebro da estufa |
| **Módulo Relé 5V 4 canais** | 1 | Acionar bombas/válvulas (3 zonas de irrigação) |
| **Módulo Relé 5V 2 canais** | 1 | Exaustor + Grow Light |
| **DHT22** | 1 | Temperatura + umidade dentro da estufa |
| **DHT11** (pode ser antigo) | 1 | Temperatura + umidade fora da estufa |
| **Fonte chaveada 5V 3A** | 1 | Alimentar ESP32 + relés + sensores |
| **Fonte chaveada 12V** (opcional) | 1 | Válvulas solenoides / bombas (se usar 12V) |
| **Resistor 2.2KΩ** (1/4W) | 1 | Pull-up do DHT11 externo (cabo longo) |
| **Jumpers, protoboard, fios** | - | Conexões |

> ⚠️ **DHT11 externo com cabo longo (~10-15m):** O resistor pull-up de **2.2KΩ** (em vez do padrão 10KΩ) é obrigatório pra o sinal sobreviver ao cabo. Use cabo de par trançado (sobra de cabo de rede) e **não passe o fio de dados junto com fios de 220V ou relé**.

---

## 🔌 Pinagem Completa — ESP32

```
ESP32 DevKit (30 pinos)         Componentes
────────────────────────        ──────────────────────────────────
GPIO 26  ───────────────────►   IN1 — Relé Zona 1 (irrigação)
GPIO 27  ───────────────────►   IN2 — Relé Zona 2 (irrigação)
GPIO 14  ───────────────────►   IN3 — Relé Zona 3 (irrigação)
GPIO 25  ───────────────────►   IN4 — Relé Exaustor (clima)
GPIO 33  ───────────────────►   IN1 — Relé Grow Light (2º módulo)

GPIO 15  ───────────────────►   DHT22 DATA (dentro, cabo curto)
GPIO 4   ───────────────────►   DHT11 DATA (fora, cabo ~15m)

VIN (5V) ───────────────────►   VCC de TODOS os relés + DHT22/11
GND      ───────────────────►   GND de TODOS os relés + DHT22/11

           ┌── resistor 2.2KΩ ──┐
GPIO 4 ────┤                    ├─── VCC (3.3V ou 5V)
           └── DHT11 DATA ──────┘
```

### Diagrama de ligação

```
                    ┌─────────────────────────────────────────┐
                    │              ESP32 DevKit                │
                    │                                          │
   Fonte 5V 3A ────┤ VIN (5V)                                 │
   Fonte 5V 3A ────┤ GND                                      │
                    │                                          │
   GPIO26 ─────────┤─────────── IN1 ┐                          │
   GPIO27 ─────────┤─────────── IN2 │ Módulo Relé 4ch          │
   GPIO14 ─────────┤─────────── IN3 │ (Irrigação)              │
   GPIO25 ─────────┤───────┐   IN4 ┘                          │
                    │       │                                   │
   GPIO33 ─────────┤───┐   │   ┌── IN1 ─── Grow Light         │
                    │   │   └───┤  Módulo Relé 2ch              │
   GPIO15 ─────────┤───┼───────┼── DHT22 DATA (dentro)         │
                    │   │       │  VCC ─── 5V                  │
   GPIO4  ─────────┤───┼───────┼── 2.2KΩ ─── 5V               │
                    │   │       └── DHT11 DATA (fora, 15m)     │
                    │   │                                       │
   GND ────────────┴───┴─────── GND comum (todos módulos)      │
                    └─────────────────────────────────────────┘

   POTÊNCIA (lado de alta dos relés):
   Fonte 12V (+) ─── COM (relé) ─── NO ─── Bomba/Válvula ─── GND 12V
   ou 110/220V conforme a carga
```

### Alimentação — Fonte Chaveada

```
Fonte Chaveada 5V 3A (PRINCIPAL)
├── ESP32 VIN + GND
├── Relé 4ch VCC + GND
├── Relé 2ch VCC + GND
├── DHT22 VCC + GND
└── DHT11 VCC + GND (via cabo longo)

Fonte Chaveada 12V (separada, opcional)
└── COM/NO dos relés para bombas e válvulas

⚠️  NUNCA conecte 12V no pino VIN do ESP32 — ele queima.
⚠️  O GND da fonte 5V e da fonte 12V devem ser COMUNS (conectados entre si).
⚠️  Se seus relés forem active-LOW, verifique o #define RELAY_ON no firmware.
⚠️  A fonte 5V 3A é suficiente para ESP32 (~300mA) + 5 relés (~75mA cada) +
    DHT22 (~2mA) + DHT11 (~2mA) = sobra mais de 2A de folga.
```

---

## 📡 Tópicos MQTT — Referência Completa

### Sensores (ESP32 → Broker, a cada 30s)

| Tópico | Payload | Descrição |
|---|---|---|
| `greenhouse/sensor/inside/temperature` | `"24.5"` | Temperatura dentro da estufa (°C) |
| `greenhouse/sensor/inside/humidity` | `"65.0"` | Umidade dentro da estufa (%) |
| `greenhouse/sensor/outside/temperature` | `"18.2"` | Temperatura fora da estufa (°C) |
| `greenhouse/sensor/outside/humidity` | `"72.0"` | Umidade fora da estufa (%) |

### Zonas de Irrigação (bidirecional)

| Tópico | Direção | Payload | Descrição |
|---|---|---|---|
| `greenhouse/zone1/command` | Broker → ESP | `ON` / `OFF` | Comando liga/desliga zona 1 |
| `greenhouse/zone2/command` | Broker → ESP | `ON` / `OFF` | Comando liga/desliga zona 2 |
| `greenhouse/zone3/command` | Broker → ESP | `ON` / `OFF` | Comando liga/desliga zona 3 |
| `greenhouse/zone1/state` | ESP → Broker | `ON` / `OFF` | Estado atual zona 1 |
| `greenhouse/zone2/state` | ESP → Broker | `ON` / `OFF` | Estado atual zona 2 |
| `greenhouse/zone3/state` | ESP → Broker | `ON` / `OFF` | Estado atual zona 3 |
| `greenhouse/irrigation/started` | ESP → Broker | `{"zone":1,"duration":5}` | Irrigação iniciada (modo autônomo) |
| `greenhouse/irrigation/stopped` | ESP → Broker | `"1"` | Irrigação finalizada (modo autônomo) |
| `greenhouse/zone1/remaining` | ESP → Broker | `"120"` | Segundos restantes (modo autônomo) |

### Climatização (bidirecional)

| Tópico | Direção | Payload | Descrição |
|---|---|---|---|
| `greenhouse/climate/status` | ESP → Broker | `{"fan":"on","mode":"auto","temp":"28.5","hum":"60.0"}` | Status do exaustor |
| `greenhouse/climate/fan/cmd` | Broker → ESP | `{"mode":"auto"}` ou `"on"` ou `"off"` | Modo do exaustor |
| `greenhouse/climate/thresholds` | Broker → ESP | `{"temp_high":30,"temp_low":28}` | Limiares de temperatura |
| `greenhouse/climate/request` | ESP → Broker | `"{}"` | ESP solicita thresholds no boot |

### Iluminação (bidirecional)

| Tópico | Direção | Payload | Descrição |
|---|---|---|---|
| `greenhouse/light/cmd` | Broker → ESP | `ON` / `OFF` | Comando grow light |
| `greenhouse/light/status` | ESP → Broker | `ON` / `OFF` | Estado atual grow light |

### Sistema (ESP32 → Broker)

| Tópico | Payload | Descrição |
|---|---|---|
| `greenhouse/status` | `"online"` | Heartbeat (a cada 30s) |
| `greenhouse/schedules/request` | `"{}"` | ESP solicita sync de schedules no boot/reconnect |
| `greenhouse/schedules/sync` | `[{...}, ...]` | Backend envia lista completa de schedules (JSON array) |

---

## 🤖 Modo Autônomo — Como Funciona

O ESP32 **não depende do servidor** para irrigar. Tudo roda localmente:

| Mecanismo | Descrição |
|---|---|
| **NTP** (`configTime`) | Sincroniza hora com `pool.ntp.org` + `a.st1.ntp.br` no boot, re-sincroniza a cada 24h |
| **NVS (Preferences)** | Schedules salvos em flash — sobrevivem a reboot e queda de energia |
| **Scheduler local** | Loop a cada 10s: compara dia/hora atual com schedules do NVS → aciona relé direto |
| **Countdown local** | Timer decremental por zona — desliga relé automaticamente quando acaba o tempo |
| **MQTT sync** | No boot/reconnect → publica `greenhouse/schedules/request` → backend responde com lista completa → salva no NVS |

```
COM INTERNET:
  ESP32 ←── NTP (hora certa)
  ESP32 ←── MQTT schedules/sync (lista do backend)
  ESP32 ──► MQTT sensores + status (dashboard atualiza)

SEM INTERNET:
  ESP32 ─── NTP (já sincronizado, mantém hora interna)
  ESP32 ─── NVS schedules (salvos localmente)
  ESP32 ─── Aciona relés por conta própria ✅
  Dashboard ─── offline (sem dados novos, mas irrigação continua)
```

Toda vez que você cria, edita ou deleta um agendamento pelo frontend, o backend publica automaticamente a lista atualizada no tópico `greenhouse/schedules/sync` — o ESP32 recebe e salva no NVS.

---

## 🔧 Firmware ESP32

O firmware completo está em `esp32-firmware/greenhouse_lucor_esp32.ino`.

### Bibliotecas necessárias (Arduino IDE Library Manager)

| Biblioteca | Propósito |
|---|---|
| **PubSubClient** (Nick O'Leary) | MQTT |
| **DHT sensor library** (Adafruit) | Leitura DHT22/DHT11 |
| **ArduinoJson** (Benoit Blanchon) | Parse JSON (thresholds, schedules) |
| **Preferences** (built-in) | Armazenamento NVS |
| **WiFi** (built-in) | Conexão Wi-Fi |
| **time.h** (built-in) | NTP |

### Configuração antes de gravar

Abra o arquivo `.ino` e edite as 3 linhas no topo:

```cpp
const char* WIFI_SSID     = "NOME_DA_SUA_REDE";
const char* WIFI_PASS     = "SENHA_DA_SUA_REDE";
const char* MQTT_BROKER   = "192.168.1.100";   // IP do servidor onde roda o backend
```

### Lógica dos relés (active-LOW vs active-HIGH)

A maioria dos módulos de relé 5V é **active-LOW** (LOW = ligado). Se o seu for active-HIGH, troque no firmware:

```cpp
#define RELAY_ON    LOW    // se active-LOW
#define RELAY_ON    HIGH   // se active-HIGH
```

---

## 🖥️ Backend

### Pré-requisitos

- Docker + Docker Compose
- Nginx (para servir o frontend)
- Mosquitto (broker MQTT)
- Python 3.12+ (para desenvolvimento local)

### Subir o backend (Docker)

```bash
cd GreenhouseLucor

# Construir e iniciar
docker compose up -d --build

# Verificar se está saudável
docker inspect --format='{{.State.Health.Status}}' greenhouse-backend
# Deve retornar: healthy
```

O container `greenhouse-backend` é configurado com:
- **restart: unless-stopped** — reinicia sozinho se cair
- **healthcheck** — monitora se a API responde
- **volume persistente** — SQLite sobrevive a recriações do container

### Deploy do frontend

```bash
npm run deploy    # build + copia para /var/www/greenhouse-lucor/
```

O Nginx escuta na **porta 8085** e faz proxy de `/api/*` para `localhost:6001`.

### Desenvolvimento local (modo mock, sem hardware)

```bash
npm run dev       # inicia frontend (Vite) + backend (mock) juntos
```

Com `MQTT_MODE=mock`, os sensores simulam valores aleatórios — não precisa de ESP32 nem broker MQTT.

---

## 🗄️ Banco de Dados (SQLite)

Arquivo: `api/data/greenhouse.db` (persiste via volume Docker)

| Tabela | Colunas | Descrição |
|---|---|---|
| `schedules` | id, zone_id, target_type, days, time, duration, enabled | Agendamentos de irrigação/luz |
| `zone_names` | id, zone_id, name, icon | Nomes e emojis customizados por zona |
| `climate_rules` | id, temp_high, temp_low, hum_high, hum_low, fan_mode | Limiares do exaustor |
| `light_state` | id, state | Estado persistente da grow light |
| `sensor_history` | id, source, metric, value, recorded_at | Histórico de sensores (gráficos) |

---

## 🖥️ Frontend — Páginas

| Tab | Conteúdo |
|---|---|
| 🌱 **Dashboard** | 3 cards de zona (ON/OFF, timer irrigação, próxima rega) + sensores dentro/fora |
| ⏰ **Agendamentos** | CRUD de schedules por zona/luz, dias da semana, horário, duração |
| 🌡️ **Clima** | Controle do exaustor (Auto/On/Off), thresholds de temperatura, grow light |
| 📊 **Histórico** | Gráficos de temperatura e umidade (dentro vs fora), seletor 24h/7d/30d |

---

## 📦 Hardware — Parte 2 (Spider Cam + Timelapse, futuro)

Esta seção descreve a **segunda fase do projeto**: câmera suspensa motorizada com 3 posições de timelapse, 10 pontos de inspeção, e detecção de doenças por ML (TFLite on-device no ESP32-P4).

### Arquitetura — Divisão física

```
SPIDER CAM (pendurada)
┌─────────────────────────────────────┐
│  DevModule M3 (P4 + C6 onboard)     │
│  ├─ P4: TFLite inference            │
│  ├─ P4: MIPI CSI camera             │
│  ├─ C6: Wi-Fi 6 → backend (HTTP)    │
│  └─ C6: MQTT → broker (comandos)    │
│            │ I2C (fio curto)        │
│  ┌─────────▼──────────┐             │
│  │   Arduino Nano      │             │
│  │   servo pan + tilt  │             │
│  └─────────────────────┘             │
└─────────────────────────────────────┘

CABINET (fixa no chão/prateleira)
┌─────────────────────────────────────┐
│  ESP32 DevKit (relé já existente)   │
│  ├─ MQTT ← backend                  │
│  ├─ MQTT: greenhouse/camera/move/*  │
│  └─ I2C → Uno                       │
│           │ I2C (fio curto)         │
│  ┌────────▼──────────┐              │
│  │   Arduino Uno      │              │
│  │   CNC Shield V3    │              │
│  │   4x A4988/DRV8825 │              │
│  │   4x NEMA 17       │              │
│  └────────────────────┘              │
└─────────────────────────────────────┘
```

**O P4 NÃO é intermediário na cadeia de movimento.** O gantry é controlado diretamente pelo ESP32 do cabinet via MQTT. O P4 só se preocupa com visão e inferência.

### Matriz de comunicação

| Evento | Origem | Meio | Destino | Latência |
|---|---|---|---|---|
| Gantry move | Backend / P4 | MQTT | ESP32 (cabinet) → Uno → steppers | ~50ms + motor |
| Camera aim | P4 | I2C | Nano → servos | <1ms + 300ms servo |
| Frame upload | P4 | HTTPS POST | DDNS → Backend → /api/camera/frame | ~200ms |
| Inferência TFLite | P4 | on-device | — | ~50-300ms |
| Resultado ML | P4 | HTTPS POST | Backend | ~200ms |
| Heartbeat | P4 | MQTT | Backend | ~50ms |

### Componentes — Spider Cam (pendurada)

| Componente | Qtd | Finalidade |
|---|---|---|
| **DevModule M3** (P4 + C6 onboard) | 1 | Cérebro: TFLite + câmera MIPI + Wi-Fi 6 |
| **Arduino Nano** | 1 | Controle servo pan/tilt (I2C slave do P4) |
| **Servo MG996R** (ou similar) | 2 | Pan e tilt da câmera |
| **Fonte 5V 2A** (step-down do 12V do cabinet) | 1 | Alimentar P4 + Nano + servos |
| **Cabo trançado 4 vias** (I2C) | 30cm | P4 ↔ Nano |
| **Cabo trançado 2 vias** (alimentação) | ~cabos da suspensão | Power do cabinet → spider cam |

### Componentes — Cabinet (fixa)

| Componente | Qtd | Finalidade |
|---|---|---|
| **ESP32 DevKit** (já existente — relay) | 1 | Recebe comandos MQTT → I2C → Uno |
| **Arduino Uno** | 1 | Cinemática inversa + AccelStepper |
| **CNC Shield V3** | 1 | Shield para 4 drivers |
| **Driver A4988 ou DRV8825** | 4 | Controle individual dos NEMA 17 |
| **NEMA 17 stepper motor** | 4 | Motores nos 4 cantos da estufa |
| **Fonte chaveada 12V 10A** | 1 | Alimentar 4 motores + Uno/ESP32 + spider cam |
| **Step-down LM2596** (12V→5V) | 1 | Derivar 5V para alimentar spider cam |
| **Cooler 40mm 12V** | 1 | Resfriar drivers durante movimento |
| **Dissipador A4988** adesivo | 8 | Drivers esquentam muito |

### Componentes — Mecânicos

| Componente | Qtd | Finalidade |
|---|---|---|
| Cabo de aço 0.6mm revestido nylon | 20m | Cabos de suspensão |
| Roldanas GT2 lisas com rolamento | 8 | Guias nos cantos |
| Acoplador flexível 5mm → eixo NEMA | 4 | Fixa carretel no motor |
| Carretel (spool 15-20mm) | 4 | Enrola cabo |
| Cantoneira L 50mm com furos | 8 | Fixar motores + roldanas no teto |
| Kit parafusos M3 + porcas | 1 | Fixação geral |
| Placa acrílica 10x10cm | 1 | Suporte da câmera no centro |
| Abraçadeira nylon 100mm | 20 | Organização de cabos |
| Eletroduto corrugado 10mm | 2m | Conduíte para fios dos motores |

### Cinemática Inversa (roda no Arduino Uno)

4 motores nos cantos do teto, cabos convergindo para a câmera central:

```
L_i(x, y, z) = raiz( (x - Mx_i)² + (y - My_i)² + (z - H)² )

Onde i = 0..3:
  M0 = (0,   0,   H)     // canto inferior esquerdo
  M1 = (W,   0,   H)     // canto inferior direito
  M2 = (W,   L,   H)     // canto superior direito
  M3 = (0,   L,   H)     // canto superior esquerdo

  W = largura estufa (cm)
  L = comprimento estufa (cm)
  H = altura do teto (cm)
  (x, y, z) = posição desejada da câmera (z < H)
```

O Uno recebe coordenadas `{"x":45,"y":30,"z":-50}` via I2C do ESP32 (cabinet), calcula os 4 comprimentos de cabo, converte para passos, e move os 4 motores simultaneamente com AccelStepper.

### Tópicos MQTT — Spider Cam + Timelapse

| Tópico | Direção | Payload | Descrição |
|---|---|---|---|
| `greenhouse/camera/move` | Broker → ESP32 (cabinet) | `{"x":45,"y":30,"z":-50}` | Move gantry para coordenadas |
| `greenhouse/camera/move/position/{1..3}` | Broker → ESP32 (cabinet) | `{"x":45}"` | Move para posição pré-definida do timelapse |
| `greenhouse/camera/arrived` | ESP32 (cabinet) → Broker | `"1"` | Gantry chegou na posição |
| `greenhouse/camera/stop` | Broker → ESP32 (cabinet) | `"1"` | Parada de emergência |
| `greenhouse/camera/status` | ESP32 (cabinet) → Broker | `"idle"\|"moving"\|"error"` | Estado do gantry |
| `greenhouse/camera/capture` | Broker → P4 | `"1"` | Tira foto manual |
| `greenhouse/camera/inspect` | Broker → P4 | `"1"` | Inicia rotina completa de inspeção (10 pontos) |
| `greenhouse/camera/result` | P4 → Broker | `{"pos":3,"label":"blight","confidence":0.87}` | Resultado da inferência |
| `greenhouse/camera/timelapse/start` | Broker → P4 | `"1"` | Inicia timelapse automático |
| `greenhouse/camera/frame` | P4 → Backend (HTTP POST) | JPEG bytes | Upload de frame (mesmo endpoint da câmera fixa) |

> **Nota**: `greenhouse/camera/frame` usa HTTP POST, não MQTT. É o mesmo endpoint `/api/camera/frame` que a câmera fixa (ESP32-CAM) já usa. O P4 também publica frames via MQTT no mesmo formato se desejar stream contínua, mas a rota HTTP já está pronta.

### Fluxo — Timelapse (3 posições, autônomo)

```
1. P4 scheduler interno dispara a cada N minutos
2. P4 publica MQTT → greenhouse/camera/move/position/1
3. ESP32 (cabinet) move gantry → publica greenhouse/camera/arrived
4. P4 recebe "arrived" → I2C → Nano → servos enquadram
5. P4 captura MIPI CSI → HTTPS POST /api/camera/frame
6. P4 publica MQTT → greenhouse/camera/move/position/2
7. Repete passos 2-5 para posições 2 e 3
8. Aguarda intervalo → reinicia ciclo
```

### Fluxo — Inspeção de doenças (10 pontos, sob demanda)

```
1. Usuário clica "Inspecionar" no dashboard → POST /api/camera/inspect
2. Backend publica MQTT → greenhouse/camera/inspect
3. P4 itera sobre 10 posições pré-definidas:
   a. P4 publica MQTT → greenhouse/camera/move {"x":x_i,"y":y_i,"z":z_i}
   b. Aguarda greenhouse/camera/arrived
   c. I2C → Nano → servos enquadram
   d. Captura MIPI CSI → roda TFLite (MobileNet quantizado int8)
   e. Publica resultado → greenhouse/camera/result
4. Backend salva cada resultado → frontend mostra grade de diagnósticos
```

### TFLite on-device (ESP32-P4)

| Aspecto | Valor |
|---|---|
| Framework | TensorFlow Lite Micro + ESP-NN |
| Modelo | MobileNetV2 ou MobileNetV3-Small |
| Tamanho | ~200-500KB (int8 quantizado) |
| Entrada | 224×224×3, crop do frame MIPI |
| Saída | Vetor de probabilidades (classes de doença) |
| Dataset de treino | PlantVillage + capturas próprias da estufa |
| Latência | ~50-300ms por inferência (acelerador ESP-NN) |

### Custo estimado da Parte 2

| Categoria | Valor (R$) |
|---|---|
| Spider Cam (P4+C6 dev module + Nano + servos) | 120-160 |
| Cabinet (Uno + CNC Shield + 4x drivers + 4x NEMA 17) | 250-350 |
| Mecânica (cabos, roldanas, cantoneiras, parafusos etc.) | 160-230 |
| **Total** | **530-740** |

---

## 🚀 Deploy Completo

### 1. Mosquitto (broker MQTT com TLS)

```bash
# Instalar
apt install -y mosquitto mosquitto-clients

# Gerar certificado TLS auto-assinado
mkdir -p /etc/mosquitto/certs
openssl req -new -x509 -days 3650 -nodes \
  -out /etc/mosquitto/certs/server.crt \
  -keyout /etc/mosquitto/certs/server.key \
  -subj "/CN=greenhousemqtt.cortada-server.ddns.net"
chmod 644 /etc/mosquitto/certs/server.crt
chmod 600 /etc/mosquitto/certs/server.key
chown mosquitto:mosquitto /etc/mosquitto/certs/server.key

# Extrair fingerprint (vai no código do ESP32)
openssl x509 -in /etc/mosquitto/certs/server.crt -sha1 -fingerprint -noout

# Configurar (já feito em /etc/mosquitto/conf.d/greenhouse.conf):
#   listener 1883 localhost         → backend conecta aqui (sem TLS)
#   listener 8883 0.0.0.0          → ESP32 conecta aqui (com TLS)
```

Criar `/etc/mosquitto/conf.d/greenhouse.conf`:
```ini
listener 1883 localhost
allow_anonymous true

listener 8883 0.0.0.0
cafile /etc/mosquitto/certs/server.crt
certfile /etc/mosquitto/certs/server.crt
keyfile /etc/mosquitto/certs/server.key
require_certificate false
allow_anonymous true
```

```bash
# Criar diretórios e iniciar
mkdir -p /run/mosquitto /var/log/mosquitto
chown mosquitto:mosquitto /run/mosquitto /var/log/mosquitto
/usr/sbin/mosquitto -c /etc/mosquitto/mosquitto.conf -d

# Firewall
iptables -A INPUT -p tcp --dport 8883 -j ACCEPT

# Port forward no roteador: 8883 TCP → 192.168.15.25:8883
```

### 2. Backend (Docker)

```bash
cd GreenhouseLucor
# .env já configurado: MQTT_MODE=real, MQTT_BROKER=localhost
docker compose up -d --build
```

### 3. Frontend (Nginx)

```bash
npm run deploy                    # build + copia dist/
sudo cp greenhouse-lucor.nginx.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 4. ESP32 (principal — relés + sensores)

1. Abra `esp32-firmware/greenhouse_lucor_esp32.ino` no Arduino IDE
2. Configure seu Wi-Fi:
   ```cpp
   const char* WIFI_SSID = "SEU_WIFI";   // ← trocar
   const char* WIFI_PASS = "SUA_SENHA";   // ← trocar
   ```
3. O broker MQTT e fingerprint TLS já estão configurados:
   ```cpp
   const char* MQTT_BROKER = "greenhousemqtt.cortada-server.ddns.net";
   const int   MQTT_PORT   = 8883;
   ```
4. **Bibliotecas necessárias** (Library Manager):
   - PubSubClient (Nick O'Leary)
   - DHT sensor library (Adafruit)
   - ArduinoJson (Benoit Blanchon)
5. Board: `esp32dev`, Flash: 4MB
6. Conecte o ESP32 via USB, selecione a porta, clique Upload
7. Serial Monitor (115200 baud) — deve mostrar:
   ```
   WiFi OK
   IP: 192.168.x.x
   [TLS] Fingerprint verification enabled
   MQTT connect... OK
   [NTP] Synced: ...
   ```

### 5. ESP32-CAM (câmera fixa de overview)

1. Abra `esp32-firmware/greenhouse_cam_esp32cam.ino` no Arduino IDE
2. Configure seu Wi-Fi (mesmo do passo 4)
3. O broker MQTT e TLS já estão configurados
4. **Bibliotecas necessárias**:
   - PubSubClient (Nick O'Leary)
5. Board: **AI Thinker ESP32-CAM**, Flash: 4MB, Partition Scheme: `Huge APP`
6. Conecte o ESP32-CAM via USB (precisa de adaptador FTDI ou placa programmer)
7. Serial Monitor (115200 baud) — deve mostrar:
   ```
   WiFi OK
   IP: 192.168.x.x
   [TLS] Fingerprint verification enabled
   [HTTP] Server started on :80
   MQTT... OK
   ```
8. O dashboard mostrará a câmera automaticamente quando o ESP32-CAM publicar seu status

### 6. Verificar tudo

```bash
# Backend
curl http://localhost:6001/api/time

# Frontend via Nginx
curl http://localhost:8085/

# Container saudável
docker inspect --format='{{.State.Health.Status}}' greenhouse-backend

# Testar MQTT local
mosquitto_sub -h localhost -t 'greenhouse/#' -v

# Testar MQTT remoto (de outra máquina com acesso ao DNS)
mosquitto_sub -h greenhousemqtt.cortada-server.ddns.net -p 8883 --insecure -t 'greenhouse/status' -v
```

---

## 📋 Checklist de Primeira Conexão

- [ ] Mosquitto rodando: `ss -tlnp | grep mosquitto` (portas 1883 e 8883)
- [ ] Port forward 8883 configurado no roteador (TCP → 192.168.15.25:8883)
- [ ] `.env` com `MQTT_MODE=real`
- [ ] Backend rodando: `docker compose up -d`
- [ ] Nginx servindo na porta 8085
- [ ] ESP32 principal flashado com Wi-Fi correto
- [ ] ESP32-CAM flashado com Wi-Fi correto
- [ ] Ambos ESP32 ligados na tomada (alimentação 5V)
- [ ] Acessar `http://<ip>:8085` — indicador ESP32 verde (online)
- [ ] Dashboard mostra stream da câmera fixa (ESP32-CAM)
- [ ] Sensores aparecendo com valores numéricos (não `--`)
- [ ] Testar acionamento de zona pelo dashboard
- [ ] Criar agendamento e verificar disparo no horário
- [ ] Desligar Wi-Fi do servidor → ESP32 continua irrigando (modo autônomo)

---

## 📂 Estrutura do Projeto

```
GreenhouseLucor/
├── api/
│   ├── server.py              # FastAPI (porta 6001)
│   ├── mqtt_client.py         # Cliente MQTT (Mock + Real)
│   ├── scheduler.py           # Agendador de irrigação
│   ├── database.py            # SQLite + 5 tabelas
│   ├── models.py              # Schemas Pydantic
│   ├── requirements.txt       # Dependências Python
│   ├── Dockerfile             # Imagem Docker do backend
│   └── data/                  # SQLite (volume persistente)
├── src/
│   ├── App.jsx                # Root com 4 tabs + polling
│   ├── index.css              # Design system Solarpunk
│   └── components/
│       ├── Dashboard.jsx      # Cards de zona + sensores
│       ├── ZoneCard.jsx       # Card individual (ON/OFF, timer, rename)
│       ├── SensorPanel.jsx    # Sensores dentro/fora
│       ├── SensorCharts.jsx   # Gráficos Chart.js (histórico)
│       ├── ScheduleList.jsx   # Lista de agendamentos
│       ├── ScheduleForm.jsx   # Modal criar/editar schedule
│       ├── ClimatePanel.jsx   # Clima (fan, thresholds, luz)
│       └── StatusBar.jsx      # Header com status + tema + hora
├── esp32-firmware/
│   └── greenhouse_lucor_esp32.ino  # Firmware autônomo completo
├── docker-compose.yml         # Stack Docker (backend)
├── greenhouse-lucor.nginx.conf # Config Nginx (porta 8085)
├── greenhouse-backend.service  # systemd unit (alternativa ao Docker)
├── deploy.sh                  # Script de deploy do frontend
├── .env                        # Variáveis de ambiente
├── index.html                  # Entry point Vite
├── vite.config.js
└── package.json
```

---

## 🛠️ Comandos Úteis

```bash
# Desenvolvimento
npm run dev              # Frontend + backend (mock mode)
npm run dev:frontend     # Apenas Vite
npm run dev:backend      # Apenas backend Python

# Produção
npm run build            # Build Vite
npm run deploy           # Build + copia para /var/www/greenhouse-lucor/
npm run preview          # Preview local do build

# Docker
docker compose up -d     # Iniciar backend
docker compose down      # Parar backend
docker compose logs -f   # Logs em tempo real
docker compose build     # Reconstruir imagem
docker restart greenhouse-backend  # Reiniciar container

# MQTT (debug)
mosquitto_sub -h localhost -t 'greenhouse/#' -v   # Ouvir tudo
mosquitto_pub -h localhost -t greenhouse/zone1/command -m ON  # Teste manual
```
