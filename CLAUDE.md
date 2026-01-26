# El Super Café - Backend API

## Comandos Principales
- `npm run dev`: Iniciar servidor (desarrollo)
- `npm start`: Iniciar servidor (producción)
- `npm install`: Instalar dependencias

## Stack Tecnológico
- Node.js >= 18, Express.js 4.x, MySQL 8.x
- **Auth**: JWT
- **Sockets**: Socket.io para tiempo real

## Base de Datos
- **Schema**: `sql/schema.sql`
- **Migración KDS**: `sql/migrations/003_kitchen_module.sql` (Requerido)
- **Tablas Clave**: `users`, `sales`, `sale_items` (con `preparation_status`), `shifts`.

## Módulo KDS (Kitchen Display System)
- **Endpoint**: `PATCH /api/sales/:saleId/items/:itemId/status`
- **Socket Event**: `kitchen:update` (Broadcast cambios de estado a POS)
- **Estados**: `pending`, `preparing`, `ready`, `delivered`

## Roles de Usuario
- `admin`: Acceso total.
- `employee`: Ventas y turnos.
- `kitchen`: Acceso KDS.
- `auxiliar_inventario`: Gestión de stock/productos.

## Endpoints Principales
- **/auth**: Login (`/login`, `/login-username`)
- **/sync**: Sincronización masiva (`/`, `/sales`, `/movements`)
- **/sales**: Gestión de ventas y estados de items.

## Sincronización
- **Filosofía**: Servidor es Fuente de Verdad.
- **Flujo**: Push inmediato desde dispositivos -> DB MySQL.
- **Stock**: `StockService.js` descuenta inventario basado en recetas y modificadores.
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

### Validación de Stock (StockService.js)
Antes de procesar una venta `completed`, el sistema valida que haya stock suficiente.

#### Flujo de Validación
1. Cuando llega una venta con `status: 'completed'` (nueva o que cambia a completed):
   - Se valida stock ANTES de guardar la venta
   - Si no hay stock suficiente, se retorna **HTTP 400** con detalle del error
   - La venta NO se registra en la base de datos

2. Si la validación pasa:
   - Se usa una **transacción SQL** para:
     - Crear/actualizar la venta
     - Crear los items
     - Descontar el stock
   - Si algo falla, todo se revierte (rollback)

#### Respuesta de Error 400 (Stock Insuficiente)
```json
{
  "success": false,
  "error": "Stock insuficiente:\nLeche: necesitas 500 ml, solo hay 200 ml",
  "stockErrors": [
    {
      "productName": "Café con Leche",
      "ingredientName": "Leche",
      "required": 500,
      "available": 200,
      "unit": "ml"
    }
  ],
  "saleId": "uuid-de-la-venta"
}
```

#### Funciones del StockService
| Función | Descripción |
|---------|-------------|
| `validateStockForItems(items)` | Valida si hay stock suficiente |
| `deductStockForItems(conn, items)` | Descuenta stock (dentro de transacción) |
| `validateAndDeductStock(conn, items)` | Valida y descuenta en una operación |
| `formatValidationErrors(errors)` | Formatea errores para respuesta HTTP |

### Descuento Automático de Inventario
Cuando se sincroniza una venta **nueva** con `status: 'completed'`, el sistema valida stock y ejecuta el descuento dentro de una transacción SQL:

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

## Sistema de Inventario Inteligente

### Migración SQL (`004_inventory_intelligence.sql`)
Agrega:
- `products.cost_unit`: Costo unitario para cálculo de utilidad
- `products.stock_min`: Stock mínimo para alertas
- `sales.gross_profit`: Utilidad bruta calculada
- Tabla `stock_adjustments`: Historial de ajustes de inventario

### Nuevas Funciones en `utils/math.js`
| Función | Descripción |
|---------|-------------|
| `calculateSaleCost(items, queryFn)` | Calcula costo total de insumos para una venta |
| `calculateGrossProfit(total, cost)` | Retorna utilidad bruta (Total - Costo) |

### Cálculo de Utilidad Bruta
- Se ejecuta automáticamente al sincronizar ventas `completed`
- Considera productos directos (`manage_stock = 1`) y recetas
- Aplica multiplicadores por modificadores (extras/exclusiones)
- Resultado guardado en `sales.gross_profit`

### Consumos Decimales
- `StockService` soporta cantidades decimales (ej: 0.2 unidades de tomate)
- `quantity_required` en recetas acepta decimales
- Extras descuentan su respectivo insumo del stock

### Tabla `stock_adjustments`
```sql
CREATE TABLE stock_adjustments (
    id VARCHAR(36) PRIMARY KEY,
    product_id VARCHAR(36) NOT NULL,
    type ENUM('entrada', 'salida') NOT NULL,
    quantity DECIMAL(12, 2) NOT NULL,
    reason ENUM('compra', 'merma', 'dano', 'correccion', 'otro'),
    description VARCHAR(255),
    previous_stock DECIMAL(12, 2),
    new_stock DECIMAL(12, 2),
    created_by_id VARCHAR(36),
    created_by_name VARCHAR(100),
    ...
);
```
