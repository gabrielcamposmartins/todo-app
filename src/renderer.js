// ============================================================
//  Estado
// ============================================================
let state = { config: null, tasks: [] };
let editingId = null; // id da tarefa em edição (null = nova)
let draftAttachments = []; // anexos do formulário atual
const expandedIds = new Set(); // cards expandidos (clique expande, não edita)
const expandedNoteExt = new Set(); // mini-cards de nota expandidos dentro do to-do

const $ = (sel) => document.querySelector(sel);

// ============================================================
//  Perfis de cores (paletas)
// ============================================================
const THEMES = {
  midnight: {
    name: 'Azul Noturno',
    accent: '#4c8dff',
    accentRgb: '76, 141, 255',
    text: '#f4f6fb',
    textDim: '#aab2c5',
    bg: '20, 24, 34',
  },
  nebula: {
    name: 'Nébula (Violeta)',
    accent: '#a855f7',
    accentRgb: '168, 85, 247',
    text: '#f5f0fb',
    textDim: '#bcb0cf',
    bg: '26, 20, 38',
  },
  emerald: {
    name: 'Esmeralda',
    accent: '#10b981',
    accentRgb: '16, 185, 129',
    text: '#eefcf5',
    textDim: '#a3c2b5',
    bg: '14, 26, 22',
  },
  sunset: {
    name: 'Pôr do Sol (Âmbar)',
    accent: '#f59e0b',
    accentRgb: '245, 158, 11',
    text: '#fdf6ec',
    textDim: '#c9b79c',
    bg: '30, 22, 15',
  },
  rose: {
    name: 'Rosé',
    accent: '#ec4899',
    accentRgb: '236, 72, 153',
    text: '#fdeef5',
    textDim: '#caa9b8',
    bg: '30, 17, 24',
  },
  ocean: {
    name: 'Oceano (Ciano)',
    accent: '#06b6d4',
    accentRgb: '6, 182, 212',
    text: '#ecfafe',
    textDim: '#9bb9c2',
    bg: '12, 26, 31',
  },
  crimson: {
    name: 'Carmesim',
    accent: '#ef4444',
    accentRgb: '239, 68, 68',
    text: '#fdeeee',
    textDim: '#c7a8a8',
    bg: '28, 17, 17',
  },
  graphite: {
    name: 'Grafite (Claro)',
    accent: '#2563eb',
    accentRgb: '37, 99, 235',
    text: '#1b2230',
    textDim: '#5a6473',
    bg: '236, 239, 245',
  },
};

function applyTheme() {
  const t = THEMES[state.config.theme] || THEMES.midnight;
  const root = document.documentElement.style;
  root.setProperty('--accent', t.accent);
  root.setProperty('--accent-rgb', t.accentRgb);
  root.setProperty('--text', t.text);
  root.setProperty('--text-dim', t.textDim);
  root.setProperty('--bg', t.bg);
}

// ============================================================
//  Click-through: liga a captura do mouse só sobre o painel/bolha
// ============================================================
let interactiveNow = false;
let lastMouse = { x: -1, y: -1 };

function updateInteractivity(x, y) {
  let over = false;
  const el = document.elementFromPoint(x, y);
  if (state.config && state.config.displayMode === 'passive') {
    // No modo passivo só o botão de sair captura o mouse; o resto atravessa.
    over = !!(el && el.closest('.passive-exit'));
  } else {
    over = !!(el && el.closest('.interactive:not(.hidden)'));
  }
  if (over !== interactiveNow) {
    interactiveNow = over;
    window.api.setInteractive(over);
  }
}

// Reavalia o click-through na posição atual do mouse, forçando o envio do
// comando (usado ao trocar de modo, quando o estado precisa ser corrigido).
function refreshInteractivity() {
  interactiveNow = null; // sentinela: garante que updateInteractivity reenvie
  updateInteractivity(lastMouse.x, lastMouse.y);
}

window.addEventListener('mousemove', (e) => {
  lastMouse = { x: e.clientX, y: e.clientY };
  if (dragging || resizing) return; // a janela já está capturando o mouse
  updateInteractivity(e.clientX, e.clientY);
});

window.addEventListener('mouseleave', () => {
  if (interactiveNow) {
    interactiveNow = false;
    window.api.setInteractive(false);
  }
});

// ============================================================
//  Persistência
// ============================================================
async function persist() {
  await window.api.saveData(state);
}

// ============================================================
//  Navegação entre telas
// ============================================================
const VIEWS = {
  list: 'view-list',
  form: 'view-form',
  settings: 'view-settings',
  calendar: 'view-calendar',
  notes: 'view-notes',
  noteform: 'view-noteform',
};

function showView(name) {
  Object.entries(VIEWS).forEach(([key, id]) => {
    $('#' + id).classList.toggle('hidden', key !== name);
  });
  // Destaca o botão da barra correspondente à tela aberta.
  $('#btn-calendar').classList.toggle('toggled', name === 'calendar');
  $('#btn-notes').classList.toggle('toggled', name === 'notes');
}

// ============================================================
//  Aparência (opacidade / largura / modos)
// ============================================================
function applyAppearance() {
  const { opacity, width, height, cardMode, enlarged } = state.config;
  document.documentElement.style.setProperty('--panel-opacity', opacity);
  const panel = $('#panel');

  document.body.classList.toggle('cards-compact', cardMode === 'compact');
  document.body.classList.toggle('enlarged', enlarged);
  $('#btn-cardmode').classList.toggle('toggled', cardMode === 'compact');
  $('#btn-enlarge').classList.toggle('toggled', enlarged);

  if (enlarged) {
    // Painel ocupa a tela com margens (%) em todos os lados.
    const m = Math.max(0, Math.min(45, state.config.enlargedMargin));
    panel.style.right = 'auto';
    panel.style.left = `${m}%`;
    panel.style.top = `${m}%`;
    panel.style.width = `${100 - 2 * m}%`;
    panel.style.height = `${100 - 2 * m}%`;
    return;
  }

  panel.style.width = `${width}px`;
  // No modo passivo a altura acompanha os cards (ignora altura fixa do resize).
  const passive = state.config.displayMode === 'passive';
  panel.style.height = !passive && height ? `${height}px` : '';
  applyPosition();
}

// Aplica a proteção contra captura: se NÃO deve aparecer na transmissão,
// ativa a proteção (o conteúdo some em gravações/streams).
function applyStreamVisibility() {
  window.api.setContentProtection(!state.config.showWhenStreaming);
}

function applyPosition() {
  const panel = $('#panel');
  const pos = state.config.position;
  if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
    panel.style.right = 'auto';
    panel.style.left = `${pos.left}px`;
    panel.style.top = `${pos.top}px`;
  } else {
    panel.style.left = 'auto';
    panel.style.right = '12px';
    panel.style.top = '12px';
  }
}

// Atualiza o badge vermelho da bolha com o total de tarefas não concluídas.
function updateBubbleBadge() {
  const pending = state.tasks.filter((t) => !t.done).length;
  const badge = $('#bubble-badge');
  badge.textContent = pending > 99 ? '99+' : String(pending);
  // Esconde se zerado ou se o contador estiver desativado nas configurações.
  badge.classList.toggle('hidden', pending === 0 || !state.config.showBubbleBadge);
}

// ============================================================
//  Modos de exibição: normal | passive | collapsed
// ============================================================
function setDisplayMode(mode) {
  // Ao recolher, posiciona a bolha no canto da tela onde o painel estava.
  if (mode === 'collapsed') positionBubbleToPanel();

  state.config.displayMode = mode;
  document.body.classList.toggle('mode-passive', mode === 'passive');
  $('#panel').classList.toggle('hidden', mode === 'collapsed');
  $('#bubble').classList.toggle('hidden', mode !== 'collapsed');
  $('#btn-passive').classList.toggle('toggled', mode === 'passive');
  if (mode === 'passive') showView('list');
  // Re-renderiza para aplicar o filtro (ex.: ocultar concluídas no passivo).
  renderList();
  // Ajusta a altura: automática (abraça os cards) no passivo; fixa no normal.
  applyAppearance();
  // Reavalia click-through imediatamente na posição atual do mouse.
  refreshInteractivity();
  persist();
}

// Coloca a bolha respeitando a altura (vertical) em que o painel estava,
// alinhada ao lado (esquerda/direita) correspondente.
function positionBubbleToPanel() {
  const rect = $('#panel').getBoundingClientRect();
  const bubble = $('#bubble');
  const SIZE = 46; // tamanho da bolha
  const EDGE = 6; // folga das bordas da tela
  const clamp = (v, max) => Math.max(EDGE, Math.min(v, max - SIZE - EDGE));

  // Vertical: mesma altura do topo do painel (limitada à tela).
  bubble.style.bottom = 'auto';
  bubble.style.top = `${clamp(rect.top, window.innerHeight)}px`;

  // Horizontal: lado correspondente, alinhado à borda do painel.
  const cx = rect.left + rect.width / 2;
  if (cx > window.innerWidth / 2) {
    bubble.style.left = 'auto';
    bubble.style.right = `${clamp(window.innerWidth - rect.right, window.innerWidth)}px`;
  } else {
    bubble.style.right = 'auto';
    bubble.style.left = `${clamp(rect.left, window.innerWidth)}px`;
  }
}

// Permite rolar as abas horizontalmente com a roda do mouse.
function bindTabsWheel() {
  ['#tabs-profile', '#tabs-project'].forEach((sel) => {
    const nav = $(sel);
    nav.addEventListener(
      'wheel',
      (e) => {
        if (nav.scrollWidth <= nav.clientWidth) return;
        e.preventDefault();
        nav.scrollLeft += e.deltaY + e.deltaX;
      },
      { passive: false }
    );
  });
}

// ============================================================
//  Perfis e projetos (abas)
// ============================================================
function activeProfile() {
  return (
    state.config.profiles.find((p) => p.id === state.config.activeProfileId) ||
    state.config.profiles[0]
  );
}

function renderTabs() {
  // Perfis
  const navP = $('#tabs-profile');
  navP.innerHTML = '';
  state.config.profiles.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'tab' + (p.id === state.config.activeProfileId ? ' active' : '');
    b.textContent = p.name;
    b.addEventListener('click', () => {
      state.config.activeProfileId = p.id;
      state.config.activeProjectId = p.projects[0].id;
      persist();
      renderTabs();
      renderList();
      if (isCalendarOpen()) renderCalendar();
      if (isNotesOpen()) renderNotes();
    });
    navP.appendChild(b);
  });

  // Projetos da seção ativa (+ aba agregada "Tudo" se habilitada)
  const navJ = $('#tabs-project');
  navJ.innerHTML = '';

  const selectProject = (id) => {
    state.config.activeProjectId = id;
    persist();
    renderTabs();
    renderList();
    if (isCalendarOpen()) renderCalendar();
    if (isNotesOpen()) renderNotes();
  };

  if (activeProfile().mergeProjects) {
    const b = document.createElement('button');
    b.className = 'tab' + (state.config.activeProjectId === ALL_PROJECTS ? ' active' : '');
    b.textContent = 'Tudo';
    b.addEventListener('click', () => selectProject(ALL_PROJECTS));
    navJ.appendChild(b);
  }

  activeProfile().projects.forEach((pj) => {
    const b = document.createElement('button');
    b.className = 'tab' + (pj.id === state.config.activeProjectId ? ' active' : '');
    b.textContent = pj.name;
    b.addEventListener('click', () => selectProject(pj.id));
    navJ.appendChild(b);
  });
}

// Id da aba agregada que mostra os to-dos de todos os projetos da seção.
const ALL_PROJECTS = '__all__';

// Verdadeiro quando a aba ativa é a agregada "Tudo".
function isAllProjects() {
  return state.config.activeProjectId === ALL_PROJECTS;
}

// Projeto efetivo para criar itens quando na aba "Tudo" (1º projeto da seção).
function effectiveProjectId() {
  return isAllProjects() ? activeProfile().projects[0].id : state.config.activeProjectId;
}

// Filtro de pertencimento de um item à aba atual (seção + projeto ou "Tudo").
function inActiveTab(item) {
  if (item.profileId !== state.config.activeProfileId) return false;
  return isAllProjects() || item.projectId === state.config.activeProjectId;
}

// ============================================================
//  Prioridades
// ============================================================
function getPriority(id) {
  return (
    state.config.priorities.find((p) => p.id === id) ||
    state.config.priorities[0]
  );
}

function fillPrioritySelect() {
  const sel = $('#f-priority');
  sel.innerHTML = '';
  state.config.priorities.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

// ============================================================
//  Ordenação + filtro por perfil/projeto
// ============================================================
function isRecurring(t) {
  return t.recurrence && t.recurrence !== 'none';
}

function visibleTasks() {
  const { sort, showRecurring, displayMode } = state.config;
  const mult = sort.dir === 'desc' ? -1 : 1;
  const prioWeight = (id) => {
    const p = getPriority(id);
    return p ? p.weight : 999;
  };

  return state.tasks
    .filter(inActiveTab)
    .filter((t) => showRecurring || !isRecurring(t)) // ocultar recorrentes (opção)
    .filter((t) => displayMode !== 'passive' || !t.done) // sem concluídas no passivo
    .sort((a, b) => {
      // Concluídas sempre vão para o final, independente da ordenação.
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      let cmp = 0;
      switch (sort.field) {
        case 'priority':
          cmp = prioWeight(a.priorityId) - prioWeight(b.priorityId);
          break;
        case 'deadline': {
          const av = a.deadline ? new Date(a.deadline).getTime() : Infinity;
          const bv = b.deadline ? new Date(b.deadline).getTime() : Infinity;
          cmp = av - bv;
          break;
        }
        case 'name':
          cmp = a.name.localeCompare(b.name, 'pt-BR');
          break;
        case 'created':
          cmp = a.createdAt - b.createdAt;
          break;
      }
      if (cmp === 0) cmp = prioWeight(a.priorityId) - prioWeight(b.priorityId);
      if (cmp === 0) cmp = a.createdAt - b.createdAt;
      return cmp * mult;
    });
}

// ============================================================
//  Renderização da lista de tarefas
// ============================================================
function formatDeadline(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const opts = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
  return { label: d.toLocaleString('pt-BR', opts), late: d.getTime() < Date.now() };
}

const RECUR_LABELS = {
  hourly: 'Por hora',
  daily: 'Diária',
  monthly: 'Mensal',
  yearly: 'Anual',
};

// Avança uma data segundo a recorrência.
function advanceDate(date, recurrence) {
  const d = new Date(date);
  switch (recurrence) {
    case 'hourly':
      d.setHours(d.getHours() + 1);
      break;
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}

// Concluir uma tarefa recorrente: reagenda para a próxima ocorrência e mantém ativa.
function rollRecurring(task) {
  let base = task.deadline ? new Date(task.deadline) : new Date();
  if (base.getTime() < Date.now()) base = new Date(); // se atrasada, parte de agora
  task.deadline = advanceDate(base, task.recurrence).toISOString();
  task.done = false;
}

// Cria um botão de ação do card com ícone + rótulo (rótulo some no compacto).
function makeActionBtn(icon, label, extraClass, handler) {
  const btn = document.createElement('button');
  btn.className = 'icon-btn' + (extraClass ? ' ' + extraClass : '');
  const ico = document.createElement('span');
  ico.className = 'ico';
  ico.textContent = icon;
  const lbl = document.createElement('span');
  lbl.className = 'lbl';
  lbl.textContent = label;
  btn.append(ico, lbl);
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); // não dispara o expandir do card
    handler();
  });
  return btn;
}

function renderList() {
  const ul = $('#task-list');
  ul.innerHTML = '';
  const tasks = visibleTasks();

  $('#empty-msg').classList.toggle('hidden', tasks.length > 0);
  updateBubbleBadge();

  tasks.forEach((task) => {
    const prio = getPriority(task.priorityId);
    const li = document.createElement('li');
    li.className = 'card' + (task.done ? ' done' : '');
    if (expandedIds.has(task.id)) li.classList.add('expanded');
    li.style.setProperty('--card-color', prio.color);

    const top = document.createElement('div');
    top.className = 'card__top';

    const title = document.createElement('span');
    title.className = 'card__title';
    title.textContent = task.name;

    const badge = document.createElement('span');
    badge.className = 'card__badge';
    badge.style.background = prio.color;
    badge.textContent = prio.name;

    top.append(title, badge);
    li.appendChild(top);

    if (task.description) {
      const desc = document.createElement('div');
      desc.className = 'card__desc';
      desc.textContent = task.description;
      li.appendChild(desc);
    }

    const meta = document.createElement('div');
    meta.className = 'card__meta';
    const dl = formatDeadline(task.deadline);
    if (dl) {
      const span = document.createElement('span');
      span.className = dl.late && !task.done ? 'late' : '';
      span.textContent = `🕑 ${dl.label}${dl.late && !task.done ? ' (atrasada)' : ''}`;
      meta.appendChild(span);
    }
    if (task.attachments && task.attachments.length) {
      const span = document.createElement('span');
      span.textContent = `📎 ${task.attachments.length}`;
      meta.appendChild(span);
    }
    if (isRecurring(task)) {
      const span = document.createElement('span');
      span.textContent = `🔁 ${RECUR_LABELS[task.recurrence] || ''}`;
      meta.appendChild(span);
    }
    const linkedNotes = state.notes.filter((n) => n.taskId === task.id);
    if (linkedNotes.length) {
      const span = document.createElement('span');
      span.textContent = `🗒 ${linkedNotes.length}`;
      meta.appendChild(span);
    }
    if (meta.childNodes.length) li.appendChild(meta);

    // Notas vinculadas: mini-cards que expandem ao clicar (não vão para edição).
    if (linkedNotes.length) {
      const notesBox = document.createElement('div');
      notesBox.className = 'card__notes';
      linkedNotes.forEach((n) => {
        const mini = document.createElement('div');
        mini.className = 'card__note' + (expandedNoteExt.has(n.id) ? ' expanded' : '');

        const mTitle = document.createElement('div');
        mTitle.className = 'card__note-title';
        mTitle.textContent = `🗒 ${n.title || '(sem título)'}`;
        mini.appendChild(mTitle);

        if (n.content) {
          const mContent = document.createElement('div');
          mContent.className = 'card__note-content';
          mContent.textContent = n.content;
          mini.appendChild(mContent);
        }

        // Botão discreto para editar (visível quando o mini-card está expandido).
        const editBtn = document.createElement('button');
        editBtn.className = 'card__note-edit';
        editBtn.textContent = '✎ Editar nota';
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openNoteForm(n.id);
        });
        mini.appendChild(editBtn);

        // Clique expande/recolhe o mini-card (não edita, não mexe no to-do).
        mini.addEventListener('click', (e) => {
          e.stopPropagation();
          if (expandedNoteExt.has(n.id)) expandedNoteExt.delete(n.id);
          else expandedNoteExt.add(n.id);
          mini.classList.toggle('expanded');
        });

        notesBox.appendChild(mini);
      });
      li.appendChild(notesBox);
    }

    // Ações (escondidas no modo passivo via CSS)
    const actions = document.createElement('div');
    actions.className = 'card__actions';
    actions.append(
      makeActionBtn(task.done ? '↺' : '✓', task.done ? 'Reabrir' : 'Concluir', '', () => {
        if (!task.done && isRecurring(task)) {
          // Recorrente: reagenda para a próxima ocorrência (não fica concluída).
          rollRecurring(task);
        } else {
          task.done = !task.done;
        }
        persist();
        renderList();
      }),
      makeActionBtn('✎', 'Editar', '', () => openForm(task.id)),
      makeActionBtn('🗑', 'Excluir', 'icon-btn--danger', () => deleteTask(task.id))
    );
    li.appendChild(actions);

    // Clique no card => EXPANDE/recolhe (não edita). Inativo no modo passivo.
    li.addEventListener('click', () => {
      if (state.config.displayMode === 'passive') return;
      if (expandedIds.has(task.id)) expandedIds.delete(task.id);
      else expandedIds.add(task.id);
      li.classList.toggle('expanded');
    });

    ul.appendChild(li);
  });
}

// ============================================================
//  Formulário de tarefa
// ============================================================
function renderDraftAttachments() {
  const ul = $('#attach-list');
  ul.innerHTML = '';
  draftAttachments.forEach((att, idx) => {
    const li = document.createElement('li');
    li.className = 'attach-item';

    const name = document.createElement('span');
    name.textContent = att.name;
    name.title = att.name;
    name.style.cursor = 'pointer';
    name.addEventListener('click', () => window.api.openAttachment(att.path));

    const rm = document.createElement('button');
    rm.className = 'icon-btn icon-btn--danger';
    rm.textContent = '✕';
    rm.addEventListener('click', () => {
      draftAttachments.splice(idx, 1);
      renderDraftAttachments();
    });

    li.append(name, rm);
    ul.appendChild(li);
  });
}

function openForm(id = null) {
  editingId = id;
  fillPrioritySelect();

  if (id) {
    const t = state.tasks.find((x) => x.id === id);
    $('#form-title').textContent = 'Editar tarefa';
    $('#f-name').value = t.name;
    $('#f-priority').value = t.priorityId;
    $('#f-desc').value = t.description || '';
    $('#f-deadline').value = t.deadline ? toLocalInput(t.deadline) : '';
    $('#f-recurrence').value = t.recurrence || 'none';
    draftAttachments = t.attachments ? [...t.attachments] : [];
  } else {
    $('#form-title').textContent = 'Nova tarefa';
    $('#task-form').reset();
    $('#f-priority').value = state.config.priorities[0]?.id || '';
    $('#f-recurrence').value = 'none';
    draftAttachments = [];
  }

  if (deadlinePicker) {
    deadlinePicker.refreshTrigger();
    deadlinePicker.close();
  }
  renderDraftAttachments();
  showView('form');
  setTimeout(() => $('#f-name').focus(), 50);
}

// ISO -> valor de <input datetime-local> no fuso local
function toLocalInput(iso) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

async function submitForm(e) {
  e.preventDefault();
  const name = $('#f-name').value.trim();
  if (!name) return;

  const deadlineVal = $('#f-deadline').value;
  const payload = {
    name,
    priorityId: $('#f-priority').value,
    description: $('#f-desc').value.trim(),
    deadline: deadlineVal ? new Date(deadlineVal).toISOString() : null,
    recurrence: $('#f-recurrence').value,
    attachments: [...draftAttachments],
  };

  if (editingId) {
    const t = state.tasks.find((x) => x.id === editingId);
    const kept = new Set(payload.attachments.map((a) => a.path));
    (t.attachments || []).forEach((a) => {
      if (!kept.has(a.path)) window.api.deleteAttachment(a.path);
    });
    Object.assign(t, payload);
  } else {
    state.tasks.push({
      id: `t-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
      ...payload,
      profileId: state.config.activeProfileId,
      projectId: effectiveProjectId(),
      done: false,
      createdAt: Date.now(),
    });
  }

  await persist();
  renderList();
  showView('list');
}

async function deleteTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  (t.attachments || []).forEach((a) => window.api.deleteAttachment(a.path));
  state.tasks = state.tasks.filter((x) => x.id !== id);
  expandedIds.delete(id);
  await persist();
  renderList();
}

// ============================================================
//  Calendário
// ============================================================
let calYear;
let calMonth;
let calSelected = null; // 'YYYY-MM-DD' do dia selecionado

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

// Tarefas da seção/projeto ativos que possuem prazo (respeitando recorrentes).
function calendarTasks() {
  const { showRecurring } = state.config;
  return state.tasks.filter(
    (t) => inActiveTab(t) && t.deadline && (showRecurring || !isRecurring(t))
  );
}

// Dias (chaves YYYY-MM-DD) em que uma tarefa recorrente ocorre dentro de
// [startDate, endDate), a partir do prazo base. Granularidade de dia.
function occurrenceKeysInRange(task, startDate, endDate) {
  const base = new Date(task.deadline);
  const rec = task.recurrence;
  const keys = [];
  let guard = 0;

  if (rec === 'hourly' || rec === 'daily') {
    const baseDay = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    let cur = baseDay < startDate ? new Date(startDate) : baseDay;
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
    while (cur < endDate && guard < 500) {
      keys.push(ymd(cur));
      cur.setDate(cur.getDate() + 1);
      guard++;
    }
  } else if (rec === 'monthly') {
    let cur = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    while (cur < endDate && guard < 1200) {
      if (cur >= startDate) keys.push(ymd(cur));
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, base.getDate());
      guard++;
    }
  } else if (rec === 'yearly') {
    let cur = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    while (cur < endDate && guard < 300) {
      if (cur >= startDate) keys.push(ymd(cur));
      cur = new Date(cur.getFullYear() + 1, base.getMonth(), base.getDate());
      guard++;
    }
  }
  return keys;
}

function renderCalendar() {
  if (calYear === undefined) {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
  }

  const first = new Date(calYear, calMonth, 1);
  const title = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  $('#cal-title').textContent = title.charAt(0).toUpperCase() + title.slice(1);

  // Janela visível (6 semanas a partir do domingo anterior ao dia 1).
  const startDow = first.getDay(); // 0 = domingo
  const start = new Date(calYear, calMonth, 1 - startDow);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42);

  // Agrupa tarefas por dia. Recorrentes aparecem em TODOS os dias de ocorrência.
  const byDay = {};
  calendarTasks().forEach((t) => {
    if (isRecurring(t)) {
      occurrenceKeysInRange(t, start, end).forEach((key) => {
        (byDay[key] = byDay[key] || []).push(t);
      });
    } else {
      const key = ymd(new Date(t.deadline));
      (byDay[key] = byDay[key] || []).push(t);
    }
  });

  // Notas atribuídas a um dia e NÃO vinculadas a tarefa (para o indicador).
  const notesByDay = {};
  state.notes.forEach((n) => {
    if (n.day && !n.taskId) (notesByDay[n.day] = notesByDay[n.day] || []).push(n);
  });

  const grid = $('#cal-grid');
  grid.innerHTML = '';
  const todayKey = ymd(new Date());

  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = ymd(d);
    const cell = document.createElement('button');
    cell.className = 'cal__cell';
    if (d.getMonth() !== calMonth) cell.classList.add('other-month');
    if (key === todayKey) cell.classList.add('today');
    if (key === calSelected) cell.classList.add('selected');

    const num = document.createElement('span');
    num.className = 'cal__num';
    num.textContent = d.getDate();
    cell.appendChild(num);

    const dayTasks = byDay[key] || [];
    const dayNotes = notesByDay[key] || [];
    if (dayTasks.length || dayNotes.length) {
      const dots = document.createElement('span');
      dots.className = 'cal__dots';
      dayTasks.slice(0, 4).forEach((t) => {
        const dot = document.createElement('i');
        dot.className = 'cal__dot';
        dot.style.background = getPriority(t.priorityId).color;
        dots.appendChild(dot);
      });
      if (dayNotes.length) {
        const dot = document.createElement('i');
        dot.className = 'cal__dot cal__dot--note';
        dots.appendChild(dot);
      }
      cell.appendChild(dots);
    }

    cell.addEventListener('click', () => {
      calSelected = calSelected === key ? null : key;
      renderCalendar();
    });
    grid.appendChild(cell);
  }

  renderCalDayTasks(byDay);
}

function renderCalDayTasks(byDay) {
  const box = $('#cal-day-tasks');
  box.innerHTML = '';
  if (!calSelected) return;

  const head = document.createElement('div');
  head.className = 'cal__day-head';
  const d = new Date(`${calSelected}T00:00`);
  const label = document.createElement('span');
  label.textContent = d.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'round-btn round-btn--primary cal__add';
  addBtn.textContent = '+';
  addBtn.title = 'Nova tarefa neste dia';
  addBtn.addEventListener('click', () => openFormForDay(calSelected));

  head.append(label, addBtn);
  box.appendChild(head);

  const tasks = (byDay[calSelected] || [])
    .slice()
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  if (!tasks.length) {
    const p = document.createElement('p');
    p.className = 'empty-msg';
    p.textContent = 'Sem tarefas neste dia.';
    box.appendChild(p);
  }

  tasks.forEach((t) => {
    const wrap = document.createElement('div');
    wrap.className = 'cal__task-wrap';

    const item = document.createElement('div');
    item.className = 'cal__task' + (t.done ? ' done' : '');
    item.style.setProperty('--card-color', getPriority(t.priorityId).color);
    const time = new Date(t.deadline).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    item.textContent = `${time}  ${t.name}`;
    item.addEventListener('click', () => openForm(t.id));
    wrap.appendChild(item);

    // Notas vinculadas a esta tarefa: pequena extensão sob o card do to-do.
    state.notes
      .filter((n) => n.taskId === t.id)
      .forEach((n) => {
        const ext = document.createElement('div');
        ext.className = 'cal__note-ext';
        ext.textContent = `🗒 ${n.title || '(sem título)'}`;
        ext.title = n.content || '';
        ext.addEventListener('click', (e) => {
          e.stopPropagation();
          openNoteForm(n.id);
        });
        wrap.appendChild(ext);
      });

    box.appendChild(wrap);
  });

  // Notas do dia NÃO vinculadas a tarefa: lista de notas do dia.
  const dayNotes = state.notes.filter((n) => n.day === calSelected && !n.taskId);
  if (dayNotes.length) {
    const sub = document.createElement('div');
    sub.className = 'cal__day-subhead';
    sub.textContent = 'Notas do dia';
    box.appendChild(sub);

    dayNotes.forEach((n) => {
      const item = document.createElement('div');
      item.className = 'cal__note';
      item.textContent = `🗒 ${n.title || '(sem título)'}`;
      item.title = n.content || '';
      item.addEventListener('click', () => openNoteForm(n.id));
      box.appendChild(item);
    });
  }
}

function isCalendarOpen() {
  return !$('#view-calendar').classList.contains('hidden');
}

// Abre o formulário de nova tarefa com o prazo já no dia selecionado (09:00).
function openFormForDay(dayKey) {
  openForm(null);
  if (dayKey) {
    $('#f-deadline').value = `${dayKey}T09:00`;
    if (deadlinePicker) deadlinePicker.refreshTrigger();
  }
}

// ============================================================
//  Notas (vinculadas a seção/projeto; opcionalmente a tarefa ou dia)
// ============================================================
let editingNoteId = null;

function visibleNotes() {
  return state.notes.filter(inActiveTab).sort((a, b) => b.createdAt - a.createdAt);
}

function isNotesOpen() {
  return !$('#view-notes').classList.contains('hidden');
}

function renderNotes() {
  const ul = $('#notes-list');
  ul.innerHTML = '';
  const notes = visibleNotes();
  $('#notes-empty').classList.toggle('hidden', notes.length > 0);

  notes.forEach((note) => {
    const li = document.createElement('li');
    li.className = 'card note-card';
    if (expandedIds.has(note.id)) li.classList.add('expanded');

    const top = document.createElement('div');
    top.className = 'card__top';
    const title = document.createElement('span');
    title.className = 'card__title';
    title.textContent = note.title || '(sem título)';
    top.appendChild(title);
    li.appendChild(top);

    if (note.content) {
      const desc = document.createElement('div');
      desc.className = 'card__desc';
      desc.textContent = note.content;
      li.appendChild(desc);
    }

    // Vínculos opcionais (tarefa / dia)
    const meta = document.createElement('div');
    meta.className = 'card__meta';
    if (note.taskId) {
      const task = state.tasks.find((t) => t.id === note.taskId);
      if (task) {
        const span = document.createElement('span');
        span.textContent = `🔗 ${task.name}`;
        meta.appendChild(span);
      }
    }
    if (note.day) {
      const span = document.createElement('span');
      const d = new Date(`${note.day}T00:00`);
      span.textContent = `📅 ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
      meta.appendChild(span);
    }
    if (meta.childNodes.length) li.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'card__actions';
    actions.append(
      makeActionBtn('✎', 'Editar', '', () => openNoteForm(note.id)),
      makeActionBtn('🗑', 'Excluir', 'icon-btn--danger', () => deleteNote(note.id))
    );
    li.appendChild(actions);

    // Clique expande/recolhe a nota (não edita — para editar use o ✎).
    li.addEventListener('click', () => {
      if (expandedIds.has(note.id)) expandedIds.delete(note.id);
      else expandedIds.add(note.id);
      li.classList.toggle('expanded');
    });
    ul.appendChild(li);
  });
}

// Preenche o select de tarefas (da seção/projeto ativos) para vincular.
function fillNoteTaskSelect(selectedId) {
  const sel = $('#n-task');
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— Nenhuma —';
  sel.appendChild(none);

  state.tasks.filter(inActiveTab).forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  });
  sel.value = selectedId || '';
}

function openNoteForm(id = null) {
  editingNoteId = id;
  if (id) {
    const n = state.notes.find((x) => x.id === id);
    $('#noteform-title').textContent = 'Editar nota';
    $('#n-title').value = n.title || '';
    $('#n-content').value = n.content || '';
    fillNoteTaskSelect(n.taskId);
    $('#n-day').value = n.day || '';
    $('#btn-note-delete').classList.remove('hidden');
  } else {
    $('#noteform-title').textContent = 'Nova nota';
    $('#n-title').value = '';
    $('#n-content').value = '';
    fillNoteTaskSelect(null);
    $('#n-day').value = '';
    $('#btn-note-delete').classList.add('hidden');
  }
  if (dayPicker) {
    dayPicker.refreshTrigger();
    dayPicker.close();
  }
  showView('noteform');
  setTimeout(() => $('#n-title').focus(), 50);
}

async function submitNoteForm(e) {
  e.preventDefault();
  const title = $('#n-title').value.trim();
  if (!title) return;

  const payload = {
    title,
    content: $('#n-content').value.trim(),
    taskId: $('#n-task').value || null,
    day: $('#n-day').value || null,
  };

  if (editingNoteId) {
    Object.assign(state.notes.find((x) => x.id === editingNoteId), payload);
  } else {
    state.notes.push({
      id: `n-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
      ...payload,
      profileId: state.config.activeProfileId,
      projectId: effectiveProjectId(),
      createdAt: Date.now(),
    });
  }

  await persist();
  renderNotes();
  showView('notes');
}

async function deleteNote(id) {
  state.notes = state.notes.filter((n) => n.id !== id);
  expandedIds.delete(id);
  await persist();
  renderNotes();
}

// ============================================================
//  Configurações
// ============================================================
function renderSettings() {
  renderThemeOptions();
  $('#s-opacity').value = state.config.opacity;
  $('#s-margin').value = state.config.enlargedMargin;
  $('#s-margin-val').textContent = `${state.config.enlargedMargin}%`;
  $('#s-cardmode').value = state.config.cardMode;
  $('#s-stream').checked = state.config.showWhenStreaming;
  $('#s-recurring').checked = state.config.showRecurring;
  $('#s-badge').checked = state.config.showBubbleBadge;
  $('#s-sort-field').value = state.config.sort.field;
  $('#s-sort-dir').value = state.config.sort.dir;
  renderPriorityEditor();
  renderProfileEditor();
}

function setTheme(id) {
  state.config.theme = id;
  applyTheme();
  persist();
  renderThemeOptions();
}

function renderThemeOptions() {
  // Select
  const sel = $('#s-theme');
  sel.innerHTML = '';
  Object.entries(THEMES).forEach(([id, t]) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  });
  sel.value = state.config.theme;

  // Swatches de pré-visualização
  const box = $('#theme-swatches');
  box.innerHTML = '';
  Object.entries(THEMES).forEach(([id, t]) => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (id === state.config.theme ? ' active' : '');
    sw.title = t.name;
    sw.style.background = `rgb(${t.bg})`;
    sw.style.setProperty('--sw-accent', t.accent);
    sw.addEventListener('click', () => setTheme(id));
    box.appendChild(sw);
  });
}

function renderPriorityEditor() {
  const ul = $('#prio-list');
  ul.innerHTML = '';
  state.config.priorities.forEach((p, idx) => {
    const li = document.createElement('li');
    li.className = 'prio-item';

    const color = document.createElement('input');
    color.type = 'color';
    color.value = p.color;
    color.addEventListener('input', () => {
      p.color = color.value;
      persist();
      renderList();
    });

    const name = document.createElement('input');
    name.type = 'text';
    name.value = p.name;
    name.addEventListener('input', () => (p.name = name.value));
    name.addEventListener('change', () => {
      persist();
      fillPrioritySelect();
      renderList();
    });

    const orderBtns = document.createElement('div');
    orderBtns.className = 'order-btns';
    const up = document.createElement('button');
    up.textContent = '▲';
    up.addEventListener('click', () => movePriority(idx, -1));
    const down = document.createElement('button');
    down.textContent = '▼';
    down.addEventListener('click', () => movePriority(idx, 1));
    orderBtns.append(up, down);

    const del = document.createElement('button');
    del.className = 'icon-btn icon-btn--danger';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      if (state.config.priorities.length <= 1) return;
      state.config.priorities.splice(idx, 1);
      reweightPriorities();
      persist();
      renderSettings();
      fillPrioritySelect();
      renderList();
    });

    li.append(color, name, orderBtns, del);
    ul.appendChild(li);
  });
}

function reweightPriorities() {
  state.config.priorities.forEach((p, i) => (p.weight = i + 1));
}

function movePriority(idx, delta) {
  const arr = state.config.priorities;
  const ni = idx + delta;
  if (ni < 0 || ni >= arr.length) return;
  [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
  reweightPriorities();
  persist();
  renderSettings();
  fillPrioritySelect();
  renderList();
}

// Botões de reordenação (setas ▲▼).
function makeOrderBtns(onUp, onDown) {
  const div = document.createElement('div');
  div.className = 'order-btns';
  const up = document.createElement('button');
  up.textContent = '▲';
  up.title = 'Subir';
  up.addEventListener('click', onUp);
  const down = document.createElement('button');
  down.textContent = '▼';
  down.title = 'Descer';
  down.addEventListener('click', onDown);
  div.append(up, down);
  return div;
}

function refreshAfterStructureChange() {
  persist();
  renderSettings();
  renderTabs();
  renderList();
}

// Reordena seções e projetos.
function moveProfile(idx, delta) {
  const arr = state.config.profiles;
  const ni = idx + delta;
  if (ni < 0 || ni >= arr.length) return;
  [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
  refreshAfterStructureChange();
}
function moveProject(profile, idx, delta) {
  const arr = profile.projects;
  const ni = idx + delta;
  if (ni < 0 || ni >= arr.length) return;
  [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
  refreshAfterStructureChange();
}

// ---------- Editor de seções / projetos ----------
function renderProfileEditor() {
  const box = $('#profile-editor');
  box.innerHTML = '';
  state.config.profiles.forEach((profile, pIdx) => {
    const block = document.createElement('div');
    block.className = 'profile-block';

    const head = document.createElement('div');
    head.className = 'profile-block__head';

    const pOrder = makeOrderBtns(
      () => moveProfile(pIdx, -1),
      () => moveProfile(pIdx, 1)
    );

    const pName = document.createElement('input');
    pName.type = 'text';
    pName.value = profile.name;
    pName.addEventListener('input', () => (profile.name = pName.value));
    pName.addEventListener('change', () => {
      persist();
      renderTabs();
    });

    const delP = document.createElement('button');
    delP.className = 'icon-btn icon-btn--danger';
    delP.textContent = '✕ seção';
    delP.addEventListener('click', () => {
      if (state.config.profiles.length <= 1) return;
      removeTasksOf(profile.id, null);
      state.config.profiles = state.config.profiles.filter((p) => p.id !== profile.id);
      if (state.config.activeProfileId === profile.id) {
        state.config.activeProfileId = state.config.profiles[0].id;
        state.config.activeProjectId = state.config.profiles[0].projects[0].id;
      }
      refreshAfterStructureChange();
    });
    head.append(pOrder, pName, delP);
    block.appendChild(head);

    // Opção: agregar todos os projetos numa aba "Tudo".
    const mergeLabel = document.createElement('label');
    mergeLabel.className = 'check-field check-field--sm';
    const mergeChk = document.createElement('input');
    mergeChk.type = 'checkbox';
    mergeChk.checked = !!profile.mergeProjects;
    mergeChk.addEventListener('change', () => {
      profile.mergeProjects = mergeChk.checked;
      // Se desligou enquanto a aba "Tudo" estava ativa, volta ao 1º projeto.
      if (
        !mergeChk.checked &&
        state.config.activeProfileId === profile.id &&
        state.config.activeProjectId === ALL_PROJECTS
      ) {
        state.config.activeProjectId = profile.projects[0].id;
      }
      refreshAfterStructureChange();
    });
    const mergeText = document.createElement('span');
    mergeText.textContent = 'Mostrar todos os projetos numa aba "Tudo"';
    mergeLabel.append(mergeChk, mergeText);
    block.appendChild(mergeLabel);

    profile.projects.forEach((proj, jIdx) => {
      const row = document.createElement('div');
      row.className = 'project-row';

      const jOrder = makeOrderBtns(
        () => moveProject(profile, jIdx, -1),
        () => moveProject(profile, jIdx, 1)
      );

      const jName = document.createElement('input');
      jName.type = 'text';
      jName.value = proj.name;
      jName.addEventListener('input', () => (proj.name = jName.value));
      jName.addEventListener('change', () => {
        persist();
        renderTabs();
      });

      const delJ = document.createElement('button');
      delJ.className = 'icon-btn icon-btn--danger';
      delJ.textContent = '✕';
      delJ.addEventListener('click', () => {
        if (profile.projects.length <= 1) return;
        removeTasksOf(profile.id, proj.id);
        profile.projects = profile.projects.filter((x) => x.id !== proj.id);
        if (state.config.activeProjectId === proj.id) {
          state.config.activeProjectId = profile.projects[0].id;
        }
        refreshAfterStructureChange();
      });
      row.append(jOrder, jName, delJ);
      block.appendChild(row);
    });

    const addJ = document.createElement('button');
    addJ.className = 'btn btn--ghost add-project';
    addJ.textContent = '+ projeto';
    addJ.addEventListener('click', () => {
      profile.projects.push({
        id: `pj-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
        name: `Projeto ${profile.projects.length + 1}`,
      });
      persist();
      renderSettings();
      renderTabs();
    });
    block.appendChild(addJ);

    box.appendChild(block);
  });
}

// Remove tarefas de uma seção (projId null) ou de um projeto específico.
function removeTasksOf(profileId, projectId) {
  state.tasks = state.tasks.filter((t) => {
    const match =
      t.profileId === profileId &&
      (projectId === null || t.projectId === projectId);
    if (match) (t.attachments || []).forEach((a) => window.api.deleteAttachment(a.path));
    return !match;
  });
}

// ============================================================
//  Date/time picker customizado (no estilo do app, com Confirmar)
// ============================================================
let deadlinePicker = null;
let dayPicker = null;

const pad2 = (n) => String(n).padStart(2, '0');
const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function setupPicker(triggerEl, inputEl, pickerEl, mode) {
  const isDateTime = mode === 'datetime';
  let work; // Date em edição
  let viewY;
  let viewM;

  const parseInput = (v) => (isDateTime ? new Date(v) : new Date(`${v}T00:00`));

  function refreshTrigger() {
    if (!inputEl.value) {
      triggerEl.textContent = isDateTime ? 'Selecionar data e hora' : 'Selecionar dia';
      triggerEl.classList.add('picker-trigger--empty');
      return;
    }
    const d = parseInput(inputEl.value);
    triggerEl.classList.remove('picker-trigger--empty');
    triggerEl.textContent = isDateTime
      ? d.toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function close() {
    pickerEl.classList.add('hidden');
  }

  function open() {
    const base = inputEl.value ? parseInput(inputEl.value) : new Date();
    work = new Date(base);
    viewY = work.getFullYear();
    viewM = work.getMonth();
    render();
    pickerEl.classList.remove('hidden');
  }

  function render() {
    pickerEl.innerHTML = '';

    // Cabeçalho com navegação de mês
    const head = document.createElement('div');
    head.className = 'picker__head';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'round-btn';
    prev.textContent = '‹';
    prev.addEventListener('click', () => {
      viewM -= 1;
      if (viewM < 0) {
        viewM = 11;
        viewY -= 1;
      }
      render();
    });
    const titleEl = document.createElement('span');
    titleEl.className = 'picker__title';
    const t = new Date(viewY, viewM, 1).toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric',
    });
    titleEl.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'round-btn';
    next.textContent = '›';
    next.addEventListener('click', () => {
      viewM += 1;
      if (viewM > 11) {
        viewM = 0;
        viewY += 1;
      }
      render();
    });
    head.append(prev, titleEl, next);
    pickerEl.appendChild(head);

    // Dias da semana
    const wd = document.createElement('div');
    wd.className = 'picker__weekdays';
    WEEKDAYS_SHORT.forEach((w) => {
      const s = document.createElement('span');
      s.textContent = w;
      wd.appendChild(s);
    });
    pickerEl.appendChild(wd);

    // Grade de dias
    const grid = document.createElement('div');
    grid.className = 'picker__grid';
    const first = new Date(viewY, viewM, 1);
    const start = new Date(viewY, viewM, 1 - first.getDay());
    const todayKey = ymd(new Date());
    const workKey = ymd(work);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = ymd(d);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'picker__cell';
      if (d.getMonth() !== viewM) cell.classList.add('other-month');
      if (key === todayKey) cell.classList.add('today');
      if (key === workKey) cell.classList.add('selected');
      cell.textContent = d.getDate();
      cell.addEventListener('click', () => {
        work = new Date(d.getFullYear(), d.getMonth(), d.getDate(), work.getHours(), work.getMinutes());
        viewY = work.getFullYear();
        viewM = work.getMonth();
        render();
      });
      grid.appendChild(cell);
    }
    pickerEl.appendChild(grid);

    // Linha de horário (apenas datetime)
    if (isDateTime) {
      const timeRow = document.createElement('div');
      timeRow.className = 'picker__time';
      const label = document.createElement('span');
      label.textContent = 'Hora:';
      const hSel = document.createElement('select');
      for (let h = 0; h < 24; h++) {
        const o = document.createElement('option');
        o.value = h;
        o.textContent = pad2(h);
        hSel.appendChild(o);
      }
      hSel.value = work.getHours();
      hSel.addEventListener('change', () => work.setHours(parseInt(hSel.value, 10)));
      const sep = document.createElement('span');
      sep.textContent = ':';
      const mSel = document.createElement('select');
      for (let m = 0; m < 60; m++) {
        const o = document.createElement('option');
        o.value = m;
        o.textContent = pad2(m);
        mSel.appendChild(o);
      }
      mSel.value = work.getMinutes();
      mSel.addEventListener('change', () => work.setMinutes(parseInt(mSel.value, 10)));
      timeRow.append(label, hSel, sep, mSel);
      pickerEl.appendChild(timeRow);
    }

    // Rodapé: Limpar / Confirmar
    const foot = document.createElement('div');
    foot.className = 'picker__foot';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn--ghost';
    clear.textContent = 'Limpar';
    clear.addEventListener('click', () => {
      inputEl.value = '';
      refreshTrigger();
      close();
    });
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn--primary';
    confirm.textContent = 'Confirmar';
    confirm.addEventListener('click', () => {
      inputEl.value = isDateTime
        ? `${work.getFullYear()}-${pad2(work.getMonth() + 1)}-${pad2(work.getDate())}T${pad2(work.getHours())}:${pad2(work.getMinutes())}`
        : `${work.getFullYear()}-${pad2(work.getMonth() + 1)}-${pad2(work.getDate())}`;
      refreshTrigger();
      close();
    });
    foot.append(clear, confirm);
    pickerEl.appendChild(foot);
  }

  triggerEl.addEventListener('click', () => {
    if (pickerEl.classList.contains('hidden')) open();
    else close();
  });

  refreshTrigger();
  return { refreshTrigger, close };
}

// ============================================================
//  Arraste para mover o app
// ============================================================
let dragging = false;
let dragStart = null;
let resizing = false;

const MIN_W = 260;
const MIN_H = 120;

// Redimensiona o painel arrastando bordas/cantos (fora do modo passivo).
function initResize() {
  const panel = $('#panel');
  let rs = null;

  panel.querySelectorAll('.resizer').forEach((handle) => {
    handle.addEventListener('mousedown', (e) => {
      if (state.config.displayMode === 'passive') return;
      const r = panel.getBoundingClientRect();
      rs = {
        dir: handle.dataset.dir,
        x: e.clientX,
        y: e.clientY,
        left: r.left,
        top: r.top,
        w: r.width,
        h: r.height,
      };
      // Fixa em left/top para que as bordas movam corretamente.
      panel.style.right = 'auto';
      panel.style.left = `${r.left}px`;
      panel.style.top = `${r.top}px`;
      panel.style.width = `${r.width}px`;
      panel.style.height = `${r.height}px`;
      resizing = true;
      e.preventDefault();
      e.stopPropagation();
    });
  });

  window.addEventListener('mousemove', (e) => {
    if (!rs) return;
    const dx = e.clientX - rs.x;
    const dy = e.clientY - rs.y;
    let left = rs.left;
    let top = rs.top;
    let w = rs.w;
    let h = rs.h;
    const d = rs.dir;

    if (d.includes('e')) w = rs.w + dx;
    if (d.includes('s')) h = rs.h + dy;
    if (d.includes('w')) {
      w = rs.w - dx;
      left = rs.left + dx;
    }
    if (d.includes('n')) {
      h = rs.h - dy;
      top = rs.top + dy;
    }

    // Largura/altura mínimas (ajustando a âncora quando puxado pela borda n/w).
    if (w < MIN_W) {
      if (d.includes('w')) left -= MIN_W - w;
      w = MIN_W;
    }
    if (h < MIN_H) {
      if (d.includes('n')) top -= MIN_H - h;
      h = MIN_H;
    }
    // Mantém dentro da tela.
    if (left < 0) {
      w += left;
      left = 0;
    }
    if (top < 0) {
      h += top;
      top = 0;
    }
    if (left + w > window.innerWidth) w = window.innerWidth - left;
    if (top + h > window.innerHeight) h = window.innerHeight - top;

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${w}px`;
    panel.style.height = `${h}px`;
  });

  window.addEventListener('mouseup', () => {
    if (!rs) return;
    rs = null;
    resizing = false;
    state.config.width = Math.round(panel.offsetWidth);
    state.config.height = Math.round(panel.offsetHeight);
    state.config.position = {
      left: Math.round(panel.offsetLeft),
      top: Math.round(panel.offsetTop),
    };
    persist();
    refreshInteractivity();
  });
}

function initDrag() {
  const grip = $('#drag-grip');
  const panel = $('#panel');

  grip.addEventListener('mousedown', (e) => {
    const r = panel.getBoundingClientRect();
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    panel.style.right = 'auto';
    panel.style.left = `${r.left}px`;
    panel.style.top = `${r.top}px`;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    let nl = dragStart.left + (e.clientX - dragStart.x);
    let nt = dragStart.top + (e.clientY - dragStart.y);
    nl = Math.max(0, Math.min(nl, window.innerWidth - pw));
    nt = Math.max(0, Math.min(nt, window.innerHeight - ph));
    panel.style.left = `${nl}px`;
    panel.style.top = `${nt}px`;
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    state.config.position = {
      left: parseInt(panel.style.left, 10),
      top: parseInt(panel.style.top, 10),
    };
    persist();
  });
}

// ============================================================
//  Bind de eventos
// ============================================================
function bindEvents() {
  $('#btn-add').addEventListener('click', () => openForm(null));
  $('#btn-cancel').addEventListener('click', () => showView('list'));
  $('#task-form').addEventListener('submit', submitForm);

  $('#btn-attach').addEventListener('click', async () => {
    const added = await window.api.pickAttachments();
    draftAttachments.push(...added);
    renderDraftAttachments();
  });


  $('#btn-cardmode').addEventListener('click', () => {
    state.config.cardMode = state.config.cardMode === 'compact' ? 'detailed' : 'compact';
    applyAppearance();
    persist();
  });

  $('#btn-passive').addEventListener('click', () => setDisplayMode('passive'));
  $('#passive-exit').addEventListener('click', () => setDisplayMode('normal'));

  $('#btn-enlarge').addEventListener('click', () => {
    state.config.enlarged = !state.config.enlarged;
    applyAppearance();
    refreshInteractivity();
    persist();
  });

  // Calendário: o botão alterna entre lista e calendário.
  $('#btn-calendar').addEventListener('click', () => {
    if (isCalendarOpen()) {
      showView('list');
    } else {
      renderCalendar();
      showView('calendar');
    }
  });
  $('#cal-prev').addEventListener('click', () => {
    calMonth -= 1;
    if (calMonth < 0) {
      calMonth = 11;
      calYear -= 1;
    }
    renderCalendar();
  });
  $('#cal-next').addEventListener('click', () => {
    calMonth += 1;
    if (calMonth > 11) {
      calMonth = 0;
      calYear += 1;
    }
    renderCalendar();
  });

  // Notas: o botão alterna entre lista de tarefas e lista de notas.
  $('#btn-notes').addEventListener('click', () => {
    if (isNotesOpen()) {
      showView('list');
    } else {
      renderNotes();
      showView('notes');
    }
  });
  $('#btn-add-note').addEventListener('click', () => openNoteForm(null));
  $('#note-form').addEventListener('submit', submitNoteForm);
  $('#btn-note-cancel').addEventListener('click', () => {
    renderNotes();
    showView('notes');
  });
  $('#btn-note-delete').addEventListener('click', () => {
    if (editingNoteId) deleteNote(editingNoteId);
    showView('notes');
  });

  $('#btn-settings').addEventListener('click', () => {
    renderSettings();
    showView('settings');
  });
  $('#btn-settings-close').addEventListener('click', () => showView('list'));

  $('#btn-collapse').addEventListener('click', () => setDisplayMode('collapsed'));
  $('#bubble').addEventListener('click', () => setDisplayMode('normal'));
  $('#btn-quit').addEventListener('click', () => window.api.quit());

  bindUpdate();

  // Aparência ao vivo
  $('#s-opacity').addEventListener('input', (e) => {
    state.config.opacity = parseFloat(e.target.value);
    applyAppearance();
  });
  $('#s-opacity').addEventListener('change', persist);

  $('#btn-reset-size').addEventListener('click', () => {
    state.config.width = 380;
    state.config.height = null;
    state.config.position = null;
    applyAppearance();
    persist();
  });

  $('#s-margin').addEventListener('input', (e) => {
    state.config.enlargedMargin = parseInt(e.target.value, 10);
    $('#s-margin-val').textContent = `${state.config.enlargedMargin}%`;
    if (state.config.enlarged) applyAppearance();
  });
  $('#s-margin').addEventListener('change', persist);

  $('#s-theme').addEventListener('change', (e) => setTheme(e.target.value));

  $('#s-cardmode').addEventListener('change', (e) => {
    state.config.cardMode = e.target.value;
    applyAppearance();
    persist();
  });

  $('#s-stream').addEventListener('change', (e) => {
    state.config.showWhenStreaming = e.target.checked;
    applyStreamVisibility();
    persist();
  });

  $('#s-recurring').addEventListener('change', (e) => {
    state.config.showRecurring = e.target.checked;
    persist();
    renderList();
  });

  $('#s-badge').addEventListener('change', (e) => {
    state.config.showBubbleBadge = e.target.checked;
    persist();
    updateBubbleBadge();
  });

  $('#s-sort-field').addEventListener('change', (e) => {
    state.config.sort.field = e.target.value;
    persist();
    renderList();
  });
  $('#s-sort-dir').addEventListener('change', (e) => {
    state.config.sort.dir = e.target.value;
    persist();
    renderList();
  });

  $('#btn-add-prio').addEventListener('click', () => {
    const n = state.config.priorities.length + 1;
    state.config.priorities.push({
      id: `p-${Date.now()}`,
      name: `Prioridade ${n}`,
      color: '#7d7dff',
      weight: n,
    });
    reweightPriorities();
    persist();
    renderSettings();
    fillPrioritySelect();
  });

  $('#btn-add-profile').addEventListener('click', () => {
    state.config.profiles.push({
      id: `pf-${Date.now()}`,
      name: `Seção ${state.config.profiles.length + 1}`,
      projects: [{ id: `pj-${Date.now()}`, name: 'Geral' }],
    });
    persist();
    renderSettings();
    renderTabs();
  });

  // Atalho global Ctrl+Alt+M: alterna passivo <-> normal.
  window.api.onTogglePassive(() => {
    setDisplayMode(state.config.displayMode === 'passive' ? 'normal' : 'passive');
  });
}

// ============================================================
//  Atualização (electron-updater)
// ============================================================
function bindUpdate() {
  const status = $('#upd-status');
  const dlBtn = $('#btn-upd-download');
  const instBtn = $('#btn-upd-install');

  window.api.getVersion().then((v) => {
    $('#upd-version').textContent = `v${v}`;
  });

  $('#btn-upd-check').addEventListener('click', async () => {
    status.textContent = 'Verificando...';
    dlBtn.classList.add('hidden');
    instBtn.classList.add('hidden');
    const r = await window.api.checkUpdate();
    if (r.state === 'dev') {
      status.textContent = 'Disponível apenas na versão instalada do app.';
    } else if (r.state === 'error') {
      status.textContent = `Erro: ${r.message}`;
    }
  });

  dlBtn.addEventListener('click', () => {
    status.textContent = 'Baixando... 0%';
    dlBtn.classList.add('hidden');
    window.api.downloadUpdate();
  });

  instBtn.addEventListener('click', () => window.api.installUpdate());

  window.api.onUpdateStatus((p) => {
    switch (p.state) {
      case 'checking':
        status.textContent = 'Verificando atualizações...';
        break;
      case 'none':
        status.textContent = `Você está na versão mais recente${p.version ? ` (v${p.version})` : ''}.`;
        break;
      case 'available':
        status.textContent = `Nova versão v${p.version} disponível.`;
        dlBtn.classList.remove('hidden');
        break;
      case 'downloading':
        status.textContent = `Baixando... ${p.percent || 0}%`;
        break;
      case 'downloaded':
        status.textContent = `Versão v${p.version} baixada. Pronta para instalar.`;
        dlBtn.classList.add('hidden');
        instBtn.classList.remove('hidden');
        break;
      case 'error':
        status.textContent = `Erro: ${p.message || ''}`;
        break;
    }
  });
}

// ============================================================
//  Init
// ============================================================
async function init() {
  state = await window.api.loadData();
  applyTheme();
  applyAppearance();
  applyStreamVisibility();
  fillPrioritySelect();
  bindEvents();
  deadlinePicker = setupPicker(
    $('#f-deadline-btn'),
    $('#f-deadline'),
    $('#f-deadline-picker'),
    'datetime'
  );
  dayPicker = setupPicker($('#n-day-btn'), $('#n-day'), $('#n-day-picker'), 'date');
  initDrag();
  initResize();
  bindTabsWheel();
  renderTabs();
  renderList();
  showView('list');
  setDisplayMode(state.config.displayMode || 'normal');
}

init();
