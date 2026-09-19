# Design System

> Fonte de verdade visual do produto. Os tokens abaixo são os mesmos usados em
> `packages/ui` e na prévia de telas. Se divergirem, o código está errado.

## 1. Princípios

O sistema é operado por pessoas que trabalham nele **o dia inteiro**, em pé,
com fila na frente. Isso define tudo:

1. **Densidade acima de respiro.** Um operador de PDV precisa ver o carrinho
   inteiro sem rolar. Espaço em branco generoso é luxo de landing page.
2. **Teclado antes do mouse.** O PDV é operável inteiro sem tirar a mão do
   teclado ou do leitor de código de barras. Atalhos são visíveis, não
   escondidos.
3. **Números legíveis à distância.** Valores monetários usam numerais tabulares
   e alinhamento à direita, sempre. Colunas de dinheiro que "dançam" causam
   erro de conferência.
4. **A divergência aparece.** Saldo negativo, custo resetado e diferença de
   caixa são destacados, nunca suavizados. O sistema permite a exceção, mas
   não a esconde.
5. **Estado vazio é informação.** "Nenhum produto" e "falha ao carregar" são
   telas projetadas, não `null`.

## 2. Tipografia

Três famílias, todas do Google Fonts.

| Papel | Família | Pesos | Uso |
|---|---|---|---|
| Display | **Archivo** | 600, 700 | Títulos de tela, números de destaque, valor total do PDV |
| Interface | **IBM Plex Sans** | 400, 500, 600 | Todo o resto do texto |
| Mono | **IBM Plex Mono** | 400, 500 | SKU, código de barras, IDs, colunas monetárias em tabela |

**Por que não Inter/Roboto/Arial:** são a escolha default de todo dashboard.
Archivo tem a sustentação de grotesca industrial que combina com varejo, e o
IBM Plex tem os melhores numerais tabulares abertos disponíveis — o que aqui é
requisito funcional, não estética.

### Escala

| Token | px / line-height | Peso | Uso |
|---|---|---|---|
| `display-xl` | 44 / 48 | 700 | Total do PDV |
| `display-lg` | 32 / 38 | 700 | Número de KPI |
| `title-lg` | 22 / 28 | 600 | Título de tela |
| `title-md` | 17 / 24 | 600 | Título de card / seção |
| `body-lg` | 15 / 22 | 400 | Corpo padrão |
| `body-md` | 14 / 20 | 400 | Tabela, formulário |
| `body-sm` | 13 / 18 | 400 | Auxiliar |
| `label` | 12 / 16 | 600 | Rótulo, cabeçalho de tabela (`letter-spacing: .04em`, caixa alta) |
| `mono-md` | 13 / 18 | 500 | SKU, valores em tabela |

## 3. Cor

Base neutra **quente**, não cinza puro — reduz a fadiga em jornada longa e
evita o visual de template.

### Neutros

| Token | Hex | Uso |
|---|---|---|
| `neutral-0` | `#FFFFFF` | Superfície de card, campo |
| `neutral-25` | `#FAF9F7` | Fundo da aplicação |
| `neutral-50` | `#F4F2EF` | Linha zebrada, fundo de seção |
| `neutral-100` | `#E9E6E1` | Divisória, borda de campo |
| `neutral-200` | `#D9D5CE` | Borda enfatizada |
| `neutral-300` | `#BDB8AF` | Borda de controle, grid de gráfico |
| `neutral-400` | `#938D83` | Texto desabilitado, placeholder |
| `neutral-500` | `#6E6860` | Texto secundário |
| `neutral-600` | `#524D46` | Texto de apoio |
| `neutral-700` | `#3B3732` | Texto forte |
| `neutral-900` | `#1A1917` | Texto primário (ink) |

### Primária — Indigo

| Token | Hex |
|---|---|
| `primary-50` | `#EEF0FA` |
| `primary-100` | `#DCE0F3` |
| `primary-200` | `#B9C1E7` |
| `primary-300` | `#8B98D4` |
| `primary-400` | `#6070BC` |
| `primary-500` | `#43529F` |
| **`primary-600`** | **`#33408C`** ← ação primária |
| `primary-700` | `#2A3573` |
| `primary-800` | `#222B5C` |
| `primary-900` | `#1B2249` |

Branco sobre `primary-600` atinge 8,9:1. ✅

### Acento — Clay

Um único acento, mesma faixa de croma da primária. Usado com parcimônia: chama
atenção para exceção operacional, nunca para decorar.

| Token | Hex |
|---|---|
| `accent-100` | `#F7E7D8` |
| `accent-600` | `#B4601C` |
| `accent-700` | `#8F4B15` |

### Status

Reservados. **Nunca** usados como cor de série em gráfico.

| Estado | Texto/Ícone | Fundo | Uso |
|---|---|---|---|
| `success` | `#1B6E46` | `#E4F2EA` | Venda concluída, caixa conferido |
| `warning` | `#8F6206` | `#FBF0DA` | Estoque abaixo do mínimo |
| `danger` | `#A81F27` | `#FAE8E8` | **Saldo negativo**, diferença de caixa, estorno |
| `info` | `#33408C` | `#EEF0FA` | Neutro informativo |

Status **sempre** acompanha ícone + rótulo textual. Nunca cor sozinha — é
requisito de acessibilidade e de operação (monitor de PDV costuma ser ruim).

### Gráficos

- **Série única** (vendas por dia, por exemplo): um só tom, `primary-600`. Sem
  legenda — o título nomeia a série.
- **Sequencial:** um hue, claro → escuro, a partir da escala primária.
- **Divergente:** clay ↔ indigo com neutro no meio. Nunca arco-íris.
- Grid e eixos recessivos (`neutral-300`, 1px). Barras com topo arredondado de
  4px ancoradas na base, 2px de respiro entre barras.
- Rótulo direto **seletivo** (último ponto, máximo). Nunca número em todo ponto.

## 4. Espaçamento

Base **4px**. Escala: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64`.

Densidade padrão da aplicação é **compacta**. Telas administrativas usam
`16`/`20`; o PDV usa `12`/`16`.

## 5. Raio e elevação

| Token | Valor | Uso |
|---|---|---|
| `radius-sm` | 4px | Badge, tag |
| `radius-md` | 6px | Botão, campo, card — **padrão** |
| `radius-lg` | 10px | Modal, drawer, painel |
| `radius-pill` | 999px | Pill de filtro, seletor de tabela de preço |

| Token | Valor |
|---|---|
| `shadow-sm` | `0 1px 2px rgba(26,25,23,.06)` |
| `shadow-md` | `0 2px 8px rgba(26,25,23,.08)` |
| `shadow-lg` | `0 12px 32px rgba(26,25,23,.16)` |

Raios pequenos e sombras discretas são deliberados: ferramenta de trabalho, não
app de consumo.

## 6. Dimensões de controle

| Elemento | Altura | Observação |
|---|---|---|
| Campo / botão padrão | 38px | Telas administrativas |
| Linha de tabela | 40px | Densidade compacta |
| **Botão do PDV** | **48px** | Mínimo 44px por acessibilidade e uso sob pressão |
| Barra lateral | 240px | Colapsa para 64px |
| Painel do carrinho | 420px | Fixo |

## 7. Foco e teclado

```css
outline: 2px solid var(--primary-500);
outline-offset: 2px;
```

Visível **sempre**. Nunca `outline: none` sem substituto. No PDV o foco inicia
no campo de código de barras e retorna a ele após cada item adicionado.

### Atalhos do PDV

| Tecla | Ação |
|---|---|
| `F2` | Buscar produto |
| `F4` | Selecionar cliente |
| `F6` | Trocar tabela de preços |
| `F8` | Aplicar desconto (sujeito a permissão) |
| `F9` | **Finalizar venda** |
| `Esc` | Cancelar item / fechar modal |

Os atalhos são exibidos na interface, não memorizados.

## 8. Componentes

Comportamento e acessibilidade vêm do **Radix UI** (headless). O visual é
nosso. Radix resolve foco, `aria-*`, navegação por teclado e portal —
problemas já resolvidos que não vale reimplementar.

| Componente | Base Radix | Observação |
|---|---|---|
| `Button` | — | Variantes: `primary`, `secondary`, `ghost`, `danger` |
| `Input` / `Field` | `Label` | Erro sempre textual, nunca só borda vermelha |
| `Select` / `Combobox` | `Select` | Combobox com busca assíncrona |
| `DataTable` | — | Colunas monetárias mono + alinhadas à direita |
| `Modal` | `Dialog` | |
| `Drawer` | `Dialog` | |
| `Toast` | `Toast` | |
| `Tabs` | `Tabs` | |
| `Badge` | — | Sempre ícone + texto |
| `Card`, `Pagination`, `EmptyState`, `LoadingState`, `ErrorState` | — | |
| `ProductCard` | — | Mostra saldo; destaca negativo |
| `Cart` | — | |
| `PriceTableSelector` | `ToggleGroup` | Pills |
| **`Extrato`** | — | Ver abaixo. Um componente, quatro usos |
| `PermissionGuard` | — | Não renderiza o que o usuário não pode acionar |

### `Extrato` — um componente para todo razão

Razão de estoque, extrato de carteira, movimento de caixa e histórico de
contas são **a mesma estrutura de dados** com nomes diferentes: um lançamento
imutável, com saldo antes e depois.

```
data · tipo · documento · entrada · saída · saldo anterior → posterior · autor
```

Por isso são um componente só, parametrizado:

| Uso | Entrada | Saída | Unidade do saldo |
|---|---|---|---|
| Estoque | Compra, devolução, ajuste + | Venda, transferência, perda | Unidades |
| Carteira | Depósito, quitação, crédito | Compra a prazo, taxa | R$ |
| Caixa | Suprimento, recebimento | Sangria, pagamento | R$ |
| Contas | Baixa recebida | Título emitido | R$ |

Regras que valem em todos:

1. **Ordem decrescente** — o mais recente primeiro. É como se lê extrato.
2. **Saldo corrente em toda linha.** Sem isso ninguém confere nada.
3. **Colunas de entrada e saída separadas**, nunca uma coluna com sinal. Os
   olhos somam colunas; não somam sinais.
4. **Nada é editável.** Estorno é linha nova apontando para a original.
5. **Lançamento sensível é destacado** — ajuste manual, bonificação, venda com
   saldo negativo, débito acima do limite. Com ícone e cor, nunca só cor.
6. **Rodapé com os três totais**: entradas, saídas e saldo final.
7. **Versão mobile** é lista de cartões, não tabela espremida: tipo e valor à
   esquerda e à direita, saldo em texto menor abaixo.

Duas telas já implementam: *Estoque — Razão de movimentações* e
*Carteira do cliente*. As de caixa e contas usam o mesmo componente na Fase 5.

### `PermissionGuard`

Esconder um botão é **cortesia de UX, não segurança**. Toda ação que ele
protege é obrigatoriamente revalidada no servidor. O guard existe para não
oferecer ao usuário um caminho que vai falhar — não para proteger dado.

## 9. Acessibilidade

- Contraste mínimo **4,5:1** para texto, **3:1** acima de 24px.
- Elementos reais: `<button>`, `<a href>`, `<input>` + `<label>`. Nunca
  `onClick` em `div`/`span` — o Tab pula.
- Botão só com ícone exige `aria-label`.
- Alvo de toque ≥ 44px nas telas operacionais e no mobile.
- Nenhuma informação transmitida apenas por cor.

## 10. Modo escuro

Planejado, **não** implementado na Fase 1. Quando entrar, será uma escala
própria derivada dos mesmos hues e validada contra a superfície escura — não
uma inversão automática dos tokens claros.
