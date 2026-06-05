const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  screen,
  globalShortcut,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const USER_DIR = app.getPath('userData');
const DATA_FILE = path.join(USER_DIR, 'data.json');
const ATTACH_DIR = path.join(USER_DIR, 'attachments');

let mainWindow = null;

// ---------- Persistência ----------

const DEFAULT_DATA = {
  config: {
    // Opacidade geral do overlay (0.2 a 1.0)
    opacity: 0.85,
    // Largura do painel em px
    width: 380,
    // Altura do painel em px (null = automática, até o limite da tela)
    height: null,
    // Prioridades parametrizáveis: nome + cor + peso (ordem)
    priorities: [
      { id: 'p-alta', name: 'Alta', color: '#ff4d4f', weight: 1 },
      { id: 'p-media', name: 'Média', color: '#faad14', weight: 2 },
      { id: 'p-baixa', name: 'Baixa', color: '#52c41a', weight: 3 },
    ],
    // Ordenação parametrizável
    sort: { field: 'priority', dir: 'asc' },
    // Perfis (abas) e seus projetos (sub-abas)
    profiles: [
      {
        id: 'pf-geral',
        name: 'Geral',
        projects: [{ id: 'pj-geral', name: 'Geral' }],
      },
    ],
    activeProfileId: 'pf-geral',
    activeProjectId: 'pj-geral',
    // Modo do card: 'detailed' | 'compact'
    cardMode: 'detailed',
    // Modo de exibição: 'normal' | 'passive' | 'collapsed'
    displayMode: 'normal',
    // Se o app deve aparecer ao compartilhar/streamar a tela
    showWhenStreaming: true,
    // Perfil de cores (paleta) — ver THEMES no renderer
    theme: 'midnight',
    // Mostrar (ou não) tarefas recorrentes na lista
    showRecurring: true,
    // Mostrar o contador (badge vermelho) no botão flutuante recolhido
    showBubbleBadge: true,
    // Por quanto tempo concluídos permanecem visíveis: 'day' | 'week' | 'month' | 'never'
    completedRetention: 'never',
    // Posição manual do painel { left, top } ou null (canto sup. direito)
    position: null,
    // Modo ampliado: painel ocupa a tela com margens (%) parametrizáveis
    enlarged: false,
    enlargedMargin: 20,
    // Mostrar aba agregada "Tudo" no nível das seções
    mergeSections: false,
  },
  tasks: [],
  notes: [],
  listItems: [],
};

// Garante integridade dos dados (perfis, projetos, campos novos, órfãos).
function normalize(data) {
  const c = data.config;

  if (!Array.isArray(c.profiles) || c.profiles.length === 0) {
    c.profiles = JSON.parse(JSON.stringify(DEFAULT_DATA.config.profiles));
  }
  c.profiles.forEach((p) => {
    if (!Array.isArray(p.projects) || p.projects.length === 0) {
      p.projects = [{ id: `pj-${p.id}`, name: 'Geral' }];
    }
  });

  if (typeof c.mergeSections !== 'boolean') c.mergeSections = false;

  const firstProfile = c.profiles[0];
  // '__all_sections__' é a aba agregada "Tudo" das seções (se habilitada).
  const allowAllSections = c.mergeSections && c.activeProfileId === '__all_sections__';
  if (
    !allowAllSections &&
    (!c.activeProfileId || !c.profiles.find((p) => p.id === c.activeProfileId))
  ) {
    c.activeProfileId = firstProfile.id;
  }
  const activeProfile = c.profiles.find((p) => p.id === c.activeProfileId);
  if (activeProfile) {
    // '__all__' é a aba agregada "Tudo" dos projetos (se a seção a habilita).
    const allowAll = activeProfile.mergeProjects && c.activeProjectId === '__all__';
    if (
      !allowAll &&
      (!c.activeProjectId ||
        !activeProfile.projects.find((pj) => pj.id === c.activeProjectId))
    ) {
      c.activeProjectId = activeProfile.projects[0].id;
    }
  }

  if (!c.cardMode) c.cardMode = 'detailed';
  if (!c.displayMode || c.displayMode === 'collapsed') c.displayMode = 'normal';
  if (c.position === undefined) c.position = null;
  if (c.height === undefined) c.height = null;
  if (c.showWhenStreaming === undefined) c.showWhenStreaming = true;
  if (!c.theme) c.theme = 'midnight';
  if (c.showRecurring === undefined) c.showRecurring = true;
  if (c.showBubbleBadge === undefined) c.showBubbleBadge = true;
  if (!c.completedRetention) c.completedRetention = 'never';
  if (typeof c.enlarged !== 'boolean') c.enlarged = false;
  if (typeof c.enlargedMargin !== 'number') c.enlargedMargin = 20;

  // Garante vínculo válido de seção/projeto (tarefas e notas órfãs).
  const fixOwnership = (item) => {
    const tp = c.profiles.find((p) => p.id === item.profileId);
    if (!tp) {
      item.profileId = firstProfile.id;
      item.projectId = firstProfile.projects[0].id;
    } else if (!item.projectId || !tp.projects.find((pj) => pj.id === item.projectId)) {
      item.projectId = tp.projects[0].id;
    }
  };
  data.tasks.forEach(fixOwnership);

  if (!Array.isArray(data.notes)) data.notes = [];
  data.notes.forEach(fixOwnership);

  if (!Array.isArray(data.listItems)) data.listItems = [];
  data.listItems.forEach(fixOwnership);

  // Garante um campo numérico `order` (usado na reordenação por arraste).
  [data.tasks, data.notes, data.listItems].forEach((arr) => {
    arr.forEach((item, i) => {
      if (typeof item.order !== 'number') item.order = i;
    });
  });

  return data;
}

function ensureDirs() {
  if (!fs.existsSync(ATTACH_DIR)) {
    fs.mkdirSync(ATTACH_DIR, { recursive: true });
  }
}

// Constrói um estado válido a partir de um objeto parseado (defaults + normalize).
function hydrate(parsed) {
  return normalize({
    config: { ...DEFAULT_DATA.config, ...((parsed && parsed.config) || {}) },
    tasks: Array.isArray(parsed && parsed.tasks) ? parsed.tasks : [],
    notes: Array.isArray(parsed && parsed.notes) ? parsed.notes : [],
    listItems: Array.isArray(parsed && parsed.listItems) ? parsed.listItems : [],
  });
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return hydrate(JSON.parse(raw));
    }
  } catch (err) {
    console.error('Falha ao ler data.json, usando defaults:', err);
  }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Falha ao salvar data.json:', err);
    return false;
  }
}

// ---------- Janela ----------

function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = primary.workAreaSize;

  mainWindow = new BrowserWindow({
    width: sw,
    height: sh,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: false,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Mantém acima de praticamente tudo sem virar "screen-saver" (que rouba foco no Windows)
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Começa em modo click-through: cliques passam para o desktop.
  // O renderer reativa a captura quando o mouse entra num elemento interativo.
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ---------- IPC ----------

ipcMain.handle('data:load', () => loadData());

ipcMain.handle('data:save', (_evt, data) => {
  return saveData(data);
});

// Exporta o estado atual para um arquivo .json escolhido pelo usuário.
ipcMain.handle('data:export', async (_evt, data) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar dados',
    defaultPath: 'todo-overlay-backup.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Importa dados de um arquivo .json (valida/normaliza e grava como atual).
ipcMain.handle('data:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar dados',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const data = hydrate(JSON.parse(raw));
    saveData(data);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Define se o overlay aparece em capturas de tela (streaming/gravação).
// protect=true => conteúdo é excluído da captura (some na transmissão).
ipcMain.on('overlay:set-content-protection', (_evt, protect) => {
  if (mainWindow) mainWindow.setContentProtection(!!protect);
});

// Liga/desliga o click-through. interactive=true => janela captura o mouse.
ipcMain.on('overlay:set-interactive', (_evt, interactive) => {
  if (!mainWindow) return;
  if (interactive) {
    mainWindow.setIgnoreMouseEvents(false);
  } else {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  }
});

// Diálogo de anexos: copia arquivos para a pasta da aplicação e devolve refs.
ipcMain.handle('attachments:pick', async () => {
  ensureDirs();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar anexos',
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];

  const saved = [];
  for (const filePath of result.filePaths) {
    try {
      const base = path.basename(filePath);
      const unique = `${Date.now()}-${Math.round(performance.now())}-${base}`;
      const dest = path.join(ATTACH_DIR, unique);
      fs.copyFileSync(filePath, dest);
      const stat = fs.statSync(dest);
      saved.push({ name: base, path: dest, size: stat.size });
    } catch (err) {
      console.error('Falha ao copiar anexo:', filePath, err);
    }
  }
  return saved;
});

// Abre um anexo no app padrão do sistema.
ipcMain.handle('attachments:open', async (_evt, filePath) => {
  const { shell } = require('electron');
  if (filePath && fs.existsSync(filePath)) {
    await shell.openPath(filePath);
    return true;
  }
  return false;
});

// Remove o arquivo físico de um anexo (ao excluir tarefa/anexo).
ipcMain.handle('attachments:delete', (_evt, filePath) => {
  try {
    if (filePath && filePath.startsWith(ATTACH_DIR) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch (err) {
    console.error('Falha ao remover anexo:', err);
    return false;
  }
});

ipcMain.on('app:quit', () => app.quit());

// ---------- Atualização automática (electron-updater) ----------

autoUpdater.autoDownload = false; // o usuário decide quando baixar
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdate(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', payload);
  }
}

autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
autoUpdater.on('update-available', (info) =>
  sendUpdate({ state: 'available', version: info.version })
);
autoUpdater.on('update-not-available', (info) =>
  sendUpdate({ state: 'none', version: info.version })
);
autoUpdater.on('error', (err) =>
  sendUpdate({ state: 'error', message: (err && err.message) || String(err) })
);
autoUpdater.on('download-progress', (p) =>
  sendUpdate({ state: 'downloading', percent: Math.round(p.percent) })
);
autoUpdater.on('update-downloaded', (info) =>
  sendUpdate({ state: 'downloaded', version: info.version })
);

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('update:check', async () => {
  // Auto-update só funciona na versão empacotada/instalada.
  if (!app.isPackaged) return { state: 'dev' };
  try {
    await autoUpdater.checkForUpdates();
    return { state: 'checking' };
  } catch (err) {
    return { state: 'error', message: (err && err.message) || String(err) };
  }
});

ipcMain.handle('update:download', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return true;
  } catch (err) {
    sendUpdate({ state: 'error', message: (err && err.message) || String(err) });
    return false;
  }
});

ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall();
});

// ---------- Ciclo de vida ----------

app.whenReady().then(() => {
  ensureDirs();
  createWindow();

  // Verificação automática de atualização ao iniciar (só na versão instalada).
  // Pequeno atraso para o renderer registrar os listeners de status.
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 4000);
  }

  // Atalho global para mostrar/esconder o overlay.
  globalShortcut.register('CommandOrControl+Alt+T', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else mainWindow.show();
  });

  // Atalho global para alternar entre normal e modo passivo (cards sem botões,
  // não-clicáveis). Necessário porque no modo passivo não há botões na tela.
  globalShortcut.register('CommandOrControl+Alt+M', () => {
    if (!mainWindow) return;
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.webContents.send('overlay:toggle-passive');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

// Mantém o app vivo mesmo sem janelas no macOS; no Windows encerra normal.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
