const { ipcRenderer } = require('electron');
const path = require('path');

// State
let currentMods = [];
let filteredMods = [];
let selectedMod = null;
let config = null;
let imageViewerIndex = 0;
let imageViewerImages = [];
let availableCategories = new Set();
let codeViewerData = null;
let selectedCodeCategory = null;
let expandedMainMods = new Set(); // Welche Main-Mods sind aufgeklappt

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  setupEventDelegation(); // ← Nur EINMAL!
  updateUI();
});

// Load Config
async function loadConfig() {
  config = await ipcRenderer.invoke('get-config');
  updateSettingsUI();
  updateProfileSelector();
}

// Event Listeners
function setupEventListeners() {
  // Window Controls
  document.getElementById('minimize-btn').addEventListener('click', () => {
    ipcRenderer.send('window-minimize');
  });

  document.getElementById('maximize-btn').addEventListener('click', () => {
    ipcRenderer.send('window-maximize');
  });

  document.getElementById('close-btn').addEventListener('click', () => {
    ipcRenderer.send('window-close');
  });

  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const page = e.currentTarget.dataset.page;
      switchPage(page);
    });
  });

  // Profile Management
  document.getElementById('profile-select').addEventListener('change', async (e) => {
    await switchProfile(e.target.value);
  });

  document.getElementById('add-profile-btn').addEventListener('click', () => {
    showProfileModal();
  });

  document.getElementById('export-profile-btn').addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('export-profile', config.activeProfile);
    if (result.success) {
      addLog(`Profile exported successfully`, 'success');
    } else {
      addLog(`Export failed: ${result.error}`, 'error');
    }
  });

  document.getElementById('import-profile-btn').addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('import-profile');
    if (result.success) {
      await loadConfig();
      addLog(`Profile imported successfully`, 'success');
    } else {
      addLog(`Import failed: ${result.error}`, 'error');
    }
  });

  document.getElementById('delete-profile-btn').addEventListener('click', async () => {
    if (config.activeProfile === 'default') {
      addLog('Cannot delete default profile', 'warning');
      return;
    }

    const confirmed = await showConfirmDialog(
      'Delete Profile',
      `Are you sure you want to delete the profile "${config.profiles[config.activeProfile].name}"? This action cannot be undone.`
    );

    if (confirmed) {
      const result = await ipcRenderer.invoke('delete-profile', config.activeProfile);
      if (result.success) {
        await loadConfig();
        addLog('Profile deleted', 'success');
      }
    }
  });

  // Profile Modal
  document.getElementById('close-profile-modal').addEventListener('click', hideProfileModal);
  document.getElementById('cancel-profile-btn').addEventListener('click', hideProfileModal);
  document.getElementById('create-profile-btn').addEventListener('click', async () => {
    const name = document.getElementById('profile-name-input').value.trim();
    if (!name) {
      addLog('Profile name cannot be empty', 'warning');
      return;
    }

    const result = await ipcRenderer.invoke('create-profile', name);
    if (result.success) {
      await loadConfig();
      hideProfileModal();
      addLog(`Profile '${name}' created`, 'success');
    } else {
      addLog(`Failed to create profile: ${result.error}`, 'error');
    }
  });

  // Confirm Modal
  document.getElementById('close-confirm-modal').addEventListener('click', () => {
    hideConfirmDialog(false);
  });
  document.getElementById('cancel-confirm-btn').addEventListener('click', () => {
    hideConfirmDialog(false);
  });
  document.getElementById('accept-confirm-btn').addEventListener('click', () => {
    hideConfirmDialog(true);
  });

  // Image Viewer Modal
  document.getElementById('close-image-viewer').addEventListener('click', hideImageViewer);
  document.getElementById('image-viewer-prev').addEventListener('click', () => {
    navigateImageViewer(-1);
  });
  document.getElementById('image-viewer-next').addEventListener('click', () => {
    navigateImageViewer(1);
  });
  
  // Close image viewer with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('image-viewer-modal').classList.contains('active')) {
      hideImageViewer();
    }
    if (document.getElementById('image-viewer-modal').classList.contains('active')) {
      if (e.key === 'ArrowLeft') navigateImageViewer(-1);
      if (e.key === 'ArrowRight') navigateImageViewer(1);
    }
  });

  // Code Viewer Modal
  document.getElementById('close-code-viewer').addEventListener('click', hideCodeViewer);

  // Mod Actions
  document.getElementById('scan-mods-btn').addEventListener('click', scanMods);

  document.getElementById('enable-all-btn').addEventListener('click', async () => {
    if (currentMods.length === 0) {
      addLog('No mods to enable. Please scan for mods first.', 'warning');
      return;
    }

    const confirmed = await showConfirmDialog(
      'Enable All Mods',
      `Are you sure you want to enable all ${currentMods.length} mods? This will copy all mod files to your Cyberpunk 2077 installation.`
    );

    if (confirmed) {
      await toggleAllMods(true);
    }
  });

  document.getElementById('disable-all-btn').addEventListener('click', async () => {
    if (currentMods.length === 0) {
      addLog('No mods to disable.', 'warning');
      return;
    }

    const confirmed = await showConfirmDialog(
      'Disable All Mods',
      `Are you sure you want to disable all ${currentMods.length} mods? This will remove all mod files from your Cyberpunk 2077 installation.`
    );

    if (confirmed) {
      await toggleAllMods(false);
    }
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    filterMods(e.target.value);
  });

  document.getElementById('category-filter').addEventListener('change', (e) => {
    filterMods();
  });

  // Settings
  document.getElementById('browse-game-path').addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('set-game-path');
    if (result.success) {
      await loadConfig();
      addLog(`Game path set: ${result.path}`, 'success');
    } else {
      addLog(`Failed to set game path: ${result.error}`, 'error');
    }
  });

  document.getElementById('browse-mod-source-path').addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('set-mod-source-path');
    if (result.success) {
      await loadConfig();
      addLog(`Mod source path set: ${result.path}`, 'success');
    } else {
      addLog(`Failed to set mod source path: ${result.error}`, 'error');
    }
  });

  document.getElementById('open-game-path').addEventListener('click', async () => {
    if (!config.gamePath) {
      addLog('Game path not set', 'warning');
      return;
    }
    const result = await ipcRenderer.invoke('open-folder', config.gamePath);
    if (result.success) {
      addLog('Opened game folder', 'info');
    } else {
      addLog(`Failed to open folder: ${result.error}`, 'error');
    }
  });

  document.getElementById('open-mod-source-path').addEventListener('click', async () => {
    if (!config.modSourcePath) {
      addLog('Mod source path not set', 'warning');
      return;
    }
    const result = await ipcRenderer.invoke('open-folder', config.modSourcePath);
    if (result.success) {
      addLog('Opened mod source folder', 'info');
    } else {
      addLog(`Failed to open folder: ${result.error}`, 'error');
    }
  });

  document.getElementById('launch-game-btn').addEventListener('click', async () => {
    if (!config.gamePath) {
      addLog('Please set game path in settings first', 'warning');
      switchPage('settings');
      return;
    }
    
    addLog('Launching Cyberpunk 2077...', 'info');
    const result = await ipcRenderer.invoke('launch-game');
    
    if (result.success) {
      addLog('Game launched successfully', 'success');
    } else {
      addLog(`Failed to launch game: ${result.error}`, 'error');
    }
  });

  document.getElementById('auto-backup-checkbox').addEventListener('change', async (e) => {
    await updateSettings({ autoBackup: e.target.checked });
  });

  document.getElementById('notifications-checkbox').addEventListener('change', async (e) => {
    await updateSettings({ showNotifications: e.target.checked });
  });

  // Logs
  document.getElementById('clear-logs-btn').addEventListener('click', () => {
    document.getElementById('log-terminal').innerHTML = '';
    addLog('Logs cleared', 'info');
  });
}

// Page Navigation
function switchPage(page) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });
  document.querySelector(`[data-page="${page}"]`).classList.add('active');

  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
  });
  document.getElementById(`${page}-page`).classList.add('active');
}

// Profile Management
function updateProfileSelector() {
  const select = document.getElementById('profile-select');
  select.innerHTML = '';

  Object.entries(config.profiles).forEach(([id, profile]) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = profile.name;
    option.selected = id === config.activeProfile;
    select.appendChild(option);
  });
}

async function switchProfile(profileId) {
  const result = await ipcRenderer.invoke('switch-profile', profileId);
  if (result.success) {
    await loadConfig();
    await scanMods();
    addLog(`Switched to profile: ${config.profiles[profileId].name}`, 'info');
  }
}

function showProfileModal() {
  document.getElementById('profile-name-input').value = '';
  document.getElementById('profile-modal').classList.add('active');
}

function hideProfileModal() {
  document.getElementById('profile-modal').classList.remove('active');
}

// Confirmation Dialog
let confirmResolve = null;

function showConfirmDialog(title, message) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-modal').classList.add('active');
  });
}

function hideConfirmDialog(result) {
  document.getElementById('confirm-modal').classList.remove('active');
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

// Mod Scanning
async function scanMods() {
  if (!config.gamePath) {
    addLog('Please set game path in settings first', 'warning');
    switchPage('settings');
    return;
  }

  addLog('Scanning for mods...', 'info');
  const scanBtn = document.getElementById('scan-mods-btn');
  scanBtn.classList.add('loading');
  scanBtn.disabled = true;

  const result = await ipcRenderer.invoke('scan-mods');

  scanBtn.classList.remove('loading');
  scanBtn.disabled = false;

  if (result.success) {
    currentMods = result.mods;
    filteredMods = [...currentMods];
    
    // Sammle alle Kategorien
    availableCategories.clear();
    currentMods.forEach(mod => {
      if (mod.category) {
        availableCategories.add(mod.category);
      }
    });
    
    updateCategoryFilter();
    renderModList();
    updateStats();
    
    // ZÃƒÂ¤hle Addons
    const addonCount = currentMods.filter(m => m.addonfor).length;
    addLog(`Found ${currentMods.length} mods${addonCount > 0 ? ` (${addonCount} add-ons)` : ''}`, 'success');
  } else {
    addLog(`Scan failed: ${result.error}`, 'error');
  }
}

// Hilfsfunktion: Finde Main Mod
function findMainMod(addonforName) {
  if (!addonforName || typeof addonforName !== 'string') return null;
  
  const normalized = addonforName.trim().toLowerCase();
  
  // Priorisierung:
  // 1. Exakte ID-Übereinstimmung (Best)
  let match = currentMods.find(mod => 
    mod.id.toLowerCase() === normalized
  );
  if (match) return match;
  
  // 2. Exakte Name-Übereinstimmung
  match = currentMods.find(mod => 
    mod.name.trim().toLowerCase() === normalized
  );
  if (match) return match;
  
  // 3. Ähnliche Namen (Fuzzy Match)
  const candidates = currentMods.filter(mod => 
    mod.name.trim().toLowerCase().includes(normalized) ||
    normalized.includes(mod.name.trim().toLowerCase())
  );
  
  if (candidates.length === 1) return candidates[0];
  
  // Zu viele Kandidaten oder keine gefunden
  console.warn(`Addon "${addonforName}" konnte nicht eindeutig zugeordnet werden`);
  return null;
}

// Hilfsfunktion: Finde alle Addons fÃƒÂ¼r eine Main Mod
function findAddons(mainModId) {
  return currentMods.filter(mod => {
    if (!mod.addonfor) return false;
    const mainMod = findMainMod(mod.addonfor);
    return mainMod && mainMod.id === mainModId;
  });
}

// Mod List Rendering
function renderModList() {
  const modList = document.getElementById('mod-list');
  modList.innerHTML = '';

  if (filteredMods.length === 0) {
    modList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <rect x="3" y="3" width="7" height="7"/>
          <rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/>
        </svg>
        <h3>No Mods Found</h3>
        <p>${currentMods.length === 0 ? 'Click "Scan Mods" to search for mods' : 'No mods match your search'}</p>
      </div>
    `;
    return;
  }

  // Gruppiere Mods nach Main Mods und Addons
  const processedMods = new Set();
  
  filteredMods.forEach(mod => {
    if (processedMods.has(mod.id)) return;
    
    // Wenn Addon UND Suche aktiv ist, zeige einzeln an
    const searchQuery = document.getElementById('search-input').value.toLowerCase();
    if (mod.addonfor && searchQuery) {
      // Bei aktiver Suche: Zeige alle Mods einzeln
      const card = createModCard(mod, false);
      modList.appendChild(card);
      processedMods.add(mod.id);
    } else if (mod.addonfor) {
      // Keine Suche aktiv: Addons werden gruppiert, nicht einzeln angezeigt
      processedMods.add(mod.id);
    } else {
      // Main Mod oder normale Mod
      const addons = findAddons(mod.id);
      const card = createModCard(mod, addons.length > 0, addons);
      modList.appendChild(card);
      processedMods.add(mod.id);
      
      // Markiere Addons als verarbeitet
      addons.forEach(addon => processedMods.add(addon.id));
      
      // Wenn expanded, zeige Addons
      if (expandedMainMods.has(mod.id)) {
        const addonContainer = createAddonContainer(mod, addons);
        modList.appendChild(addonContainer);
      }
    }
  });
}

function createModCard(mod, hasAddons = false, addons = []) {
  const card = document.createElement('div');
  
  // NEU: Prüfe Requirements
  const reqCheck = checkRequirements(mod);
  const hasUnmetRequirements = !reqCheck.satisfied;
  
  card.className = `mod-card ${!mod.enabled ? 'disabled' : ''} ${selectedMod?.id === mod.id ? 'selected' : ''} ${hasAddons ? 'has-addons' : ''} ${hasUnmetRequirements ? 'requirements-missing' : ''}`;
  card.dataset.modId = mod.id;

  const thumbnail = document.createElement('div');
  thumbnail.className = 'mod-thumbnail';

  if (mod.screenshots.length > 0) {
    const img = document.createElement('img');
    img.src = mod.screenshots[0];
    img.alt = mod.name;
    thumbnail.appendChild(img);
  } else {
    thumbnail.classList.add('no-image');
    thumbnail.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    `;
  }

  const info = document.createElement('div');
  info.className = 'mod-info';
  
  // NEU: Author String mit 2 Autoren
  let authorText = mod.author;
  if (mod.author2) {
    authorText = `${mod.author} and ${mod.author2}`;
  }
  
  let nameHTML = `<div class="mod-name">${mod.name}</div>`;
  if (hasAddons) {
    nameHTML = `
      <div class="mod-name">
        ${mod.name}
        <span class="addon-badge">${addons.length} Add-on${addons.length > 1 ? 's' : ''}</span>
      </div>
    `;
  }
  
  info.innerHTML = `
    ${nameHTML}
    <div class="mod-meta">
      <span>v${mod.version}</span>
      <span>by ${authorText}</span>
    </div>
  `;

  const actions = document.createElement('div');
  actions.className = 'mod-actions';

  if (hasAddons) {
    const folderBtn = document.createElement('button');
    folderBtn.className = 'icon-btn-small';
    folderBtn.title = 'Open Folder';
    folderBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
    `;
    folderBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const result = await ipcRenderer.invoke('open-folder', mod.path);
      if (result.success) {
        addLog(`Opened folder: ${mod.name}`, 'info');
      }
    });
    
    const expandBtn = document.createElement('button');
    expandBtn.className = 'icon-btn-small expand-btn';
    expandBtn.title = 'Show Add-ons';
    const isExpanded = expandedMainMods.has(mod.id);
    expandBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="transform: rotate(${isExpanded ? '180deg' : '0deg'}); transition: transform 0.3s;">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    `;
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMainModExpansion(mod.id);
    });
    
    actions.appendChild(folderBtn);
    actions.appendChild(expandBtn);
  } else {
    const toggle = document.createElement('div');
    toggle.className = 'mod-toggle';
    toggle.innerHTML = `<div class="toggle-switch ${mod.enabled ? 'active' : ''}"></div>`;
    toggle.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleMod(mod.id);
    });
    actions.appendChild(toggle);
  }

  card.appendChild(thumbnail);
  card.appendChild(info);
  card.appendChild(actions);

  card.addEventListener('click', () => {
    if (hasAddons) {
      toggleMainModExpansion(mod.id);
    } else {
      selectMod(mod);
    }
  });

  return card;
}

function createAddonContainer(mainMod, addons) {
  const container = document.createElement('div');
  container.className = 'addon-container';
  container.dataset.mainModId = mainMod.id;
  
  // Main Mod Header
  const header = document.createElement('div');
  header.className = 'addon-main-header';
  header.dataset.modId = mainMod.id; // NEU: data-mod-id hinzufügen
  
  const thumbnail = document.createElement('div');
  thumbnail.className = 'addon-thumbnail';
  
  if (mainMod.screenshots.length > 0) {
    const img = document.createElement('img');
    img.src = mainMod.screenshots[0];
    img.alt = mainMod.name;
    thumbnail.appendChild(img);
  } else {
    thumbnail.classList.add('no-image');
    thumbnail.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    `;
  }
  
  const mainInfo = document.createElement('div');
  mainInfo.className = 'addon-main-info';
  mainInfo.innerHTML = `
    <div class="addon-main-name">${mainMod.name}</div>
    <div class="addon-main-meta">Main Mod - v${mainMod.version} by ${mainMod.author}</div>
  `;
  
  const actions = document.createElement('div');
  actions.className = 'addon-main-actions';
  
  // Folder Button
  const folderBtn = document.createElement('button');
  folderBtn.className = 'icon-btn-small';
  folderBtn.title = 'Open Folder';
  folderBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  `;
  folderBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const result = await ipcRenderer.invoke('open-folder', mainMod.path);
    if (result.success) {
      addLog(`Opened folder: ${mainMod.name}`, 'info');
    }
  });
  
  // Toggle Switch
  const toggle = document.createElement('div');
  toggle.className = 'mod-toggle';
  toggle.innerHTML = `<div class="toggle-switch ${mainMod.enabled ? 'active' : ''}"></div>`;
  toggle.addEventListener('click', async (e) => {
    e.stopPropagation();
    await toggleMod(mainMod.id);
  });
  
  actions.appendChild(folderBtn);
  actions.appendChild(toggle);
  
  header.appendChild(thumbnail);
  header.appendChild(mainInfo);
  header.appendChild(actions);
  
  mainInfo.addEventListener('click', () => {
    selectMod(mainMod);
  });
  thumbnail.addEventListener('click', () => {
    selectMod(mainMod);
  });
  
  container.appendChild(header);
  
  // Addons
  addons.forEach(addon => {
    // NEU: Prüfe Requirements für Addon
    const addonReqCheck = checkRequirements(addon);
    const addonHasUnmetRequirements = !addonReqCheck.satisfied;
    
    const addonCard = document.createElement('div');
    addonCard.className = 'addon-card';
    addonCard.dataset.modId = addon.id; // HIER hinzufügen

    const addonThumbnail = document.createElement('div');
    addonThumbnail.className = 'addon-thumbnail';
    
    if (addon.screenshots.length > 0) {
      const img = document.createElement('img');
      img.src = addon.screenshots[0];
      img.alt = addon.name;
      addonThumbnail.appendChild(img);
    } else {
      addonThumbnail.classList.add('no-image');
      addonThumbnail.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
      `;
    }
    
    const addonInfo = document.createElement('div');
    addonInfo.className = 'addon-info';
    addonInfo.innerHTML = `
      <div class="addon-name">${addon.name}</div>
      <div class="addon-meta">
        <span>v${addon.version}</span>
        <span>by ${addon.author}</span>
      </div>
    `;
    
    const toggle = document.createElement('div');
    toggle.className = 'mod-toggle';
    toggle.innerHTML = `<div class="toggle-switch ${addon.enabled ? 'active' : ''}"></div>`;
    
    addonCard.appendChild(addonThumbnail);
    addonCard.appendChild(addonInfo);
    addonCard.appendChild(toggle);
    
    // Events
    addonInfo.addEventListener('click', () => selectMod(addon));
    addonThumbnail.addEventListener('click', () => selectMod(addon));
    
    toggle.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleMod(addon.id);
    });
    
    container.appendChild(addonCard);
  });
  
  return container;
}

function toggleMainModExpansion(mainModId) {
  // Speichere die aktuelle Scroll-Position
  const modList = document.getElementById('mod-list');
  const scrollPosition = modList.scrollTop;
  
  if (expandedMainMods.has(mainModId)) {
    expandedMainMods.delete(mainModId);
  } else {
    expandedMainMods.add(mainModId);
  }
  
  renderModList();
  
  // Stelle die Scroll-Position wieder her
  modList.scrollTop = scrollPosition;
}

// Mod Selection
function selectMod(mod) {
  selectedMod = mod;
  
  // Speichere die aktuelle Scroll-Position
  const modList = document.getElementById('mod-list');
  const scrollPosition = modList.scrollTop;
  
  // Rendere nur die Details, nicht die Liste
  renderModDetails(mod);
  
  // Update nur die visuellen Ã„nderungen in der Liste ohne neu zu rendern
  document.querySelectorAll('.mod-card').forEach(card => {
    card.classList.remove('selected');
    if (card.dataset.modId === mod.id) {
      card.classList.add('selected');
    }
  });
  
  document.querySelectorAll('.addon-card').forEach(card => {
    card.classList.remove('selected');
    if (card.dataset.modId === mod.id) {
      card.classList.add('selected');
    }
  });
  
  // Stelle die Scroll-Position wieder her
  modList.scrollTop = scrollPosition;
}

function renderModDetails(mod) {
  const details = document.getElementById('mod-details');
  
  // NEU: Author String mit Links
  let authorHTML = mod.author;
  if (mod.authorlink) {
    authorHTML = `<a href="${mod.authorlink}" class="nexus-link" target="_blank">${mod.author}</a>`;
  }
  
  // NEU: Author2 hinzufügen
  let author2HTML = '';
  if (mod.author2) {
    if (mod.authorlink2) {
      author2HTML = ` & <a href="${mod.authorlink2}" class="nexus-link" target="_blank">${mod.author2}</a>`;
    } else {
      author2HTML = ` & ${mod.author2}`;
    }
  }
  
  const fullAuthorHTML = authorHTML + author2HTML;
  
  // Addon Info
  let addonInfo = '';
  if (mod.addonfor) {
    const mainMod = findMainMod(mod.addonfor);
    if (mainMod) {
      addonInfo = `<div><strong>Add-on for:</strong> <span class="addon-link">${mainMod.name}</span></div>`;
    } else {
      addonInfo = `<div><strong>Add-on for:</strong> ${mod.addonfor}</div>`;
    }
  }
  

  // NEU: Requirements Check - NUR Warnung anzeigen
  const reqCheck = checkRequirements(mod);
  let requirementsHTML = '';
  if (mod.requirements && mod.requirements.trim() !== '' && !reqCheck.satisfied) {
    requirementsHTML = `
      <div class="requirements-warning">
        <div class="requirements-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>Missing Requirements</span>
        </div>
        <p>Install the following mods for this mod to work properly:</p>
        <ul class="requirements-list">
          ${reqCheck.missing.map(req => `<li>${req}</li>`).join('')}
        </ul>
      </div>
    `;
  }
  
  details.innerHTML = `
    <div class="detail-header">
      <h3 class="detail-title">${mod.name}</h3>
      <div class="detail-meta">
        <div><strong>Version:</strong> ${mod.version}</div>
        <div><strong>${mod.author2 ? 'Authors:' : 'Author:'}</strong> ${fullAuthorHTML}</div>
        ${addonInfo}
        <div><strong>Status:</strong> <span style="color: ${mod.enabled ? 'var(--success)' : 'var(--text-muted)'}">
          ${mod.enabled ? 'Enabled' : 'Disabled'}
        </span></div>
      </div>
    </div>

    ${requirementsHTML}

    ${mod.screenshots.length > 0 ? `
      <div class="detail-section">
        <h4>Screenshots</h4>
        <div class="screenshot-viewer" id="screenshot-viewer">
          <img src="${mod.screenshots[0]}" alt="${mod.name}">
          ${mod.screenshots.length > 1 ? `
            <div class="screenshot-nav" id="screenshot-nav"></div>
          ` : ''}
        </div>
      </div>
    ` : ''}

    <div class="detail-section">
      <h4>Description</h4>
      <p class="detail-description">${mod.description || 'No description available'}</p>
    </div>

    <div class="detail-section">
      <h4>Category</h4>
      <p class="detail-description">${mod.category || 'Uncategorized'}</p>
    </div>

    <div class="detail-section">
      <h4>Installation Path</h4>
      <p class="detail-description" style="font-family: monospace; font-size: 12px; word-break: break-all;">
        ${mod.path}
      </p>
    </div>

    ${mod.codes ? `
      <div class="detail-section">
        <button class="btn-view-codes" id="view-codes-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2"/>
            <path d="M6 9h12M6 13h12M6 17h6"/>
          </svg>
          View Item Codes (${Object.keys(parseModCodes(mod.codes)).length})
        </button>
      </div>
    ` : ''}

    ${mod.modlink ? `
      <div class="detail-section">
        <button class="btn-nexus-mods" id="view-on-nexus-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
          </svg>
          View on Nexus Mods
        </button>
      </div>
    ` : ''}
  `;

  // Rest des Codes bleibt gleich...
  if (mod.addonfor) {
    const addonLink = details.querySelector('.addon-link');
    if (addonLink) {
      addonLink.style.cursor = 'pointer';
      addonLink.style.color = 'var(--accent-primary)';
      addonLink.addEventListener('click', () => {
        const mainMod = findMainMod(mod.addonfor);
        if (mainMod) {
          selectMod(mainMod);
        }
      });
    }
  }

  if (mod.screenshots.length > 1) {
    setupScreenshotNav(mod.screenshots);
  }

  if (mod.codes) {
    document.getElementById('view-codes-btn').addEventListener('click', () => {
      showCodeViewer(mod);
    });
  }

  if (mod.modlink) {
    document.getElementById('view-on-nexus-btn').addEventListener('click', () => {
      const { shell } = require('electron');
      shell.openExternal(mod.modlink);
    });
  }
}

function setupScreenshotNav(screenshots) {
  const viewer = document.getElementById('screenshot-viewer');
  const nav = document.getElementById('screenshot-nav');
  let currentIndex = 0;

  // Click on image to open fullscreen viewer
  viewer.querySelector('img').addEventListener('click', () => {
    showImageViewer(screenshots, currentIndex);
  });

  screenshots.forEach((screenshot, index) => {
    const btn = document.createElement('button');
    btn.className = index === 0 ? 'active' : '';
    btn.addEventListener('click', () => {
      currentIndex = index;
      viewer.querySelector('img').src = screenshot;
      nav.querySelectorAll('button').forEach((b, i) => {
        b.className = i === index ? 'active' : '';
      });
    });
    nav.appendChild(btn);
  });
}

// Image Viewer
function showImageViewer(images, startIndex = 0) {
  imageViewerImages = images;
  imageViewerIndex = startIndex;
  updateImageViewer();
  document.getElementById('image-viewer-modal').classList.add('active');
}

function hideImageViewer() {
  document.getElementById('image-viewer-modal').classList.remove('active');
  imageViewerImages = [];
  imageViewerIndex = 0;
}

function navigateImageViewer(direction) {
  imageViewerIndex += direction;
  if (imageViewerIndex < 0) imageViewerIndex = imageViewerImages.length - 1;
  if (imageViewerIndex >= imageViewerImages.length) imageViewerIndex = 0;
  updateImageViewer();
}

function updateImageViewer() {
  const img = document.getElementById('image-viewer-img');
  const counter = document.getElementById('image-viewer-counter');
  const prevBtn = document.getElementById('image-viewer-prev');
  const nextBtn = document.getElementById('image-viewer-next');

  img.src = imageViewerImages[imageViewerIndex];
  counter.textContent = `${imageViewerIndex + 1} / ${imageViewerImages.length}`;

  // Hide navigation buttons if only one image
  if (imageViewerImages.length <= 1) {
    prevBtn.classList.add('hidden');
    nextBtn.classList.add('hidden');
  } else {
    prevBtn.classList.remove('hidden');
    nextBtn.classList.remove('hidden');
  }
}

// Code Viewer
function showCodeViewer(mod) {
  if (!mod.codes || mod.codes.trim() === '') {
    addLog('No codes found for this mod', 'warning');
    return;
  }

  codeViewerData = parseModCodes(mod.codes);
  selectedCodeCategory = Object.keys(codeViewerData)[0] || null;
  
  renderCodeViewer();
  document.getElementById('code-viewer-modal').classList.add('active');
}

function hideCodeViewer() {
  document.getElementById('code-viewer-modal').classList.remove('active');
  codeViewerData = null;
  selectedCodeCategory = null;
}

function parseModCodes(codesString) {
  const codes = [];
  const seen = new Set(); // Für Deduplizierung

  // INVENTORY - alle Varianten in einer Regex
  const inventoryRegex = /Game\.AddToInventory\s*\(\s*"Items\.([^"]+)"/gi;
  let match;
  while ((match = inventoryRegex.exec(codesString)) !== null) {
    const key = `inventory:${match[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      codes.push({
        type: 'inventory',
        fullCode: match[1],
        rawCode: match[0]
      });
    }
  }

  // VEHICLE - ALLE Formate in EINER REGEX kombiniert
  const vehicleRegex = /Game\.GetVehicleSystem\s*\(\s*\)\s*:\s*EnablePlayerVehicle\s*\(\s*['"]Vehicle\.([^'"]+)['"]\s*(?:,\s*(?:true|false))?\s*(?:,\s*(?:true|false))?\s*\)/gi;
  while ((match = vehicleRegex.exec(codesString)) !== null) {
    const key = `vehicle:${match[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      codes.push({
        type: 'vehicle',
        fullCode: match[1],
        rawCode: match[0]
      });
    }
  }

  // Organisiere nach Typ und Kategorie
  const organized = {};

  codes.forEach(code => {
    let category = '';
    let variant = '';

    if (code.type === 'inventory') {
      const parts = code.fullCode.split('_');
      category = parts.slice(0, -1).join('_');
      variant = parts[parts.length - 1];
      if (!category) category = 'Items';
    } else if (code.type === 'vehicle') {
      const parts = code.fullCode.split('_');
      category = parts.slice(0, -1).join('_') || 'Vehicles';
      variant = parts[parts.length - 1] || code.fullCode;
    }

    if (!organized[category]) {
      organized[category] = [];
    }

    organized[category].push({
      fullCode: code.fullCode,
      variant: variant,
      type: code.type,
      color: code.type === 'vehicle' ? null : getColorFromVariant(variant),
      rawCode: code.rawCode
    });
  });

  return organized;
}

// ===== NEUE FUNKTION - NACH parseModCodes() EINFÃœGEN =====
function getCodeCount(codesString) {
  const inventoryRegex = /Game\.AddToInventory\s*\(\s*"Items\.([^"]+)"/gi;
  const vehicleRegex = /Game\.GetVehicleSystem\s*\(\s*\)\s*:\s*EnablePlayerVehicle\s*\(/gi;
  
  let inventoryCount = 0, vehicleCount = 0;
  let match;
  
  while ((match = inventoryRegex.exec(codesString)) !== null) inventoryCount++;
  while ((match = vehicleRegex.exec(codesString)) !== null) vehicleCount++;
  
  return inventoryCount + vehicleCount;
}

function getColorFromVariant(variant) {
  const colorMap = {
    'black': '#000000',
    'white': '#FFFFFF',
    'red': '#FF0000',
    'blue': '#0084ffff',
    'green': '#00FF00',
    'yellow': '#FFFF00',
    'pink': '#FF1493',
    'purple': '#800080',
    'cyan': '#00FFFF',
    'gray': '#808080',
    'grey': '#808080',
    'orange': '#FFA500',
    'brown': '#A52A2A',
    'bleu': '#0084ffff',
  };
  
  return colorMap[variant.toLowerCase()] || null;
}

// Prüfe ob Requirements erfüllt sind
function checkRequirements(mod) {
  if (!mod.requirements || mod.requirements.trim() === '') {
    return { satisfied: true, missing: [] };
  }

  const required = mod.requirements
    .split(',')
    .map(r => r.trim())
    .filter(r => r.length > 0);

  const missing = [];

  required.forEach(reqName => {
    const found = currentMods.some(m => 
      m.name.toLowerCase() === reqName.toLowerCase() ||
      m.id.toLowerCase() === reqName.toLowerCase()
    );
    if (!found) {
      missing.push(reqName);
    }
  });

  return {
    satisfied: missing.length === 0,
    missing: missing
  };
}

function renderCodeViewer() {
  const modal = document.getElementById('code-viewer-modal');
  const categories = Object.keys(codeViewerData);
  
  const categoryContainer = document.getElementById('code-categories');
  categoryContainer.innerHTML = '';
  
  categories.forEach(category => {
    const btn = document.createElement('button');
    btn.className = `code-category-btn ${selectedCodeCategory === category ? 'active' : ''}`;
    btn.textContent = formatCategoryName(category);
    btn.addEventListener('click', () => {
      selectedCodeCategory = category;
      renderCodeViewer();
    });
    categoryContainer.appendChild(btn);
  });

  const codesContainer = document.getElementById('code-items');
  codesContainer.innerHTML = '';
  
  if (selectedCodeCategory && codeViewerData[selectedCodeCategory]) {
    codeViewerData[selectedCodeCategory].forEach(item => {
      const codeItem = document.createElement('div');
      codeItem.className = 'code-item';
      
      let colorIndicator = '';
      if (item.color) {
        colorIndicator = `<div class="color-indicator" style="background-color: ${item.color};" title="${item.variant}"></div>`;
      }

      let typeIcon = '';
      if (item.type === 'vehicle') {
        typeIcon = `<span class="code-type-badge vehicle">Vehicle</span>`;
      } else {
        typeIcon = `<span class="code-type-badge item">Item</span>`;
      }
      
      codeItem.innerHTML = `
        ${colorIndicator}
        <div class="code-info">
          ${typeIcon}
          <span class="code-variant">${item.variant}</span>
          <span class="code-full">${item.type === 'vehicle' ? 'Vehicle.' : 'Items.'}${item.fullCode}</span>
        </div>
        <button class="btn-copy-code" title="Copy to clipboard">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
          </svg>
        </button>
      `;
      
      codeItem.querySelector('.btn-copy-code').addEventListener('click', () => {
        const code = item.type === 'vehicle' 
          ? `Game.GetVehicleSystem():EnablePlayerVehicle("Vehicle.${item.fullCode}", true, false)`
          : `Game.AddToInventory("Items.${item.fullCode}",1)`;
        navigator.clipboard.writeText(code).then(() => {
          addLog(`Code copied: ${item.variant}`, 'success');
        });
      });
      
      codesContainer.appendChild(codeItem);
    });
  }
}

function formatCategoryName(category) {
  return category
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Mod Toggle
async function toggleMod(modId) {
  const result = await ipcRenderer.invoke('toggle-mod', modId);
  
  if (result.success) {
    const mod = currentMods.find(m => m.id === modId);
    if (mod) {
      mod.enabled = result.enabled;
      
      // Update nur die betroffene Mod Card ohne komplettes Re-Rendering
      updateModCardToggle(modId, result.enabled);
      
      // Update Details wenn diese Mod ausgewählt ist
      if (selectedMod?.id === modId) {
        selectedMod.enabled = result.enabled;
        renderModDetails(selectedMod);
      }
      
      updateStats();
      addLog(`${mod.name} ${result.enabled ? 'enabled' : 'disabled'}`, 'info');
    }
  } else {
    addLog(`Failed to toggle mod: ${result.error}`, 'error');
  }
}

// Update nur den Toggle-Status einer einzelnen Mod Card
function updateModCardToggle(modId, enabled) {
  // Update 1: Normale Mod Liste
  const modCard = document.querySelector(`.mod-card[data-mod-id="${modId}"]`);
  if (modCard) {
    const toggle = modCard.querySelector('.toggle-switch');
    if (toggle) {
      toggle.classList.toggle('active', enabled);
      modCard.classList.toggle('disabled', !enabled);
    }
  }
  
  // Update 2: Addon Container - Main Header (nur wenn es ein Main Mod ist)
  const allMainHeaders = document.querySelectorAll(`.addon-main-header[data-mod-id="${modId}"]`);
  allMainHeaders.forEach(header => {
    const toggle = header.querySelector('.toggle-switch');
    if (toggle) {
      toggle.classList.toggle('active', enabled);
    }
  });
  
  // Update 3: Addon Cards (wenn es ein Addon ist)
  const addonCard = document.querySelector(`.addon-card[data-mod-id="${modId}"]`);
  if (addonCard) {
    const toggle = addonCard.querySelector('.toggle-switch');
    if (toggle) {
      toggle.classList.toggle('active', enabled);
      addonCard.classList.toggle('disabled', !enabled);
    }
  }
}

// Toggle All Mods
async function toggleAllMods(enable) {
  addLog(`${enable ? 'Enabling' : 'Disabling'} all mods...`, 'info');
  
  const enableBtn = document.getElementById('enable-all-btn');
  const disableBtn = document.getElementById('disable-all-btn');
  enableBtn.disabled = true;
  disableBtn.disabled = true;
  enableBtn.classList.add('loading');
  disableBtn.classList.add('loading');

  const result = await ipcRenderer.invoke('toggle-all-mods', enable);

  enableBtn.disabled = false;
  disableBtn.disabled = false;
  enableBtn.classList.remove('loading');
  disableBtn.classList.remove('loading');

  if (result.success) {
    currentMods.forEach(mod => {
      mod.enabled = enable;
    });
    
    renderModList();
    if (selectedMod) {
      selectedMod.enabled = enable;
      renderModDetails(selectedMod);
    }
    updateStats();
    
    const action = enable ? 'enabled' : 'disabled';
    addLog(`${result.processed} mods ${action}${result.errors > 0 ? ` (${result.errors} errors)` : ''}`, 'success');
  } else {
    addLog(`Failed to ${enable ? 'enable' : 'disable'} all mods: ${result.error}`, 'error');
  }
}

// Search and Filter
function filterMods() {
  const searchQuery = document.getElementById('search-input').value.toLowerCase();
  const categoryFilter = document.getElementById('category-filter').value;
  
  filteredMods = currentMods.filter(mod => {
    const matchesSearch = !searchQuery || 
      mod.name.toLowerCase().includes(searchQuery) ||
      mod.description.toLowerCase().includes(searchQuery) ||
      mod.author.toLowerCase().includes(searchQuery);
    
    const matchesCategory = !categoryFilter || mod.category === categoryFilter;
    
    return matchesSearch && matchesCategory;
  });
  
  renderModList();
}

function updateCategoryFilter() {
  const select = document.getElementById('category-filter');
  
  select.innerHTML = '<option value="">All Categories</option>';
  
  const sortedCategories = Array.from(availableCategories).sort();
  
  sortedCategories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    select.appendChild(option);
  });
}

// Stats
function updateStats() {
  const total = currentMods.length;
  const active = currentMods.filter(m => m.enabled).length;
  const inactive = total - active;

  document.getElementById('total-mods').textContent = total;
  document.getElementById('active-mods').textContent = active;
  document.getElementById('inactive-mods').textContent = inactive;
}

// Settings
function updateSettingsUI() {
  document.getElementById('game-path-input').value = config.gamePath || 'Not set';
  document.getElementById('mod-source-path-input').value = config.modSourcePath || 'Not set';
  document.getElementById('auto-backup-checkbox').checked = config.settings.autoBackup;
  document.getElementById('notifications-checkbox').checked = config.settings.showNotifications;
}

async function updateSettings(settings) {
  await ipcRenderer.invoke('update-settings', settings);
  await loadConfig();
  addLog('Settings updated', 'success');
}

// Logging
function addLog(message, type = 'info') {
  const terminal = document.getElementById('log-terminal');
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;

  const now = new Date();
  const time = now.toLocaleTimeString(); // ← Nutzt Browser-Einstellung

  entry.innerHTML = `
    <span class="log-time">[${time}]</span>
    <span class="log-message">${message}</span>
  `;

  terminal.appendChild(entry);
  terminal.scrollTop = terminal.scrollHeight;
}

// UI Updates
function updateUI() {
  updateStats();
  updateSettingsUI();
  updateProfileSelector();
}