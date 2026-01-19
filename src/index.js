require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { testConnection } = require('./config/database');
const authRoutes = require('./routes/auth.routes');
const syncRoutes = require('./routes/sync.routes');
const usersRoutes = require('./routes/users.routes');
const reportsRoutes = require('./routes/reports.routes');
const catalogRoutes = require('./routes/catalog.routes');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// MIDDLEWARES DE SEGURIDAD
// ============================================

// Helmet para headers de seguridad
app.use(helmet());

// CORS configuración
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = (process.env.CORS_ORIGINS || '')
      .split(',')
      .map(o => o.trim());

    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.warn(`CORS bloqueado: ${origin}`);
    return callback(new Error('No permitido por CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-ID'],
};


app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 1000,
  message: {
    success: false,
    error: 'Demasiadas solicitudes, intenta de nuevo más tarde',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/sync')) {
    return next();
  }
  return limiter(req, res, next);
});

// ============================================
// MIDDLEWARES DE PARSING
// ============================================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// MIDDLEWARE DE LOGGING (desarrollo)
// ============================================

if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} | ${req.method} ${req.path}`);
    next();
  });
}

// ============================================
// RUTAS
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'El Super Café API funcionando',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Rutas de autenticación
app.use('/api/auth', authRoutes);

// Rutas de sincronización
app.use('/api/sync', syncRoutes);

// Rutas de usuarios
app.use('/api/users', usersRoutes);

// Rutas de reportes
app.use('/api/reports', reportsRoutes);

// Rutas de catálogo
app.use('/api/catalog', catalogRoutes);

// ============================================
// MANEJO DE ERRORES
// ============================================

// Ruta no encontrada
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint no encontrado',
    path: req.path,
  });
});

// Error handler global
app.use((err, req, res, next) => {
  console.error('Error:', err);

  // Error de CORS
  if (err.message === 'No permitido por CORS') {
    return res.status(403).json({
      success: false,
      error: 'Acceso no permitido desde este origen',
    });
  }

  // Error de JSON malformado
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'JSON malformado en el body',
    });
  }

  // Error genérico
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Error interno del servidor',
  });
});

// ============================================
// INICIAR SERVIDOR
// ============================================

async function startServer() {
  // Probar conexión a la base de datos
  const dbConnected = await testConnection();

  if (!dbConnected) {
    console.error('❌ No se pudo conectar a la base de datos. Verifica la configuración.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════╗
║       EL SUPER CAFÉ - API SERVER               ║
╠════════════════════════════════════════════════╣
║  🚀 Servidor corriendo en puerto: ${PORT}          ║
║  📦 Entorno: ${process.env.NODE_ENV || 'development'}                    ║
║  🔗 URL: http://localhost:${PORT}                  ║
╚════════════════════════════════════════════════╝
    `);
  });
}

startServer();
