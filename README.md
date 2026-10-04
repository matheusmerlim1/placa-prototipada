🔗 **Site:** https://matheusmerlim1.github.io/placa-prototipada/

# 🟩 Placa Prototipada

Ferramenta no navegador para desenhar uma placa de circuito impresso (PCI) simples, em três passos:

1. **Componentes** — escolha as peças numa biblioteca (resistores, capacitores, LEDs, transistores, CIs DIP, conectores, Arduino Nano, ESP32…) e arraste-as sobre a placa.
2. **Ligações** — clique em um pino e depois em outro para dizer o que liga com o quê. Pinos ligados entre si formam uma **rede** (ex.: GND, VCC), que pode ser renomeada.
3. **Trilhas** — escolha **1 ou 2 camadas** e o programa calcula o caminho de cada trilha **sem que nenhuma cruze outra**.

Não precisa instalar nada: basta abrir o `index.html` no Chrome, Edge ou Firefox. O projeto fica salvo automaticamente no navegador e pode ser exportado e importado como `.json`.

## Medidas reais (datasheet)

Cada componente da biblioteca usa as medidas do datasheet, com o footprint padrão IPC-7251/KiCad: posição dos terminais, **forma e tamanho de cada pad** (redondo, quadrado no pino 1 ou oblongo), **diâmetro do furo** e contorno do corpo para a serigrafia. Exemplos:

| Componente | Passo | Pad / furo | Corpo |
|---|---|---|---|
| Resistor 1/4 W (DIN 0207) | 7,62 / 10,16 / 12,7 / 15,24 mm | Ø 1,6 / 0,8 | 6,3 × Ø 2,5 mm |
| Diodo 1N4007 (DO-41) | 7,62 / 10,16 / 12,7 mm | Ø 2,2 / 1,1 | 5,2 × Ø 2,7 mm |
| LED 5 mm | 2,54 mm | Ø 1,8 / 0,9 | Ø 5,0 (aba 5,8) com chanfro no catodo |
| TO-92 | 1,27 (original) ou 2,54 mm | 1,05 × 1,5 oblongo / 0,75 | Ø 4,8 mm |
| TO-220 | 2,54 mm | 1,9 × 2,0 oblongo / 1,1 | 10,0 × 4,4 mm |
| CI DIP | 2,54 mm, fileiras a 7,62 mm | Ø 1,6 / 0,8 | 6,35 mm × comprimento do datasheet |
| Botão tátil 6×6 | 6,5 × 4,5 mm | Ø 2,0 / 1,0 | 6 × 6 mm |
| Cristal HC-49/US | 4,88 mm | Ø 1,5 / 0,8 | 11,0 × 4,65 mm |
| Conector JST XH | 2,50 mm | 1,7 × 2,0 / 0,95 | conforme nº de pinos |

Pinos fora da grade de 2,54 mm (6,5, 4,88, 2,5, 7,6, 5,0 mm…) são aceitos normalmente. Ao clicar num componente, aparece uma **ficha** com pino, nome, pad, furo e coordenada em mm de cada terminal.

## Como usar

| Ação | Como |
|------|------|
| Adicionar componente | Botão **+** na biblioteca (escolha passo, diâmetro ou nº de pinos quando houver) |
| Mover | Arrastar o componente; o encaixe pode ser 2,54, 1,27 ou 0,635 mm |
| Girar / remover | Tecla **R** / **Del** com o componente selecionado, ou pelos botões da lista |
| Identificar os pinos | O número/nome de cada pino aparece ao lado do pad (ex.: `1` e `2` no resistor, `K`/`A` no LED, `C B E` no transistor). Botão **Pinos** liga/desliga. Passar o mouse mostra o pino e a coordenada |
| Ligar pinos | Passo 2: clique no pino A e depois no pino B (ou escolha nas listas). **Shift+clique** continua ligando a partir do último pino. **Esc** cancela |
| Desfazer ligação | **×** na etiqueta da ligação, dentro da rede |
| Aproximar / mover a vista | Roda do mouse / arrastar numa área vazia |
| Ver um exemplo | **Carregar exemplo…**: pisca-pisca com NE555, fonte 5 V, LED com botão ou termômetro com Arduino Nano |

As linhas tracejadas coloridas mostram as ligações que ainda não têm trilha.

## Como as trilhas são calculadas

Tudo é calculado em **milímetros reais**:

- A placa vira uma grade fina de **0,635 mm**, com trilhas em 0°, 45° e 90°.
- **Folgas geométricas exatas**: cada trecho de trilha é testado contra a borda real do cobre de cada pad (redondo, retangular ou oblongo). A distância tem que ser ≥ folga + meia largura da trilha. Trilha ↔ trilha, via ↔ trilha e via ↔ via também respeitam a folga.
- **Busca A\***: acha o caminho mais curto de cada ligação, com penalidade para curvas. Redes com vários pinos crescem como uma árvore.
- **Negociação de congestionamento** (*PathFinder*): o espaço disputado fica mais caro a cada passada, até que nenhuma trilha encoste ou cruze outra.
- **1 camada**: tudo no lado da solda. O que não couber é listado (dá para resolver com 2 camadas, reposicionando peças ou com um jumper).
- **2 camadas**: as trilhas trocam de lado por **via** (Ø 1,2 / 1,6 / 2,0 mm). Pads de componentes são metalizados e também servem de passagem.
- **Conferência de folgas (DRC)**: depois do roteamento, uma verificação independente mede a menor distância real entre cobres de redes diferentes e mostra o valor (ex.: “0,270 mm ≥ 0,25 mm ✓”).

Ajustes: largura da trilha (0,3–1,0 mm), folga mínima (0,20–0,50 mm) e **anel do pad** (+0,2 a +0,6 mm sobre o datasheet, útil para corrosão caseira). O painel avisa se cabe trilha entre dois pinos de CI vizinhos.

## Mandar fazer a placa numa empresa

O botão **Arquivos para fabricação (Gerber .zip)** gera o pacote padrão que as empresas de placas pedem (JLCPCB, PCBWay, fabricantes nacionais):

| Arquivo | Conteúdo |
|---|---|
| `placa.GTL` / `placa.GBL` | cobre superior / inferior (na face simples, só o `GBL`) |
| `placa.GTS` / `placa.GBS` | máscara de solda: aberturas nos pads (+0,05 mm); vias cobertas |
| `placa.GTO` | serigrafia: contornos, referências e nomes dos pinos, em fonte de traço de 0,15 mm, recortada fora dos pads |
| `placa.GKO` | contorno da placa (corte) |
| `placa.DRL` | furação Excellon métrica, uma ferramenta por diâmetro, todos os furos metalizados |
| `LEIA-ME.txt` | dados para o pedido: tamanho, camadas, trilha, folga, furo mínimo e lista de brocas |

Os arquivos seguem o Gerber RS-274X (X2), em mm, formato 4.6, com origem no canto inferior esquerdo. Envie o .zip inteiro no site do fabricante e confira a visualização antes de confirmar. O pacote foi validado com um interpretador de Gerber independente (gerbonara): todas as camadas foram reconhecidas e a renderização bateu com o editor.

## Exportar em escala real (1:1)

São dois PDFs:

- **PDF das trilhas (1:1, fabricação):** uma página por camada de cobre e uma de furação. A serigrafia 1:1 entra se você marcar *Incluir serigrafia 1:1*.
- **PDF de montagem (pinos e posições):**
  - desenho ampliado, vista pelo lado dos componentes, com o contorno de cada componente, a referência, o nome de cada pino junto do pad, as marcas de polaridade (pad quadrado = pino 1) e réguas em mm nas bordas;
  - **lista de componentes:** tipo, valor, posição do pino 1 e rotação;
  - **tabela de pinos:** posição x;y, pad/furo, rede e os outros pinos ligados a cada um.

O PDF das trilhas é desenhado em milímetros reais e em vetor. Impresso em **“Tamanho real / 100%”**, a largura da trilha, os pads e os furos saem com a medida exata, prontos para reproduzir na placa. Cada página traz:

- **Régua de 50 mm** e **amostra da trilha** (30 mm na largura escolhida), para conferir a impressão com uma régua.
- **Marcas de corte** nos cantos e o contorno da placa.
- **Cabeçalho** com a orientação da imagem, o processo, a largura da trilha, a folga e a data.
- Na página de furação, a **lista de brocas** (diâmetro × quantidade).
- No cobre, os pads no tamanho do datasheet, com um ponto-guia de Ø 0,4 mm no centro para a broca.

**Processo de fabricação:** define o que sai espelhado.

| Processo | Cobre inferior | Cobre superior | Serigrafia |
|---|---|---|---|
| Serigrafia / fotolito (imagem vista de frente para cada face) | espelhado | normal | normal |
| Transferência térmica (papel virado sobre o cobre) | normal | espelhado | espelhada |
| Sem espelhar (como na tela) | normal | normal | normal |

**Negativo:** inverte preto e branco, conforme a emulsão. **Nomes dos pinos na serigrafia:** liga ou desliga os rótulos. A serigrafia é recortada 0,2 mm em volta de cada pad para não cair tinta onde vai solda.

Também há **SVG em mm** (1 unidade = 1 mm) de cada camada, para Inkscape, CorelDRAW ou CNC.

## Exemplos

Em **Carregar exemplo…** há quatro circuitos didáticos, todos já posicionados e prontos para rotear:

| Exemplo | Componentes | Placa |
|---|---|---|
| **Pisca-pisca com NE555** | NE555 (DIP-8), 3 resistores, 2 capacitores, LED, borne | 60 × 40 mm |
| **Fonte regulada 5 V** | regulador 7805 (TO-220), capacitores de entrada e saída, LED de “ligado”, bornes de entrada e saída | 55 × 35 mm, face simples |
| **LED acionado por botão** | botão tátil 6×6, transistor BC547 como chave, resistores de base e do LED | 45 × 35 mm, face simples |
| **Termômetro com Arduino Nano** | Arduino Nano, sensor LM35, LED com resistor, buzzer | 60 × 50 mm |

## Nomes dos pinos dos conectores

Barras de pinos, JST e bornes aceitam um nome em cada pino. Clique no conector, e a ficha mostra um campo por pino (ex.: `SDA`, `GND`, `3V3`). O nome aparece na placa, nas ligações e na serigrafia.

## Arquivos

| Arquivo | Conteúdo |
|---------|----------|
| `index.html` | Interface |
| `css/style.css` | Visual (tema claro/escuro automático) |
| `js/library.js` | Biblioteca de componentes: pinos, pads, furos e corpo em mm (datasheet) |
| `js/router.js` | Roteador em mm (A* + negociação + folgas geométricas) e conferência DRC; também roda no Node |
| `js/app.js` | Edição, ligações, desenho da placa e exportação |
| `js/pdf.js` | Gerador de PDF vetorial em mm (escala real), sem bibliotecas externas |
| `js/gerber.js` | Gerber RS-274X + Excellon + .zip para o fabricante (com fonte de traço para a serigrafia) |
| `js/examples.js` | Projetos de exemplo |
| `tests/` | Testes Jest (`npm test`) |

## Testes

```bash
npm install   # uma vez: instala o Jest
npm test
```

Testes, em `tests/`:

| Suíte | O que confere |
|---|---|
| `exemplos.test.js` | A fiação de cada exemplo, rede por rede, e a leitura de rótulos de pino com ponto no nome (ex.: `3.3V`) |
| `roteador.test.js` | Os exemplos roteados em 1 e 2 camadas, sem nenhuma falha e com DRC sem violações. Também confere a recusa de pads encostados ou fora da placa, o desvio de pads de outras redes e a medida exata da folga |
| `pdf.test.js` | Tamanho físico da página, matriz em mm, largura da trilha, tabela xref e acentos (WinAnsi) |
| `gerber.test.js` | As camadas exigidas pelo fabricante, o cabeçalho RS-274X, as aberturas definidas, as coordenadas dentro da placa, os flashes por pad, o contorno, os furos do Excellon, o CRC32 do .zip e a fonte de traço |

Os testes precisam passar antes de qualquer push.

### Adicionar um componente à biblioteca

Em `js/library.js`, acrescente um item com `id`, `group`, `name`, `prefix` (R, C, U…) e uma função `build()` que devolve `pins` (posição em mm relativa ao pino 1, com `pad: {shape, w, h, drill}`) e `body` (contorno do corpo em mm). Coloque em `src` de onde vieram as medidas. Pinos ligados por dentro do componente, como nos botões táteis de 4 pinos, vão em `internal`.

> ⚠️ As medidas são as nominais dos encapsulamentos padrão. Pinagens de transistores e de módulos (Arduino Nano, ESP32 DevKit) e o corpo do trimpot 3386P variam entre fabricantes: confira no datasheet da sua peça e imprima uma prova 1:1 para encostar os componentes antes de fabricar.
