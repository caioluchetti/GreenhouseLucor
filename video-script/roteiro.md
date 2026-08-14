# Roteiro — "Eu entreguei minha horta pra um ESP32 (e ele me superou)"

> **Estilo:** Michael Reeves / Tom Scott — maker nerd caótico
> **Duração estimada:** ~10–12 min
> **Idioma:** PT-BR
> **Tom:** leve, auto-depreciativo, over-engineered, cortes rápidos, B-roll agressivo

---

## LEGENDA DE SÍMBOLOS

- 🎬 = corte / mudança de take
- 📹 = B-roll (timelapse, close, screen recording)
- 🗣 = fala do apresentador (on-camera)
- 🔊 = voice-over (off)
- 💻 = screen recording / overlay de código
- 🎵 = sugestão de música
- 📝 = overlay de texto na tela
- 😬 = beat / gag visual

---

## 0:00 — COLD OPEN (caótico, antes do título)

🎵 *lo-fi nada a ver, cortada abruptamente*

📹 Close na placa ESP32 ligada, LEDs piscando, com um fiapo de fio encostando nela.
📹 Timelapse acelerada da estufa sendo montada (as que você já tem).

🗣 *(on-camera, cara de quem dormiu 4h)*:

> "Eu gastei dois meses e uma quantidade suspeita de dinheiro pra construir uma estufa que se rega sozinha. A parte física eu até filmei bonitinho. Mas a parte engraçada — onde eu perco o controle pra um chip do tamanho do meu dedo — essa aqui a gente conta agora."

📝 overlay: *"TATUFA — uma estufa controlada por um chip de R$ 40."*

😬 *corte seco pro relé estalando* 🔊 *CLICK alto*

🎬 **TÍTULO: "Eu entreguei minha horta pra um ESP32"**

---

## 0:25 — STAKES / "por que eu fiz isso"

🗣 *(on-camera, sentado no chão da estufa com um copo d'água)*:

> "Primeiro: por preguiça. Segundo: porque eu esqueço de regar planta antes da planta morrer. Terceiro: porque tinha um ESP32 na gaveta me encarando há seis meses — e uma vez que você tem um ESP32 na gaveta, você começa a procurar desculpa pra usar ele."

🔊 *(off)*:

> "E a desculpa foi essa daqui."

📹 Pan lento pela estufa. Corta pra foto das plantinhas secas.

📝 overlay: *"PROBLEMA: já deixei morrer 3 manjericões e um orégano inocentes."*

🗣 *(on-camera)*:

> "A solução normal seria: comprar um timer de parede por R$ 30, plugar numa tomada, fim. Eu não escolhi a solução normal. Eu escolhi MQTT."

😬 *corte pra "assuming face"*

🎬

---

## 1:10 — O CÉREBRO

🔊 *(off)*:

> "Conheça o protagonista."

📹 Close extremo do ESP32 DevKit na mesa, leve movimento estilo "filme de abertura".

🗣 *(on-camera, segurando a placa com pinça estilo cirurgião)*:

> "Isso é um ESP32. Ele tem Wi-Fi, dois núcleos, 4 MB de flash e custa menos que um Big Mac. Por R$ 40 ele tem mais conectividade que o celular que eu usava em 2012. E, profissionalmente falando: é a única coisa nesse projeto que não me decepcionou."

📝 overlay: *"ESP32 DevKit — 30 pinos — 240 MHz — Wi-Fi + BT — R$ 40"*

🔊 *(off)*:

> "Trabalho dele: ler sensores, acionar relés e mandar tudo pra um servidor Docker no chão do meu quarto. Plantas não precisam de MQTT. Eu é que precisava de uma desculpa."

🎬

---

## 1:50 — SENSORES: a parte dolorosa

🗣 *(on-camera, segurando um DHT22)*:

> "Pra minha estufa saber se está quente ou seca, eu preciso de sensores. E aqui começa o sofrimento."

🔊 *(off)*:

> "Esse bonito aqui é o DHT22. Mede temperatura e umidade. Dentro da estufa, cabinho curto, funciona que é uma beleza."

📹 Timelapse de você soldando o DHT22.

🔊 *(off)*:

> "Agora, o sensor de FORA da estufa…"

🗣 *(on-camera, segurando um cabo de rede de 15 m enrolado)*:

> "Esse é um DHT11 barato. Ele devia ficar a 15 metros de distância, do lado de fora, mandando a temperatura por um cabo de rede reciclado de uma caixa de internet velha. Eu não procurava beleza. Procurava funcionar. Spoiler: não funcionou."

😬 *Arduino Serial Monitor: "nan, nan, nan, nan, nan" rolando infinitamente.*

🔊 *(off)*:

> "Porque o DHT11 usa um sinal digital de 1 fio, e 15 metros de cabo é onde o sinal vai morrer de fadiga."

🗣 *(on-camera, no quadro branco, desenhando)*:

> "A documentação diz: usa resistor de 10kΩ de pull-up. Eu usei. Leu 'nan'. Testei 4k7. Leu 'nan'. Desce pra 2k2. *LEU.*"

📝 overlay: *"10kΩ = nan. 4k7 = nan. 2k2 = ✅. Cada metro de cabo = R$ 0,50 em sanidade."*

🗣 *(on-camera, casual)*:

> "Demorei 3 horas pra descobrir que um resistor mais barato que um picolé resolvia. Esse é o tipo de bug que só dá em projeto de fdp que largou I2C no quintal."

🎬

---

## 3:20 — OS RELÉS: onde ficou assustador

🔊 *(off)*:

> "Pra acionar bomba, exaustor e luz, comprei um módulo de relé de 8 canais."

🗣 *(on-camera, mostrando a placa)*:

> "Oito canais. Eu uso 5. Os outros 3 ficam ali, esperando. Tipo GB de RAM que você nunca usa. Vai saber."

🔊 *(off)*:

> "Cada relé vira um 'interruptor controlado por código'. GPIO26 liga a Zona 1. GPIO27 a Zona 2. GPIO14 a Zona 3. GPIO25 o exaustor. GPIO33 a grow light. 5 GPIOs, 5 relés. Fácil."

📝 overlay animado:
```
GPIO26 → IN1 → Zona 1
GPIO27 → IN2 → Zona 2
GPIO14 → IN3 → Zona 3
GPIO25 → IN4 → Exaustor
GPIO33 → IN5 → Grow Light
IN6, 7, 8 → esperando eu virar uma pessoa melhor
```

🔊 *(off)*:

> "E o detalhe que quase me custou a horta: esses módulos normalmente são active-LOW. 'Ligado' é quando o pino está em LOW. Não é intuitivo."

🗣 *(on-camera, no monitor, mostrando o define no .ino)*:

> "Tá aqui o define mágico. Se esquecer disso: você liga o ESP, ele liga TODOS os relés no boot — e a sua bomba enche a estufa d'água."

😬 *clip exagerado de água jorrando, com som de alarme de emergência.*

🗣 *(on-camera)*:

> "Acabei de descrever como as plantas morreram na primeira versão."

💻 screen recording do `esp32-firmware/greenhouse_lucor_esp32.ino`:
```cpp
#define RELAY_ON    LOW     // active-LOW
#define RELAY_OFF   HIGH
```

🔊 *(off)*:

> "Se seus relés forem o oposto, troca LOW por HIGH e reza pra nada estar ligado ainda."

🎬

---

## 4:40 — O LCD: porque sim

🗣 *(on-camera, segurando um LCD 16x2 azul)*:

> "Nada disso é necessário. Eu, mesmo assim, coloquei um display 16x2 acoplado no I2C. Por quê? Porque eu quis. Não precisa de uma razão."

🔊 *(off)*:

> "Ele rotaciona por 3 telas a cada 3 segundos: sensores dentro/fora, estado das 3 zonas, e status de Wi-Fi + MQTT. Se a internet cair, eu olho o LCD e fico sabendo — sem precisar abrir o notebook."

📹 Close do LCD alternando entre as 3 telas, legíveis.

📝 overlay: *"GASTO IRRACIONAL: R$ 12 no LCD só pra não abrir o notebook."*

🗣 *(on-camera, sério)*:

> "É IoT de preguiçoso com delírio de controle."

🎬

---

## 5:20 — BACKEND: onde deu trabalho de verdade

🔊 *(off)*:

> "Esse chip não liga motores à toa. Entre ele e a bomba existe uma cadeia esquisita de camadas que eu mesmo escolhi:"

💻 overlay animado, em sequência:
```
ESP32 ⇄ Mosquitto (MQTT/TLS, :8883) ⇄ FastAPI (Docker, :6001) ⇄ Nginx (:8085) ⇄ Navegador (React)
```

🔊 *(off)*:

> "ESP32 manda sensores e estado por MQTT — com TLS, padrão não-negociável — pra um Mosquitto que roda numa VPS no DDNS. Esse broker repassa pro FastAPI, que salva num SQLite e serve pro frontend React que eu fiz às 3 da manhã."

🗣 *(on-camera, no notebook)*:

> "4 abas: Dashboard, Agendamentos, Clima, Gráficos. Tudo encoberto por glassmorphism Solarpunk. Sim, eu coloquei glassmorphism pra regar hortelã. Não me julgue."

💻 screen recording do dashboard ao vivo: clique liga Zona 1 → timer caindo → LED verde no card.

🔊 *(off)*:

> "Cada clique atravessa 5 processos diferentes pra regar hortelã. That's the dream."

😬 *gag overlay: meme clássico "Is this 5-layer enterprise architecture?" / "Always has been, astronaut."*

🎬

---

## 6:50 — MODO AUTÔNOMO: a parte que me assustou

🗣 *(on-camera, deitado no chão)*:

> "Aqui entra o detalhe que eu mais gostei. Eu não previ. E eu me arrependo um pouco."

🔊 *(off)*:

> "Eu imaginava que, se a internet caísse, a estufa parava. É normal IoT: sem nuvem, sem vida."

🔊 *(off)*:

> "Aí eu percebi uma coisa: se o servidor cair, eu perco a irrigação automática. As plantas morrem, eu perco 6 meses de trabalho. Eu não consigo dormir com isso. Então eu fiz o contrário."

🔊 *(off)*:

> "E aí eu tive uma ideia estúpida: e se a estufa continuasse funcionando mesmo sem internet?"

💻 screen recording do código do ESP32, pan em:
```cpp
configTime(0, 0, "pool.ntp.org", "a.st1.ntp.br");
Preferences prefs; prefs.begin("schedules");
```

🔊 *(off)*:

> "O ESP32 sincroniza a hora no boot via NTP. Salva os agendamentos na flash interna (NVS). A cada 10 segundos, um loop compara a hora atual com os agendamentos salvos. Se bater: liga o relé. Sem internet, sem servidor, sem Wi-Fi. Continua funcionando."

🔊 *(off)*:

> "Eu gastei 1 semana implementando uma coisa que, na prática, é só um despertador. Mas é um despertador que rega hortelã às 8 da manhã ainda que o roteador esteja em chamas."

🔊 *(off)*:

> "Eu desliguei a internet de propósito pra testar."

📹 screen record: terminal `mosquitto` parado; LCD mostra "MQTT: OFF"; relé estala; bomba liga; LCD: "Z1: ON 04:59".

🗣 *(on-camera)*:

> "Funcionou. Sentimento médio: orgulho misturado com um leve medo."

🔊 *(off)*:

> "Porque, tecnicamente, o ESP32 agora é mais confiável do que eu regando às 8 da manhã. Ele nunca dorme demais. Ele nunca sai pra buscar pão e esquece. Ele está sempre lá."

🗣 *(on-camera)*:

> "Eu ainda sou melhor em fazer um molho pesto, mas pra regar planta, perdi."

😀 *beat. Sorriso seco.*

🎬

---

## 8:10 — MQTT: a parte que eu não admitiria numa entrevista

🔊 *(off)*:

> "Sobre o protocolo. O ESP32 não fala direto com o servidor. Ele manda uma mensagem num tópico. Tipo assim:"

💻 overlay com terminal:
```
mosquitto_sub -h localhost -t 'greenhouse/#' -v
greenhouse/sensor/inside/temperature "24.5"
greenhouse/zone1/command ON
greenhouse/irrigation/started {"zone":1,"duration":5}
```

🔊 *(off)*:

> "Esse é o MQTT. Pessoas acham que é old, mas, pra mensagens curtas e leves entre dispositivos, ainda é elegante. Tipo post-it em formato de protocolo."

🗣 *(on-camera)*:

> "Pub/sub. Se eu quero temperatura dentro, me inscrevo em `greenhouse/sensor/inside/temperature`. O ESP32 publica um valor a cada 30s. Quem quiser ler, lê; quem não, ignora. Como Twitter, só que útil."

🔊 *(off)*:

> "O projeto inteiro tem mais de 20 tópicos. Sensores, comandos de zona, clima, luz, sync de agendamentos, heartbeat próprio do ESP32. Eu sei que é exagero pra hortelã. Eu não paro."

🎬

---

## 9:20 — MINI WALKTHROUGH (rápido)

🎵 música mais animada, ritmo rápido.

🔊 *(off), rápido*:

> "Resumo do fluxo, 30 segundos."

💻 overlay com o diagrama do README aparecendo em pedaços.

🔊 *(off), rápido*:

> "Navegador → React → Nginx → FastAPI → Mosquitto → ESP32 → relé → água. Oito saltos. Do clique até a gota na terra."

🗣 *(on-camera, com uma tangerina na mão)*:

> "É exagero? Sim. Funciona? Também. Quantas vezes eu realmente uso o frontend? Tipo, três vezes por dia. Mas a beleza é poder abrir o celular e regar hortelã sem levantar do sofá."

🔊 *(off)*:

> "Isso não é feature. É conveniência e preguiça brindando juntas."

🎬

---

## 10:00 — BLOOPER REAL

🔊 *(off)*:

> "Tá, e eu tinha que mostrar isso:"

📹 Clip curto de algo que deu errado. Sugestões:
- LCD mostrando caractere japonês confuso por bug no I2C inicial.
- Bomba espirrando água fora da estufa por causa de válvula invertida.
- ESP32 reiniciando e ligando todos os relés ao mesmo tempo.
- Wi-Fi desconectando e reconectando a cada 5s, LCD piscando OFF/ON/OFF/ON.

🔊 *(off)*:

> "Resolvido, mostly. Se 'mostly' é a palavra certa."

🗣 *(on-camera)*:

> "Esse projeto não passa num code review. Mas rega manjericão toda manhã às 8h. Então, eu considero um sucesso."

😬 *corte abrupto*

🎬

---

## 10:30 — TEASER / PARTE 2

🎵 música tensa, suspense.

🔊 *(off)*:

> "Mas eu ainda não terminei."

📹 Slow pan por uma placa mais potente (ou impressão 3D da DevModule, ou só imagem de uma NEMA 17 com luz dramática).

🔊 *(off)*:

> "Esse é o próximo capítulo. 'Spider Cam' — uma câmera pendurada no teto da estufa, controlada por 4 motores de passo, que percorre 10 pontos, faz timelapse e roda inferência de machine learning pra detectar doença em plantas."

🗣 *(on-camera)*:

> "Sim. IA na horta. Eu sei. Demorou, mas chegamos no momento Michael Reeves."

📝 overlay:
- DevModule M3 (P4+C6) → TFLite on-device
- Arduino Uno → CNC Shield → 4x A4988 → 4x NEMA 17
- Câmera MIPI CSI → servos pan/tilt
- 10 pontos de inspeção + 3 de timelapse

🔊 *(off)*:

> "Quatro NEMA 17 nos quatro cantos. Cabos de aço convergem. Arduino Uno calculando cinemática inversa, ESP32 mandando coordenadas por MQTT. O P4 faz a IA na própria placa — MobileNet int8, uns 200 KB. Cabe na memória dele."

🗣 *(on-camera)*:

> "Custo estimado: R$ 500 a 750. Valor que eu não recupero. Se inscreve."

🔊 *(off)*:

> "E ainda uma ESP32-CAM fixa de overview, 24/7. Tipo Big Brother, mas de hortelã."

😬 *corte*

🎬

---

## 11:20 — OUTRO

🗣 *(on-camera, mesmo lugar do início, segurança uma folha de manjericão saudável)*:

> "Em resumo: arquitetura enterprise, microserviços, MQTT com TLS, backend Docker, dashboard React, modo autônomo com fallback, LCD redundante, 20 tópicos MQTT. Tudo pra regar uma hortelã."

🗣 *(on-camera)*:

> "Eu poderia ter comprado um timer de parede de R$ 30. Mas assim eu tenho um vídeo."

🔊 *(off)*:

> "Código, pinagem, esquema, lista de compras, e tudo que terminei e que não funcionou — na descrição. Repositório no README do projeto."

🔊 *(off)*:

> "Inscreva-se. Comenta a próxima ideia inútil que eu devia construir. Tipo um robô que corta pizza usando TensorFlow."

🗣 *(on-camera)*:

> "Até a próxima. Tchau."

😬 *clip final 2s: LCD mostra "08:00 — Z1: ON" e o relé estala. A bomba liga sozinha. Ninguém pediu. A hortelã agradece. Som de gota.*

🔊 *(off), final curto*:

> "Ele acordou sozinho pra trabalhar."

🎵 *outro fades out.*

📝 END CARD:
- "código: github.com/.../GreenhouseLucor"
- "nome do projeto: TATUFA"
- "se inscreve 👍"

🎬 **FIM**

---

## NOTAS DE PRODUÇÃO

### Estilo / pacing
- Cortes rápidos a cada 1.5–3s nas falas.
- Cortes secos para gags (clique do relé, queda d'água, "nan" passando no serial).
- Alternar on-camera e voice-over com frequência. Michael Reeves faz MUITO V/O.
- Use reaction shots de horror entre segmentos ("staring at the screen") pra fazer bridge.

### B-roll sugerido
- Timelapses da montagem — você já tem.
- Closes: ESP32, relés, LED piscando, fios, bomba jorrando, LCD trocando telas, motor estalando.
- Screen recordings: `mosquitto_sub -v`, Serial Monitor, dashboard React, código no VS Code.
- Quadro branco / papel A4 nas seções de sensores e MQTT.

### Áudio
- Relé estalando: amplifique. É o som-ícone do projeto. Cada irrigation on = *CLICK*, off = *CLICK*.
- Música: lo-fi na tech, percussão upbeat no walkthrough, suspense no teaser. Sempre baixa, sob a V/O.

### Text overlay
- Sans legível, stroke escuro, fundo semi-transparente. Uma frase por tela. Letras grandes, estilo Kurzgesagt.

### Improvisação
- Improvise ao redor dessas falas. A energia Michael Reeves vem da fala parecer improvisada, mesmo com roteiro. Faça pausas, engasgue, repita palavras como "tipo…", "né", "espera".

### Antes de gravar, tenha
1. Projeto rodando de verdade: ESP32 ligado, LCD atualizando, dashboard aberto, pelo menos um LED de zona aceso.
2. Estufa limpa e iluminada.
3. Capturas de tela: terminal com MQTT trafegando, dashboard ao vivo, Serial Monitor com sensores.
4. Pelo menos um shot de blooper honesto. Se não tiver, fabrica um: desconecte o DHT11 e filme o LCD mostrando "nan" passando.
5. Se possível, peças da Spider Cam na mesa pra já vazar no teaser.
6. Os timelapses de construção que você já tem — usa no cold open e no teaser.

🎬 **FIM DO ROTEIRO**