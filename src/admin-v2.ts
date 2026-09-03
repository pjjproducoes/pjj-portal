import { logo } from './logo';
import { randomToken } from './crypto';

export function adminV2(): Response {
  const nonce = randomToken(12);

  const page = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Administração · PJJ Portal</title>

<style nonce="${nonce}">
:root{
  --black:#090909;
  --gold:#b8872c;
  --gold2:#e0b64f;
  --paper:#f5f3ee;
  --ink:#191919;
  --muted:#716e67;
  --line:#e2ded5
}

*{
  box-sizing:border-box
}

[hidden]{
  display:none !important;
}

body{
  margin:0;
  background:var(--paper);
  color:var(--ink);
  font:15px/1.5 Inter,system-ui,sans-serif
}

.app{
  display:grid;
  grid-template-columns:260px 1fr;
  min-height:100vh
}

.nav{
  background:var(--black);
  color:#fff;
  padding:28px 18px
}

.brand{
  display:flex;
  align-items:center;
  gap:10px;
  color:#fff;
  text-decoration:none;
  font-weight:800;
  letter-spacing:.04em;
  padding:0 10px 26px;
  border-bottom:1px solid #fff2
}

.brand img{
  width:42px;
  height:42px;
  border-radius:50%
}

.nav-group{
  margin:30px 0 8px 12px;
  color:#9e9a90;
  text-transform:uppercase;
  font-size:10px;
  letter-spacing:.18em
}

.nav button{
  display:block;
  width:100%;
  padding:13px 14px;
  margin:4px 0;
  border:0;
  border-radius:10px;
  background:none;
  color:#d9d5ca;
  text-align:left;
  font-weight:650;
  cursor:pointer
}

.nav button.active,
.nav button:hover{
  background:var(--gold);
  color:#fff
}

.main{
  padding:42px clamp(22px,5vw,72px);
  max-width:1500px
}

.head{
  display:flex;
  justify-content:space-between;
  align-items:flex-end;
  border-bottom:1px solid var(--line);
  padding-bottom:24px;
  margin-bottom:28px
}

.eyebrow{
  color:var(--gold);
  font-size:11px;
  letter-spacing:.2em;
  text-transform:uppercase;
  font-weight:800
}

.h1{
  font-size:clamp(32px,4vw,48px);
  letter-spacing:-.05em;
  margin:6px 0 0
}

.section{
  display:none
}

.section.active{
  display:block
}

.grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(210px,1fr));
  gap:18px
}

.card{
  background:#fff;
  border:1px solid var(--line);
  border-radius:18px;
  padding:22px;
  box-shadow:0 9px 28px #0000000b
}

.metric{
  font-size:34px;
  font-weight:800;
  margin-top:8px
}

.muted{
  color:var(--muted)
}

.toolbar{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:12px;
  margin:28px 0 14px
}

.btn{
  border:0;
  border-radius:10px;
  padding:11px 16px;
  background:var(--black);
  color:#fff;
  font-weight:700;
  cursor:pointer;
  text-decoration:none;
  display:inline-block
}

.btn.alt{
  background:#fff;
  color:var(--ink);
  border:1px solid var(--line)
}

.btn.gold{
  background:var(--gold)
}

.list{
  background:#fff;
  border:1px solid var(--line);
  border-radius:18px;
  overflow:hidden
}

.item{
  display:grid;
  grid-template-columns:1.4fr 1fr .8fr auto;
  gap:14px;
  align-items:center;
  padding:17px 20px;
  border-bottom:1px solid var(--line)
}

.item:last-child{
  border:0
}

.pill{
  display:inline-flex;
  width:max-content;
  padding:4px 9px;
  border-radius:99px;
  background:#eeeae1;
  color:#635a48;
  font-size:12px
}

.actions{
  display:flex;
  gap:8px;
  justify-content:flex-end
}

.empty{
  padding:30px;
  text-align:center;
  color:var(--muted)
}

dialog{
  border:0;
  border-radius:18px;
  padding:0;
  width:min(560px,calc(100% - 28px));
  box-shadow:0 25px 80px #0004
}

dialog::backdrop{
  background:#000b
}

.form{
  padding:28px
}

.field{
  display:grid;
  gap:6px;
  margin:14px 0
}

.field label{
  font-weight:700
}

.field input,
.field textarea,
.field select{
  width:100%;
  padding:12px;
  border:1px solid #d2cec5;
  border-radius:9px;
  font:inherit
}

.field textarea{
  min-height:100px
}

.form-actions{
  display:flex;
  justify-content:flex-end;
  gap:10px;
  margin-top:22px
}

.msg{
  min-height:22px;
  color:#9c352e
}

@media(max-width:800px){
  .app{
    grid-template-columns:1fr
  }

  .nav{
    position:static;
    padding:18px
  }

  .nav-group{
    margin-top:18px
  }

  .nav button{
    display:inline-block;
    width:auto;
    margin-right:4px
  }

  .main{
    padding:28px 18px
  }

  .item{
    grid-template-columns:1fr 1fr
  }

  .item .actions{
    grid-column:1/-1;
    justify-content:flex-start
  }
}
</style>
</head>

<body>

<div
  id="login"
  style="min-height:100vh;display:grid;place-items:center;background:var(--black);padding:20px"
>
<form
  id="loginForm"
  class="form"
  style="background:#fff;border-radius:20px;width:min(430px,100%)"
>

<a
  class="brand"
  style="background:var(--black);margin:-28px -28px 25px;padding:20px;border-radius:20px 20px 0 0"
  href="/"
>
<img src="${logo}" alt="PJJ">
<span>PJJ PORTAL</span>
</a>

<div class="eyebrow">Acesso administrativo</div>
<h1>Central PJJ</h1>

<div class="field">
<label>E-mail</label>
<input id="email" type="email" autocomplete="username" required>
</div>

<div class="field">
<label>Senha</label>
<input id="password" type="password" autocomplete="current-password" required>
</div>

<div id="loginMsg" class="msg"></div>

<button class="btn" style="width:100%">
Entrar
</button>

<button
  id="recoverOpen"
  class="btn alt"
  type="button"
  style="width:100%;margin-top:10px"
>
Redefinir senha com MFA
</button>

</form>
</div>

<div id="app" class="app" hidden>

<aside class="nav">

<a class="brand" href="/">
<img src="${logo}" alt="PJJ">
<span>PJJ PORTAL</span>
</a>

<div class="nav-group">Operação</div>

<button data-section="dashboard" class="active">Visão geral</button>
<button data-section="projects">Projetos</button>
<button data-section="assets">Arquivos e processamento</button>

<div class="nav-group">Cadastros</div>

<button data-section="clients">Clientes</button>
<button data-section="captures">Captações</button>

<div class="nav-group">Acesso</div>

<button data-section="sharing">Compartilhamentos</button>
<button data-section="audit">Auditoria</button>
<button id="logout">Sair</button>

</aside>

<main class="main">

<header class="head">

<div>
<div class="eyebrow">PJJ Produções</div>
<h1 id="title" class="h1">Visão geral</h1>
</div>

<button id="refresh" class="btn alt">
Atualizar
</button>

</header>

<section id="dashboard" class="section active">

<div id="metrics" class="grid"></div>

<div class="toolbar">
<h2>Atividade recente</h2>
<button class="btn gold" data-open="clientDialog">
Novo cliente
</button>
</div>

<div id="recent" class="list"></div>

</section>

<section id="clients" class="section">

<div class="toolbar">

<div>
<h2>Clientes</h2>
<p class="muted">Empresas e responsáveis pelas entregas.</p>
</div>

<button class="btn gold" data-open="clientDialog">
Novo cliente
</button>

</div>

<div id="clientsList" class="list"></div>

</section>

<section id="projects" class="section">

<div class="toolbar">

<div>
<h2>Projetos</h2>
<p class="muted">Empreendimentos, locais e status de publicação.</p>
</div>

<button class="btn gold" data-open="projectDialog">
Novo projeto
</button>

</div>

<div id="projectsList" class="list"></div>

</section>

<section id="assets" class="section">

<div class="toolbar">

<div>
<h2>Arquivos e processamento</h2>
<p class="muted">Revise falhas, reprocesse e publique produtos.</p>
</div>

<a class="btn gold" href="/admin/operations">
Abrir central operacional
</a>

</div>

<div id="assetsList" class="list"></div>

</section>

<section id="captures" class="section">

<div class="toolbar">

<div>
<h2>Captações</h2>
<p class="muted">
Campanhas organizadas por data dentro dos projetos.
</p>
</div>

<button class="btn gold" data-open="captureDialog">
Nova captação
</button>

</div>

<div id="capturesList" class="list"></div>

</section>

<section id="sharing" class="section">

<div class="toolbar">

<div>
<h2>Compartilhamentos</h2>
<p class="muted">
Convites, links e embeds com validade e permissão.
</p>
</div>

<a class="btn gold" href="/admin/operations">
Gerenciar acessos
</a>

</div>

<div class="card">
A gestão detalhada de convites, embeds e links seguros está na Central operacional.
</div>

</section>

<section id="audit" class="section">

<div class="toolbar">

<div>
<h2>Auditoria</h2>
<p class="muted">
Histórico de ações administrativas e acessos.
</p>
</div>

<a class="btn gold" href="/admin/operations">
Abrir auditoria completa
</a>

</div>

<div id="auditList" class="list"></div>

</section>

</main>
</div>

<dialog id="clientDialog">

<form id="clientForm" class="form">

<h2>Novo cliente</h2>

<div class="field">
<label>Nome</label>
<input name="name" required>
</div>

<div class="field">
<label>Contato</label>
<input name="primaryContactName">
</div>

<div class="field">
<label>E-mail</label>
<input name="email" type="email">
</div>

<div class="form-actions">
<button type="button" class="btn alt" data-close>
Cancelar
</button>
<button class="btn gold">
Criar cliente
</button>
</div>

<div class="msg" data-msg></div>

</form>

</dialog>

<dialog id="projectDialog">

<form id="projectForm" class="form">

<h2>Novo projeto</h2>

<div class="field">
<label>Cliente</label>
<select
  name="clientId"
  id="clientSelect"
  required
></select>
</div>

<div class="field">
<label>Nome</label>
<input name="name" required>
</div>

<div class="field">
<label>Localização</label>
<input name="location">
</div>

<div class="field">
<label>Descrição</label>
<textarea name="description"></textarea>
</div>

<div class="form-actions">
<button type="button" class="btn alt" data-close>
Cancelar
</button>
<button class="btn gold">
Criar projeto
</button>
</div>

<div class="msg" data-msg></div>

</form>

</dialog>

<dialog id="captureDialog">

<form id="captureForm" class="form">

<input name="id" type="hidden">

<h2 id="captureDialogTitle">
Nova captação
</h2>

<div class="field">
<label>Projeto</label>
<select
  name="projectId"
  id="captureProjectSelect"
  required
></select>
</div>

<div class="field">
<label>Data e hora</label>
<input
  name="capturedAt"
  type="datetime-local"
  required
>
</div>

<div class="field">
<label>Título</label>
<input name="title">
</div>

<div class="field">
<label>Descrição</label>
<textarea name="description"></textarea>
</div>

<div class="form-actions">

<button
  type="button"
  class="btn alt"
  data-crud-close
>
Cancelar
</button>

<button class="btn gold">
Salvar captação
</button>

</div>

<div class="msg" data-msg></div>

</form>
</dialog>

<dialog id="projectEditDialog">

<form id="projectEditForm" class="form">

<input name="id" type="hidden">

<h2>Editar projeto</h2>

<div class="field">
<label>Nome</label>
<input name="name" required>
</div>

<div class="field">
<label>Localização</label>
<input name="location_text">
</div>

<div class="field">
<label>Descrição</label>
<textarea name="description"></textarea>
</div>

<div class="field">
<label>Visibilidade</label>

<select name="visibility">

<option value="private">
Privado
</option>

<option value="shared">
Compartilhado
</option>

<option value="public_demo">
Demonstração pública
</option>

</select>

</div>

<div class="form-actions">

<button
  type="button"
  class="btn alt"
  data-crud-close
>
Cancelar
</button>

<button class="btn gold">
Salvar alterações
</button>

</div>

<div class="msg" data-msg></div>

</form>
</dialog>

<script nonce="${nonce}">

let csrf = '';
let mfaChallenge = '';

const $ = s => document.querySelector(s);

const esc = v =>
  String(v ?? '').replace(
    /[&<>"']/g,
    c => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    }[c])
  );

async function api(p, o = {}) {

  o.headers = {
    'content-type':'application/json',
    ...(csrf ? {'x-csrf-token': csrf} : {}),
    ...(o.headers || {})
  };

  const r = await fetch(p, o);

  const d = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw Object.assign(
      new Error(
        d.error?.message ||
        'Falha na operação'
      ),
      { status:r.status }
    );
  }

  return d;
}

const labels = {
  dashboard:'Visão geral',
  clients:'Clientes',
  projects:'Projetos',
  assets:'Arquivos e processamento',
  captures:'Captações',
  sharing:'Compartilhamentos',
  audit:'Auditoria'
};

function section(name) {

  document
    .querySelectorAll('.section')
    .forEach(
      x => x.classList.toggle(
        'active',
        x.id === name
      )
    );

  document
    .querySelectorAll('[data-section]')
    .forEach(
      x => x.classList.toggle(
        'active',
        x.dataset.section === name
      )
    );

  $('#title').textContent =
    labels[name] || name;

  if (name === 'clients')
    renderClients();

  if (name === 'projects')
    renderProjects();

  if (name === 'assets')
    renderAssets();

  if (name === 'captures')
    renderCaptures();

  if (name === 'audit')
    renderAudit();
}

document
  .querySelectorAll('[data-section]')
  .forEach(
    b => b.onclick = () =>
      section(b.dataset.section)
  );

document
  .querySelectorAll('[data-open]')
  .forEach(
    b => b.onclick = () => {

      const id = b.dataset.open;

      if (id === 'captureDialog') {
        openNewCapture();
        return;
      }

      document
        .querySelector('#' + id)
        ?.showModal();
    }
  );

document
  .querySelectorAll('[data-close]')
  .forEach(
    b => b.onclick = () =>
      b.closest('dialog')?.close()
  );

document
  .querySelectorAll('[data-crud-close]')
  .forEach(
    b => b.onclick = () => {

      b.closest('dialog')?.close();

      const f = b.closest('form');

      if (
        f &&
        f.id === 'captureForm'
      ) {
        f.projectId.disabled = false;
      }
    }
  );

async function renderClients() {

  const d =
    await api('/api/admin/clients');

  $('#clientsList').innerHTML =
    (d.items || [])
      .map(
        x =>
          '<div class="item">' +
            '<strong>' + esc(x.name) + '</strong>' +
            '<span>' + esc(x.email || 'Sem e-mail') + '</span>' +
            '<span class="pill">' + esc(x.status) + '</span>' +
            '<span></span>' +
          '</div>'
      )
      .join('')
    ||
    '<div class="empty">Nenhum cliente cadastrado.</div>';
}

let crudProjects = [];

async function refreshCrudProjects() {

  const d =
    await api('/api/admin/projects');

  crudProjects = d.items || [];

  const captureSelect =
    document.querySelector('#captureProjectSelect');

  if (captureSelect) {

    captureSelect.innerHTML =
      crudProjects
        .map(
          x =>
            '<option value="' + x.id + '">' +
            esc(x.name) +
            '</option>'
        )
        .join('');
  }

  return crudProjects;
}

async function renderProjects() {

  const d =
    await api('/api/admin/projects');

  crudProjects = d.items || [];

  $('#projectsList').innerHTML =
    crudProjects
      .map(
        x =>
          '<div class="item">' +
            '<strong>' + esc(x.name) + '</strong>' +
            '<span>' + esc(x.client_name || '') + '</span>' +
            '<span class="pill">' + esc(x.status) + '</span>' +
            '<span class="actions">' +
              '<button class="btn alt" data-project-edit="' + x.id + '">' +
                'Editar' +
              '</button>' +
              '<button class="btn alt" data-project-captures="' + x.id + '">' +
                'Captações' +
              '</button>' +
            '</span>' +
          '</div>'
      )
      .join('')
    ||
    '<div class="empty">Nenhum projeto cadastrado.</div>';

  document
    .querySelectorAll('[data-project-edit]')
    .forEach(
      b => b.onclick = () => {

        const x =
          crudProjects.find(
            v =>
              v.id ===
              b.dataset.projectEdit
          );

        if (!x)
          return;

        const f =
          document.querySelector(
            '#projectEditForm'
          );

        f.reset();

        f.id.value = x.id;
        f.name.value = x.name || '';
        f.location_text.value =
          x.location_text || '';
        f.description.value =
          x.description || '';
        f.visibility.value =
          x.visibility || 'private';

        document
          .querySelector(
            '#projectEditDialog'
          )
          .showModal();
      }
    );

  document
    .querySelectorAll(
      '[data-project-captures]'
    )
    .forEach(
      b => b.onclick = () => {

        section('captures');

        setTimeout(
          () => {

            const add =
              [
                ...document.querySelectorAll(
                  '[data-capture-new]'
                )
              ]
              .find(
                x =>
                  x.dataset.captureNew ===
                  b.dataset.projectCaptures
              );

            if (add) {
              add.scrollIntoView({
                behavior:'smooth',
                block:'center'
              });
            }
          },
          100
        );
      }
    );
}

function openNewCapture(projectId) {

  const f =
    document.querySelector(
      '#captureForm'
    );

  f.reset();

  f.id.value = '';
  f.projectId.disabled = false;

  document
    .querySelector(
      '#captureDialogTitle'
    )
    .textContent = 'Nova captação';

  refreshCrudProjects()
    .then(
      () => {

        if (projectId) {
          f.projectId.value =
            projectId;
        }

        document
          .querySelector(
            '#captureDialog'
          )
          .showModal();
      }
    )
    .catch(
      e => alert(e.message)
    );
}

async function editCapture(
  projectId,
  captureId
) {

  try {

    const d =
      await api(
        '/api/admin/projects/' +
        projectId +
        '/captures'
      );

    const x =
      (d.items || [])
        .find(
          v => v.id === captureId
        );

    if (!x) {
      throw new Error(
        'Captação não encontrada.'
      );
    }

    const f =
      document.querySelector(
        '#captureForm'
      );

    f.reset();

    f.id.value = x.id;

    await refreshCrudProjects();

    f.projectId.value =
      projectId;

    f.projectId.disabled = true;

    f.capturedAt.value =
      (x.captured_at || '')
        .slice(0,16);

    f.title.value =
      x.title || '';

    f.description.value =
      x.description || '';

    document
      .querySelector(
        '#captureDialogTitle'
      )
      .textContent = 'Editar captação';

    document
      .querySelector(
        '#captureDialog'
      )
      .showModal();

  } catch(e) {

    alert(e.message);
  }
}

async function renderCaptures() {

  const projects =
    await refreshCrudProjects();

  if (!projects.length) {

    document
      .querySelector(
        '#capturesList'
      )
      .innerHTML =
        '<div class="empty">' +
        'Crie um projeto antes de adicionar captações.' +
        '</div>';

    return;
  }

  const groups =
    await Promise.all(
      projects.map(
        async p => ({

          project:p,

          items:
            (
              await api(
                '/api/admin/projects/' +
                p.id +
                '/captures'
              )
            ).items || []

        })
      )
    );

  document
    .querySelector(
      '#capturesList'
    )
    .innerHTML =
      groups
        .map(
          g =>

            '<div style="padding:18px 20px;border-bottom:1px solid var(--line)">' +

              '<div class="toolbar" style="margin:0 0 10px">' +

                '<strong>' +
                  esc(g.project.name) +
                '</strong>' +

                '<button class="btn gold" data-capture-new="' + g.project.id + '">' +
                  'Nova captação' +
                '</button>' +

              '</div>' +

              (
                g.items
                  .map(
                    x =>

                      '<div class="item">' +

                        '<strong>' +
                          esc(
                            x.title ||
                            new Date(
                              x.captured_at
                            )
                            .toLocaleDateString(
                              'pt-BR'
                            )
                          ) +
                        '</strong>' +

                        '<span>' +
                          esc(
                            new Date(
                              x.captured_at
                            )
                            .toLocaleString(
                              'pt-BR'
                            )
                          ) +
                        '</span>' +

                        '<span class="pill">' +
                          esc(x.status) +
                        '</span>' +

                        '<button class="btn alt" data-capture-edit="' + x.id + '" data-project="' + g.project.id + '">' +
                          'Editar' +
                        '</button>' +

                      '</div>'
                  )
                  .join('')
                ||
                '<div class="empty">' +
                  'Nenhuma captação.' +
                '</div>'
              ) +

            '</div>'
        )
        .join('');

  document
    .querySelectorAll(
      '[data-capture-new]'
    )
    .forEach(
      b => b.onclick =
        () =>
          openNewCapture(
            b.dataset.captureNew
          )
    );

  document
    .querySelectorAll(
      '[data-capture-edit]'
    )
    .forEach(
      b => b.onclick =
        () =>
          editCapture(
            b.dataset.project,
            b.dataset.captureEdit
          )
    );
}

async function renderAssets() {

  try {

    const d =
      await api(
        '/api/admin/assets'
      );

    $('#assetsList').innerHTML =
      (d.items || [])
        .map(
          x =>
            '<div class="item">' +
              '<strong>' + esc(x.title || x.original_name || 'Arquivo') + '</strong>' +
              '<span>' + esc(x.type || '') + '</span>' +
              '<span class="pill">' + esc(x.status || '') + '</span>' +
              '<span></span>' +
            '</div>'
        )
        .join('')
      ||
      '<div class="empty">Nenhum arquivo encontrado.</div>';

  } catch(e) {

    $('#assetsList').innerHTML =
      '<div class="empty">' +
      esc(e.message) +
      '</div>';
  }
}

async function renderAudit() {

  try {

    const d =
      await api(
        '/api/admin/audit'
      );

    $('#auditList').innerHTML =
      (d.items || [])
        .map(
          x =>
            '<div class="item">' +
              '<strong>' + esc(x.action || 'Ação') + '</strong>' +
              '<span>' + esc(x.actor_email || '') + '</span>' +
              '<span>' + esc(x.created_at || '') + '</span>' +
              '<span></span>' +
            '</div>'
        )
        .join('')
      ||
      '<div class="empty">Nenhum registro.</div>';

  } catch(e) {

    $('#auditList').innerHTML =
      '<div class="empty">' +
      esc(e.message) +
      '</div>';
  }
}

async function load() {

  const [
    clients,
    projects
  ] =
  await Promise.all([
    api('/api/admin/clients'),
    api('/api/admin/projects')
  ]);

  const clientItems =
    clients.items || [];

  const projectItems =
    projects.items || [];

  crudProjects =
    projectItems;

  document
    .querySelector(
      '#clientSelect'
    )
    .innerHTML =
      clientItems
        .map(
          x =>
            '<option value="' + x.id + '">' +
            esc(x.name) +
            '</option>'
        )
        .join('');

  $('#metrics').innerHTML =

    '<div class="card">' +
      '<div class="muted">Clientes</div>' +
      '<div class="metric">' + clientItems.length + '</div>' +
    '</div>' +

    '<div class="card">' +
      '<div class="muted">Projetos</div>' +
      '<div class="metric">' + projectItems.length + '</div>' +
    '</div>' +

    '<div class="card">' +
      '<div class="muted">Portal</div>' +
      '<div class="metric">Online</div>' +
    '</div>';

  $('#recent').innerHTML =
    projectItems
      .slice(0,8)
      .map(
        x =>
          '<div class="item">' +
            '<strong>' + esc(x.name) + '</strong>' +
            '<span>' + esc(x.client_name || '') + '</span>' +
            '<span class="pill">' + esc(x.status || '') + '</span>' +
            '<span></span>' +
          '</div>'
      )
      .join('')
    ||
    '<div class="empty">Nenhuma atividade recente.</div>';
}

document
  .querySelector(
    '#clientForm'
  )
  .onsubmit =
    async e => {

      e.preventDefault();

      const f = e.currentTarget;
      const m =
        f.querySelector(
          '[data-msg]'
        );

      m.textContent = 'Salvando…';

      const d =
        Object.fromEntries(
          new FormData(f)
        );

      try {

        await api(
          '/api/admin/clients',
          {
            method:'POST',
            body:JSON.stringify(d)
          }
        );

        f.closest(
          'dialog'
        ).close();

        f.reset();

        m.textContent = '';

        await load();
        await renderClients();

      } catch(x) {

        m.textContent = x.message;
      }
    };

document
  .querySelector(
    '#projectForm'
  )
  .onsubmit =
    async e => {

      e.preventDefault();

      const f = e.currentTarget;
      const m =
        f.querySelector(
          '[data-msg]'
        );

      m.textContent = 'Salvando…';

      const d =
        Object.fromEntries(
          new FormData(f)
        );

      try {

        await api(
          '/api/admin/projects',
          {
            method:'POST',
            body:JSON.stringify(d)
          }
        );

        f.closest(
          'dialog'
        ).close();

        f.reset();

        m.textContent = '';

        await load();
        await renderProjects();

      } catch(x) {

        m.textContent = x.message;
      }
    };

document
  .querySelector(
    '#projectEditForm'
  )
  .onsubmit =
    async e => {

      e.preventDefault();

      const f = e.currentTarget;

      const m =
        f.querySelector(
          '[data-msg]'
        );

      const d =
        Object.fromEntries(
          new FormData(f)
        );

      const id = d.id;

      delete d.id;

      m.textContent = 'Salvando…';

      try {

        await api(
          '/api/admin/projects/' + id,
          {
            method:'PATCH',
            body:JSON.stringify(d)
          }
        );

        f.closest(
          'dialog'
        ).close();

        m.textContent = '';

        await load();
        await renderProjects();

      } catch(x) {

        m.textContent = x.message;
      }
    };

document
  .querySelector(
    '#captureForm'
  )
  .onsubmit =
    async e => {

      e.preventDefault();

      const f = e.currentTarget;

      const m =
        f.querySelector(
          '[data-msg]'
        );

      const id =
        f.id.value;

      const projectId =
        f.projectId.value;

      const data = {
        capturedAt:
          f.capturedAt.value,

        title:
          f.title.value,

        description:
          f.description.value
      };

      m.textContent = 'Salvando…';

      try {

        if (id) {

          await api(
            '/api/admin/captures/' + id,
            {
              method:'PATCH',

              body:JSON.stringify({

                captured_at:
                  new Date(
                    data.capturedAt
                  )
                  .toISOString(),

                title:
                  data.title,

                description:
                  data.description
              })
            }
          );

        } else {

          await api(
            '/api/admin/projects/' +
            projectId +
            '/captures',
            {
              method:'POST',
              body:JSON.stringify(data)
            }
          );
        }

        f.projectId.disabled = false;

        f.closest(
          'dialog'
        ).close();

        f.reset();

        m.textContent = '';

        await load();
        await renderCaptures();

      } catch(x) {

        m.textContent = x.message;
      }
    };

document
  .querySelector(
    '#refresh'
  )
  .onclick =
    async () => {

      await load();

      const current =
        document
          .querySelector(
            '.section.active'
          )?.id;

      if (current) {
        section(current);
      }
    };

document
  .querySelector(
    '#logout'
  )
  .onclick =
    async () => {

      try {
        await api(
          '/api/auth/logout',
          { method:'POST' }
        );
      } catch {}

      location.reload();
    };

async function finishAdminLogin() {

  const me =
    await api(
      '/api/auth/me'
    );

  csrf =
    me.csrfToken ||
    csrf;

  document
    .querySelector(
      '#login'
    )
    .hidden = true;

  document
    .querySelector(
      '#app'
    )
    .hidden = false;

  await load();
}

document
  .querySelector(
    '#loginForm'
  )
  .onsubmit =
    async e => {

      e.preventDefault();

      const m =
        document.querySelector(
          '#loginMsg'
        );

      m.textContent =
        'Verificando…';

      try {

        const d =
          await api(
            '/api/auth/login',
            {
              method:'POST',

              body:JSON.stringify({
                email:
                  document
                    .querySelector(
                      '#email'
                    )
                    .value,

                password:
                  document
                    .querySelector(
                      '#password'
                    )
                    .value
              })
            }
          );

        if (d.mfaRequired) {

          m.textContent =
            'Esta conta exige MFA. Use o fluxo de autenticação configurado.';

          return;
        }

        csrf =
          d.csrfToken ||
          '';

        await finishAdminLogin();

      } catch(x) {

        m.textContent =
          x.message;
      }
    };

api('/api/auth/me')
  .then(
    async d => {

      csrf =
        d.csrfToken ||
        '';

      await finishAdminLogin();
    }
  )
  .catch(() => {});

</script>

</body>
</html>`;

  return new Response(page, {
    status:200,
    headers:{
      'content-type':'text/html; charset=utf-8',
      'cache-control':'no-store',
      'content-security-policy':
  `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'`
