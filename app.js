/**
 * INVENTARIO PARA EL HOGAR - PWA CON BACKEND SQL Y SOPORTE DE FOTOS
 * Gestión de reactividad, persistencia híbrida (API SQL + IndexedDB offline),
 * administración de secciones, subida de fotos y exportación CSV.
 */

// =============================================================================
// CONSTANTES Y CONFIGURACIÓN
// =============================================================================

const DB_NAME = 'InventarioHogarDB';
const DB_VERSION = 2; // Versión incrementada para nuevo store de secciones
const STORE_ITEMS = 'items';
const STORE_SECTIONS = 'sections';

// Estado global de la aplicación
const state = {
  currentView: 'inventory', // 'inventory' | 'sections'
  sections: [],
  items: [],
  selectedSection: 'ALL',   // 'ALL' o nombre de la sección
  selectedTag: 'ALL',       // 'ALL', 'Guardar', 'Donar', 'Vender'
  searchQuery: '',
  sortBy: 'recent',
  
  // Edición de Ítem
  editingItemId: null,
  stagedPhotos: [], // Array de URLs o File objects { file, previewUrl, isExisting }

  // Edición de Sección
  editingSectionId: null,

  // Eliminación genérica
  deleteTarget: null, // { type: 'item' | 'section', id: string, name: string }

  // Lightbox
  lightboxPhotos: [],
  lightboxIndex: 0,

  // PWA
  deferredInstallPrompt: null
};

// =============================================================================
// CAPA DE PERSISTENCIA OFFLINE (INDEXEDDB FALLBACK)
// =============================================================================

let idb = null;

function initIndexedDB() {
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) {
      resolve(null);
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        db.createObjectStore(STORE_ITEMS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SECTIONS)) {
        db.createObjectStore(STORE_SECTIONS, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => {
      idb = e.target.result;
      resolve(idb);
    };
    req.onerror = () => resolve(null);
  });
}

async function cacheToIndexedDB(storeName, dataArray) {
  if (!idb) return;
  try {
    const tx = idb.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    dataArray.forEach(item => store.put(item));
  } catch (err) {
    console.warn(`Error cacheando en IndexedDB (${storeName}):`, err);
  }
}

async function readFromIndexedDB(storeName) {
  if (!idb) return [];
  return new Promise((resolve) => {
    try {
      const tx = idb.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

// =============================================================================
// CLIENTE API REST (CONEXIÓN CON BACKEND SQL)
// =============================================================================

const api = {
  async getSections() {
    try {
      const res = await fetch('/api/sections');
      if (!res.ok) throw new Error('Error de servidor al cargar secciones');
      const data = await res.json();
      cacheToIndexedDB(STORE_SECTIONS, data);
      return data;
    } catch (err) {
      console.warn('API no disponible, leyendo secciones desde IndexedDB...');
      return await readFromIndexedDB(STORE_SECTIONS);
    }
  },

  async createSection(sectionData) {
    const res = await fetch('/api/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sectionData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al crear la sección en SQL');
    }
    return await res.json();
  },

  async updateSection(id, sectionData) {
    const res = await fetch(`/api/sections/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sectionData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al actualizar sección en SQL');
    }
    return await res.json();
  },

  async deleteSection(id) {
    const res = await fetch(`/api/sections/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al eliminar sección en SQL');
    }
    return await res.json();
  },

  async getItems() {
    try {
      const res = await fetch('/api/items');
      if (!res.ok) throw new Error('Error al cargar ítems');
      const data = await res.json();
      cacheToIndexedDB(STORE_ITEMS, data);
      return data;
    } catch (err) {
      console.warn('API no disponible, leyendo ítems desde IndexedDB...');
      return await readFromIndexedDB(STORE_ITEMS);
    }
  },

  async createItem(itemData) {
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(itemData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al crear ítem en SQL');
    }
    return await res.json();
  },

  async updateItem(id, itemData) {
    const res = await fetch(`/api/items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(itemData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al actualizar ítem en SQL');
    }
    return await res.json();
  },

  async deleteItem(id) {
    const res = await fetch(`/api/items/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al eliminar ítem en SQL');
    }
    return await res.json();
  },

  async uploadPhotos(files) {
    if (!files || files.length === 0) return [];
    const formData = new FormData();
    files.forEach((file) => formData.append('fotos', file));

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      throw new Error('Error al subir una o más imágenes');
    }
    const data = await res.json();
    return data.urls || [];
  }
};

// =============================================================================
// FORMATTEADORES & HELPERS
// =============================================================================

function formatMoney(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return '$0';
  return '$' + Number(amount).toLocaleString('es-CO');
}

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button style="background:none; border:none; color:inherit; cursor:pointer; margin-left:12px; font-weight:bold;">✕</button>
  `;
  
  const closeBtn = toast.querySelector('button');
  const removeToast = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 200);
  };

  closeBtn.addEventListener('click', removeToast);
  container.appendChild(toast);
  setTimeout(removeToast, 3500);
}

// =============================================================================
// NAVEGACIÓN ENTRE VISTAS PRINCIPALES
// =============================================================================

function switchView(viewName) {
  state.currentView = viewName;
  const invTab = document.getElementById('nav-tab-inventory');
  const secTab = document.getElementById('nav-tab-sections');
  const invView = document.getElementById('view-inventory');
  const secView = document.getElementById('view-sections');

  if (viewName === 'inventory') {
    invTab.classList.add('active');
    invTab.setAttribute('aria-selected', 'true');
    secTab.classList.remove('active');
    secTab.setAttribute('aria-selected', 'false');

    invView.classList.remove('hidden');
    secView.classList.add('hidden');
    renderInventoryView();
  } else {
    secTab.classList.add('active');
    secTab.setAttribute('aria-selected', 'true');
    invTab.classList.remove('active');
    invTab.setAttribute('aria-selected', 'false');

    secView.classList.remove('hidden');
    invView.classList.add('hidden');
    renderSectionsManageView();
  }
}

// =============================================================================
// RENDERIZADO DE LA VISTA DE INVENTARIO
// =============================================================================

function renderInventoryView() {
  renderSectionTabs();
  renderMetrics();
  renderItemsList();
  updateSectionDropdownInItemModal();
}

function renderSectionTabs() {
  const container = document.getElementById('sections-tabs');
  container.innerHTML = '';

  // Tab para 'Todas'
  const allCount = state.items.length;
  const allBtn = document.createElement('button');
  allBtn.className = `tab-btn ${state.selectedSection === 'ALL' ? 'active' : ''}`;
  allBtn.setAttribute('role', 'tab');
  allBtn.setAttribute('aria-selected', state.selectedSection === 'ALL');
  allBtn.innerHTML = `
    <span>🏠 Todas</span>
    <span class="tab-badge">${allCount}</span>
  `;
  allBtn.addEventListener('click', () => {
    state.selectedSection = 'ALL';
    renderInventoryView();
  });
  container.appendChild(allBtn);

  // Tabs por cada sección existente en la base de datos
  state.sections.forEach((sec) => {
    const count = state.items.filter((i) => i.seccion === sec.nombre).length;
    const btn = document.createElement('button');
    btn.className = `tab-btn ${state.selectedSection === sec.nombre ? 'active' : ''}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', state.selectedSection === sec.nombre);
    btn.innerHTML = `
      <span>${escapeHTML(sec.icono || '📦')} ${escapeHTML(sec.nombre)}</span>
      <span class="tab-badge">${count}</span>
    `;
    btn.addEventListener('click', () => {
      state.selectedSection = sec.nombre;
      renderInventoryView();
    });
    container.appendChild(btn);
  });
}

function renderMetrics() {
  const total = state.items.length;
  const guardar = state.items.filter((i) => i.etiqueta_destino === 'Guardar').length;
  const donar = state.items.filter((i) => i.etiqueta_destino === 'Donar').length;
  const venderItems = state.items.filter((i) => i.etiqueta_destino === 'Vender');
  const venderCount = venderItems.length;
  
  const totalVentaEstimada = venderItems.reduce((acc, curr) => {
    return acc + (Number(curr.precio_venta) || 0);
  }, 0);

  document.getElementById('metric-total-items').textContent = total;
  document.getElementById('metric-guardar-items').textContent = guardar;
  document.getElementById('metric-donar-items').textContent = donar;
  document.getElementById('metric-vender-items').textContent = venderCount;
  document.getElementById('metric-vender-total').textContent = formatMoney(totalVentaEstimada);

  document.getElementById('pill-count-all').textContent = total;
  document.getElementById('pill-count-guardar').textContent = guardar;
  document.getElementById('pill-count-donar').textContent = donar;
  document.getElementById('pill-count-vender').textContent = venderCount;

  document.getElementById('nav-sections-count').textContent = state.sections.length;
  document.getElementById('sections-total-pill').textContent = `${state.sections.length} habitaciones`;

  renderBreakdownCard();
}

function renderBreakdownCard() {
  const grid = document.getElementById('breakdown-grid');
  grid.innerHTML = '';

  state.sections.forEach((sec) => {
    const secItems = state.items.filter((i) => i.seccion === sec.nombre);
    const total = secItems.length;
    const itemCard = document.createElement('div');
    itemCard.className = 'breakdown-item';
    itemCard.innerHTML = `
      <span class="breakdown-name">${escapeHTML(sec.icono || '📦')} ${escapeHTML(sec.nombre)}</span>
      <span class="breakdown-counts">${total} artículo${total === 1 ? '' : 's'}</span>
    `;
    itemCard.addEventListener('click', () => {
      state.selectedSection = sec.nombre;
      document.getElementById('room-breakdown-card').classList.add('hidden');
      renderInventoryView();
    });
    grid.appendChild(itemCard);
  });
}

function getFilteredAndSortedItems() {
  let list = [...state.items];

  if (state.selectedSection !== 'ALL') {
    list = list.filter((item) => item.seccion === state.selectedSection);
  }

  if (state.selectedTag !== 'ALL') {
    list = list.filter((item) => item.etiqueta_destino === state.selectedTag);
  }

  if (state.searchQuery.trim() !== '') {
    const q = state.searchQuery.toLowerCase();
    list = list.filter((item) =>
      (item.nombre && item.nombre.toLowerCase().includes(q)) ||
      (item.notas && item.notas.toLowerCase().includes(q)) ||
      (item.seccion && item.seccion.toLowerCase().includes(q))
    );
  }

  list.sort((a, b) => {
    switch (state.sortBy) {
      case 'name-asc':
        return a.nombre.localeCompare(b.nombre);
      case 'name-desc':
        return b.nombre.localeCompare(a.nombre);
      case 'price-desc':
        return (Number(b.precio_venta) || 0) - (Number(a.precio_venta) || 0);
      case 'status':
        return a.estado.localeCompare(b.estado);
      case 'has-photos': {
        const aHas = (a.fotos && a.fotos.length > 0) ? 1 : 0;
        const bHas = (b.fotos && b.fotos.length > 0) ? 1 : 0;
        return bHas - aHas;
      }
      case 'recent':
      default:
        return new Date(b.fecha_registro || 0) - new Date(a.fecha_registro || 0);
    }
  });

  return list;
}

function renderItemsList() {
  const container = document.getElementById('items-container');
  const emptyState = document.getElementById('empty-state');
  const filteredList = getFilteredAndSortedItems();

  const currentTitleEl = document.getElementById('current-section-title');
  const currentCounterEl = document.getElementById('current-section-counter');
  currentTitleEl.textContent = state.selectedSection === 'ALL' ? 'Todas las Habitaciones' : state.selectedSection;
  currentCounterEl.textContent = `${filteredList.length} artículo${filteredList.length === 1 ? '' : 's'}`;

  container.innerHTML = '';

  if (filteredList.length === 0) {
    emptyState.classList.remove('hidden');
    container.classList.add('hidden');
    
    const msgEl = document.getElementById('empty-state-message');
    if (state.searchQuery) {
      msgEl.textContent = `No hay resultados para "${state.searchQuery}". Intenta con otra palabra clave.`;
    } else if (state.selectedTag !== 'ALL') {
      msgEl.textContent = `No hay artículos con la etiqueta "${state.selectedTag}" en esta sección.`;
    } else {
      msgEl.textContent = `No hay artículos registrados aún en ${state.selectedSection === 'ALL' ? 'el inventario' : state.selectedSection}.`;
    }
    return;
  }

  emptyState.classList.add('hidden');
  container.classList.remove('hidden');

  filteredList.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'item-card';

    // Badge de destino
    let badgeHtml = '';
    if (item.etiqueta_destino === 'Guardar') {
      badgeHtml = `
        <span class="item-badge-destination badge-guardar">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
          </svg>
          Guardar
        </span>
      `;
    } else if (item.etiqueta_destino === 'Donar') {
      badgeHtml = `
        <span class="item-badge-destination badge-donar">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          Donar
        </span>
      `;
    } else if (item.etiqueta_destino === 'Vender') {
      badgeHtml = `
        <span class="item-badge-destination badge-vender">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="1" x2="12" y2="23"/>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          Vender: <strong class="badge-price">${formatMoney(item.precio_venta)}</strong>
        </span>
      `;
    }

    const statusClassMap = {
      'Excelente': 'status-excelente',
      'Buen estado': 'status-buen-estado',
      'Regular': 'status-regular',
      'Para reparar': 'status-para-reparar'
    };
    const statusClass = statusClassMap[item.estado] || 'status-buen-estado';

    // Sección icono
    const secObj = state.sections.find(s => s.nombre === item.seccion);
    const secIcon = secObj ? secObj.icono : '📦';

    // Foto de portada si existe
    const hasPhotos = Array.isArray(item.fotos) && item.fotos.length > 0;
    const coverPhotoHtml = hasPhotos ? `
      <div class="card-photo-wrapper" data-item-id="${item.id}" title="Ver fotos en alta resolución">
        <img src="${item.fotos[0]}" alt="${escapeHTML(item.nombre)}" class="card-photo-img" loading="lazy">
        <div class="photo-badge-card">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          ${item.fotos.length} ${item.fotos.length === 1 ? 'foto' : 'fotos'}
        </div>
      </div>
    ` : '';

    card.innerHTML = `
      ${coverPhotoHtml}
      <div class="card-body">
        <div class="card-top">
          <div>
            <h3 class="item-name">${escapeHTML(item.nombre)}</h3>
            <span class="item-section-tag">
              <span>${secIcon}</span>
              ${escapeHTML(item.seccion)}
            </span>
          </div>
          ${badgeHtml}
        </div>

        <div class="card-meta">
          <span class="status-pill ${statusClass}">
            ● ${escapeHTML(item.estado)}
          </span>
        </div>

        ${item.notas ? `
          <div class="card-notes">
            ${escapeHTML(item.notas)}
          </div>
        ` : ''}
      </div>

      <div class="card-footer">
        <span class="card-date">
          ${formatDate(item.fecha_registro)}
        </span>
        <div class="card-actions">
          <button class="btn-card-action btn-card-edit" data-id="${item.id}" aria-label="Editar">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            Editar
          </button>
          <button class="btn-card-action btn-card-delete" data-id="${item.id}" data-name="${escapeHTML(item.nombre)}" aria-label="Eliminar">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            </svg>
            Eliminar
          </button>
        </div>
      </div>
    `;

    // Click en foto para abrir Lightbox
    if (hasPhotos) {
      const photoEl = card.querySelector('.card-photo-wrapper');
      photoEl.addEventListener('click', () => {
        openLightbox(item.fotos, 0, item.nombre);
      });
    }

    const editBtn = card.querySelector('.btn-card-edit');
    editBtn.addEventListener('click', () => openModalForEdit(item.id));

    const deleteBtn = card.querySelector('.btn-card-delete');
    deleteBtn.addEventListener('click', () => openDeleteDialog('item', item.id, item.nombre));

    container.appendChild(card);
  });
}

function updateSectionDropdownInItemModal() {
  const select = document.getElementById('form-seccion');
  select.innerHTML = '';
  state.sections.forEach(sec => {
    const opt = document.createElement('option');
    opt.value = sec.nombre;
    opt.textContent = `${sec.icono || '📦'} ${sec.nombre}`;
    select.appendChild(opt);
  });
}

// =============================================================================
// VISTA DE GESTIÓN DE SECCIONES (CREAR, EDITAR, ELIMINAR SECCIONES)
// =============================================================================

function renderSectionsManageView() {
  const container = document.getElementById('sections-manage-grid');
  container.innerHTML = '';

  state.sections.forEach((sec) => {
    const itemCount = state.items.filter(i => i.seccion === sec.nombre).length;
    const card = document.createElement('div');
    card.className = 'section-mgmt-card';
    card.innerHTML = `
      <div class="section-card-top">
        <div class="section-icon-large">${sec.icono || '📦'}</div>
        <div class="section-card-info">
          <h4 class="section-card-title">${escapeHTML(sec.nombre)}</h4>
          ${sec.descripcion ? `<p class="section-card-desc">${escapeHTML(sec.descripcion)}</p>` : ''}
          <span class="section-card-count">${itemCount} artículo${itemCount === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div class="section-card-actions">
        <button class="btn btn-secondary btn-icon sec-btn-view" title="Ver en inventario">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span style="font-size:0.75rem;">Ver ítems</span>
        </button>
        <button class="btn btn-secondary btn-icon sec-btn-edit" title="Editar sección">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          <span style="font-size:0.75rem;">Editar</span>
        </button>
        <button class="btn btn-secondary btn-icon btn-card-delete sec-btn-delete" title="Eliminar sección">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
          </svg>
          <span style="font-size:0.75rem;">Eliminar</span>
        </button>
      </div>
    `;

    // Botón ver ítems
    card.querySelector('.sec-btn-view').addEventListener('click', () => {
      state.selectedSection = sec.nombre;
      switchView('inventory');
    });

    // Botón editar
    card.querySelector('.sec-btn-edit').addEventListener('click', () => {
      startEditSection(sec);
    });

    // Botón eliminar
    card.querySelector('.sec-btn-delete').addEventListener('click', () => {
      openDeleteDialog('section', sec.id, sec.nombre, itemCount);
    });

    container.appendChild(card);
  });
}

function startEditSection(sec) {
  state.editingSectionId = sec.id;
  document.getElementById('sec-card-title').textContent = `✏️ Editar Sección: "${sec.nombre}"`;
  document.getElementById('btn-submit-sec-text').textContent = 'Actualizar Sección';
  document.getElementById('btn-cancel-sec-edit').classList.remove('hidden');

  document.getElementById('sec-form-id').value = sec.id;
  document.getElementById('sec-form-nombre').value = sec.nombre;
  document.getElementById('sec-form-icono').value = sec.icono || '📦';
  document.getElementById('sec-form-desc').value = sec.descripcion || '';
  document.getElementById('sec-error-nombre').textContent = '';

  document.getElementById('sec-form-nombre').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetSectionForm() {
  state.editingSectionId = null;
  document.getElementById('sec-card-title').textContent = '➕ Nueva Sección';
  document.getElementById('btn-submit-sec-text').textContent = 'Guardar Sección';
  document.getElementById('btn-cancel-sec-edit').classList.add('hidden');

  document.getElementById('section-form').reset();
  document.getElementById('sec-form-id').value = '';
  document.getElementById('sec-form-icono').value = '📦';
  document.getElementById('sec-error-nombre').textContent = '';
}

// Envío del formulario de Sección
document.getElementById('section-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const nombreInput = document.getElementById('sec-form-nombre');
  const iconoInput = document.getElementById('sec-form-icono');
  const descInput = document.getElementById('sec-form-desc');
  const errorEl = document.getElementById('sec-error-nombre');

  errorEl.textContent = '';
  const nombreVal = nombreInput.value.trim();
  if (!nombreVal) {
    errorEl.textContent = 'El nombre de la sección es obligatorio.';
    nombreInput.focus();
    return;
  }

  const iconoVal = iconoInput.value.trim() || '📦';
  const descVal = descInput.value.trim();

  try {
    if (state.editingSectionId) {
      // Actualizar en SQL
      const updated = await api.updateSection(state.editingSectionId, {
        nombre: nombreVal,
        icono: iconoVal,
        descripcion: descVal
      });

      // Actualizar estado local
      const idx = state.sections.findIndex(s => s.id === state.editingSectionId);
      if (idx !== -1) state.sections[idx] = updated;

      // Refrescar ítems por si el nombre de la sección cambió en cascada
      state.items = await api.getItems();

      showToast(`Sección "${nombreVal}" actualizada con éxito`);
    } else {
      // Crear en SQL
      const created = await api.createSection({
        nombre: nombreVal,
        icono: iconoVal,
        descripcion: descVal
      });

      state.sections.push(created);
      showToast(`Sección "${nombreVal}" creada con éxito`);
    }

    resetSectionForm();
    renderSectionsManageView();
    renderInventoryView();
  } catch (err) {
    errorEl.textContent = err.message || 'Error al guardar la sección';
  }
});

document.getElementById('btn-cancel-sec-edit').addEventListener('click', resetSectionForm);

// Selector rápido de emojis para secciones
document.getElementById('emoji-quick-picker').addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-emoji');
  if (btn && btn.dataset.emoji) {
    document.getElementById('sec-form-icono').value = btn.dataset.emoji;
  }
});

// =============================================================================
// GESTIÓN DE FOTOS Y FORMULARIO DE ÍTEMS
// =============================================================================

const modalOverlay = document.getElementById('item-modal-overlay');
const itemForm = document.getElementById('item-form');
const groupPrecioVenta = document.getElementById('group-precio-venta');
const formPrecioInput = document.getElementById('form-precio');
const destRadioInputs = document.querySelectorAll('input[name="etiqueta_destino"]');
const photoInput = document.getElementById('form-photos-input');
const photoDropzone = document.getElementById('photo-dropzone');
const photoPreviewGrid = document.getElementById('photo-preview-grid');
const photoCounterBadge = document.getElementById('photo-counter-badge');

function handleDestinationChange() {
  const selected = document.querySelector('input[name="etiqueta_destino"]:checked')?.value;
  if (selected === 'Vender') {
    groupPrecioVenta.classList.remove('hidden');
    formPrecioInput.setAttribute('required', 'required');
  } else {
    groupPrecioVenta.classList.add('hidden');
    formPrecioInput.removeAttribute('required');
    formPrecioInput.value = '';
    document.getElementById('error-precio').textContent = '';
  }
}

destRadioInputs.forEach((radio) => {
  radio.addEventListener('change', handleDestinationChange);
});

// Selector de archivos de fotos
document.getElementById('btn-trigger-file').addEventListener('click', () => {
  photoInput.click();
});

photoInput.addEventListener('change', (e) => {
  handleSelectedFiles(Array.from(e.target.files));
});

// Drag & drop de fotos
photoDropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  photoDropzone.style.borderColor = 'var(--primary)';
});
photoDropzone.addEventListener('dragleave', () => {
  photoDropzone.style.borderColor = '';
});
photoDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  photoDropzone.style.borderColor = '';
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleSelectedFiles(Array.from(e.dataTransfer.files));
  }
});

function handleSelectedFiles(files) {
  const imageFiles = files.filter(f => f.type.startsWith('image/'));
  if (imageFiles.length === 0) return;

  if (state.stagedPhotos.length + imageFiles.length > 10) {
    showToast('Límite de 10 fotos por artículo alcanzado', 'info');
  }

  imageFiles.forEach(file => {
    if (state.stagedPhotos.length >= 10) return;
    const previewUrl = URL.createObjectURL(file);
    state.stagedPhotos.push({
      file,
      previewUrl,
      isExisting: false
    });
  });

  renderPhotoPreviews();
  photoInput.value = '';
}

function renderPhotoPreviews() {
  photoPreviewGrid.innerHTML = '';
  photoCounterBadge.textContent = `${state.stagedPhotos.length} foto${state.stagedPhotos.length === 1 ? '' : 's'}`;

  if (state.stagedPhotos.length === 0) {
    photoPreviewGrid.classList.add('hidden');
    return;
  }

  photoPreviewGrid.classList.remove('hidden');

  state.stagedPhotos.forEach((photoObj, index) => {
    const card = document.createElement('div');
    card.className = 'photo-preview-card';
    const imgSrc = photoObj.isExisting ? photoObj.previewUrl : photoObj.previewUrl;
    
    card.innerHTML = `
      <img src="${imgSrc}" alt="Vista previa foto ${index + 1}" class="photo-preview-thumb">
      <button type="button" class="btn-remove-photo" title="Eliminar foto" data-index="${index}">✕</button>
    `;

    card.querySelector('.btn-remove-photo').addEventListener('click', () => {
      // Si era un blob url generado localmente, liberarlo
      if (!photoObj.isExisting && photoObj.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(photoObj.previewUrl);
      }
      state.stagedPhotos.splice(index, 1);
      renderPhotoPreviews();
    });

    photoPreviewGrid.appendChild(card);
  });
}

function openModalForAdd() {
  state.editingItemId = null;
  state.stagedPhotos = [];
  document.getElementById('modal-title').textContent = 'Registrar Ítem';
  document.getElementById('btn-save-text').textContent = 'Guardar Ítem';
  
  itemForm.reset();
  document.getElementById('item-id').value = '';
  document.getElementById('error-nombre').textContent = '';
  document.getElementById('error-precio').textContent = '';

  updateSectionDropdownInItemModal();

  if (state.selectedSection !== 'ALL') {
    document.getElementById('form-seccion').value = state.selectedSection;
  }

  const guardarRadio = document.querySelector('input[name="etiqueta_destino"][value="Guardar"]');
  if (guardarRadio) guardarRadio.checked = true;

  handleDestinationChange();
  renderPhotoPreviews();

  modalOverlay.classList.remove('hidden');
  document.getElementById('form-nombre').focus();
}

function openModalForEdit(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;

  state.editingItemId = id;
  document.getElementById('modal-title').textContent = 'Editar Ítem';
  document.getElementById('btn-save-text').textContent = 'Actualizar Ítem';

  document.getElementById('item-id').value = item.id;
  document.getElementById('form-nombre').value = item.nombre;
  
  updateSectionDropdownInItemModal();
  document.getElementById('form-seccion').value = item.seccion;
  document.getElementById('form-estado').value = item.estado;
  document.getElementById('form-notas').value = item.notas || '';

  const targetRadio = document.querySelector(`input[name="etiqueta_destino"][value="${item.etiqueta_destino}"]`);
  if (targetRadio) targetRadio.checked = true;

  handleDestinationChange();

  if (item.etiqueta_destino === 'Vender') {
    formPrecioInput.value = item.precio_venta !== null && item.precio_venta !== undefined ? item.precio_venta : '';
  }

  // Cargar fotos existentes en la etapa de preview
  state.stagedPhotos = (item.fotos || []).map(url => ({
    file: null,
    previewUrl: url,
    isExisting: true
  }));
  renderPhotoPreviews();

  document.getElementById('error-nombre').textContent = '';
  document.getElementById('error-precio').textContent = '';

  modalOverlay.classList.remove('hidden');
  document.getElementById('form-nombre').focus();
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  state.editingItemId = null;
  state.stagedPhotos = [];
}

// Envío del Formulario de Ítem (Con subida de fotos a SQL)
itemForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const nombreInput = document.getElementById('form-nombre');
  const errorNombre = document.getElementById('error-nombre');
  const errorPrecio = document.getElementById('error-precio');

  errorNombre.textContent = '';
  errorPrecio.textContent = '';

  const nombreVal = nombreInput.value.trim();
  if (!nombreVal) {
    errorNombre.textContent = 'El nombre del ítem es obligatorio.';
    nombreInput.focus();
    return;
  }

  const seccionVal = document.getElementById('form-seccion').value;
  const estadoVal = document.getElementById('form-estado').value;
  const etiquetaVal = document.querySelector('input[name="etiqueta_destino"]:checked')?.value || 'Guardar';
  
  let precioVal = null;
  if (etiquetaVal === 'Vender') {
    const rawPrecio = formPrecioInput.value;
    if (rawPrecio === '' || isNaN(rawPrecio) || Number(rawPrecio) < 0) {
      errorPrecio.textContent = 'Ingresa un precio de venta válido.';
      formPrecioInput.focus();
      return;
    }
    precioVal = Number(rawPrecio);
  }

  const notasVal = document.getElementById('form-notas').value.trim();

  // Subir fotos nuevas al backend SQL
  const btnSaveText = document.getElementById('btn-save-text');
  const originalBtnText = btnSaveText.textContent;
  btnSaveText.textContent = 'Guardando...';

  try {
    const existingPhotoUrls = state.stagedPhotos
      .filter(p => p.isExisting)
      .map(p => p.previewUrl);

    const newFilesToUpload = state.stagedPhotos
      .filter(p => !p.isExisting && p.file)
      .map(p => p.file);

    let newlyUploadedUrls = [];
    if (newFilesToUpload.length > 0) {
      newlyUploadedUrls = await api.uploadPhotos(newFilesToUpload);
    }

    const finalPhotos = [...existingPhotoUrls, ...newlyUploadedUrls];

    if (state.editingItemId) {
      // Actualizar en SQL
      const updated = await api.updateItem(state.editingItemId, {
        nombre: nombreVal,
        seccion: seccionVal,
        estado: estadoVal,
        etiqueta_destino: etiquetaVal,
        precio_venta: precioVal,
        notas: notasVal,
        fotos: finalPhotos
      });

      const idx = state.items.findIndex(i => i.id === state.editingItemId);
      if (idx !== -1) state.items[idx] = updated;
      showToast(`"${nombreVal}" actualizado con éxito`);
    } else {
      // Crear en SQL
      const created = await api.createItem({
        nombre: nombreVal,
        seccion: seccionVal,
        estado: estadoVal,
        etiqueta_destino: etiquetaVal,
        precio_venta: precioVal,
        notas: notasVal,
        fotos: finalPhotos,
        fecha_registro: new Date().toISOString()
      });

      state.items.unshift(created);
      showToast(`"${nombreVal}" guardado en el inventario`);
    }

    closeModal();
    renderInventoryView();
  } catch (err) {
    showToast(err.message || 'Error al guardar el ítem', 'error');
  } finally {
    btnSaveText.textContent = originalBtnText;
  }
});

// =============================================================================
// MODAL DE CONFIRMACIÓN DE ELIMINACIÓN (ÍTEMS O SECCIONES)
// =============================================================================

const deleteModalOverlay = document.getElementById('delete-modal-overlay');

function openDeleteDialog(type, id, name, extraData = null) {
  state.deleteTarget = { type, id, name, extraData };
  document.getElementById('delete-item-name').textContent = `"${name}"`;

  const descEl = document.getElementById('delete-desc');
  if (type === 'section') {
    if (extraData && extraData > 0) {
      descEl.innerHTML = `⚠️ La sección <strong>"${name}"</strong> contiene <strong>${extraData} artículo(s)</strong>. Para proteger tus datos, primero reasigna o elimina los artículos antes de borrar la sección.`;
      document.getElementById('btn-confirm-delete').disabled = true;
      document.getElementById('btn-confirm-delete').style.opacity = '0.5';
    } else {
      descEl.innerHTML = `Estás a punto de eliminar la sección <strong>"${name}"</strong>. No contiene artículos y se eliminará permanentemente de la base de datos SQL.`;
      document.getElementById('btn-confirm-delete').disabled = false;
      document.getElementById('btn-confirm-delete').style.opacity = '1';
    }
  } else {
    descEl.innerHTML = `Estás a punto de eliminar <strong>"${name}"</strong> y sus fotos asociadas. Esta acción se guardará en SQL y no se puede deshacer.`;
    document.getElementById('btn-confirm-delete').disabled = false;
    document.getElementById('btn-confirm-delete').style.opacity = '1';
  }

  deleteModalOverlay.classList.remove('hidden');
}

function closeDeleteDialog() {
  deleteModalOverlay.classList.add('hidden');
  state.deleteTarget = null;
}

document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
  if (!state.deleteTarget) return;

  const { type, id, name } = state.deleteTarget;
  try {
    if (type === 'section') {
      await api.deleteSection(id);
      state.sections = state.sections.filter(s => s.id !== id);
      showToast(`Sección "${name}" eliminada de SQL`);
      renderSectionsManageView();
      renderInventoryView();
    } else {
      await api.deleteItem(id);
      state.items = state.items.filter(i => i.id !== id);
      showToast(`"${name}" eliminado de SQL`, 'info');
      renderInventoryView();
    }
  } catch (err) {
    showToast(err.message || 'Error al eliminar', 'error');
  } finally {
    closeDeleteDialog();
  }
});

document.getElementById('btn-cancel-delete').addEventListener('click', closeDeleteDialog);

// =============================================================================
// MODAL LIGHTBOX DE FOTOS A PANTALLA COMPLETA
// =============================================================================

const lightboxModal = document.getElementById('photo-lightbox-modal');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxIndexBadge = document.getElementById('lightbox-index-badge');
const btnLightboxPrev = document.getElementById('btn-lightbox-prev');
const btnLightboxNext = document.getElementById('btn-lightbox-next');

function openLightbox(photos, startIndex = 0, caption = '') {
  if (!photos || photos.length === 0) return;
  state.lightboxPhotos = photos;
  state.lightboxIndex = startIndex;
  lightboxCaption.textContent = caption;

  updateLightboxContent();
  lightboxModal.classList.remove('hidden');
}

function updateLightboxContent() {
  const currentUrl = state.lightboxPhotos[state.lightboxIndex];
  lightboxImg.src = currentUrl;
  lightboxIndexBadge.textContent = `${state.lightboxIndex + 1} / ${state.lightboxPhotos.length}`;

  const hasMultiple = state.lightboxPhotos.length > 1;
  btnLightboxPrev.style.display = hasMultiple ? 'inline-flex' : 'none';
  btnLightboxNext.style.display = hasMultiple ? 'inline-flex' : 'none';
}

function closeLightbox() {
  lightboxModal.classList.add('hidden');
  state.lightboxPhotos = [];
}

btnLightboxPrev.addEventListener('click', (e) => {
  e.stopPropagation();
  state.lightboxIndex = (state.lightboxIndex - 1 + state.lightboxPhotos.length) % state.lightboxPhotos.length;
  updateLightboxContent();
});

btnLightboxNext.addEventListener('click', (e) => {
  e.stopPropagation();
  state.lightboxIndex = (state.lightboxIndex + 1) % state.lightboxPhotos.length;
  updateLightboxContent();
});

document.getElementById('btn-close-lightbox').addEventListener('click', closeLightbox);
lightboxModal.addEventListener('click', (e) => {
  if (e.target === lightboxModal) closeLightbox();
});

// =============================================================================
// EXPORTACIÓN A EXCEL / CSV
// =============================================================================

function exportInventoryToCSV() {
  // Descarga directa desde la API SQL del backend con fallback local
  window.location.href = '/api/export';
  showToast('Descargando inventario_hogar.csv con todas las fotos...');
}

// =============================================================================
// EVENT LISTENERS GLOBALES Y PWA
// =============================================================================

function setupEventListeners() {
  // Pestañas de navegación de vistas
  document.getElementById('nav-tab-inventory').addEventListener('click', () => switchView('inventory'));
  document.getElementById('nav-tab-sections').addEventListener('click', () => switchView('sections'));

  // Botones de agregar
  document.getElementById('btn-open-add').addEventListener('click', openModalForAdd);
  document.getElementById('fab-add').addEventListener('click', openModalForAdd);
  document.getElementById('btn-empty-add').addEventListener('click', openModalForAdd);

  // Cerrar modales
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  deleteModalOverlay.addEventListener('click', (e) => {
    if (e.target === deleteModalOverlay) closeDeleteDialog();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!lightboxModal.classList.contains('hidden')) closeLightbox();
      else if (!modalOverlay.classList.contains('hidden')) closeModal();
      else if (!deleteModalOverlay.classList.contains('hidden')) closeDeleteDialog();
    }
  });

  // Filtros por etiqueta (Pills)
  const tagPills = document.querySelectorAll('.tag-pill');
  tagPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      tagPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.selectedTag = pill.dataset.tag;
      renderItemsList();
    });
  });

  // Buscador en tiempo real
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    if (state.searchQuery.length > 0) {
      searchClear.classList.remove('hidden');
    } else {
      searchClear.classList.add('hidden');
    }
    renderItemsList();
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    searchClear.classList.add('hidden');
    renderItemsList();
    searchInput.focus();
  });

  // Ordenación
  const sortSelect = document.getElementById('sort-select');
  sortSelect.addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    renderItemsList();
  });

  // Toggle desglose de habitaciones
  const breakdownCard = document.getElementById('room-breakdown-card');
  document.getElementById('btn-toggle-stats').addEventListener('click', () => {
    breakdownCard.classList.toggle('hidden');
  });
  document.getElementById('btn-close-breakdown').addEventListener('click', () => {
    breakdownCard.classList.add('hidden');
  });

  // Exportar CSV
  document.getElementById('btn-export-csv').addEventListener('click', exportInventoryToCSV);

  // Modal de Copia de Seguridad y Restauración (ZIP)
  const backupModal = document.getElementById('backup-modal-overlay');
  const restoreConfirmModal = document.getElementById('restore-confirm-modal');
  const backupZipInput = document.getElementById('backup-zip-input');
  const backupSelectedFileName = document.getElementById('backup-selected-file-name');
  const btnSubmitRestore = document.getElementById('btn-submit-restore');

  document.getElementById('btn-open-backup').addEventListener('click', () => {
    backupModal.classList.remove('hidden');
    backupZipInput.value = '';
    backupSelectedFileName.textContent = 'Haz clic para seleccionar archivo .zip';
    btnSubmitRestore.classList.add('hidden');
  });

  document.getElementById('btn-close-backup-modal').addEventListener('click', () => {
    backupModal.classList.add('hidden');
  });

  backupModal.addEventListener('click', (e) => {
    if (e.target === backupModal) backupModal.classList.add('hidden');
  });

  // Descarga de copia de seguridad ZIP
  document.getElementById('btn-download-backup-zip').addEventListener('click', () => {
    showToast('Generando y descargando respaldo ZIP con fotos...', 'info');
    window.location.href = '/api/backup/export';
  });

  // Selección de archivo ZIP para restaurar
  document.getElementById('btn-trigger-backup-file').addEventListener('click', () => {
    backupZipInput.click();
  });

  let selectedBackupFile = null;

  backupZipInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      selectedBackupFile = e.target.files[0];
      const sizeMb = (selectedBackupFile.size / (1024 * 1024)).toFixed(2);
      backupSelectedFileName.textContent = `📦 ${selectedBackupFile.name} (${sizeMb} MB)`;
      btnSubmitRestore.classList.remove('hidden');
    }
  });

  btnSubmitRestore.addEventListener('click', () => {
    if (!selectedBackupFile) return;
    document.getElementById('restore-file-label').textContent = selectedBackupFile.name;
    restoreConfirmModal.classList.remove('hidden');
  });

  document.getElementById('btn-cancel-restore').addEventListener('click', () => {
    restoreConfirmModal.classList.add('hidden');
  });

  restoreConfirmModal.addEventListener('click', (e) => {
    if (e.target === restoreConfirmModal) restoreConfirmModal.classList.add('hidden');
  });

  document.getElementById('btn-confirm-restore').addEventListener('click', async () => {
    if (!selectedBackupFile) return;
    restoreConfirmModal.classList.add('hidden');

    showToast('Restaurando inventario y fotos en SQL...', 'info');

    try {
      const formData = new FormData();
      formData.append('backup_zip', selectedBackupFile);

      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error restaurando respaldo');
      }

      showToast(`¡Respaldo restaurado con éxito! (${data.itemsCount} artículos, ${data.sectionsCount} secciones)`);
      backupModal.classList.add('hidden');

      // Recargar datos desde la base de datos restaurada
      const [sections, items] = await Promise.all([
        api.getSections(),
        api.getItems()
      ]);
      state.sections = sections || [];
      state.items = items || [];
      renderInventoryView();
      renderSectionsManageView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Detección de conectividad online/offline
  const offlineBadge = document.getElementById('offline-badge');
  function updateOnlineStatus() {
    if (navigator.onLine) {
      offlineBadge.classList.add('hidden');
    } else {
      offlineBadge.classList.remove('hidden');
    }
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // PWA Prompt de Instalación
  const installBtn = document.getElementById('btn-install-pwa');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    installBtn.classList.remove('hidden');
  });

  installBtn.addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    const { outcome } = await state.deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      showToast('¡Gracias por instalar Inventario Hogar!');
    }
    state.deferredInstallPrompt = null;
    installBtn.classList.add('hidden');
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(err => console.warn(err));
    });
  }
}

// =============================================================================
// INICIALIZACIÓN GENERAL DE LA APP
// =============================================================================

async function initApp() {
  setupEventListeners();
  registerServiceWorker();
  await initIndexedDB();

  try {
    // Cargar secciones e ítems desde SQL (con fallback IndexedDB automático)
    const [sections, items] = await Promise.all([
      api.getSections(),
      api.getItems()
    ]);

    state.sections = sections || [];
    state.items = items || [];

    renderInventoryView();
    renderSectionsManageView();
  } catch (err) {
    console.error('Error inicializando aplicación:', err);
    showToast('Error cargando datos iniciales', 'error');
  }
}

document.addEventListener('DOMContentLoaded', initApp);
