# Roteiro de Vídeo — Tatufa

## Título sugerido

**Eu construí uma estufa inteligente porque um timer era simples demais**

## Formato

- **Duração:** aproximadamente 10 minutos
- **Idioma:** português brasileiro
- **Tom:** maker caótico, engraçado e técnico
- **Material principal:** timelapses da construção, vídeos dos sprinklers e fotos da montagem do ESP32
- **Estilo:** cortes rápidos, narração em off, diagramas simples e sons exagerados de relé

## Ideia central

Eu queria resolver um problema simples: não esquecer de regar as plantas.

Em vez de comprar um timer barato, construí uma estufa com ESP32, sensores, relés, Wi-Fi, MQTT, backend e dashboard.

O vídeo deve contar essa escalada: uma tarefa simples que virou um pequeno sistema de automação residencial.

---

## 0:00 — Cold open: mostrar o resultado primeiro

### Imagens

Use uma sequência de cortes rápidos:

1. Sprinklers funcionando
2. ESP32 ligado
3. Timelapse rápido da construção
4. Foto da montagem eletrônica
5. Close de fios, relés ou mangueiras

### Edição

- Cortes de 0,5 a 1,5 segundo
- Música começando e parando de repente
- Som alto de relé e bomba
- Texto grande na tela: **"Eu fiz uma planta ser mais responsável que eu"**

### Narração

> Eu queria regar algumas plantas automaticamente.
>
> Então construí uma estufa com sensores, Wi-Fi, MQTT, um servidor e um ESP32.
>
> Tudo isso para fazer uma coisa que um timer de tomada de 30 reais já resolveria.
>
> E o pior: funcionou.

### Título na tela

**EU CONSTRUÍ UMA ESTUFA INTELIGENTE PORQUE UM TIMER ERA SIMPLES DEMAIS**

### Regra da abertura

Não explicar a história antes de mostrar água saindo. Os primeiros 30 segundos precisam entregar o resultado, o exagero do projeto e a pergunta: **como isso foi parar tão longe?**

---

## 0:30 — O problema e a decisão ruim

### Imagens

- Primeiro timelapse da construção
- Fotos da estufa ainda incompleta
- Qualquer imagem das plantas ou do espaço vazio

### Narração

> O problema era simples: eu esquecia de regar as plantas.
>
> Às vezes eu lembrava tarde demais. Às vezes a planta já tinha desistido de continuar vivendo.
>
> A solução normal seria comprar um timer de tomada por alguns reais e encerrar o assunto.
>
> Eu não escolhi a solução normal.

### Texto na tela

```text
Problema: plantas morrendo
Solução normal: timer de tomada
Solução escolhida: arquitetura distribuída
```

### Piada

> Eu não queria automatizar a rega. Eu queria transformar uma torneira em infraestrutura.

---

## 1:15 — A construção da estufa

### Imagens

Use o timelapse como uma montagem acelerada:

1. Estrutura inicial
2. Montagem das prateleiras
3. Instalação das mangueiras
4. Posicionamento dos sprinklers
5. Estufa tomando forma

### Narração

> A parte física começou de forma inocente.
>
> Madeira, estrutura, mangueiras e algumas decisões que pareciam excelentes às duas da manhã.
>
> Cada etapa parecia aproximar o projeto de uma estufa funcional.
>
> O que também significa que cada etapa me afastava da possibilidade de desistir.

### Textos rápidos sobre o timelapse

- **Ainda parece uma boa ideia**
- **Mais uma mangueira**
- **Aqui eu ainda tinha esperança**
- **A fita isolante entrou em cena**
- **Não tocar nesse fio**

---

## 2:45 — O cérebro: ESP32

### Imagens

Use as fotos da montagem em sequência, como um stop-motion:

1. ESP32 vazio
2. Componentes separados
3. Primeiros fios
4. Relés conectados
5. Sensores instalados
6. Montagem final

### Edição

- Zoom lento nas fotos
- Pan horizontal e vertical
- Setas apontando para os componentes
- Som de clique a cada nova foto

### Narração

> O cérebro da operação é um ESP32.
>
> Ele tem Wi-Fi, lê sensores e controla os relés. Ou seja: faz tudo que eu precisava e também permite que eu complique completamente o projeto.
>
> O ESP32 recebe informações dos sensores, decide quando algo precisa ser ligado e conversa com o resto do sistema pela rede.

### Diagrama na tela

```text
Sensores → ESP32 → Relés → Bombas e sprinklers
             ↓
           Wi-Fi
             ↓
        Dashboard
```

### Piada

> A planta não sabe o que é MQTT. Mas agora ela depende dele.

---

## 4:00 — A montagem eletrônica

### Imagens

- Fotos de solda e conexões
- Close dos relés
- Fios saindo do ESP32
- Montagem final

### Narração

> Esse é o momento em que um projeto deixa de ser uma ideia e vira um conjunto de fios que você não pode mais tocar porque tem medo de descobrir o que acontece.

> Cada sensor tem uma função. Cada relé controla uma carga. E cada fio foi colocado ali com uma confiança que eu espero que continue existindo.

### Textos sobre as fotos

- **engenharia**
- **provavelmente**
- **mais um relé**
- **fio importante**
- **problema futuro**

### Observação de produção

Não mostre números de GPIO ou explique a pinagem se a versão final não estiver confirmada. Mostre a função dos componentes e use um diagrama geral.

---

## 5:15 — O teste dos sprinklers

### Imagens

- Vídeos reais dos sprinklers funcionando
- Bomba ligando
- Água atingindo as plantas
- Qualquer falha, vazamento ou excesso de água

### Edição

- Reduza a música antes da água começar
- Destaque o som real da bomba
- Amplifique o clique do relé
- Use câmera lenta em algum jato de água

### Narração

> Depois de montar tudo, chegou a hora de testar a parte mais importante: fazer água sair no lugar certo.

> Esse foi o primeiro momento em que o projeto deixou de ser uma coleção de componentes caros e virou uma estufa de verdade.

### Se o teste tiver sido imperfeito

> A água saiu. A direção era uma sugestão.

ou:

> Funcionou perfeitamente, desde que você não considere a parte em que molhou tudo.

---

## 6:30 — A parte absurdamente tecnológica

### Imagens adicionais para gravar

Esses takes podem ser gravados agora, sem refazer a construção:

- Dashboard funcionando
- Código do ESP32 no editor
- Terminal mostrando mensagens MQTT
- Status dos sensores
- Agendamento de irrigação

### Diagrama na tela

```text
Dashboard
    ↓
Backend
    ↓
MQTT
    ↓
ESP32
    ↓
Relé
    ↓
Bomba
    ↓
Água
```

### Narração

> Quando eu aperto um botão, ele atravessa o frontend, o backend, o broker MQTT e o ESP32 antes de finalmente virar água.
>
> Para regar uma planta.

### Piada

> Isso não é automação residencial. É uma empresa de tecnologia com folhas.

---

## 7:45 — O modo autônomo

### Imagens

- ESP32 ligado
- Dashboard mostrando um agendamento
- Sprinkler funcionando
- Fotos da montagem final

### Narração

> A parte mais importante é que a estufa não precisa de mim o tempo inteiro.
>
> Os agendamentos podem ser enviados ao ESP32, que continua executando a lógica localmente. O servidor ajuda no controle e na visualização, mas a irrigação não precisa depender de um clique manual o tempo todo.
>
> Então agora existe um pequeno computador responsável pela sobrevivência das minhas plantas.
>
> Isso parece uma boa ideia até você lembrar que ele também foi montado por mim.

### Texto na tela

**Internet caiu? As plantas ainda têm uma chance.**

---

## 8:50 — Resultado, custos e encerramento

### Imagens

Monte um antes e depois:

- Estufa no início
- Timelapse da construção
- Fotos do ESP32 sendo montado
- Estufa pronta
- Sprinklers funcionando

### Narração

> No final, eu queria resolver um problema simples: não esquecer de regar as plantas.
>
> A solução foi uma estufa automatizada com ESP32, sensores, relés, MQTT, backend e um sistema que provavelmente tem mais camadas do que deveria.
>
> Mas funciona.
>
> E, quando a água começa a sair sozinha, todas as decisões ruins parecem temporariamente justificadas.

### Custos e aprendizado

Inclua aqui uma montagem curta com os principais gastos reais do projeto e uma conclusão honesta:

> No fim, eu poderia ter gastado menos. Mas teria perdido a parte mais importante: transformar uma rega em um projeto grande o bastante para virar vídeo.

Não invente valores. Se o custo total não estiver fechado, use apenas uma comparação visual com um timer barato.

### Último gag

Mostre o sprinkler funcionando, corte para a tela do dashboard e depois para uma foto da placa.

Som de relé.

### Texto final

**Próximo problema: impedir que as plantas cresçam mais rápido que o software.**

---

## Gravações extras recomendadas

Grave apenas inserts curtos para preencher as partes sem imagens:

- Você explicando o projeto para a câmera
- Close do ESP32 ligado
- Dashboard funcionando
- Terminal com MQTT
- Código rolando no editor
- Um teste manual de irrigação
- Sua reação olhando para a placa
- Um take final da estufa pronta

Não é necessário refazer a construção.

## Direção de edição

- Use cortes de 2 a 4 segundos durante as piadas
- Faça a maior parte da explicação em voice-over
- Use música energética, mas baixa durante a narração
- Dê destaque aos sons de relé, bomba e água
- Faça diagramas simples, com poucas palavras
- Use fotos com zoom e movimento para não parecerem estáticas
- Não invente falhas ou testes que não foram gravados
- Use as imagens reais como prova de que o projeto realmente funcionou

## Checklist de materiais

- [ ] Timelapses da construção
- [ ] Vídeos dos sprinklers
- [ ] Fotos da montagem do ESP32
- [ ] Foto ou vídeo da estufa pronta
- [ ] Captura do dashboard
- [ ] Captura do código
- [ ] Captura do MQTT ou Serial Monitor
- [ ] Narração gravada por blocos
- [ ] Sons de relé, bomba e água
