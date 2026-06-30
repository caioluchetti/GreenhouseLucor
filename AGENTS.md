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
- **Hardware**: ESP32 DevKit com 5 relés, DHT22 (dentro), DHT11 (fora)
- **Comunicação**: Frontend↔Backend via HTTP REST, Backend↔ESP32 via MQTT
- **Design system**: Solarpunk/glassmorphism definido por CSS variables em `src/index.css`

---

## 📂 Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/App.jsx` | Root: 4 tabs, estado global, polling, todos os callbacks |
| `src/index.css` | Design system completo (~460 linhas): variáveis CSS, tema dark/light, animações |
| `src/components/Dashboard.jsx` | Grid de 3 ZoneCards + SensorPanel, calcula próxima rega |
| `src/components/ZoneCard.jsx` | Card de zona: ON/OFF toggle, timer irrigação, rename, emoji edit |
| `src/components/SensorPanel.jsx` | 4 cards: temp/umid dentro e fora da estufa |
| `src/components/SensorCharts.jsx` | Gráficos Chart.js: temperatura + umidade, períodos 1h/24h/7d/30d, botão limpar |
| `src/components/ScheduleList.jsx` | Lista de agendamentos por zona/luz, toggle enable, CRUD |
| `src/components/ScheduleForm.jsx` | Modal criar/editar schedule: zona/luz, dias, hora, duração |
| `src/components/ClimatePanel.jsx` | Controle de exaustor (auto/on/off), thresholds temp, grow light |
| `src/components/StatusBar.jsx` | Header: título "TATUFA", toggle tema ☀️/🌙, status ESP, relógio |
| `api/server.py` | FastAPI app: 18 endpoints REST, lifespan (MQTT+scheduler+histórico) |
| `api/models.py` | Schemas Pydantic: zonas, sensores, schedules, clima, luz, histórico |
| `api/database.py` | SQLAlchemy ORM: 5 tabelas, auto-migration, seed data, auto-cleanup |
| `api/mqtt_client.py` | `MockMQTT` (dev) + `RealMQTT` (prod): sensores, zones, clima, luz |
| `api/scheduler.py` | Agendador: loop a cada 5s, dias em inglês (hardcoded), remaining dinâmico |
| `esp32-firmware/greenhouse_lucor_esp32.ino` | Firmware ESP32 autônomo: NTP, NVS, scheduler local, MQTT |
| `docker-compose.yml` | Stack Docker do backend (container único) |
| `greenhouse-lucor.nginx.conf` | Config Nginx: porta 8085, proxy /api/* → :6001 |
| `deploy.sh` | Script de deploy: build frontend + copia dist + instala nginx config |

---

## 🛠️ Comandos

```bash
# Desenvolvimento
npm run dev              # Frontend (Vite) + backend (mock) — não precisa de hardware
npm run dev:frontend     # Só Vite
npm run dev:backend      # Só backend Python (MQTT_MODE=mock)

# Build & Deploy
npm run build            # Vite → dist/
npm run deploy           # build + cp dist/* → /var/www/greenhouse-lucor/
npm run preview          # Preview local do build (sem backend)

# Docker (backend)
docker compose up -d --build   # Build + start
docker compose logs -f          # Logs em tempo real
docker restart greenhouse-backend   # Reiniciar
docker inspect --format='{{.State.Health.Status}}' greenhouse-backend  # healthcheck
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
```

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

### Bibliotecas Arduino necessárias

- **PubSubClient** (Nick O'Leary) — MQTT
- **DHT sensor library** (Adafruit) — DHT22/DHT11
- **ArduinoJson** (Benoit Blanchon) — parse JSON
- **Preferences** (built-in) — NVS
- **WiFi** (built-in)
- **time.h** (built-in) — NTP

Board: `esp32dev`, framework: `arduino`

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
- **Pinos GPIO**: 26, 27, 14 = irrigação / 25 = exaustor / 33 = luz / 15 = DHT22 / 4 = DHT11
- **MQTT buffer**: 4096 bytes (para receber array JSON de schedules)
- **NVS namespaces**: `"climate"`, `"schedules"` (não colidir)

---

## ⚠️ Gotchas

1. **Dias da semana**: Sempre em inglês (`mon`/`tue`/`wed`...). O locale não é mais usado.
2. **DHT11 externo**: Usa GPIO 4 com resistor pull-up de **2.2KΩ** (cabo longo). Sinal pode falhar — considerar DS18B20 como fallback.
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
