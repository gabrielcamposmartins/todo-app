const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),

  // Click-through: avisa o main quando o cursor entra/sai de zonas interativas.
  setInteractive: (interactive) =>
    ipcRenderer.send('overlay:set-interactive', interactive),

  // Atalho global Ctrl+Alt+M dispara alternância do modo passivo.
  onTogglePassive: (cb) =>
    ipcRenderer.on('overlay:toggle-passive', () => cb()),

  // Define se o overlay é excluído de capturas de tela (protect=true esconde).
  setContentProtection: (protect) =>
    ipcRenderer.send('overlay:set-content-protection', protect),

  pickAttachments: () => ipcRenderer.invoke('attachments:pick'),
  openAttachment: (filePath) => ipcRenderer.invoke('attachments:open', filePath),
  deleteAttachment: (filePath) =>
    ipcRenderer.invoke('attachments:delete', filePath),

  quit: () => ipcRenderer.send('app:quit'),
});
