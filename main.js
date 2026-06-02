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
    // Posição manual do painel { left, top } ou null (canto sup. direito)
    position: null,
  },
  tasks: [],
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

  const firstProfile = c.profiles[0];
  if (!c.activeProfileId || !c.profiles.find((p) => p.id === c.activeProfileId)) {
    c.activeProfileId = firstProfile.id;
  }
  const activeProfile = c.profiles.find((p) => p.id === c.activeProfileId);
  if (
    !c.activeProjectId ||
    !activeProfile.projects.find((pj) => pj.id === c.activeProjectId)
  ) {
    c.activeProjectId = activeProfile.projects[0].id;
  }

  if (!c.cardMode) c.cardMode = 'detailed';
  if (!c.displayMode || c.displayMode === 'collapsed') c.displayMode = 'normal';
  if (c.position === undefined) c.position = null;
  if (c.height === undefined) c.height = null;
  if (c.showWhenStreaming === undefined) c.showWhenStreaming = true;
  if (!c.theme) c.theme = 'midnight';

  // Tarefas órfãs vão para o primeiro perfil/projeto válido.
  data.tasks.forEach((t) => {
    const tp = c.profiles.find((p) => p.id === t.profileId);
    if (!tp) {
      t.profileId = firstProfile.id;
      t.projectId = firstProfile.projects[0].id;
    } else if (!t.projectId || !tp.projects.find((pj) => pj.id === t.projectId)) {
      t.projectId = tp.projects[0].id;
    }
  });

  return data;
}

function ensureDirs() {
  if (!fs.existsSync(ATTACH_DIR)) {
    fs.mkdirSync(ATTACH_DIR, { recursive: true });
  }
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      // Mescla com defaults para tolerar versões antigas
      return normalize({
        config: { ...DEFAULT_DATA.config, ...(parsed.config || {}) },
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      });
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

// ---------- Ciclo de vida ----------

app.whenReady().then(() => {
  ensureDirs();
  createWindow();

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
