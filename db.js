/**
 * CAPA DE BASE DE DATOS SQL (SQLite nativo de Node.js)
 * Almacena secciones, artículos y metadatos con soporte de persistencia en disco
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

// Directorio persistente de datos (configurable por variable de entorno para Docker/Coolify)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'inventario.sqlite');

// Asegurar que los directorios existan
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Inicializar conexión SQLite
let db = new DatabaseSync(DB_PATH);

// Configuración pragmas recomendados para SQLite (WAL mode, foreign keys, UTF-8)
function applyPragmas() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);
}
applyPragmas();

// Forzar guardado de todas las transacciones WAL en el archivo principal .sqlite
function flushAndCheckpoint() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (err) {
    console.warn('Advertencia en wal_checkpoint:', err);
  }
}

// Cerrar conexión de forma segura para permitir reemplazo de archivo en restauraciones
function closeDatabase() {
  try {
    flushAndCheckpoint();
    db.close();
  } catch (err) {
    console.warn('Error al cerrar DB:', err);
  }
}

// Reabrir conexión SQLite tras una restauración
function reopenDatabase() {
  db = new DatabaseSync(DB_PATH);
  applyPragmas();
  return db;
}

// Crear tablas si no existen
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    nombre TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS casas (
    id TEXT PRIMARY KEY,
    nombre TEXT UNIQUE NOT NULL,
    icono TEXT DEFAULT '🏡',
    direccion TEXT,
    descripcion TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    nombre TEXT UNIQUE NOT NULL,
    icono TEXT DEFAULT '📦',
    descripcion TEXT,
    orden INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    nombre TEXT UNIQUE NOT NULL,
    icono TEXT DEFAULT '🏷️',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    casa_id TEXT DEFAULT 'casa_floresta',
    nombre TEXT NOT NULL,
    seccion TEXT NOT NULL,
    categoria TEXT DEFAULT 'Mobiliario',
    cantidad INTEGER DEFAULT 1,
    estado TEXT NOT NULL,
    etiqueta_destino TEXT NOT NULL,
    precio_venta REAL,
    notas TEXT,
    fotos TEXT DEFAULT '[]',
    fecha_registro TEXT NOT NULL,
    FOREIGN KEY (seccion) REFERENCES sections(nombre) ON UPDATE CASCADE ON DELETE RESTRICT
  );

  CREATE INDEX IF NOT EXISTS idx_items_seccion ON items(seccion);
  CREATE INDEX IF NOT EXISTS idx_items_destino ON items(etiqueta_destino);
`);

// Migración segura de columnas existentes en tabla items
try {
  const tableInfo = db.prepare('PRAGMA table_info(items)').all();
  const hasCantidad = tableInfo.some(col => col.name === 'cantidad');
  if (!hasCantidad) {
    db.exec('ALTER TABLE items ADD COLUMN cantidad INTEGER NOT NULL DEFAULT 1;');
  }
  const hasCategoria = tableInfo.some(col => col.name === 'categoria');
  if (!hasCategoria) {
    db.exec("ALTER TABLE items ADD COLUMN categoria TEXT NOT NULL DEFAULT 'Mobiliario';");
  }
  const hasCasaId = tableInfo.some(col => col.name === 'casa_id');
  if (!hasCasaId) {
    db.exec("ALTER TABLE items ADD COLUMN casa_id TEXT NOT NULL DEFAULT 'casa_floresta';");
  }
} catch (e) {
  console.warn('Nota en migración de items:', e.message);
}

// Crear índices si no existen
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_items_casa ON items(casa_id);
  CREATE INDEX IF NOT EXISTS idx_items_categoria ON items(categoria);
`);

// Migración y siembra de datos iniciales
function seedInitialData() {
  // Asegurar casa predeterminada
  const casasCount = db.prepare('SELECT COUNT(*) as count FROM casas').get().count;
  if (casasCount === 0) {
    console.log('🌱 Inicializando casa predeterminada en SQL...');
    db.prepare(`
      INSERT INTO casas (id, nombre, icono, direccion, descripcion, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'casa_floresta',
      'Casa Floresta',
      '🏡',
      'Cra. 80 # 45-20',
      'Casa principal / inventario base',
      new Date().toISOString()
    );
  }

  // Asegurar que todos los items huérfanos o existentes tengan casa_id asignado
  db.exec("UPDATE items SET casa_id = 'casa_floresta' WHERE casa_id IS NULL OR casa_id = '';");

  // Asegurar usuario administrador inicial si no hay usuarios
  const usersCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (usersCount === 0) {
    console.log('🌱 Inicializando usuario administrador por defecto...');
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync('admin123', salt, 64).toString('hex');
    db.prepare(`
      INSERT INTO users (id, username, password_hash, salt, nombre, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('usr_admin', 'admin', passwordHash, salt, 'Administrador', new Date().toISOString());
  }

  const sectionsCount = db.prepare('SELECT COUNT(*) as count FROM sections').get().count;

  if (sectionsCount === 0) {
    console.log('🌱 Inicializando secciones predeterminadas en SQL...');
    const defaultSections = [
      { id: 'sec_sala', nombre: 'Sala', icono: '🛋️', descripcion: 'Área común y descanso principal', orden: 1 },
      { id: 'sec_cuarto_p', nombre: 'Cuarto Principal', icono: '🛏️', descripcion: 'Dormitorio master', orden: 2 },
      { id: 'sec_cuarto_s', nombre: 'Cuarto Secundario', icono: '🛌', descripcion: 'Habitación de visitas o niños', orden: 3 },
      { id: 'sec_bano', nombre: 'Baño', icono: '🚿', descripcion: 'Baño principal y social', orden: 4 },
      { id: 'sec_cocina', nombre: 'Cocina', icono: '🍳', descripcion: 'Electrodomésticos y utensilios', orden: 5 },
      { id: 'sec_comedor', nombre: 'Comedor', icono: '🍽️', descripcion: 'Mesa y vajilla', orden: 6 },
      { id: 'sec_estudio', nombre: 'Estudio', icono: '💻', descripcion: 'Oficina y computadores', orden: 7 },
      { id: 'sec_patio', nombre: 'Patio/Balcón', icono: '🪴', descripcion: 'Plantas, exteriores y balcón', orden: 8 }
    ];

    const insertSec = db.prepare(`
      INSERT INTO sections (id, nombre, icono, descripcion, orden, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    defaultSections.forEach(s => {
      insertSec.run(s.id, s.nombre, s.icono, s.descripcion, s.orden, now);
    });
  }

  // Inicializar categorías predeterminadas
  const categoriesCount = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
  if (categoriesCount === 0) {
    console.log('🌱 Inicializando categorías predeterminadas en SQL...');
    const defaultCategories = [
      { id: 'cat_mobiliario', nombre: 'Mobiliario', icono: '🛋️' },
      { id: 'cat_electro', nombre: 'Electrodoméstico', icono: '🔌' },
      { id: 'cat_ropa', nombre: 'Ropa', icono: '👕' },
      { id: 'cat_decoracion', nombre: 'Decoración', icono: '🖼️' },
      { id: 'cat_tecnologia', nombre: 'Tecnología', icono: '💻' },
      { id: 'cat_cocina', nombre: 'Cocina / Vajilla', icono: '🍽️' },
      { id: 'cat_herramientas', nombre: 'Herramientas', icono: '🛠️' },
      { id: 'cat_libros', nombre: 'Libros / Documentos', icono: '📚' },
      { id: 'cat_otros', nombre: 'Otros', icono: '📦' }
    ];

    const insertCat = db.prepare(`
      INSERT INTO categories (id, nombre, icono, created_at)
      VALUES (?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    defaultCategories.forEach(c => {
      insertCat.run(c.id, c.nombre, c.icono, now);
    });
  }

  const itemsCount = db.prepare('SELECT COUNT(*) as count FROM items').get().count;
  if (itemsCount === 0) {
    console.log('🌱 Inicializando ítems de ejemplo en SQL...');
    const defaultItems = [
      { id: 'item_seed_1', casa_id: 'casa_floresta', nombre: 'Cuadro principal', seccion: 'Sala', categoria: 'Decoración', cantidad: 1, estado: 'Excelente', etiqueta_destino: 'Almacenar', precio_venta: null, notas: 'Marco de madera dorada', fotos: '[]', fecha_registro: new Date(Date.now() - 3600000 * 5).toISOString() },
      { id: 'item_seed_2', casa_id: 'casa_floresta', nombre: 'Comedor', seccion: 'Sala', categoria: 'Mobiliario', cantidad: 1, estado: 'Buen estado', etiqueta_destino: 'Almacenar', precio_venta: null, notas: 'Mesa con 6 sillas de roble', fotos: '[]', fecha_registro: new Date(Date.now() - 3600000 * 4).toISOString() },
      { id: 'item_seed_3', casa_id: 'casa_floresta', nombre: 'Estatua', seccion: 'Sala', categoria: 'Decoración', cantidad: 1, estado: 'Excelente', etiqueta_destino: 'Vender', precio_venta: 80000, notas: 'Escultura decorativa de bronce', fotos: '[]', fecha_registro: new Date(Date.now() - 3600000 * 3).toISOString() },
      { id: 'item_seed_4', casa_id: 'casa_floresta', nombre: 'Panel', seccion: 'Sala', categoria: 'Decoración', cantidad: 1, estado: 'Buen estado', etiqueta_destino: 'Almacenar', precio_venta: null, notas: 'Panel acústico de pared', fotos: '[]', fecha_registro: new Date(Date.now() - 3600000 * 2).toISOString() },
      { id: 'item_seed_5', casa_id: 'casa_floresta', nombre: 'Lámpara', seccion: 'Sala', categoria: 'Electrodoméstico', cantidad: 1, estado: 'Regular', etiqueta_destino: 'Donar', precio_venta: null, notas: 'Lámpara de pie de lectura', fotos: '[]', fecha_registro: new Date(Date.now() - 3600000 * 1).toISOString() },
      { id: 'item_seed_6', casa_id: 'casa_floresta', nombre: 'Sofá', seccion: 'Sala', categoria: 'Mobiliario', cantidad: 1, estado: 'Buen estado', etiqueta_destino: 'Almacenar', precio_venta: null, notas: 'Sofá de 3 puestos color gris', fotos: '[]', fecha_registro: new Date().toISOString() }
    ];

    const insertItem = db.prepare(`
      INSERT INTO items (id, casa_id, nombre, seccion, categoria, cantidad, estado, etiqueta_destino, precio_venta, notas, fotos, fecha_registro)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    defaultItems.forEach(i => {
      insertItem.run(i.id, i.casa_id, i.nombre, i.seccion, i.categoria, i.cantidad, i.estado, i.etiqueta_destino, i.precio_venta, i.notas, i.fotos, i.fecha_registro);
    });
  }
}

seedInitialData();

// =============================================================================
// REPOSITORIOS / MÉTODOS CRUD
// =============================================================================

// Repositorio de Usuarios y Autenticación
const UserRepo = {
  create({ username, password, nombre }) {
    const id = 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO users (id, username, password_hash, salt, nombre, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, username.trim().toLowerCase(), passwordHash, salt, nombre ? nombre.trim() : username.trim(), now);
    
    return this.getById(id);
  },

  getById(id) {
    const row = db.prepare('SELECT id, username, nombre, created_at FROM users WHERE id = ?').get(id);
    return row || null;
  },

  getByUsername(username) {
    const row = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username.trim());
    return row || null;
  },

  verifyPassword(user, password) {
    if (!user || !user.salt || !user.password_hash) return false;
    const hash = crypto.scryptSync(password, user.salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.password_hash, 'hex'));
  },

  count() {
    return db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  }
};

// Repositorio de Sesiones (Tokens de acceso seguros)
const SessionRepo = {
  create(userId, ttlDays = 30) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
    
    db.prepare(`
      INSERT INTO sessions (token, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(token, userId, now.toISOString(), expiresAt);

    return { token, userId, expiresAt };
  },

  getByToken(token) {
    if (!token) return null;
    const row = db.prepare(`
      SELECT s.token, s.user_id, s.expires_at, u.username, u.nombre
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ?
    `).get(token);

    if (!row) return null;

    // Verificar expiración
    if (new Date(row.expires_at) < new Date()) {
      this.delete(token);
      return null;
    }

    return {
      token: row.token,
      userId: row.user_id,
      username: row.username,
      nombre: row.nombre
    };
  },

  delete(token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  },

  deleteByUser(userId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
};

// Repositorio de Casas / Propiedades
const CasaRepo = {
  getAll() {
    const query = db.prepare(`
      SELECT 
        c.*, 
        COUNT(DISTINCT i.id) as item_count,
        COUNT(DISTINCT i.seccion) as section_count,
        COALESCE(SUM(CASE WHEN i.etiqueta_destino = 'Vender' THEN COALESCE(i.precio_venta, 0) * COALESCE(i.cantidad, 1) ELSE 0 END), 0) as total_valor_venta
      FROM casas c
      LEFT JOIN items i ON c.id = i.casa_id
      GROUP BY c.id
      ORDER BY c.created_at ASC
    `);
    return query.all();
  },

  getById(id) {
    const row = db.prepare(`
      SELECT 
        c.*, 
        COUNT(DISTINCT i.id) as item_count,
        COUNT(DISTINCT i.seccion) as section_count,
        COALESCE(SUM(CASE WHEN i.etiqueta_destino = 'Vender' THEN COALESCE(i.precio_venta, 0) * COALESCE(i.cantidad, 1) ELSE 0 END), 0) as total_valor_venta
      FROM casas c
      LEFT JOIN items i ON c.id = i.casa_id
      WHERE c.id = ?
      GROUP BY c.id
    `).get(id);
    return row || null;
  },

  getByName(nombre) {
    const row = db.prepare('SELECT * FROM casas WHERE LOWER(nombre) = LOWER(?)').get(nombre.trim());
    return row || null;
  },

  create({ id, nombre, icono, direccion, descripcion }) {
    const casaId = id || 'casa_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO casas (id, nombre, icono, direccion, descripcion, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      casaId,
      nombre.trim(),
      icono || '🏡',
      direccion ? direccion.trim() : '',
      descripcion ? descripcion.trim() : '',
      now
    );
    return this.getById(casaId);
  },

  update(id, { nombre, icono, direccion, descripcion }) {
    const existing = this.getById(id);
    if (!existing) return null;

    db.prepare(`
      UPDATE casas
      SET nombre = COALESCE(?, nombre),
          icono = COALESCE(?, icono),
          direccion = COALESCE(?, direccion),
          descripcion = COALESCE(?, descripcion)
      WHERE id = ?
    `).run(
      nombre !== undefined ? nombre.trim() : null,
      icono !== undefined ? icono : null,
      direccion !== undefined ? direccion.trim() : null,
      descripcion !== undefined ? descripcion.trim() : null,
      id
    );
    return this.getById(id);
  },

  delete(id) {
    const existing = this.getById(id);
    if (!existing) return { deleted: false, reason: 'not_found' };

    // Validar si tiene items asociados
    const count = db.prepare('SELECT COUNT(*) as count FROM items WHERE casa_id = ?').get(id).count;
    if (count > 0) {
      return { deleted: false, reason: 'has_items', itemCount: count, casaName: existing.nombre };
    }

    // No permitir eliminar si es la única casa
    const totalCasas = db.prepare('SELECT COUNT(*) as count FROM casas').get().count;
    if (totalCasas <= 1) {
      return { deleted: false, reason: 'last_casa', message: 'No se puede eliminar la única casa registrada.' };
    }

    db.prepare('DELETE FROM casas WHERE id = ?').run(id);
    return { deleted: true };
  }
};

const SectionRepo = {
  getAll(casaId = null) {
    if (casaId) {
      const query = db.prepare(`
        SELECT s.*, COUNT(i.id) as item_count 
        FROM sections s
        LEFT JOIN items i ON s.nombre = i.seccion AND i.casa_id = ?
        GROUP BY s.id
        ORDER BY s.orden ASC, s.created_at ASC
      `);
      return query.all(casaId);
    }

    const query = db.prepare(`
      SELECT s.*, COUNT(i.id) as item_count 
      FROM sections s
      LEFT JOIN items i ON s.nombre = i.seccion
      GROUP BY s.id
      ORDER BY s.orden ASC, s.created_at ASC
    `);
    return query.all();
  },

  getById(id) {
    const query = db.prepare('SELECT * FROM sections WHERE id = ?');
    return query.get(id);
  },

  getByName(nombre) {
    const query = db.prepare('SELECT * FROM sections WHERE nombre = ?');
    return query.get(nombre);
  },

  create({ id, nombre, icono, descripcion, orden }) {
    const stmt = db.prepare(`
      INSERT INTO sections (id, nombre, icono, descripcion, orden, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    stmt.run(id, nombre, icono || '📦', descripcion || '', orden || 99, now);
    return this.getById(id);
  },

  update(id, { nombre, icono, descripcion, orden }) {
    const existing = this.getById(id);
    if (!existing) return null;

    // Si cambia el nombre, actualizar en cascada los items
    if (nombre && nombre !== existing.nombre) {
      const updateItems = db.prepare('UPDATE items SET seccion = ? WHERE seccion = ?');
      updateItems.run(nombre, existing.nombre);
    }

    const stmt = db.prepare(`
      UPDATE sections 
      SET nombre = COALESCE(?, nombre),
          icono = COALESCE(?, icono),
          descripcion = COALESCE(?, descripcion),
          orden = COALESCE(?, orden)
      WHERE id = ?
    `);
    stmt.run(nombre, icono, descripcion, orden, id);
    return this.getById(id);
  },

  delete(id) {
    const existing = this.getById(id);
    if (!existing) return { deleted: false, reason: 'not_found' };

    // Verificar si existen ítems en esta sección
    const countCheck = db.prepare('SELECT COUNT(*) as count FROM items WHERE seccion = ?').get(existing.nombre);
    if (countCheck.count > 0) {
      return { 
        deleted: false, 
        reason: 'has_items', 
        itemCount: countCheck.count,
        sectionName: existing.nombre
      };
    }

    const stmt = db.prepare('DELETE FROM sections WHERE id = ?');
    stmt.run(id);
    return { deleted: true };
  }
};

const CategoryRepo = {
  getAll() {
    const query = db.prepare('SELECT * FROM categories ORDER BY nombre ASC');
    return query.all();
  },

  getById(id) {
    const query = db.prepare('SELECT * FROM categories WHERE id = ?');
    return query.get(id);
  },

  getByName(nombre) {
    const query = db.prepare('SELECT * FROM categories WHERE LOWER(nombre) = LOWER(?)');
    return query.get(nombre);
  },

  create({ id, nombre, icono }) {
    const stmt = db.prepare(`
      INSERT INTO categories (id, nombre, icono, created_at)
      VALUES (?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    stmt.run(id, nombre, icono || '🏷️', now);
    return this.getById(id);
  },

  delete(id) {
    const existing = this.getById(id);
    if (!existing) return false;
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    return true;
  }
};

const ItemRepo = {
  getAll(casaId = null) {
    let query;
    let rows;
    if (casaId) {
      query = db.prepare('SELECT * FROM items WHERE casa_id = ? ORDER BY fecha_registro DESC');
      rows = query.all(casaId);
    } else {
      query = db.prepare('SELECT * FROM items ORDER BY fecha_registro DESC');
      rows = query.all();
    }
    return rows.map(row => ({
      ...row,
      casa_id: row.casa_id || 'casa_floresta',
      cantidad: Number(row.cantidad) || 1,
      categoria: row.categoria || 'Mobiliario',
      fotos: row.fotos ? JSON.parse(row.fotos) : []
    }));
  },

  getById(id) {
    const query = db.prepare('SELECT * FROM items WHERE id = ?');
    const row = query.get(id);
    if (!row) return null;
    return {
      ...row,
      casa_id: row.casa_id || 'casa_floresta',
      cantidad: Number(row.cantidad) || 1,
      categoria: row.categoria || 'Mobiliario',
      fotos: row.fotos ? JSON.parse(row.fotos) : []
    };
  },

  create({ id, casa_id, nombre, seccion, categoria, cantidad, estado, etiqueta_destino, precio_venta, notas, fotos, fecha_registro }) {
    const itemId = id || crypto.randomUUID();
    const finalCasaId = casa_id || 'casa_floresta';
    const stmt = db.prepare(`
      INSERT INTO items (id, casa_id, nombre, seccion, categoria, cantidad, estado, etiqueta_destino, precio_venta, notas, fotos, fecha_registro)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const fotosJson = JSON.stringify(Array.isArray(fotos) ? fotos : []);
    const date = fecha_registro || new Date().toISOString();
    const qty = Math.max(1, parseInt(cantidad, 10) || 1);
    const cat = (categoria && String(categoria).trim()) || 'Mobiliario';

    stmt.run(
      itemId,
      finalCasaId,
      nombre,
      seccion,
      cat,
      qty,
      estado,
      etiqueta_destino,
      precio_venta !== undefined && precio_venta !== '' && precio_venta !== null ? Number(precio_venta) : null,
      notas || '',
      fotosJson,
      date
    );
    return this.getById(itemId);
  },

  update(id, { casa_id, nombre, seccion, categoria, cantidad, estado, etiqueta_destino, precio_venta, notas, fotos }) {
    const existing = this.getById(id);
    if (!existing) return null;

    const stmt = db.prepare(`
      UPDATE items 
      SET casa_id = COALESCE(?, casa_id),
          nombre = COALESCE(?, nombre),
          seccion = COALESCE(?, seccion),
          categoria = COALESCE(?, categoria),
          cantidad = COALESCE(?, cantidad),
          estado = COALESCE(?, estado),
          etiqueta_destino = COALESCE(?, etiqueta_destino),
          precio_venta = ?,
          notas = COALESCE(?, notas),
          fotos = COALESCE(?, fotos)
      WHERE id = ?
    `);

    const finalPrecio = (etiqueta_destino === 'Vender' || (existing.etiqueta_destino === 'Vender' && !etiqueta_destino))
      ? (precio_venta !== undefined && precio_venta !== null && precio_venta !== '' ? Number(precio_venta) : existing.precio_venta)
      : null;

    const fotosJson = fotos !== undefined ? JSON.stringify(Array.isArray(fotos) ? fotos : []) : JSON.stringify(existing.fotos);
    const qty = cantidad !== undefined ? Math.max(1, parseInt(cantidad, 10) || 1) : existing.cantidad;
    const cat = categoria !== undefined ? String(categoria).trim() : existing.categoria;

    stmt.run(
      casa_id !== undefined ? casa_id : null,
      nombre !== undefined ? nombre : null,
      seccion !== undefined ? seccion : null,
      cat,
      qty,
      estado !== undefined ? estado : null,
      etiqueta_destino !== undefined ? etiqueta_destino : null,
      finalPrecio !== undefined ? finalPrecio : null,
      notas !== undefined ? notas : null,
      fotosJson,
      id
    );
    return this.getById(id);
  },

  delete(id) {
    const existing = this.getById(id);
    if (!existing) return false;

    // Eliminar fotos físicas asociadas si están en /uploads/
    if (existing.fotos && Array.isArray(existing.fotos)) {
      existing.fotos.forEach(photoUrl => {
        if (photoUrl && photoUrl.startsWith('/uploads/')) {
          const filename = path.basename(photoUrl);
          const fullPath = path.join(UPLOADS_DIR, filename);
          if (fs.existsSync(fullPath)) {
            try { fs.unlinkSync(fullPath); } catch (e) { /* ignore */ }
          }
        }
      });
    }

    const stmt = db.prepare('DELETE FROM items WHERE id = ?');
    stmt.run(id);
    return true;
  }
};

module.exports = {
  getDb: () => db,
  DATA_DIR,
  UPLOADS_DIR,
  DB_PATH,
  flushAndCheckpoint,
  closeDatabase,
  reopenDatabase,
  UserRepo,
  SessionRepo,
  CasaRepo,
  SectionRepo,
  CategoryRepo,
  ItemRepo
};
