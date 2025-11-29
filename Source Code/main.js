const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const ini = require('ini');

let mainWindow;
let config = {
  gamePath: '',
  modPath: '',
  profiles: {},
  activeProfile: 'default',
  settings: {
    theme: 'cyberpunk',
    autoBackup: true,
    showNotifications: true
  },
  installedFiles: {} // Trackt welche Dateien von welcher Mod installiert wurden
};

const configPath = path.join(app.getPath('userData'), 'config.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#0a0a0f',
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.loadFile('index.html');
  
  // Entwickler-Tools in Produktion auskommentieren
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  loadConfig();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Config Management
function loadConfig() {
  const defaultConfig = {
    gamePath: '',
    modPath: '',
    modSourcePath: '',
    profiles: {
      default: { name: 'Default', mods: [] }
    },
    activeProfile: 'default',
    settings: {
      theme: 'cyberpunk',
      autoBackup: true,
      showNotifications: true
    },
    installedFiles: {}
  };

  try {
    if (fs.existsSync(configPath)) {
      try {
        const fileContent = fs.readFileSync(configPath, 'utf8');
        const loadedConfig = JSON.parse(fileContent);
        
        // Validiere Struktur
        if (typeof loadedConfig !== 'object' || loadedConfig === null) {
          throw new Error('Config ist kein Objekt');
        }
        
        // Merge mit Defaults (falls Fields fehlen)
        config = {
          ...defaultConfig,
          ...loadedConfig,
          settings: { ...defaultConfig.settings, ...loadedConfig.settings },
          installedFiles: loadedConfig.installedFiles || {}
        };
        
        // Validiere kritische Fields
        if (!config.profiles || typeof config.profiles !== 'object') {
          config.profiles = { default: { name: 'Default', mods: [] } };
        }
        
        if (!config.profiles.default) {
          config.profiles.default = { name: 'Default', mods: [] };
        }
        
        if (!config.profiles[config.activeProfile]) {
          config.activeProfile = 'default';
        }
        
      } catch (parseErr) {
        console.error('Config-Datei beschädigt, verwende Defaults:', parseErr);
        config = JSON.parse(JSON.stringify(defaultConfig)); // Deep copy
        saveConfig(); // Speichere reparierten Config
      }
    } else {
      config = JSON.parse(JSON.stringify(defaultConfig)); // Deep copy
      saveConfig();
    }
  } catch (err) {
    console.error('Kritischer Fehler beim Laden der Config:', err);
    // Fallback auf absolute Defaults
    config = {
      gamePath: '',
      modPath: '',
      profiles: { default: { name: 'Default', mods: [] } },
      activeProfile: 'default',
      settings: { theme: 'cyberpunk', autoBackup: true, showNotifications: true },
      installedFiles: {}
    };
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Error saving config:', err);
  }
}

// IPC Handlers
ipcMain.handle('get-config', () => config);

ipcMain.handle('set-game-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Cyberpunk 2077 Installation Folder'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    // Prüfe ob es ein gültiger Cyberpunk-Ordner ist
    const exePath = path.join(selectedPath, 'bin', 'x64', 'Cyberpunk2077.exe');
    if (fs.existsSync(exePath)) {
      config.gamePath = selectedPath;
      // Wenn noch kein modPath gesetzt ist, setze den Standard
      if (!config.modPath) {
        config.modPath = path.join(selectedPath, 'archive', 'pc', 'mod');
      }
      
      saveConfig();
      return { success: true, path: selectedPath };
    } else {
      return { success: false, error: 'Invalid Cyberpunk 2077 directory' };
    }
  }
  return { success: false, error: 'No path selected' };
});

ipcMain.handle('set-mod-source-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Mod Source Folder (where your mods are stored)'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    config.modSourcePath = result.filePaths[0];
    saveConfig();
    return { success: true, path: result.filePaths[0] };
  }
  return { success: false, error: 'No path selected' };
});

ipcMain.handle('scan-mods', async () => {
  const scanPath = config.modSourcePath || config.modPath;
  
  if (!scanPath || !fs.existsSync(scanPath)) {
    return { success: false, error: 'Mod source path not set or invalid' };
  }

  try {
    const mods = [];
    const items = fs.readdirSync(scanPath);

    for (const item of items) {
      const itemPath = path.join(scanPath, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory()) {
        const modInfoPath = path.join(itemPath, 'modinfo.ini');
        let modData = {
          id: item,
          name: item,
          path: itemPath,
          enabled: false,
          version: 'Unknown',
          author: 'Unknown',
          description: '',
          screenshots: [],
          addonfor: '',
          category: 'Uncategorized',
          authorlink: '',
          modlink: ''
        };

        // Lade modinfo.ini
        if (fs.existsSync(modInfoPath)) {
          try {
            const iniContent = fs.readFileSync(modInfoPath, 'utf8');
            const parsed = ini.parse(iniContent);
            
            modData.name = parsed.name || item;
            modData.version = parsed.version || 'Unknown';
            modData.author = parsed.author || 'Unknown';
            modData.author2 = parsed.author2 || ''; // NEU
            modData.description = parsed.description || '';
            modData.addonfor = parsed.addonfor || '';
            modData.category = parsed.category || 'Uncategorized';
            modData.authorlink = parsed.authorlink || '';
            modData.authorlink2 = parsed.authorlink2 || ''; // NEU
            modData.modlink = parsed.modlink || '';
            modData.codes = parsed.codes || '';
            modData.requirements = parsed.requirements || ''; // NEU
          } catch (err) {
            console.error(`Error parsing modinfo.ini for ${item}:`, err);
          }
        }

        // Scanne nach Screenshots
        const screenshots = Array.from({ length: 20 }, (_, i) => 
          i === 0 ? 'screen.png' : `screen${i + 1}.png`
        );
        for (const screenshot of screenshots) {
          const screenshotPath = path.join(itemPath, screenshot);
          if (fs.existsSync(screenshotPath)) {
            modData.screenshots.push(screenshotPath);
          }
        }

        // Prüfe ob Mod im aktuellen Profil aktiviert ist
        const profile = config.profiles[config.activeProfile];
        if (profile && profile.mods) {
          const modEntry = profile.mods.find(m => m.id === item);
          if (modEntry) {
            modData.enabled = modEntry.enabled;
            modData.order = modEntry.order;
          }
        }

        mods.push(modData);
      }
    }

    return { success: true, mods };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('toggle-mod', async (event, modId) => {
  const profile = config.profiles[config.activeProfile];
  if (!profile) return { success: false, error: 'No active profile' };

  let modEntry = profile.mods.find(m => m.id === modId);
  
  const wasEnabled = modEntry ? modEntry.enabled : false;
  const willBeEnabled = !wasEnabled;

  if (!modEntry) {
    modEntry = { id: modId, enabled: true, order: profile.mods.length };
    profile.mods.push(modEntry);
  } else {
    modEntry.enabled = !modEntry.enabled;
  }

  // Kopiere/Entferne Mod-Dateien
  try {
    const sourcePath = config.modSourcePath || config.modPath;
    const modSourcePath = path.join(sourcePath, modId);
    const targetPath = config.gamePath;

    // Stelle sicher dass installedFiles existiert
    if (!config.installedFiles) {
      config.installedFiles = {};
    }

    // Initialisiere installedFiles für diese Mod falls nicht vorhanden
    if (!config.installedFiles[modId]) {
      config.installedFiles[modId] = [];
    }

    if (willBeEnabled) {
      // Kopiere alle Dateien und tracke sie
      const installedFilesList = [];
      await copyModFiles(modSourcePath, targetPath, installedFilesList);
      config.installedFiles[modId] = installedFilesList;
    } else {
      // Entferne nur die getrackten Dateien dieser Mod
      const filesToRemove = config.installedFiles[modId] || [];
      for (const relativeFilePath of filesToRemove) {
        const absolutePath = path.join(targetPath, relativeFilePath);
        try {
          if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
            fs.unlinkSync(absolutePath);
          }
        } catch (err) {
          console.error(`Error removing file ${absolutePath}:`, err);
        }
      }
      
      // Entferne leere Ordner (optional, aber sicher)
      await removeEmptyDirectories(targetPath, config.gamePath);
      
      // Lösche die Tracking-Info
      config.installedFiles[modId] = [];
    }
  } catch (err) {
    console.error('Error toggling mod files:', err);
    // Rollback
    modEntry.enabled = wasEnabled;
    saveConfig();
    return { success: false, error: `Failed to copy/remove mod files: ${err.message}` };
  }

  saveConfig();
  return { success: true, enabled: modEntry.enabled };
});

// Hilfsfunktion zum rekursiven Kopieren und Tracken von Dateien
async function copyModFiles(sourceDir, targetDir, installedFilesList, relativePath = '') {
  try {
    let items;
    try {
      items = fs.readdirSync(sourceDir);
    } catch (err) {
      console.error(`Quelle nicht lesbar: ${sourceDir}`, err.message);
      throw new Error(`Mod-Quelle nicht zugänglich: ${err.message}`);
    }

    for (const item of items) {
      if (item === 'modinfo.ini' || item.startsWith('screen')) continue;

      const sourcePath = path.join(sourceDir, item);
      const targetPath = path.join(targetDir, item);
      const relativeFilePath = path.join(relativePath, item);

      try {
        const stat = fs.statSync(sourcePath);

        if (stat.isFile()) {
          const targetDirPath = path.dirname(targetPath);
          
          try {
            if (!fs.existsSync(targetDirPath)) {
              fs.mkdirSync(targetDirPath, { recursive: true });
            }
          } catch (err) {
            console.error(`Ziel-Ordner konnte nicht erstellt werden: ${targetDirPath}`, err);
            throw new Error(`Ordner-Erstellung fehlgeschlagen: ${err.message}`);
          }
          
          try {
            fs.copyFileSync(sourcePath, targetPath);
            installedFilesList.push(relativeFilePath);
          } catch (err) {
            console.error(`Datei kopieren fehlgeschlagen: ${sourcePath}`, err);
            throw new Error(`Datei konnte nicht kopiert werden: ${sourcePath} (${err.message})`);
          }
        } else if (stat.isDirectory()) {
          const targetPath = path.join(targetDir, item);
          if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
          }
          await copyModFiles(sourcePath, targetPath, installedFilesList, relativeFilePath);
        }
      } catch (err) {
        if (err.message.includes('konnte nicht')) throw err; // Rethrow eigene Fehler
        console.error(`Item ${item} konnte nicht verarbeitet werden:`, err);
        // Optional: Weitermachen oder abbrechen
        throw new Error(`Fehler bei ${item}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('Copy-Operation fehlgeschlagen:', err);
    throw err;
  }
}

// Hilfsfunktion zum Entfernen leerer Verzeichnisse
async function removeEmptyDirectories(directory, rootDir) {
  try {
    // Verhindere das Löschen des Root-Verzeichnisses
    if (directory === rootDir) return;

    const items = fs.readdirSync(directory);
    
    // Rekursiv durch Unterordner
    for (const item of items) {
      const fullPath = path.join(directory, item);
      if (fs.statSync(fullPath).isDirectory()) {
        await removeEmptyDirectories(fullPath, rootDir);
      }
    }

    // Prüfe ob Ordner jetzt leer ist
    const remainingItems = fs.readdirSync(directory);
    if (remainingItems.length === 0) {
      fs.rmdirSync(directory);
    }
  } catch (err) {
    // Ignoriere Fehler beim Löschen von Ordnern
  }
}

ipcMain.handle('create-profile', async (event, profileName) => {
  const profileId = profileName.toLowerCase().replace(/\s+/g, '_');
  
  if (config.profiles[profileId]) {
    return { success: false, error: 'Profile already exists' };
  }

  config.profiles[profileId] = {
    name: profileName,
    mods: []
  };

  saveConfig();
  return { success: true, profileId };
});

ipcMain.handle('switch-profile', async (event, profileId) => {
  if (!config.profiles[profileId]) {
    return { success: false, error: 'Profile not found' };
  }

  config.activeProfile = profileId;
  saveConfig();
  return { success: true };
});

ipcMain.handle('delete-profile', async (event, profileId) => {
  if (profileId === 'default') {
    return { success: false, error: 'Cannot delete default profile' };
  }

  if (!config.profiles[profileId]) {
    return { success: false, error: 'Profile not found' };
  }

  delete config.profiles[profileId];
  
  if (config.activeProfile === profileId) {
    config.activeProfile = 'default';
  }

  saveConfig();
  return { success: true };
});

ipcMain.handle('toggle-all-mods', async (event, enable) => {
  const profile = config.profiles[config.activeProfile];
  if (!profile) return { success: false, error: 'No active profile' };

  if (!config.gamePath || !config.modPath) {
    return { success: false, error: 'Game path not configured' };
  }

  const sourcePath = config.modSourcePath || config.modPath;
  if (!fs.existsSync(sourcePath)) {
    return { success: false, error: 'Mod source path does not exist' };
  }

  // Stelle sicher dass installedFiles existiert
  if (!config.installedFiles) {
    config.installedFiles = {};
  }

  try {
    const items = fs.readdirSync(sourcePath);
    const targetPath = config.gamePath;

    let processedCount = 0;
    let errorCount = 0;

    for (const item of items) {
      const itemPath = path.join(sourcePath, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory()) {
        try {
          let modEntry = profile.mods.find(m => m.id === item);
          
          if (!modEntry) {
            modEntry = { id: item, enabled: enable, order: profile.mods.length };
            profile.mods.push(modEntry);
          } else {
            // Nur ändern wenn der Zustand unterschiedlich ist
            if (modEntry.enabled === enable) {
              continue;
            }
            modEntry.enabled = enable;
          }

          const modSourcePath = path.join(sourcePath, item);

          // Initialisiere installedFiles für diese Mod falls nicht vorhanden
          if (!config.installedFiles[item]) {
            config.installedFiles[item] = [];
          }

          if (enable) {
            // Kopiere alle Dateien und tracke sie
            const installedFilesList = [];
            await copyModFiles(modSourcePath, targetPath, installedFilesList);
            config.installedFiles[item] = installedFilesList;
          } else {
            // Entferne nur die getrackten Dateien dieser Mod
            const filesToRemove = config.installedFiles[item] || [];
            for (const relativeFilePath of filesToRemove) {
              const absolutePath = path.join(targetPath, relativeFilePath);
              try {
                if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
                  fs.unlinkSync(absolutePath);
                }
              } catch (err) {
                console.error(`Error removing file ${absolutePath}:`, err);
              }
            }
            
            // Entferne leere Ordner
            await removeEmptyDirectories(targetPath, config.gamePath);
            
            // Lösche die Tracking-Info
            config.installedFiles[item] = [];
          }

          processedCount++;
        } catch (err) {
          console.error(`Error processing mod ${item}:`, err);
          errorCount++;
        }
      }
    }

    saveConfig();
    return { 
      success: true, 
      processed: processedCount,
      errors: errorCount,
      enabled: enable 
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('reorder-mods', async (event, modOrder) => {
  const profile = config.profiles[config.activeProfile];
  if (!profile) return { success: false, error: 'No active profile' };

  modOrder.forEach((modId, index) => {
    let modEntry = profile.mods.find(m => m.id === modId);
    if (modEntry) {
      modEntry.order = index;
    }
  });

  profile.mods.sort((a, b) => a.order - b.order);
  saveConfig();
  return { success: true };
});

ipcMain.handle('update-settings', async (event, settings) => {
  config.settings = { ...config.settings, ...settings };
  saveConfig();
  return { success: true };
});

ipcMain.handle('export-profile', async (event, profileId) => {
  const profile = config.profiles[profileId];
  if (!profile) return { success: false, error: 'Profile not found' };

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Profile',
    defaultPath: `${profile.name}.json`,
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });

  if (!result.canceled && result.filePath) {
    try {
      fs.writeFileSync(result.filePath, JSON.stringify(profile, null, 2));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'Export canceled' };
});

ipcMain.handle('import-profile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Profile',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const profileData = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
      const profileId = profileData.name.toLowerCase().replace(/\s+/g, '_');
      
      config.profiles[profileId] = profileData;
      saveConfig();
      
      return { success: true, profileId };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'Import canceled' };
});

ipcMain.handle('open-folder', async (event, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) {
    return { success: false, error: 'Folder does not exist' };
  }

  try {
    const { shell } = require('electron');
    await shell.openPath(folderPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('launch-game', async () => {
  if (!config.gamePath) {
    return { success: false, error: 'Game path not set' };
  }

  const exePath = path.join(config.gamePath, 'bin', 'x64', 'Cyberpunk2077.exe');
  
  if (!fs.existsSync(exePath)) {
    return { success: false, error: 'Game executable not found' };
  }

  try {
    const { shell } = require('electron');
    await shell.openPath(exePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Window Controls
ipcMain.on('window-minimize', () => {
  mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  mainWindow.close();
});