/**
 * INVENTARIO PARA EL HOGAR - PWA CON BACKEND SQL Y SOPORTE DE FOTOS
 * Gestión de reactividad, persistencia híbrida (API SQL + IndexedDB offline),
 * administración de secciones, subida de fotos y exportación CSV.
 */

// =============================================================================
// CONSTANTES Y CONFIGURACIÓN
// =============================================================================

const DB_NAME = 'InventarioHogarDB';
const DB_VERSION = 3; // Versión incrementada para store de categorías
const STORE_ITEMS = 'items';
const STORE_SECTIONS = 'sections';
const STORE_CATEGORIES = 'categories';

// Estado global de la aplicación
const state = {
  // Autenticación y usuario actual
  currentUser: null,
  authToken: localStorage.getItem('inventario_token') || null,

  // Multi-casas / Propiedades
  casas: [],
  selectedCasaId: localStorage.getItem('inventario_selected_casa') || null,

  currentView: 'inventory', // 'inventory' | 'sections'
  viewMode: 'cards',        // 'cards' | 'list'
  sections: [],
  categories: [],
  items: [],
  selectedSection: 'ALL',   // 'ALL' o nombre de la sección
  selectedTag: 'ALL',       // 'ALL', 'Almacenar', 'Llevar', 'Donar', 'Vender'
  selectedCategory: 'ALL',  // 'ALL' o nombre de la categoría
  searchQuery: '',
  sortBy: 'recent',
  
  // Visualización detallada de Ítem (Popup)
  viewingItemId: null,

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
      if (!db.objectStoreNames.contains(STORE_CATEGORIES)) {
        db.createObjectStore(STORE_CATEGORIES, { keyPath: 'id' });
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
// CLIENTE API REST (CONEXIÓN CON BACKEND SQL + AUTH + MULTI-CASA)
// =============================================================================

const api = {
  getAuthHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (state.authToken) {
      headers['Authorization'] = `Bearer ${state.authToken}`;
    }
    return headers;
  },

  async authMe() {
    try {
      const res = await fetch('/api/auth/me', {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.authenticated ? data.user : null;
    } catch (e) {
      return null;
    }
  },

  async login(username, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al iniciar sesión');
    }
    return data;
  },

  async register(username, password, nombre) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, nombre })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al crear cuenta');
    }
    return data;
  },

  async logout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: this.getAuthHeaders()
      });
    } catch (e) {}
    localStorage.removeItem('inventario_token');
    state.authToken = null;
    state.currentUser = null;
  },

  // Casas / Propiedades
  async getCasas() {
    const res = await fetch('/api/casas', {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error('AUTH_REQUIRED');
      throw new Error('Error al cargar propiedades');
    }
    return await res.json();
  },

  async createCasa(casaData) {
    const res = await fetch('/api/casas', {
      method: 'POST',
      headers: this.getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(casaData)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al crear propiedad');
    }
    return data;
  },

  async updateCasa(id, casaData) {
    const res = await fetch(`/api/casas/${id}`, {
      method: 'PUT',
      headers: this.getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(casaData)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al actualizar propiedad');
    }
    return data;
  },

  async deleteCasa(id) {
    const res = await fetch(`/api/casas/${id}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al eliminar propiedad');
    }
    return data;
  },

  async getCategories() {
    try {
      const res = await fetch('/api/categories', {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error('AUTH_REQUIRED');
        throw new Error('Error al cargar categorías');
      }
      const data = await res.json();
      cacheToIndexedDB(STORE_CATEGORIES, data);
      return data;
    } catch (err) {
      if (err.message === 'AUTH_REQUIRED') throw err;
      console.warn('API no disponible, leyendo categorías desde IndexedDB...');
      return await readFromIndexedDB(STORE_CATEGORIES);
    }
  },

  async createCategory(categoryData) {
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: this.getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(categoryData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al crear la categoría en SQL');
    }
    return await res.json();
  },

  async getSections(casaId = null) {
    try {
      const url = casaId ? `/api/sections?casa_id=${encodeURIComponent(casaId)}` : '/api/sections';
      const res = await fetch(url, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error('AUTH_REQUIRED');
        throw new Error('Error de servidor al cargar secciones');
      }
      const data = await res.json();
      cacheToIndexedDB(STORE_SECTIONS, data);
      return data;
    } catch (err) {
      if (err.message === 'AUTH_REQUIRED') throw err;
      console.warn('API no disponible, leyendo secciones desde IndexedDB...');
      return await readFromIndexedDB(STORE_SECTIONS);
    }
  },

  async createSection(sectionData) {
    const res = await fetch('/api/sections', {
      method: 'POST',
      headers: this.getAuthHeaders({ 'Content-Type': 'application/json' }),
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
      headers: this.getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(sectionData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al actualizar sección en SQL');
    }
    return await res.json();
  },

  async deleteSection(id) {
    const res = await fetch(`/api/sections/${id}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al eliminar sección en SQL');
    }
    return await res.json();
  },

  async getItems(casaId = null) {
    try {
      const url = casaId ? `/api/items?casa_id=${encodeURIComponent(casaId)}` : '/api/items';
      const res = await fetch(url, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error('AUTH_REQUIRED');
        throw new Error('Error al cargar ítems');
      }
      const data = await res.json();
      cacheToIndexedDB(STORE_ITEMS, data);
      return data;
    } catch (err) {
      if (err.message === 'AUTH_REQUIRED') throw err;
      console.warn('API no disponible, leyendo ítems desde IndexedDB...');
      return await readFromIndexedDB(STORE_ITEMS);
    }
  },

  async createItem(itemData) {
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: this.getAuthHeaders({ 'Content-Type': 'application/json' }),
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
      headers: this.getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(itemData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al actualizar ítem en SQL');
    }
    return await res.json();
  },

  async deleteItem(id) {
    const res = await fetch(`/api/items/${id}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
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
      headers: this.getAuthHeaders(),
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
  const casasTab = document.getElementById('nav-tab-casas');
  const invView = document.getElementById('view-inventory');
  const secView = document.getElementById('view-sections');
  const casasView = document.getElementById('view-casas');

  // Quitar active de todas las pestañas
  invTab?.classList.remove('active');
  invTab?.setAttribute('aria-selected', 'false');
  secTab?.classList.remove('active');
  secTab?.setAttribute('aria-selected', 'false');
  casasTab?.classList.remove('active');
  casasTab?.setAttribute('aria-selected', 'false');

  // Ocultar todas las vistas
  invView?.classList.add('hidden');
  secView?.classList.add('hidden');
  casasView?.classList.add('hidden');

  if (viewName === 'inventory') {
    invTab?.classList.add('active');
    invTab?.setAttribute('aria-selected', 'true');
    invView?.classList.remove('hidden');
    renderInventoryView();
  } else if (viewName === 'sections') {
    secTab?.classList.add('active');
    secTab?.setAttribute('aria-selected', 'true');
    secView?.classList.remove('hidden');
    renderSectionsManageView();
  } else if (viewName === 'casas') {
    casasTab?.classList.add('active');
    casasTab?.setAttribute('aria-selected', 'true');
    casasView?.classList.remove('hidden');
    renderCasasManageView();
  }
}

// =============================================================================
// RENDERIZADO DE LA VISTA DE INVENTARIO
// =============================================================================

function renderInventoryView() {
  renderSectionTabs();
  renderMetrics();
  updateCategoryFilterDropdown();
  renderItemsList();
  updateSectionDropdownInItemModal();
  updateCategoryDropdownInItemModal();
}

function updateCategoryFilterDropdown() {
  const select = document.getElementById('filter-categoria');
  if (!select) return;

  const currentVal = state.selectedCategory || 'ALL';
  select.innerHTML = '<option value="ALL">Todas las Categorías</option>';

  // Solo mostrar categorías que tengan al menos 1 producto registrado
  const activeCategories = state.categories.filter(cat => {
    return state.items.some(i => (i.categoria || 'Mobiliario') === cat.nombre);
  });

  // Si la categoría seleccionada actualmente ya no tiene productos, resetear a 'ALL'
  if (currentVal !== 'ALL' && !activeCategories.some(c => c.nombre === currentVal)) {
    state.selectedCategory = 'ALL';
  }

  activeCategories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.nombre;
    const count = state.items.filter(i => (i.categoria || 'Mobiliario') === cat.nombre).length;
    opt.textContent = `${cat.icono || '🏷️'} ${cat.nombre} (${count})`;
    if (cat.nombre === state.selectedCategory) opt.selected = true;
    select.appendChild(opt);
  });
}

function updateCategoryDropdownInItemModal() {
  const select = document.getElementById('form-categoria');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '';

  state.categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.nombre;
    opt.textContent = `${cat.icono || '🏷️'} ${cat.nombre}`;
    select.appendChild(opt);
  });

  if (currentVal && state.categories.some(c => c.nombre === currentVal)) {
    select.value = currentVal;
  }
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

  // Tabs solo para las secciones que tienen ítems registrados en esta casa
  const sectionsWithItems = state.sections.filter((sec) => {
    return state.items.some((i) => i.seccion === sec.nombre);
  });

  // Si la sección seleccionada actualmente ya no tiene ítems, volver a 'ALL'
  if (state.selectedSection !== 'ALL' && !sectionsWithItems.some(s => s.nombre === state.selectedSection)) {
    state.selectedSection = 'ALL';
  }

  sectionsWithItems.forEach((sec) => {
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
  const totalItems = state.items.length;
  const totalPiezas = state.items.reduce((acc, curr) => acc + (Number(curr.cantidad) || 1), 0);
  const almacenar = state.items.filter((i) => i.etiqueta_destino === 'Almacenar' || i.etiqueta_destino === 'Guardar').length;
  const llevar = state.items.filter((i) => i.etiqueta_destino === 'Llevar').length;
  const donar = state.items.filter((i) => i.etiqueta_destino === 'Donar').length;
  const venderItems = state.items.filter((i) => i.etiqueta_destino === 'Vender');
  const venderCount = venderItems.length;
  
  const totalVentaEstimada = venderItems.reduce((acc, curr) => {
    const qty = Number(curr.cantidad) || 1;
    return acc + ((Number(curr.precio_venta) || 0) * qty);
  }, 0);

  // Muestra total ítems (y piezas si son más de 1 por ítem)
  const totalLabel = totalPiezas !== totalItems ? `${totalItems} (${totalPiezas} pzs)` : `${totalItems}`;
  document.getElementById('metric-total-items').textContent = totalLabel;
  document.getElementById('metric-guardar-items').textContent = almacenar;
  const metricLlevarEl = document.getElementById('metric-llevar-items');
  if (metricLlevarEl) metricLlevarEl.textContent = llevar;
  document.getElementById('metric-donar-items').textContent = donar;
  document.getElementById('metric-vender-items').textContent = venderCount;
  document.getElementById('metric-vender-total').textContent = formatMoney(totalVentaEstimada);

  document.getElementById('pill-count-all').textContent = totalItems;
  document.getElementById('pill-count-guardar').textContent = almacenar;
  const pillLlevarEl = document.getElementById('pill-count-llevar');
  if (pillLlevarEl) pillLlevarEl.textContent = llevar;
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
    list = list.filter((item) => {
      if (state.selectedTag === 'Almacenar') {
        return item.etiqueta_destino === 'Almacenar' || item.etiqueta_destino === 'Guardar';
      }
      return item.etiqueta_destino === state.selectedTag;
    });
  }

  if (state.selectedCategory !== 'ALL') {
    list = list.filter((item) => (item.categoria || 'Mobiliario') === state.selectedCategory);
  }

  if (state.searchQuery.trim() !== '') {
    const q = state.searchQuery.toLowerCase();
    list = list.filter((item) =>
      (item.nombre && item.nombre.toLowerCase().includes(q)) ||
      (item.notas && item.notas.toLowerCase().includes(q)) ||
      (item.seccion && item.seccion.toLowerCase().includes(q)) ||
      (item.categoria && item.categoria.toLowerCase().includes(q))
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

  // Aplicar modo de visualización: Tarjetas ('cards') o Lista compacta ('list')
  if (state.viewMode === 'list') {
    container.classList.add('items-container-list');
  } else {
    container.classList.remove('items-container-list');
  }

  container.innerHTML = '';

  if (filteredList.length === 0) {
    emptyState.classList.remove('hidden');
    container.classList.add('hidden');
    
    const msgEl = document.getElementById('empty-state-message');
    if (state.searchQuery) {
      msgEl.textContent = `No hay resultados para "${state.searchQuery}". Intenta con otra palabra clave.`;
    } else if (state.selectedTag !== 'ALL') {
      msgEl.textContent = `No hay artículos con la etiqueta "${state.selectedTag}" en esta sección.`;
    } else if (state.selectedCategory !== 'ALL') {
      msgEl.textContent = `No hay artículos con la categoría "${state.selectedCategory}".`;
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

    // Destino y precio (incorporando cantidad en venta)
    const cantidad = Number(item.cantidad) || 1;
    let badgeHtml = '';
    if (item.etiqueta_destino === 'Almacenar' || item.etiqueta_destino === 'Guardar') {
      badgeHtml = `
        <span class="item-badge-destination badge-guardar">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
          </svg>
          Almacenar
        </span>
      `;
    } else if (item.etiqueta_destino === 'Llevar') {
      badgeHtml = `
        <span class="item-badge-destination badge-llevar">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M5 18H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.19M15 6h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3.19"/>
            <path d="M7 6h10v12H7z"/>
            <path d="M10 6V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3"/>
          </svg>
          Llevar
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
      const unitPrice = Number(item.precio_venta) || 0;
      const totalPrice = unitPrice * cantidad;
      const priceText = cantidad > 1 
        ? `${formatMoney(totalPrice)} <small style="opacity:0.85; font-size:0.75rem;">(${formatMoney(unitPrice)} c/u)</small>`
        : formatMoney(unitPrice);
      badgeHtml = `
        <span class="item-badge-destination badge-vender">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="1" x2="12" y2="23"/>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          Vender: <strong class="badge-price">${priceText}</strong>
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

    // Categoría icono
    const catObj = state.categories.find(c => c.nombre === item.categoria);
    const catIcon = catObj ? catObj.icono : '🏷️';
    const categoriaNombre = item.categoria || 'Mobiliario';

    // Foto de portada si existe; en caso contrario, mostrar imagen/placeholder por defecto de la categoría
    const hasPhotos = Array.isArray(item.fotos) && item.fotos.length > 0;
    const coverPhotoHtml = hasPhotos ? `
      <div class="card-photo-wrapper card-photo-has-real" data-item-id="${item.id}" title="Ver fotos en alta resolución">
        <img src="${item.fotos[0]}" alt="${escapeHTML(item.nombre)}" class="card-photo-img" loading="lazy">
        <div class="photo-badge-card">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          ${item.fotos.length} ${item.fotos.length === 1 ? 'foto' : 'fotos'}
        </div>
      </div>
    ` : `
      <div class="card-photo-wrapper card-photo-default-cat" data-item-id="${item.id}" title="Ver detalles del artículo">
        <div class="card-photo-placeholder">
          <span class="placeholder-cat-icon">${catIcon}</span>
          <span class="placeholder-cat-label">${escapeHTML(categoriaNombre)}</span>
        </div>
      </div>
    `;

    card.innerHTML = `
      ${coverPhotoHtml}
      <div class="card-body">
        <div class="card-top">
          <div>
            <h3 class="item-name">${escapeHTML(item.nombre)}</h3>
            <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 4px;">
              <span class="item-section-tag">
                <span>${secIcon}</span>
                ${escapeHTML(item.seccion)}
              </span>
              <span class="item-category-pill">
                <span>${catIcon}</span>
                ${escapeHTML(categoriaNombre)}
              </span>
              ${cantidad > 1 ? `<span class="item-quantity-pill">Cant: ${cantidad}</span>` : ''}
            </div>
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
          <button class="btn-card-view" data-id="${item.id}" aria-label="Visualizar información completa" title="Visualizar información completa">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Visualizar
          </button>
          <button class="btn-card-action btn-card-edit" data-id="${item.id}" aria-label="Editar" title="Editar ítem">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            Editar
          </button>
          <button class="btn-card-action btn-card-delete" data-id="${item.id}" data-name="${escapeHTML(item.nombre)}" aria-label="Eliminar" title="Eliminar ítem">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            </svg>
            Eliminar
          </button>
        </div>
      </div>
    `;

    // Click en foto real para abrir Lightbox, o en placeholder para abrir Visualización completa
    const photoEl = card.querySelector('.card-photo-wrapper');
    if (photoEl) {
      photoEl.addEventListener('click', () => {
        if (hasPhotos) {
          openLightbox(item.fotos, 0, item.nombre);
        } else {
          openItemViewModal(item.id);
        }
      });
    }

    const viewBtn = card.querySelector('.btn-card-view');
    if (viewBtn) {
      viewBtn.addEventListener('click', () => openItemViewModal(item.id));
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
  const activeCasaPill = document.getElementById('sec-active-casa-pill');
  if (activeCasaPill) {
    const currentCasa = state.casas.find(c => c.id === state.selectedCasaId);
    activeCasaPill.textContent = currentCasa ? `${currentCasa.icono || '🏡'} ${currentCasa.nombre}` : '🏡 Propiedad Actual';
  }

  const sectionsCountEl = document.getElementById('sections-total-pill');
  if (sectionsCountEl) {
    sectionsCountEl.textContent = `${state.sections.length} habitaciones`;
  }
  const navSectionsCount = document.getElementById('nav-sections-count');
  if (navSectionsCount) {
    navSectionsCount.textContent = state.sections.length;
  }

  if (!container) return;
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
  const currentCasaId = state.selectedCasaId || 'casa_floresta';

  try {
    if (state.editingSectionId) {
      // Actualizar en SQL
      const updated = await api.updateSection(state.editingSectionId, {
        casa_id: currentCasaId,
        nombre: nombreVal,
        icono: iconoVal,
        descripcion: descVal
      });

      // Actualizar estado local
      const idx = state.sections.findIndex(s => s.id === state.editingSectionId);
      if (idx !== -1) state.sections[idx] = updated;

      // Refrescar ítems por si el nombre de la sección cambió en cascada
      state.items = await api.getItems(currentCasaId);

      showToast(`Sección "${nombreVal}" actualizada con éxito`);
    } else {
      // Crear en SQL
      const created = await api.createSection({
        casa_id: currentCasaId,
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

// =============================================================================
// VISTA DE ADMINISTRACIÓN DE CASAS / PROPIEDADES
// =============================================================================

function renderCasasManageView() {
  const container = document.getElementById('casas-manage-grid');
  const countPill = document.getElementById('casas-total-pill');
  const navCasasBadge = document.getElementById('nav-casas-count');

  if (countPill) {
    const total = state.casas.length;
    countPill.textContent = `${total} propiedad${total === 1 ? '' : 'es'}`;
  }
  if (navCasasBadge) {
    navCasasBadge.textContent = state.casas.length;
  }

  if (!container) return;
  container.innerHTML = '';

  state.casas.forEach((casa) => {
    const isActive = casa.id === state.selectedCasaId;
    const card = document.createElement('div');
    card.className = `casa-card ${isActive ? 'active-casa-card' : ''}`;

    const itemsCount = Number(casa.item_count) || 0;
    const sectionsCount = Number(casa.section_count) || 0;
    const valorVenta = Number(casa.total_valor_venta) || 0;

    card.innerHTML = `
      <div class="casa-card-header">
        <div class="casa-card-avatar">${casa.icono || '🏡'}</div>
        <div class="casa-card-info">
          <h4 class="casa-card-title">${escapeHTML(casa.nombre)}</h4>
          ${casa.direccion ? `
            <div class="casa-card-address">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              <span>${escapeHTML(casa.direccion)}</span>
            </div>
          ` : ''}
          ${casa.descripcion ? `<p class="casa-card-desc">${escapeHTML(casa.descripcion)}</p>` : ''}
        </div>
        ${isActive ? '<span class="casa-card-badge-active">🏡 Activa</span>' : ''}
      </div>

      <div class="casa-card-metrics-grid">
        <div class="casa-stat-item">
          <span class="casa-stat-value">${itemsCount}</span>
          <span class="casa-stat-label">Ítems</span>
        </div>
        <div class="casa-stat-item">
          <span class="casa-stat-value">${sectionsCount}</span>
          <span class="casa-stat-label">Secciones</span>
        </div>
        <div class="casa-stat-item">
          <span class="casa-stat-value">${formatMoney(valorVenta)}</span>
          <span class="casa-stat-label">En Venta</span>
        </div>
      </div>

      <div class="casa-card-actions">
        ${isActive ? `
          <button type="button" class="btn btn-secondary btn-select-casa is-active" disabled>
            <span>✓ Casa Activa</span>
          </button>
        ` : `
          <button type="button" class="btn btn-primary btn-select-casa btn-switch-casa">
            <span>Seleccionar Casa</span>
          </button>
        `}
        <button type="button" class="btn btn-secondary btn-icon btn-edit-casa" title="Editar propiedad">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          <span style="font-size:0.75rem;">Editar</span>
        </button>
        <button type="button" class="btn btn-secondary btn-icon btn-card-delete btn-delete-casa" title="Eliminar propiedad" ${state.casas.length <= 1 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
          </svg>
          <span style="font-size:0.75rem;">Eliminar</span>
        </button>
      </div>
    `;

    // Click en Seleccionar Casa
    const switchBtn = card.querySelector('.btn-switch-casa');
    if (switchBtn) {
      switchBtn.addEventListener('click', async () => {
        state.selectedCasaId = casa.id;
        localStorage.setItem('inventario_selected_casa', casa.id);
        showToast(`Cambiando a "${casa.nombre}"...`);
        await reloadAppData();
        switchView('inventory');
      });
    }

    // Click en Editar Casa
    const editBtn = card.querySelector('.btn-edit-casa');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        openPropertyModalForEdit(casa);
      });
    }

    // Click en Eliminar Casa
    const deleteBtn = card.querySelector('.btn-delete-casa');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        if (state.casas.length <= 1) {
          showToast('No puedes eliminar la única propiedad existente', 'error');
          return;
        }
        openDeleteDialog('casa', casa.id, casa.nombre, itemsCount);
      });
    }

    container.appendChild(card);
  });
}

function openPropertyModalForAdd() {
  if (propertyModalOverlay) {
    if (propertyForm) propertyForm.reset();
    document.getElementById('prop-id').value = '';
    document.getElementById('property-modal-title').textContent = 'Nueva Propiedad / Casa';
    document.getElementById('btn-submit-prop-modal').textContent = 'Guardar Propiedad';
    document.getElementById('prop-icono').value = '🏡';
    
    if (propEmojiPicker) {
      propEmojiPicker.querySelectorAll('.btn-emoji').forEach(b => b.classList.remove('active'));
      const defaultEmoji = propEmojiPicker.querySelector('[data-emoji="🏡"]');
      if (defaultEmoji) defaultEmoji.classList.add('active');
    }
    
    propertyModalOverlay.classList.remove('hidden');
    document.getElementById('prop-nombre').focus();
  }
}

function openPropertyModalForEdit(casa) {
  if (propertyModalOverlay) {
    document.getElementById('prop-id').value = casa.id;
    document.getElementById('property-modal-title').textContent = `✏️ Editar: "${casa.nombre}"`;
    document.getElementById('btn-submit-prop-modal').textContent = 'Actualizar Propiedad';
    document.getElementById('prop-nombre').value = casa.nombre || '';
    document.getElementById('prop-icono').value = casa.icono || '🏡';
    document.getElementById('prop-direccion').value = casa.direccion || '';
    document.getElementById('prop-desc').value = casa.descripcion || '';

    if (propEmojiPicker) {
      propEmojiPicker.querySelectorAll('.btn-emoji').forEach(b => b.classList.remove('active'));
      const activeEmojiBtn = propEmojiPicker.querySelector(`[data-emoji="${casa.icono}"]`);
      if (activeEmojiBtn) {
        activeEmojiBtn.classList.add('active');
      }
    }

    propertyModalOverlay.classList.remove('hidden');
    document.getElementById('prop-nombre').focus();
  }
}

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
  document.getElementById('form-item-casa-id').value = state.selectedCasaId || 'casa_floresta';
  document.getElementById('error-nombre').textContent = '';
  document.getElementById('error-precio').textContent = '';

  // Cantidad por defecto
  document.getElementById('form-cantidad').value = '1';

  updateSectionDropdownInItemModal();
  updateCategoryDropdownInItemModal();

  if (state.selectedSection !== 'ALL') {
    document.getElementById('form-seccion').value = state.selectedSection;
  }

  if (state.selectedCategory !== 'ALL') {
    document.getElementById('form-categoria').value = state.selectedCategory;
  }

  const almacenarRadio = document.querySelector('input[name="etiqueta_destino"][value="Almacenar"]');
  if (almacenarRadio) almacenarRadio.checked = true;

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
  document.getElementById('form-item-casa-id').value = item.casa_id || state.selectedCasaId || 'casa_floresta';
  document.getElementById('form-nombre').value = item.nombre;
  
  updateSectionDropdownInItemModal();
  updateCategoryDropdownInItemModal();

  document.getElementById('form-seccion').value = item.seccion;
  document.getElementById('form-categoria').value = item.categoria || (state.categories[0] ? state.categories[0].nombre : 'Mobiliario');
  document.getElementById('form-cantidad').value = item.cantidad || 1;
  document.getElementById('form-estado').value = item.estado;
  document.getElementById('form-notas').value = item.notas || '';

  // Normalizar Guardar a Almacenar en la selección del radio si viene de datos antiguos
  const targetVal = item.etiqueta_destino === 'Guardar' ? 'Almacenar' : item.etiqueta_destino;
  const targetRadio = document.querySelector(`input[name="etiqueta_destino"][value="${targetVal}"]`);
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

// =============================================================================
// MODAL DE VISUALIZACIÓN COMPLETA DE DETALLE DE ÍTEM (POPUP INFORMATIVO)
// =============================================================================

const itemViewModalOverlay = document.getElementById('item-view-modal-overlay');
const viewItemBadges = document.getElementById('view-item-badges');
const viewItemContent = document.getElementById('view-item-content');
const btnCloseViewModal = document.getElementById('btn-close-view-modal');
const btnViewModalClose = document.getElementById('btn-view-modal-close');
const btnViewModalEdit = document.getElementById('btn-view-modal-edit');

function openItemViewModal(itemId) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;

  state.viewingItemId = itemId;

  // Iconos de sección y categoría
  const secObj = state.sections.find(s => s.nombre === item.seccion);
  const secIcon = secObj ? secObj.icono : '📦';
  const catObj = state.categories.find(c => c.nombre === item.categoria);
  const catIcon = catObj ? catObj.icono : '🏷️';
  const categoriaNombre = item.categoria || 'Mobiliario';
  const cantidad = Number(item.cantidad) || 1;

  // Badges superiores
  let destBadgeClass = 'badge-guardar';
  if (item.etiqueta_destino === 'Llevar') destBadgeClass = 'badge-llevar';
  else if (item.etiqueta_destino === 'Donar') destBadgeClass = 'badge-donar';
  else if (item.etiqueta_destino === 'Vender') destBadgeClass = 'badge-vender';

  viewItemBadges.innerHTML = `
    <span class="item-badge-destination ${destBadgeClass}">
      ${escapeHTML(item.etiqueta_destino)}
    </span>
    <span class="item-category-pill">
      ${catIcon} ${escapeHTML(categoriaNombre)}
    </span>
    ${cantidad > 1 ? `<span class="item-quantity-pill">Cant: ${cantidad}</span>` : ''}
  `;

  // Precios para artículos de venta
  let priceHtml = '';
  if (item.etiqueta_destino === 'Vender') {
    const unitPrice = Number(item.precio_venta) || 0;
    const totalPrice = unitPrice * cantidad;
    priceHtml = `
      <div class="view-info-item" style="grid-column: span 2; background: #f0fdf4; padding: 8px; border-radius: 8px; border: 1px solid #bbf7d0;">
        <span class="view-info-label" style="color: #166534;">Valor Estimado de Venta</span>
        <span class="view-info-value" style="color: #15803d; font-size: 1.15rem;">
          ${formatMoney(totalPrice)}
          ${cantidad > 1 ? `<small style="font-size:0.8rem; font-weight:normal; opacity:0.85;">(${formatMoney(unitPrice)} cada uno)</small>` : ''}
        </span>
      </div>
    `;
  }

  // Carrusel de fotos interactivo o placeholder
  const hasPhotos = Array.isArray(item.fotos) && item.fotos.length > 0;
  let photosHtml = '';
  if (hasPhotos) {
    const photos = item.fotos;
    const isMultiple = photos.length > 1;

    photosHtml = `
      <div class="view-carousel-wrapper">
        <div class="view-photos-header">
          <span>📸 Fotos del Artículo (${photos.length})</span>
          <span style="font-size: 0.72rem; color: var(--text-tertiary);">Clic en la foto para pantalla completa</span>
        </div>

        <div class="view-carousel-container" id="detail-carousel-container">
          <img 
            src="${photos[0]}" 
            alt="${escapeHTML(item.nombre)}" 
            class="view-carousel-img" 
            id="detail-carousel-img"
            loading="lazy"
          >
          <div class="view-carousel-badge" id="detail-carousel-badge">
            1 / ${photos.length}
          </div>

          ${isMultiple ? `
            <button type="button" class="view-carousel-btn view-carousel-prev" id="btn-detail-carousel-prev" aria-label="Foto anterior">‹</button>
            <button type="button" class="view-carousel-btn view-carousel-next" id="btn-detail-carousel-next" aria-label="Siguiente foto">›</button>
          ` : ''}
        </div>

        ${isMultiple ? `
          <div class="view-carousel-dots" id="detail-carousel-dots">
            ${photos.map((_, idx) => `
              <button type="button" class="view-carousel-dot ${idx === 0 ? 'active' : ''}" data-idx="${idx}" aria-label="Ir a foto ${idx + 1}"></button>
            `).join('')}
          </div>

          <div class="view-carousel-thumbs" id="detail-carousel-thumbs">
            ${photos.map((url, idx) => `
              <div class="view-carousel-thumb ${idx === 0 ? 'active' : ''}" data-idx="${idx}">
                <img src="${url}" alt="Miniatura ${idx + 1}" loading="lazy">
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  } else {
    photosHtml = `
      <div style="background: var(--bg-subtle); border-radius: var(--radius-md); padding: 20px; text-align: center; border: 1px dashed var(--border);">
        <span style="font-size: 2.2rem; display: block; margin-bottom: 4px;">${catIcon}</span>
        <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-tertiary);">Sin fotos adjuntas (mostrando icono de ${escapeHTML(categoriaNombre)})</span>
      </div>
    `;
  }

  viewItemContent.innerHTML = `
    <h2 class="view-modal-title" id="view-item-title">${escapeHTML(item.nombre)}</h2>

    ${photosHtml}

    <div class="view-info-grid">
      <div class="view-info-item">
        <span class="view-info-label">Sección / Ubicación</span>
        <span class="view-info-value">${secIcon} ${escapeHTML(item.seccion)}</span>
      </div>
      <div class="view-info-item">
        <span class="view-info-label">Estado</span>
        <span class="view-info-value">● ${escapeHTML(item.estado)}</span>
      </div>
      <div class="view-info-item">
        <span class="view-info-label">Cantidad</span>
        <span class="view-info-value">${cantidad} ${cantidad === 1 ? 'unidad' : 'unidades'}</span>
      </div>
      <div class="view-info-item">
        <span class="view-info-label">Fecha de Registro</span>
        <span class="view-info-value">${formatDate(item.fecha_registro)}</span>
      </div>
      ${priceHtml}
    </div>

    ${item.notas ? `
      <div>
        <span class="view-info-label" style="display:block; margin-bottom: 4px;">Notas / Observaciones</span>
        <div class="view-notes-box">
          <p class="view-notes-text">${escapeHTML(item.notas)}</p>
        </div>
      </div>
    ` : ''}
  `;

  // Inicializar controles interactivos del carrusel
  if (hasPhotos) {
    const photos = item.fotos;
    let currentPhotoIdx = 0;

    const imgEl = viewItemContent.querySelector('#detail-carousel-img');
    const badgeEl = viewItemContent.querySelector('#detail-carousel-badge');
    const prevBtn = viewItemContent.querySelector('#btn-detail-carousel-prev');
    const nextBtn = viewItemContent.querySelector('#btn-detail-carousel-next');
    const dots = viewItemContent.querySelectorAll('.view-carousel-dot');
    const thumbs = viewItemContent.querySelectorAll('.view-carousel-thumb');

    const updateCarousel = (newIdx) => {
      currentPhotoIdx = (newIdx + photos.length) % photos.length;
      imgEl.src = photos[currentPhotoIdx];
      if (badgeEl) badgeEl.textContent = `${currentPhotoIdx + 1} / ${photos.length}`;

      dots.forEach((dot, idx) => {
        dot.classList.toggle('active', idx === currentPhotoIdx);
      });
      thumbs.forEach((th, idx) => {
        th.classList.toggle('active', idx === currentPhotoIdx);
      });
    };

    if (prevBtn) {
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        updateCarousel(currentPhotoIdx - 1);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        updateCarousel(currentPhotoIdx + 1);
      });
    }

    dots.forEach((dot) => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(dot.dataset.idx, 10) || 0;
        updateCarousel(idx);
      });
    });

    thumbs.forEach((th) => {
      th.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(th.dataset.idx, 10) || 0;
        updateCarousel(idx);
      });
    });

    // Clic en la imagen del carrusel abre el Lightbox en pantalla completa
    if (imgEl) {
      imgEl.addEventListener('click', () => {
        openLightbox(photos, currentPhotoIdx, item.nombre);
      });
    }
  }

  itemViewModalOverlay.classList.remove('hidden');
}

function closeItemViewModal() {
  itemViewModalOverlay.classList.add('hidden');
  state.viewingItemId = null;
}

if (btnCloseViewModal) btnCloseViewModal.addEventListener('click', closeItemViewModal);
if (btnViewModalClose) btnViewModalClose.addEventListener('click', closeItemViewModal);
if (itemViewModalOverlay) {
  itemViewModalOverlay.addEventListener('click', (e) => {
    if (e.target === itemViewModalOverlay) closeItemViewModal();
  });
}

if (btnViewModalEdit) {
  btnViewModalEdit.addEventListener('click', () => {
    const idToEdit = state.viewingItemId;
    closeItemViewModal();
    if (idToEdit) openModalForEdit(idToEdit);
  });
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
  const categoriaVal = document.getElementById('form-categoria').value || 'Mobiliario';
  const cantidadVal = Math.max(1, parseInt(document.getElementById('form-cantidad').value, 10) || 1);
  const estadoVal = document.getElementById('form-estado').value;
  const etiquetaVal = document.querySelector('input[name="etiqueta_destino"]:checked')?.value || 'Almacenar';
  
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

    const itemCasaId = document.getElementById('form-item-casa-id').value || state.selectedCasaId || 'casa_floresta';

    if (state.editingItemId) {
      // Actualizar en SQL
      const updated = await api.updateItem(state.editingItemId, {
        casa_id: itemCasaId,
        nombre: nombreVal,
        seccion: seccionVal,
        categoria: categoriaVal,
        cantidad: cantidadVal,
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
        casa_id: itemCasaId,
        nombre: nombreVal,
        seccion: seccionVal,
        categoria: categoriaVal,
        cantidad: cantidadVal,
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
  if (type === 'casa') {
    if (extraData && extraData > 0) {
      descEl.innerHTML = `⚠️ La propiedad <strong>"${name}"</strong> contiene <strong>${extraData} artículo(s)</strong> registrados. Para evitar pérdida accidental de datos, primero transfiere o elimina los artículos antes de borrar esta casa.`;
      document.getElementById('btn-confirm-delete').disabled = true;
      document.getElementById('btn-confirm-delete').style.opacity = '0.5';
    } else {
      descEl.innerHTML = `Estás a punto de eliminar la propiedad <strong>"${name}"</strong>. No contiene artículos y se eliminará permanentemente de tu cuenta.`;
      document.getElementById('btn-confirm-delete').disabled = false;
      document.getElementById('btn-confirm-delete').style.opacity = '1';
    }
  } else if (type === 'section') {
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
    if (type === 'casa') {
      await api.deleteCasa(id);
      state.casas = state.casas.filter(c => c.id !== id);
      showToast(`Propiedad "${name}" eliminada`);
      if (state.selectedCasaId === id) {
        state.selectedCasaId = state.casas[0]?.id || 'casa_floresta';
        localStorage.setItem('inventario_selected_casa', state.selectedCasaId);
      }
      await reloadAppData();
      renderCasasManageView();
    } else if (type === 'section') {
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
  const tokenParam = state.authToken ? `&token=${encodeURIComponent(state.authToken)}` : '';
  const casaParam = state.selectedCasaId ? `casa_id=${encodeURIComponent(state.selectedCasaId)}` : '';
  const url = `/api/export?${casaParam}${tokenParam}`;
  window.location.href = url;
  showToast('Descargando inventario_hogar.csv con todas las fotos...');
}

// =============================================================================
// EVENT LISTENERS GLOBALES Y PWA
// =============================================================================

function setupEventListeners() {
  // Pestañas de navegación de vistas
  document.getElementById('nav-tab-inventory')?.addEventListener('click', () => switchView('inventory'));
  document.getElementById('nav-tab-sections')?.addEventListener('click', () => switchView('sections'));
  document.getElementById('nav-tab-casas')?.addEventListener('click', () => switchView('casas'));

  // Botón nueva propiedad en panel de casas
  document.getElementById('btn-casas-panel-add')?.addEventListener('click', openPropertyModalForAdd);

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
      else if (!itemViewModalOverlay.classList.contains('hidden')) closeItemViewModal();
      else if (!modalOverlay.classList.contains('hidden')) closeModal();
      else if (!deleteModalOverlay.classList.contains('hidden')) closeDeleteDialog();
    }
  });

  // Selector de Modo de Vista (Tarjetas / Lista)
  const btnViewCards = document.getElementById('btn-view-cards');
  const btnViewList = document.getElementById('btn-view-list');

  if (btnViewCards && btnViewList) {
    btnViewCards.addEventListener('click', () => {
      state.viewMode = 'cards';
      btnViewCards.classList.add('active');
      btnViewCards.setAttribute('aria-pressed', 'true');
      btnViewList.classList.remove('active');
      btnViewList.setAttribute('aria-pressed', 'false');
      renderItemsList();
    });

    btnViewList.addEventListener('click', () => {
      state.viewMode = 'list';
      btnViewList.classList.add('active');
      btnViewList.setAttribute('aria-pressed', 'true');
      btnViewCards.classList.remove('active');
      btnViewCards.setAttribute('aria-pressed', 'false');
      renderItemsList();
    });
  }

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

  // Descarga de copia de seguridad ZIP (con token de sesión)
  document.getElementById('btn-download-backup-zip').addEventListener('click', () => {
    showToast('Generando y descargando respaldo ZIP con fotos...', 'info');
    const tokenParam = state.authToken ? `?token=${encodeURIComponent(state.authToken)}` : '';
    window.location.href = `/api/backup/export${tokenParam}`;
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
        headers: api.getAuthHeaders(),
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error restaurando respaldo');
      }

      showToast(`¡Respaldo restaurado con éxito! (${data.itemsCount} artículos, ${data.sectionsCount} secciones)`);
      backupModal.classList.add('hidden');

      // Recargar datos desde la base de datos restaurada
      await reloadAppData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Modal para Crear Nueva Categoría Rápida
  const categoryModal = document.getElementById('category-modal-overlay');
  const btnOpenQuickCategory = document.getElementById('btn-open-quick-category');
  const btnCloseCatModal = document.getElementById('btn-close-cat-modal');
  const btnCancelNewCat = document.getElementById('btn-cancel-new-cat');
  const quickCatForm = document.getElementById('quick-category-form');
  const newCatNombreInput = document.getElementById('new-cat-nombre');
  const newCatIconoInput = document.getElementById('new-cat-icono');
  const newCatError = document.getElementById('new-cat-error');
  const catEmojiPicker = document.getElementById('cat-emoji-picker');

  function openCategoryModal() {
    newCatNombreInput.value = '';
    newCatIconoInput.value = '🏷️';
    newCatError.textContent = '';
    categoryModal.classList.remove('hidden');
    newCatNombreInput.focus();
  }

  function closeCategoryModal() {
    categoryModal.classList.add('hidden');
  }

  if (btnOpenQuickCategory) btnOpenQuickCategory.addEventListener('click', openCategoryModal);
  if (btnCloseCatModal) btnCloseCatModal.addEventListener('click', closeCategoryModal);
  if (btnCancelNewCat) btnCancelNewCat.addEventListener('click', closeCategoryModal);
  if (categoryModal) {
    categoryModal.addEventListener('click', (e) => {
      if (e.target === categoryModal) closeCategoryModal();
    });
  }

  if (catEmojiPicker) {
    catEmojiPicker.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-emoji');
      if (btn && btn.dataset.emoji) {
        newCatIconoInput.value = btn.dataset.emoji;
      }
    });
  }

  if (quickCatForm) {
    quickCatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      newCatError.textContent = '';
      const nombre = newCatNombreInput.value.trim();
      const icono = newCatIconoInput.value.trim() || '🏷️';

      if (!nombre) {
        newCatError.textContent = 'El nombre de la categoría es obligatorio.';
        newCatNombreInput.focus();
        return;
      }

      try {
        const created = await api.createCategory({ nombre, icono });
        state.categories.push(created);
        showToast(`Categoría "${created.nombre}" creada con éxito`);
        closeCategoryModal();

        // Actualizar dropdowns y seleccionar la categoría creada
        updateCategoryDropdownInItemModal();
        updateCategoryFilterDropdown();
        const itemCatSelect = document.getElementById('form-categoria');
        if (itemCatSelect) itemCatSelect.value = created.nombre;
      } catch (err) {
        newCatError.textContent = err.message || 'Error al guardar la categoría';
      }
    });
  }

  // Stepper de Cantidad (+ / -)
  const qtyInput = document.getElementById('form-cantidad');
  const btnQtyMinus = document.getElementById('btn-qty-minus');
  const btnQtyPlus = document.getElementById('btn-qty-plus');

  if (btnQtyMinus && qtyInput) {
    btnQtyMinus.addEventListener('click', () => {
      const current = parseInt(qtyInput.value, 10) || 1;
      if (current > 1) qtyInput.value = current - 1;
    });
  }

  if (btnQtyPlus && qtyInput) {
    btnQtyPlus.addEventListener('click', () => {
      const current = parseInt(qtyInput.value, 10) || 1;
      qtyInput.value = current + 1;
    });
  }

  // Filtro desplegable de categoría en la barra de herramientas
  const filterCatSelect = document.getElementById('filter-categoria');
  if (filterCatSelect) {
    filterCatSelect.addEventListener('change', (e) => {
      state.selectedCategory = e.target.value;
      renderItemsList();
    });
  }

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
// GESTIÓN DE AUTENTICACIÓN Y MULTI-CASA EN EL FRONTEND
// =============================================================================

const authGateOverlay = document.getElementById('auth-gate-overlay');
const formLogin = document.getElementById('form-login');
const formRegister = document.getElementById('form-register');
const tabAuthLogin = document.getElementById('tab-auth-login');
const tabAuthRegister = document.getElementById('tab-auth-register');
const authErrorMsg = document.getElementById('auth-error-msg');
const authRegErrorMsg = document.getElementById('auth-reg-error-msg');

const btnPropertyDropdown = document.getElementById('btn-property-dropdown');
const propertyDropdownMenu = document.getElementById('property-dropdown-menu');
const propertyListContainer = document.getElementById('property-list-container');
const currentPropertyIcon = document.getElementById('current-property-icon');
const currentPropertyName = document.getElementById('current-property-name');
const btnOpenNewProperty = document.getElementById('btn-open-new-property');
const propertyModalOverlay = document.getElementById('property-modal-overlay');
const propertyForm = document.getElementById('property-form');
const btnCancelPropModal = document.getElementById('btn-cancel-prop-modal');
const propEmojiPicker = document.getElementById('prop-emoji-picker');

const btnUserProfile = document.getElementById('btn-user-profile');
const userDropdownMenu = document.getElementById('user-dropdown-menu');
const userAvatarInitials = document.getElementById('user-avatar-initials');
const userDisplayName = document.getElementById('user-display-name');
const userDisplayUsername = document.getElementById('user-display-username');
const btnLogout = document.getElementById('btn-logout');

function showAuthGate() {
  if (authGateOverlay) authGateOverlay.classList.remove('hidden');
}

function hideAuthGate() {
  if (authGateOverlay) authGateOverlay.classList.add('hidden');
}

function updateUserInfoUI(user) {
  if (!user) return;
  state.currentUser = user;
  const name = user.nombre || user.username || 'Usuario';
  if (userDisplayName) userDisplayName.textContent = name;
  if (userDisplayUsername) userDisplayUsername.textContent = `@${user.username}`;
  
  if (userAvatarInitials) {
    const parts = name.trim().split(/\s+/);
    let initials = parts[0] ? parts[0][0].toUpperCase() : 'U';
    if (parts.length > 1 && parts[1]) initials += parts[1][0].toUpperCase();
    userAvatarInitials.textContent = initials.substring(0, 2);
  }
}

function renderPropertySwitcher() {
  if (!state.casas || state.casas.length === 0) return;

  // Seleccionar la casa activa o la primera si no hay seleccionada
  let activeCasa = state.casas.find(c => c.id === state.selectedCasaId);
  if (!activeCasa) {
    activeCasa = state.casas[0];
    state.selectedCasaId = activeCasa.id;
    localStorage.setItem('inventario_selected_casa', activeCasa.id);
  }

  if (currentPropertyIcon) currentPropertyIcon.textContent = activeCasa.icono || '🏡';
  if (currentPropertyName) currentPropertyName.textContent = activeCasa.nombre || 'Mi Casa';

  if (!propertyListContainer) return;
  propertyListContainer.innerHTML = '';

  state.casas.forEach(casa => {
    const isActive = casa.id === state.selectedCasaId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `property-menu-item ${isActive ? 'active' : ''}`;
    btn.innerHTML = `
      <div class="property-item-left">
        <span class="property-item-icon">${casa.icono || '🏡'}</span>
        <span class="property-item-name">${escapeHTML(casa.nombre)}</span>
      </div>
      <span class="property-badge-count">${casa.item_count || 0} ítems</span>
    `;

    btn.addEventListener('click', async () => {
      if (state.selectedCasaId !== casa.id) {
        state.selectedCasaId = casa.id;
        localStorage.setItem('inventario_selected_casa', casa.id);
        if (propertyDropdownMenu) propertyDropdownMenu.classList.add('hidden');
        showToast(`Cambiando a ${casa.nombre}...`);
        await reloadAppData();
      } else {
        if (propertyDropdownMenu) propertyDropdownMenu.classList.add('hidden');
      }
    });

    propertyListContainer.appendChild(btn);
  });
}

async function reloadAppData() {
  try {
    const [casas, categories, sections, items] = await Promise.all([
      api.getCasas(),
      api.getCategories(),
      api.getSections(state.selectedCasaId),
      api.getItems(state.selectedCasaId)
    ]);

    state.casas = casas || [];
    state.categories = categories || [];
    state.sections = sections || [];
    state.items = items || [];

    renderPropertySwitcher();
    renderInventoryView();
    renderSectionsManageView();
    renderCasasManageView();
  } catch (err) {
    if (err.message === 'AUTH_REQUIRED') {
      showAuthGate();
    } else {
      console.error('Error al recargar datos:', err);
      showToast('Error cargando datos de la propiedad', 'error');
    }
  }
}

function setupAuthAndCasasEvents() {
  // Pestañas de Login / Registro
  if (tabAuthLogin && tabAuthRegister) {
    tabAuthLogin.addEventListener('click', () => {
      tabAuthLogin.classList.add('active');
      tabAuthRegister.classList.remove('active');
      formLogin.classList.remove('hidden');
      formRegister.classList.add('hidden');
    });

    tabAuthRegister.addEventListener('click', () => {
      tabAuthRegister.classList.add('active');
      tabAuthLogin.classList.remove('active');
      formRegister.classList.remove('hidden');
      formLogin.classList.add('hidden');
    });
  }

  // Enviar Login
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (authErrorMsg) authErrorMsg.classList.add('hidden');
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;

      try {
        const data = await api.login(username, password);
        state.authToken = data.token;
        localStorage.setItem('inventario_token', data.token);
        updateUserInfoUI(data.user);
        hideAuthGate();
        showToast(`¡Bienvenido, ${data.user.nombre || data.user.username}!`);
        await reloadAppData();
      } catch (err) {
        if (authErrorMsg) {
          authErrorMsg.textContent = err.message || 'Error al iniciar sesión';
          authErrorMsg.classList.remove('hidden');
        }
      }
    });
  }

  // Enviar Registro
  if (formRegister) {
    formRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (authRegErrorMsg) authRegErrorMsg.classList.add('hidden');
      const nombre = document.getElementById('reg-name').value.trim();
      const username = document.getElementById('reg-username').value.trim();
      const password = document.getElementById('reg-password').value;

      try {
        const data = await api.register(username, password, nombre);
        state.authToken = data.token;
        localStorage.setItem('inventario_token', data.token);
        updateUserInfoUI(data.user);
        hideAuthGate();
        showToast(`¡Cuenta creada con éxito! Bienvenido, ${data.user.nombre}.`);
        await reloadAppData();
      } catch (err) {
        if (authRegErrorMsg) {
          authRegErrorMsg.textContent = err.message || 'Error al registrar usuario';
          authRegErrorMsg.classList.remove('hidden');
        }
      }
    });
  }

  // Dropdown de Casas
  if (btnPropertyDropdown && propertyDropdownMenu) {
    btnPropertyDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      propertyDropdownMenu.classList.toggle('hidden');
      if (userDropdownMenu) userDropdownMenu.classList.add('hidden');
    });
  }

  // Dropdown de Usuario / Perfil
  if (btnUserProfile && userDropdownMenu) {
    btnUserProfile.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdownMenu.classList.toggle('hidden');
      if (propertyDropdownMenu) propertyDropdownMenu.classList.add('hidden');
    });
  }

  // Cerrar sesión
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      if (userDropdownMenu) userDropdownMenu.classList.add('hidden');
      await api.logout();
      showToast('Sesión cerrada correctamente');
      showAuthGate();
    });
  }

  // Cerrar menús al hacer clic fuera
  document.addEventListener('click', (e) => {
    if (propertyDropdownMenu && !propertyDropdownMenu.classList.contains('hidden')) {
      if (!propertyDropdownMenu.contains(e.target) && !btnPropertyDropdown.contains(e.target)) {
        propertyDropdownMenu.classList.add('hidden');
      }
    }
    if (userDropdownMenu && !userDropdownMenu.classList.contains('hidden')) {
      if (!userDropdownMenu.contains(e.target) && !btnUserProfile.contains(e.target)) {
        userDropdownMenu.classList.add('hidden');
      }
    }
  });

  // Modal para agregar nueva casa
  if (btnOpenNewProperty) {
    btnOpenNewProperty.addEventListener('click', () => {
      if (propertyDropdownMenu) propertyDropdownMenu.classList.add('hidden');
      if (propertyForm) propertyForm.reset();
      document.getElementById('prop-icono').value = '🏡';
      const defaultEmoji = propEmojiPicker?.querySelector('[data-emoji="🏡"]');
      if (defaultEmoji) {
        propEmojiPicker.querySelectorAll('.btn-emoji').forEach(b => b.classList.remove('active'));
        defaultEmoji.classList.add('active');
      }
      if (propertyModalOverlay) propertyModalOverlay.classList.remove('hidden');
      document.getElementById('prop-nombre').focus();
    });
  }

  if (btnCancelPropModal && propertyModalOverlay) {
    btnCancelPropModal.addEventListener('click', () => {
      propertyModalOverlay.classList.add('hidden');
    });
    propertyModalOverlay.addEventListener('click', (e) => {
      if (e.target === propertyModalOverlay) propertyModalOverlay.classList.add('hidden');
    });
  }

  if (propEmojiPicker) {
    propEmojiPicker.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-emoji');
      if (btn && btn.dataset.emoji) {
        propEmojiPicker.querySelectorAll('.btn-emoji').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('prop-icono').value = btn.dataset.emoji;
      }
    });
  }

  if (propertyForm) {
    propertyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const propId = document.getElementById('prop-id').value;
      const nombre = document.getElementById('prop-nombre').value.trim();
      const icono = document.getElementById('prop-icono').value || '🏡';
      const direccion = document.getElementById('prop-direccion').value.trim();
      const descripcion = document.getElementById('prop-desc').value.trim();

      if (!nombre) {
        showToast('El nombre de la propiedad es requerido', 'error');
        return;
      }

      try {
        if (propId) {
          // Actualizar casa existente
          const updated = await api.updateCasa(propId, { nombre, icono, direccion, descripcion });
          const idx = state.casas.findIndex(c => c.id === propId);
          if (idx !== -1) {
            state.casas[idx] = { ...state.casas[idx], ...updated };
          }
          propertyModalOverlay.classList.add('hidden');
          showToast(`¡Propiedad "${nombre}" actualizada!`);
          await reloadAppData();
        } else {
          // Crear nueva casa
          const nuevaCasa = await api.createCasa({ nombre, icono, direccion, descripcion });
          state.casas.push(nuevaCasa);
          state.selectedCasaId = nuevaCasa.id;
          localStorage.setItem('inventario_selected_casa', nuevaCasa.id);
          
          propertyModalOverlay.classList.add('hidden');
          showToast(`¡Propiedad "${nuevaCasa.nombre}" creada y seleccionada!`);
          await reloadAppData();
        }

        if (state.currentView === 'casas') {
          renderCasasManageView();
        }
      } catch (err) {
        showToast(err.message || 'Error al guardar propiedad', 'error');
      }
    });
  }
}

// =============================================================================
// INICIALIZACIÓN GENERAL DE LA APP
// =============================================================================

async function initApp() {
  setupEventListeners();
  setupAuthAndCasasEvents();
  registerServiceWorker();
  await initIndexedDB();

  try {
    // 1. Verificar si hay sesión activa
    const me = await api.authMe();
    if (!me) {
      showAuthGate();
      return;
    }

    updateUserInfoUI(me);
    hideAuthGate();

    // 2. Cargar casas y datos del inventario
    await reloadAppData();
  } catch (err) {
    console.error('Error inicializando aplicación:', err);
    if (err.message === 'AUTH_REQUIRED') {
      showAuthGate();
    } else {
      showToast('Error cargando datos iniciales', 'error');
    }
  }
}

document.addEventListener('DOMContentLoaded', initApp);

