# El Super Café - Backend API

Backend Node.js + Express + MySQL para el sistema POS de El Super Café.

## Requisitos

- Node.js >= 18.0.0
- MySQL >= 8.0

## Características Backend

- **API RESTful:** Endpoints para gestión de ventas, productos, inventario y usuarios.
- **Soporte de Modificadores:** Procesamiento de pedidos con ingredientes excluidos/extras en `sale_items`.
- **Cálculo de Totales:** Lógica robusta para calcular totales de venta incluyendo costos de extras.
- **Gestión de Stock:** Descuento automático de inventario basado en recetas y modificadores (ej. "Extra Queso" descuenta doble).
- **Sincronización:** Endpoints optimizados para sincronización masiva con clientes offline.
- **WebSockets:** Notificaciones en tiempo real para actualizaciones de mesas y pedidos.

## Instalación

1. **Clonar/Copiar el proyecto**

2. **Instalar dependencias**
```bash
npm install
```

3. **Configurar variables de entorno**
```bash
cp .env.example .env
# Editar .env con tus credenciales
```

4. **Crear la base de datos MySQL**
```bash
# Ejecutar el script SQL en tu servidor MySQL
mysql -u root -p < sql/schema.sql
```

5. **Iniciar el servidor**
```bash
# Desarrollo
npm run dev

# Producción
npm start
```

## Variables de Entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor | 3001 |
| `NODE_ENV` | Entorno (development/production) | development |
| `DB_HOST` | Host de MySQL | localhost |
| `DB_PORT` | Puerto de MySQL | 3306 |
| `DB_USER` | Usuario de MySQL | root |
| `DB_PASSWORD` | Contraseña de MySQL | - |
| `DB_NAME` | Nombre de la base de datos | el_super_cafe |
| `JWT_SECRET` | Secret para tokens JWT | - |
| `JWT_EXPIRES_IN` | Expiración de tokens | 24h |
| `CORS_ORIGINS` | Orígenes permitidos | localhost:5173 |

## Endpoints

### Autenticación

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login con userId + PIN |
| POST | `/api/auth/login-username` | Login con username + PIN |
| GET | `/api/auth/users` | Lista de usuarios activos |
| GET | `/api/auth/verify` | Verificar token actual |

### Sincronización

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/sync` | Sincronización completa |
| POST | `/api/sync/sales` | Sincronizar ventas |
| POST | `/api/sync/movements` | Sincronizar movimientos |
| GET | `/api/sync/status` | Estado de sincronización |

### KDS (Cocina)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| PATCH | `/api/sales/:saleId/items/:itemId/status` | Actualizar estado de preparación (pending/preparing/ready) |

### Usuarios (Solo Admin)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/users` | Listar todos los usuarios |
| GET | `/api/users/:id` | Obtener usuario por ID |
| POST | `/api/users` | Crear nuevo usuario |
| PUT | `/api/users/:id` | Actualizar usuario |
| DELETE | `/api/users/:id` | Desactivar usuario |

### Reportes (Solo Admin)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/reports/summary` | Resumen de ventas |
| GET | `/api/reports/sales-by-day` | Ventas por día |
| GET | `/api/reports/top-products` | Productos más vendidos |
| GET | `/api/reports/shifts` | Historial de turnos |
| GET | `/api/reports/shift/:id` | Detalle de turno |
| GET | `/api/reports/debts` | Deudas pendientes |

## Ejemplos de Uso

### Login
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"userId": "uuid-del-usuario", "pin": "1234"}'
```

### Sincronizar ventas
```bash
curl -X POST http://localhost:3001/api/sync/sales \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer tu-token-jwt" \
  -d '{
    "sales": [...],
    "sale_items": [...]
  }'
```

## Despliegue en cPanel

1. Crear la base de datos MySQL desde cPanel
2. Ejecutar `sql/schema.sql` en phpMyAdmin
3. Subir los archivos del proyecto (excepto `node_modules`)
4. Configurar Node.js App en cPanel
5. Crear archivo `.env` con las credenciales de producción
6. Instalar dependencias: `npm install --production`
7. Iniciar la aplicación

## Estructura del Proyecto

```
el-super-cafe-backend/
├── sql/
│   └── schema.sql          # Script de base de datos
├── src/
│   ├── config/
│   │   └── database.js     # Configuración MySQL
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── sync.controller.js
│   │   ├── users.controller.js
│   │   └── reports.controller.js
│   ├── middleware/
│   │   └── auth.middleware.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── sync.routes.js
│   │   ├── users.routes.js
│   │   └── reports.routes.js
│   └── index.js            # Servidor principal
├── .env.example
├── package.json
└── README.md
```

## Seguridad

- Tokens JWT para autenticación
- Rate limiting en endpoints
- Helmet para headers de seguridad
- CORS configurado
- Validación de inputs
- Soft delete para usuarios

## Licencia

ISC - El Super Café
