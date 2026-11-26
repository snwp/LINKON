# Linkon

Aplicativo desktop de organização criativa, construído a partir do briefing `../linkon_funcionamento_geral.txt` (etapas 1 a 5) e do guia `../guia_visual_linkon.pdf`. A interface é só preto e branco (tokens em `src/app.css`). O logotipo usa a fonte Science Gothic (licença OFL, em `static/fonts/`). O ícone sai de `app-icon.svg` (Linke, o mascote: um círculo com dois olhos vazados): para regenerar, rode `npx tauri icon app-icon.svg`, apague `src-tauri/icons/android` e `ios` e copie `32x32.png` para `static/favicon.png`.

Tecnologias: Tauri 2, Rust, Svelte 5 com TypeScript e SQLite (via `rusqlite`, modo WAL).

## O que o app faz

- **Ideias e projetos:** salvamento automático com status visível (pendente, salvo ou falhou). O que estiver pendente é gravado antes de a janela fechar.
- **Biblioteca:** importa arquivos pelo seletor ou arrastando para a janela, e guarda uma cópia em `library/`. O original nunca é alterado. Tem filtros por tipo, busca, ordenação, prévia de imagem, PDF e texto, e associação a projetos e ideias.
- **Conexões:** ideia com ideia, arquivo ou projeto, e página com as referências que usa. A tela Conexões mostra um grafo e uma lista acessível.
- **Editor:** páginas com texto, imagem, bloco, seção, link e referência. Tem seleção, mover com encaixe e guias, redimensionar, camadas, inspector, desfazer e refazer (`Ctrl Z`/`Ctrl Y`), duplicar (`Ctrl D`) e salvamento automático.
- **Desktop e mobile:** cada página tem a versão desktop (1440 px) e pode ter a mobile (390 px), alternadas na barra do editor. Na primeira vez, a mobile é montada a partir da desktop (`toMobile` em `src/lib/editor/layouts.ts`): o que está dentro de um bloco, seção ou imagem vira filho dele e é empilhado em uma coluna, na ordem de leitura (corte em colunas e linhas pelo maior vão). Depois as duas versões são editadas separadamente.
- **Modelos:** ao criar uma página dá para começar de Landing page, Catálogo, Loja, Portfólio ou Link na bio, cada um com as duas versões desenhadas. Ficam em `src/lib/editor/layouts.ts`.
- **Visualização e exportação:** a visualização não mostra controles de edição e alterna entre desktop e mobile. A exportação gera um único arquivo `.html` com imagens e fontes embutidas. Com versão mobile, as duas vão no arquivo e telas de até 767 px mostram a mobile.
- **Cópia de segurança e restauração** em Configurações. Antes de restaurar, o estado atual vai para `backups/` na pasta de dados.
- **Assistente de IA no Editor:** um painel no canto monta e ajusta a página pelo que você pede. O botão direito num elemento abre um balão com um pedido só para ele, e o botão direito numa área vazia marca o ponto onde criar. Tudo o que a IA faz fica editável, e cada pedido é um único passo de desfazer.

### Como o assistente funciona

O Linkon não tem chave de API nem login próprio. Ele chama o **Claude Code instalado neste computador** (`claude -p`), com a conta em que você entrou nele, e o uso conta na sua assinatura do Claude. Para conectar, rode uma vez num terminal:

```powershell
claude auth login
```

Configurações mostra se o Claude Code foi encontrado e se a conta está conectada, e permite escolher o modelo. Em cada pedido, o Claude Code roda sem nenhuma ferramenta (não lê nem grava arquivos), numa pasta vazia do app, sem guardar a sessão e sem carregar as suas configurações e hooks. A página atual e os títulos das suas ideias e arquivos vão no pedido. A resposta chega como operações em JSON Lines (`src/lib/editor/assistant.ts`), validadas antes de serem aplicadas.

O Linkon não oferece "entrar com a conta do Claude" dentro dele porque a Anthropic não permite isso em apps de terceiros. Ele usa o Claude Code que você mesmo instalou e conectou.

A Etapa 6 do briefing (sincronização, colaboração, IA, publicação online, mobile) não foi implementada, como o próprio briefing pede.

## Rodar

```powershell
npm install
npm run tauri dev
```

`npm run dev` abre só a interface no navegador, com dados em memória que somem ao recarregar. Serve para trabalhar no visual sem compilar o Rust. Backup e restauração só funcionam no app desktop.

Para gerar o instalador:

```powershell
npm run tauri build
```

## Testes

```powershell
cd src-tauri
cargo test
npm run check
```

Os testes do backend ficam nos módulos de `src-tauri/src/` (banco, biblioteca, páginas, exportação, cópia de segurança) e rodam pelo binário `tests/db.rs`. O binário de teste que inclui o Tauri não abre com o toolchain GNU/mingw desta máquina. Pelo mesmo motivo a crate gera só `rlib`; volte a `["staticlib", "cdylib", "rlib"]` se for fazer a versão mobile.

## Onde ficam os dados

Pasta de dados do app (no Windows, `%APPDATA%\com.linkon.app`):

- `linkon.db`, com `linkon.db-wal` e `linkon.db-shm`, que fazem parte do banco.
- `library/`: cópias dos arquivos importados.
- `backups/`: estados guardados antes de cada restauração.

As migrações usam `PRAGMA user_version` e ficam em `db.rs` (versão atual: 3).

## Estrutura

- `src-tauri/src/db.rs`: esquema, migrações, ideias, projetos e conexões entre ideias.
- `src-tauri/src/library.rs`: importação, metadados, associações e prévia de texto.
- `src-tauri/src/pages.rs`: páginas do editor (documento em JSON).
- `src-tauri/src/export.rs`: grava o HTML exportado com as imagens em base64.
- `src-tauri/src/backup.rs`: cópia de segurança (`VACUUM INTO`) e restauração (backup API do SQLite).
- `src-tauri/src/ai.rs`: localiza o Claude Code, consulta o login (`claude auth status`), roda pedidos e repassa o stream.
- `src-tauri/src/lib.rs`: comandos Tauri.
- `src/lib/api.ts`: chamadas ao backend, com uma versão em memória para a prévia no navegador.
- `src/lib/editor/`: modelo do documento (`doc.ts`), editor, painel de camadas, coluna do Claude (`ClaudePanel.svelte`), renderização HTML (`render.ts`) e fontes embutidas.
- `src/lib/graph.ts`: montagem e desenho do grafo de conexões.
- `src/routes/`: Início, Projetos, Ideias, Biblioteca, Conexões, Editor, Visualizar e Configurações.

## Limitações conhecidas

- A busca de ideias pelo título não ignora acentos. A de projetos, arquivos e páginas ignora.
- As miniaturas da Biblioteca usam a imagem original reduzida pelo navegador. Com milhares de imagens, convém gerá-las no Rust.
- O grafo calcula o desenho em O(n²). Acima de cerca de 1.500 itens, convém mover o cálculo para um Web Worker.
- O HTML exportado tem duas larguras fixas (desktop e mobile), reduzidas proporcionalmente quando a tela é menor. Entre 390 e 767 px a versão mobile fica centralizada, sem esticar.
- Desktop e mobile não se sincronizam: um texto mudado numa versão precisa ser mudado na outra.
- As alturas dos textos nos modelos e na adaptação automática são estimadas; um texto muito diferente do original pode precisar de ajuste à mão.

## Gerar imagens

No editor, aba Inserir, bloco Gerar imagem: a descrição vira uma imagem guardada na pasta e colocada na página. Dois geradores, escolhidos em Configurações > Imagens:

- **Codex (padrão):** usa o Codex CLI logado no ChatGPT (`codex login`), sem chave. O Linkon roda `codex exec --json -s read-only` numa pasta vazia, manda o pedido pela entrada padrão e lê a imagem em `~/.codex/generated_images/<id da conversa>/`. Gasta o limite do plano do ChatGPT; cada imagem leva de 30 a 90 s.
- **API da OpenAI:** `gpt-image-2.6-flare` ou `gpt-image-2.6-sunburst`, cobrada por imagem. A chave fica no Gerenciador de Credenciais do Windows (entrada `Linkon`) e nunca volta para a interface.

## Sites, navegador e Vercel

- **Documentos\Linkon:** cada interface vira um site em `Documentos\Linkon\<pasta>\<interface>\` (`index.html`, `assets/`, `fit.js`, `vercel.json`), gravado depois de cada salvamento (`src-tauri/src/site.rs`). Renomear move a pasta. Pastas sem o arquivo `.linkon` não são do Linkon e nunca são sobrescritas. Apagar uma interface não apaga a pasta do site.
- **Ver no navegador:** servidor local só em 127.0.0.1, só a pasta Documentos\Linkon, recusando outro Host (DNS rebinding) e caminhos com `..` (`serve.rs`).
- **Publicar:** revisão de segurança do HTML (scripts, atributos `on…`, `javascript:`, iframe, form) e confirmação sempre; depois `vercel deploy --prod --yes` pela CLI logada do usuário (`npm i -g vercel`, `vercel login`). Cada interface é o projeto `linkon-<pasta>-<interface>`. O `vercel.json` manda CSP fechada (nada de fora, sem script embutido), HSTS, nosniff e bloqueio de iframe. Os sites são estáticos: não há formulário nem backend.
