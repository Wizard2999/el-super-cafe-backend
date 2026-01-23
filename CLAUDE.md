# El Super Café - Backend API

## Descripción
API REST para el sistema POS de El Super Café. Proporciona endpoints para autenticación, sincronización de datos desde dispositivos offline-first, gestión de usuarios y reportes.

## Stack Tecnológico
- **Runtime:** Node.js >= 18
- **Framework:** Express.js 4.x
- **Base de Datos:** MySQL 8.x
- **Autenticación:** JWT (jsonwebtoken)
- **Seguridad:** Helmet, CORS, Rate Limiting
- **Driver MySQL:** mysql2/promise (con pool de conexiones)

## Estructura del Proyecto
```
src/
├── config/
│   └── database.js       # Pool de conexiones MySQL
├── controllers/
│   ├── auth.controller.js
│   ├── sync.controller.js
│   ├── users.controller.js
│   └── reports.controller.js
├── middleware/
│   └── auth.middleware.js  # verifyToken, requireAdmin
├── routes/
│   ├── auth.routes.js
│   ├── sync.routes.js
│   ├── users.routes.js
│   └── reports.routes.js
├── utils/                  # (Reservado para utilidades)
└── index.js               # Servidor principal Express
```

## Base de Datos

### Versión del Schema: 1.0

### Tablas Principales
| Tabla | Descripción |
|-------|-------------|
| `users` | Usuarios del sistema (admin, employee) |
| `categories` | Categorías de productos |
| `products` | Productos e insumos |
| `recipes` | Recetas (ingredientes para productos preparados) |
| `cafe_tables` | Mesas del establecimiento |
| `shifts` | Turnos de caja (del dispositivo) |
| `sales` | Ventas realizadas |
| `sale_items` | Items de cada venta |
| `movements` | Movimientos de caja (gastos, ingresos) |
| `sync_log` | Registro de sincronizaciones |

### Campos Importantes en `sales`
- `status`: ENUM('pending', 'completed', 'unpaid_debt')
- `observation`: TEXT - Razón de no pago (deudas)
- `unpaid_authorized_by_id`: UUID del admin que autorizó la deuda
- `print_count`: Contador de impresiones del ticket

### Campos Importantes en `shifts`
- `opened_by_id` / `opened_by_name`: Quién abrió el turno
- `closed_by_id` / `closed_by_name`: Quién cerró el turno
- El turno es del **dispositivo**, no del usuario individual

## Autenticación

### Flujo de Login
1. Cliente envía `POST /api/auth/login` con `{ userId, pin }`
2. Servidor valida PIN contra tabla `users`
3. Si es válido, genera JWT con `{ userId, username, role }`
4. Cliente guarda token y lo envía en header `Authorization: Bearer <token>`

### Middleware de Auth
- `verifyToken`: Valida JWT y agrega `req.user`
- `requireAdmin`: Verifica que `req.user.role === 'admin'`

### Tokens JWT
- Payload: `{ userId, username, role }`
- Expiración: Configurable via `JWT_EXPIRES_IN` (default: 24h)
- Secret: Configurable via `JWT_SECRET`

## Sincronización Proactiva (Servidor como Fuente de Verdad)

### Filosofía
El backend es la **Fuente de Verdad** para todos los datos:
- Los dispositivos envían datos automáticamente sin intervención humana.
- En caso de conflicto, el servidor tiene prioridad para catálogo (precios, productos, mesas).
- La base de datos MySQL siempre tiene la información más reciente.

### Flujo de Sincronización
1. **Auto-Push Inmediato**: Cada venta/gasto se envía al backend inmediatamente después de guardarse en el dispositivo.
2. **Auto-Pull al Login**: Al iniciar sesión, el dispositivo descarga catálogo + usuarios actualizados.
3. **Intervalo de Respaldo**: Cada 5 minutos, el dispositivo verifica pendientes y sincroniza.
4. **Prioridad del Servidor**: Al hacer pull, el catálogo del servidor sobrescribe el local.

### Endpoints de Sync (Push - Subida)
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/sync` | Sincronización completa (shifts, sales, sale_items, movements) |
| POST | `/api/sync/sales` | Solo ventas y sale_items |
| POST | `/api/sync/movements` | Solo movimientos |
| GET | `/api/sync/status` | Estado de última sincronización |

### Endpoints de Sync (Pull - Bajada)
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/sync/users` | Descargar usuarios al dispositivo (requiere auth, incluye PIN hash) |
| GET | `/api/catalog/full` | Descargar catálogo completo (categorías, productos, recetas, mesas) |
| GET | `/api/sync/sales/pending` | Descargar ventas pendientes (pedidos activos en mesas ocupadas) |
| GET | `/api/sync/shifts/open` | Obtener turno(s) abierto(s) para adopción global |

### Endpoints de Catálogo
| Método | Endpoint | Rol | Descripción |
|--------|----------|-----|-------------|
| GET | `/api/catalog/full` | Todos | Descargar catálogo completo |
| POST | `/api/catalog/sync` | Admin | Subir cambios del catálogo |
| GET/POST/DELETE | `/api/catalog/categories` | Admin | CRUD categorías |
| GET/POST/DELETE | `/api/catalog/products` | Admin | CRUD productos |
| GET/POST/DELETE | `/api/catalog/recipes` | Admin | CRUD recetas |
| GET/POST/DELETE | `/api/catalog/tables` | Admin | CRUD mesas |

## Gestión de Usuarios
- `POST /api/users` - Crear usuario (Admin only)
- `PUT /api/users/:id` - Actualizar usuario (Admin only)
- `DELETE /api/users/:id` - Desactivar/Eliminar usuario (Admin only)
- `GET /api/users` - Listar usuarios (Admin only)

### Descuento Automático de Inventario
Cuando se sincroniza una venta **nueva** con `status: 'completed'`, el sistema ejecuta automáticamente `processInventoryDeduction(saleId)`:

#### Lógica de Descuento
1. **Productos con stock directo** (`manage_stock = 1`):
   - Se resta la cantidad vendida directamente de `products.stock_current`
   - Ejemplo: Venta de 2 cervezas → stock_current -= 2

2. **Productos preparados con receta** (`manage_stock = 0`):
   - Se busca la receta en tabla `recipes`
   - Se descuenta de cada insumo: `cantidad_vendida × quantity_required`
   - Ejemplo: Venta de 3 cafés con leche (receta: 20g café, 150ml leche por unidad)
     - Café: stock_current -= 60g (3 × 20)
     - Leche: stock_current -= 450ml (3 × 150)

#### Protecciones
- Solo se procesa para ventas **nuevas** (evita doble descuento en re-sync)
- `GREATEST(0, stock_current - X)` previene valores negativos
- Si el producto no existe, se registra warning y continúa

### Headers Especiales
- `X-Device-ID`: Identificador del dispositivo (para logs)

## Endpoints

### Públicos (sin auth)
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/auth/users` | Lista usuarios activos (para login screen) |
| POST | `/api/auth/login` | Login con userId + PIN |

### Protegidos (requieren JWT)
| Método | Endpoint | Rol | Descripción |
|--------|----------|-----|-------------|
| GET | `/api/auth/verify` | Todos | Verificar token |
| POST | `/api/sync` | Todos | Sincronización completa |
| POST | `/api/sync/sales` | Todos | Sync ventas |
| POST | `/api/sync/movements` | Todos | Sync movimientos |

### Solo Admin
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/users` | Listar usuarios |
| POST | `/api/users` | Crear usuario |
| PUT | `/api/users/:id` | Actualizar usuario |
| DELETE | `/api/users/:id` | Desactivar usuario |
| GET | `/api/reports/summary` | Resumen de ventas |
| GET | `/api/reports/sales-by-day` | Ventas por día |
| GET | `/api/reports/top-products` | Top productos |
| GET | `/api/reports/shifts` | Historial turnos |
| GET | `/api/reports/shift/:id` | Detalle de turno |
| GET | `/api/reports/debts` | Deudas pendientes |

## Manejo de Errores

### Formato de Respuesta
```javascript
// Éxito
{ success: true, data: {...}, message: "..." }

// Error
{ success: false, error: "Mensaje de error" }
```

### Códigos HTTP
- `200`: OK
- `201`: Creado
- `400`: Bad Request (validación)
- `401`: No autenticado
- `403`: Forbidden (sin permisos)
- `404`: No encontrado
- `500`: Error interno

## Configuración

### Variables de Entorno (.env)
```
PORT=3001
NODE_ENV=development

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=el_super_cafe

JWT_SECRET=cambiar-en-produccion
JWT_EXPIRES_IN=24h

CORS_ORIGINS=http://localhost:5173
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

## Seguridad

### Implementado
- JWT para autenticación stateless
- Helmet para headers de seguridad
- CORS configurado por origen
- Rate limiting por IP
- Validación de inputs
- Soft delete (usuarios nunca se eliminan físicamente)
- No se puede eliminar usuario con turno abierto
- **Hashing de PIN con bcrypt** (bcryptjs, 10 rounds)
  - Los PINs nuevos se guardan hasheados automáticamente
  - PINs en texto plano se migran automáticamente al hacer login
  - Campo `pin_code` es VARCHAR(60) para soportar hashes

### Pendiente / Recomendado
- HTTPS obligatorio en producción
- Logs de auditoría más detallados
- Backup automático de base de datos

## Comandos

```bash
# Desarrollo (con nodemon)
npm run dev

# Producción
npm start

# Instalar dependencias
npm install
```

## Despliegue en cPanel

1. Crear base de datos MySQL en cPanel
2. Ejecutar `sql/schema.sql` en phpMyAdmin
3. Subir archivos (sin node_modules)
4. Crear `.env` con credenciales de producción
5. Configurar Node.js App en cPanel
6. `npm install --production`
7. Iniciar aplicación

## Relación con Frontend

### Frontend (el-super-cafe)
- React + Vite + TypeScript
- Dexie.js (IndexedDB) para datos locales
- Funciona 100% offline
- Sincroniza cuando detecta conexión

### Backend (el-super-cafe-backend)
- Recibe datos sincronizados
- Proporciona reportes consolidados
- Gestión centralizada de usuarios
- Backup de datos en MySQL

## Notas para el Asistente

- Los UUIDs para **ventas, turnos, movimientos** se generan en el frontend con `crypto.randomUUID()`
- Los **usuarios** tienen IDs fijos que deben coincidir con el frontend:
  - `u1-soporte-001` - Soporte Técnico (PIN: 2908, admin)
  - `u2-admin-002` - Administrador Café (PIN: 1234, admin)
  - `u3-cajero-003` - Cajero (PIN: 0000, employee)
- El backend solo recibe y almacena, nunca genera IDs nuevos para datos sincronizados
- `is_synced` en MySQL siempre es 1 (ya fue sincronizado)
- La tabla `sync_log` registra cada operación de sincronización
- Los turnos (`shifts`) son del dispositivo, no del usuario - cualquier empleado puede operar en un turno abierto
- El campo `observation` en `sales` es para explicar por qué un cliente no pagó (deuda/fiado)
- `processInventoryDeduction(saleId)` está exportada en sync.controller.js para uso externo si es necesario
- El descuento de inventario **solo ocurre para ventas nuevas completadas** - re-sincronizar la misma venta no duplica el descuento
- **Evento `movement:create`** incluye `shiftId` para que los dispositivos puedan asociar gastos al turno correcto
- **Endpoint `/api/sync/sales/pending`** retorna ventas, items y mesas ocupadas para sincronización PULL antes de PUSH

## Transit State: Handover de Mesas entre Turnos

### Concepto
El "Transit State" permite traspasar mesas pendientes de un usuario a otro sin crear el turno del receptor inmediatamente. Las ventas quedan en un estado de tránsito hasta que el receptor abra su turno.

### Flujo de Usuario A (cerrando turno)
1. En `CashCloseModal`, si hay ventas pendientes, aparece botón "Traspasar Mesas"
2. Usuario A selecciona al receptor (Usuario B)
3. Sistema llama a `POST /api/sync/shifts/transfer-tables` que:
   - Establece `shift_id = NULL` en las ventas
   - Establece `pending_receiver_user_id = Usuario B's ID`
4. Usuario A puede completar su arqueo de caja y cerrar turno normalmente

### Flujo de Usuario B (abriendo turno)
1. Usuario B abre su turno manualmente como siempre
2. Al crear el turno, `syncShift()` llama a `linkOrphanSalesToShift()`:
   - Busca ventas donde `shift_id IS NULL AND pending_receiver_user_id = Usuario B's ID`
   - Las vincula al nuevo turno: `shift_id = nuevo_turno_id, pending_receiver_user_id = NULL`
3. Frontend ejecuta `SyncService.syncAll()` para descargar las mesas traspasadas

### Endpoints Relacionados
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/sync/shifts/transfer-tables` | Traspasa ventas pendientes a un usuario receptor |

### Campo `pending_receiver_user_id` en `sales`
- `VARCHAR(36)` - ID del usuario que recibirá las ventas al abrir su turno
- Solo tiene valor cuando las ventas están en tránsito (`shift_id IS NULL`)
- Se limpia automáticamente al vincular las ventas al nuevo turno

### Eventos de Socket
- `sales:transfer`: Notifica que ventas fueron traspasadas a un usuario
- `sales:linked`: Notifica que ventas huérfanas fueron vinculadas a un turno

### Respuesta de Sincronización con Mesas Heredadas
Cuando User B abre su turno y el backend vincula ventas huérfanas, la respuesta de `/api/sync` incluye:
```json
{
  "success": true,
  "data": {
    "shifts": { "synced": 1, "errors": [] },
    "linkedSalesInfo": {
      "shiftId": "uuid-del-nuevo-turno",
      "linkedSalesCount": 3,
      "linkedTables": [
        { "id": "table-uuid-1", "name": "Mesa 1" },
        { "id": "table-uuid-2", "name": "Mesa 2" }
      ]
    }
  }
}
```
El frontend usa esta información para mostrar el modal de bienvenida a User B.
