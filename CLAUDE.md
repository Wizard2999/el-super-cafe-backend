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
```

## Sistema de Créditos y Deudas

### Sincronización de Deudas (Fuente de Verdad)
- **Regla de Oro**: La deuda (`current_debt`) se calcula en el servidor.
- **Sync Inverso**:
  - `syncCustomers` NO sobrescribe `current_debt` con datos del dispositivo.
  - Solo actualiza nombre, teléfono, dirección, etc.
- **Atomicidad**:
  - Al recibir una transacción de crédito (`syncCreditTransactions`), se recalcula la deuda del cliente atómicamente (`UPDATE customers SET current_debt = current_debt + ?`).

### Scripts de Mantenimiento
- `scripts/recalculate_debts.js`:
  - Recalcula la deuda de TODOS los clientes basándose en la suma histórica de `credit_transactions`.
  - Útil para corregir inconsistencias por fallos de sync previos.

### Reportes y Abonos
- **Endpoint `getShiftDetail`**:
  - Ahora incluye `totalAbonos` (suma de pagos en el turno).
  - Retorna array `abonos` con detalle (cliente, monto, fecha).
- **Filtros**:
  - Endpoints de reportes soportan filtrado por `shift_id` para alineación exacta con turnos de caja.
