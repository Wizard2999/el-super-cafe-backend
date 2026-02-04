const { query } = require('../config/database');

/**
 * GET /api/reports/summary
 * Resumen general de ventas por período
 */
async function getSalesSummary(req, res) {
  try {
    const { start_date, end_date, period = 'day', shift_id } = req.query;

    let startDate, endDate;
    let whereClause = "WHERE status = 'completed'";
    const params = [];

    if (shift_id) {
      whereClause += " AND shift_id = ?";
      params.push(shift_id);
    } else if (start_date && end_date) {
      startDate = new Date(start_date);
      endDate = new Date(end_date);
      whereClause += " AND created_at BETWEEN ? AND ?";
      params.push(startDate, endDate);
    } else {
      // Por defecto: hoy
      endDate = new Date();
      startDate = new Date();

      switch (period) {
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(startDate.getMonth() - 1);
          break;
        case 'year':
          startDate.setFullYear(startDate.getFullYear() - 1);
          break;
        default:
          startDate.setHours(0, 0, 0, 0);
      }
      whereClause += " AND created_at BETWEEN ? AND ?";
      params.push(startDate, endDate);
    }

    // Resumen de ventas
    const salesSummary = await query(
      `SELECT
        COUNT(*) AS total_transactions,
        COALESCE(SUM(CASE WHEN payment_method = 'efectivo' THEN total ELSE 0 END), 0) AS cash_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'transferencia' THEN total ELSE 0 END), 0) AS transfer_sales,
        COALESCE(SUM(total), 0) AS total_sales
       FROM sales
       ${whereClause}`,
      params
    );

    // Resumen de gastos
    // Nota: expensesSummary necesita su propio whereClause porque 'movements' tiene 'type'='gasto'
    // y puede tener shift_id o fechas.
    let expensesWhere = "WHERE type = 'gasto'";
    const expensesParams = [];
    
    if (shift_id) {
        expensesWhere += " AND shift_id = ?";
        expensesParams.push(shift_id);
    } else {
        expensesWhere += " AND created_at BETWEEN ? AND ?";
        // Reutilizamos las fechas calculadas arriba
        expensesParams.push(startDate, endDate);
    }

    const expensesSummary = await query(
      `SELECT
        COUNT(*) AS total_expenses_count,
        COALESCE(SUM(amount), 0) AS total_expenses
       FROM movements
       ${expensesWhere}`,
      expensesParams
    );

    // Deudas pendientes
    const debtsSummary = await query(
      `SELECT
        COUNT(*) AS total_debts,
        COALESCE(SUM(total), 0) AS total_debt_amount
       FROM sales
       WHERE status = 'unpaid_debt'`
    );

    // Abonos (Pagos de créditos)
    let abonosWhere = "WHERE type = 'payment'";
    const abonosParams = [];
    if (shift_id) {
        abonosWhere += " AND shift_id = ?";
        abonosParams.push(shift_id);
    } else {
        abonosWhere += " AND created_at BETWEEN ? AND ?";
        abonosParams.push(startDate, endDate);
    }

    const abonosSummary = await query(
      `SELECT
        COUNT(*) AS total_payments,
        COALESCE(SUM(amount), 0) AS total_amount
       FROM credit_transactions
       ${abonosWhere}`,
      abonosParams
    );

    const sales = salesSummary[0];
    const expenses = expensesSummary[0];
    const debts = debtsSummary[0];
    const abonos = abonosSummary[0];

    res.json({
      success: true,
      data: {
        period: {
          start: startDate,
          end: endDate,
        },
        sales: {
          totalTransactions: parseInt(sales.total_transactions),
          cashSales: parseFloat(sales.cash_sales),
          transferSales: parseFloat(sales.transfer_sales),
          totalSales: parseFloat(sales.total_sales),
        },
        expenses: {
          count: parseInt(expenses.total_expenses_count),
          total: parseFloat(expenses.total_expenses),
        },
        debts: {
          count: parseInt(debts.total_debts),
          total: parseFloat(debts.total_debt_amount),
        },
        abonos: {
          count: parseInt(abonos.total_payments),
          total: parseFloat(abonos.total_amount),
        },
        netProfit: parseFloat(sales.total_sales) - parseFloat(expenses.total_expenses),
        cashFlow: parseFloat(sales.cash_sales) + parseFloat(abonos.total_amount) - parseFloat(expenses.total_expenses),
      },
    });
  } catch (error) {
    console.error('Error obteniendo resumen:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo resumen',
    });
  }
}

/**
 * GET /api/reports/sales-by-day
 * Ventas agrupadas por día
 */
async function getSalesByDay(req, res) {
  try {
    const { days = 30 } = req.query;

    const results = await query(
      `SELECT
        DATE(created_at) AS sale_date,
        COUNT(*) AS transactions,
        SUM(CASE WHEN payment_method = 'efectivo' THEN total ELSE 0 END) AS cash,
        SUM(CASE WHEN payment_method = 'transferencia' THEN total ELSE 0 END) AS transfer,
        SUM(total) AS total
       FROM sales
       WHERE status = 'completed'
         AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY sale_date DESC`,
      [parseInt(days)]
    );

    res.json({
      success: true,
      data: results.map((r) => ({
        date: r.sale_date,
        transactions: parseInt(r.transactions),
        cash: parseFloat(r.cash),
        transfer: parseFloat(r.transfer),
        total: parseFloat(r.total),
      })),
    });
  } catch (error) {
    console.error('Error obteniendo ventas por día:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo ventas por día',
    });
  }
}

/**
 * GET /api/reports/top-products
 * Productos más vendidos
 */
async function getTopProducts(req, res) {
  try {
    const { limit = 10, start_date, end_date } = req.query;

    let dateFilter = '';
    const params = [];

    if (start_date && end_date) {
      dateFilter = 'AND s.created_at BETWEEN ? AND ?';
      params.push(new Date(start_date), new Date(end_date));
    }

    params.push(parseInt(limit));

    const results = await query(
      `SELECT
        si.product_id,
        si.product_name,
        SUM(si.quantity) AS total_quantity,
        SUM(si.quantity * si.unit_price) AS total_revenue,
        COUNT(DISTINCT si.sale_id) AS times_sold
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.id
       WHERE s.status = 'completed' ${dateFilter}
       GROUP BY si.product_id, si.product_name
       ORDER BY total_quantity DESC
       LIMIT ?`,
      params
    );

    res.json({
      success: true,
      data: results.map((r) => ({
        productId: r.product_id,
        productName: r.product_name,
        quantity: parseFloat(r.total_quantity),
        revenue: parseFloat(r.total_revenue),
        timesSold: parseInt(r.times_sold),
      })),
    });
  } catch (error) {
    console.error('Error obteniendo top productos:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo top productos',
    });
  }
}

/**
 * GET /api/reports/shifts
 * Historial de turnos
 */
async function getShiftsHistory(req, res) {
  try {
    const { limit = 20, status } = req.query;

    let statusFilter = '';
    const params = [];

    if (status) {
      statusFilter = 'WHERE s.status = ?';
      params.push(status);
    }

    params.push(parseInt(limit));

    const shifts = await query(
      `SELECT
        s.*,
        (SELECT COALESCE(SUM(sa.total), 0) FROM sales sa WHERE sa.shift_id = s.id AND sa.status = 'completed') AS total_sales,
        (SELECT COALESCE(SUM(sa.total), 0) FROM sales sa WHERE sa.shift_id = s.id AND sa.status = 'completed' AND sa.payment_method = 'efectivo') AS cash_sales,
        (SELECT COALESCE(SUM(ct.amount), 0) FROM credit_transactions ct WHERE ct.shift_id = s.id AND ct.type = 'payment') AS total_abonos,
        (SELECT COALESCE(SUM(m.amount), 0) FROM movements m WHERE m.shift_id = s.id AND m.type = 'gasto') AS total_expenses
       FROM shifts s
       ${statusFilter}
       ORDER BY s.start_time DESC
       LIMIT ?`,
      params
    );

    res.json({
      success: true,
      data: shifts.map((s) => ({
        id: s.id,
        openedBy: {
          id: s.opened_by_id,
          name: s.opened_by_name,
        },
        closedBy: s.closed_by_id
          ? {
              id: s.closed_by_id,
              name: s.closed_by_name,
            }
          : null,
        startTime: s.start_time,
        endTime: s.end_time,
        initialCash: parseFloat(s.initial_cash),
        finalCashReported: s.final_cash_reported ? parseFloat(s.final_cash_reported) : null,
        cashDifference: s.cash_difference ? parseFloat(s.cash_difference) : null,
        status: s.status,
        totalSales: parseFloat(s.total_sales),
        totalExpenses: parseFloat(s.total_expenses),
        expectedCash:
          parseFloat(s.initial_cash) + parseFloat(s.cash_sales || 0) + parseFloat(s.total_abonos || 0) - parseFloat(s.total_expenses),
      })),
    });
  } catch (error) {
    console.error('Error obteniendo historial de turnos:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo historial de turnos',
    });
  }
}

/**
 * GET /api/reports/shift/:id
 * Detalle de un turno específico
 */
async function getShiftDetail(req, res) {
  try {
    const { id } = req.params;

    // Obtener turno
    const shifts = await query('SELECT * FROM shifts WHERE id = ?', [id]);

    if (shifts.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Turno no encontrado',
      });
    }

    const shift = shifts[0];

    // Obtener ventas del turno
    const sales = await query(
      `SELECT * FROM sales WHERE shift_id = ? ORDER BY created_at DESC`,
      [id]
    );

    // Obtener movimientos del turno
    const movements = await query(
      `SELECT * FROM movements WHERE shift_id = ? ORDER BY created_at DESC`,
      [id]
    );

    // Obtener abonos (pagos de créditos) del turno
    const abonos = await query(
      `SELECT ct.*, c.name as customer_name 
       FROM credit_transactions ct 
       LEFT JOIN customers c ON ct.customer_id = c.id
       WHERE ct.shift_id = ? AND ct.type = 'payment' 
       ORDER BY ct.created_at DESC`,
      [id]
    );

    // Calcular totales
    const salesCash = sales
      .filter((s) => s.status === 'completed' && s.payment_method === 'efectivo')
      .reduce((sum, s) => sum + parseFloat(s.total), 0);

    const salesTransfer = sales
      .filter((s) => s.status === 'completed' && s.payment_method === 'transferencia')
      .reduce((sum, s) => sum + parseFloat(s.total), 0);

    const totalExpenses = movements
      .filter((m) => m.type === 'gasto')
      .reduce((sum, m) => sum + parseFloat(m.amount), 0);
      
    const totalAbonos = abonos.reduce((sum, a) => sum + parseFloat(a.amount), 0);

    res.json({
      success: true,
      data: {
        shift: {
          id: shift.id,
          openedBy: {
            id: shift.opened_by_id,
            name: shift.opened_by_name,
          },
          closedBy: shift.closed_by_id
            ? {
                id: shift.closed_by_id,
                name: shift.closed_by_name,
              }
            : null,
          startTime: shift.start_time,
          endTime: shift.end_time,
          initialCash: parseFloat(shift.initial_cash),
          finalCashReported: shift.final_cash_reported
            ? parseFloat(shift.final_cash_reported)
            : null,
          cashDifference: shift.cash_difference ? parseFloat(shift.cash_difference) : null,
          status: shift.status,
        },
        summary: {
          salesCash,
          salesTransfer,
          totalSales: salesCash + salesTransfer,
          totalExpenses,
          totalAbonos,
          expectedCash: parseFloat(shift.initial_cash) + salesCash + totalAbonos - totalExpenses,
        },
        sales: sales.map((s) => ({
          id: s.id,
          total: parseFloat(s.total),
          paymentMethod: s.payment_method,
          status: s.status,
          observation: s.observation,
          createdAt: s.created_at,
        })),
        movements: movements.map((m) => ({
          id: m.id,
          type: m.type,
          amount: parseFloat(m.amount),
          description: m.description,
          createdAt: m.created_at,
        })),
        abonos: abonos.map((a) => ({
          id: a.id,
          amount: parseFloat(a.amount),
          customerName: a.customer_name || 'Cliente Eliminado',
          createdAt: a.created_at,
        })),
      },
    });
  } catch (error) {
    console.error('Error obteniendo detalle de turno:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo detalle de turno',
    });
  }
}

/**
 * GET /api/reports/debts
 * Listado de deudas pendientes
 */
async function getPendingDebts(req, res) {
  try {
    const debts = await query(
      `SELECT
        s.*,
        u.name AS authorized_by_name,
        sh.opened_by_name AS shift_opened_by
       FROM sales s
       LEFT JOIN users u ON s.unpaid_authorized_by_id = u.id
       LEFT JOIN shifts sh ON s.shift_id = sh.id
       WHERE s.status = 'unpaid_debt'
       ORDER BY s.created_at DESC`
    );

    // Si no hay deudas, retornar vacío
    if (debts.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Obtener items de las deudas
    const debtIds = debts.map(d => d.id);
    // Necesitamos manejar el array para el IN clause
    const placeholders = debtIds.map(() => '?').join(',');
    
    const items = await query(
      `SELECT * FROM sale_items WHERE sale_id IN (${placeholders})`,
      debtIds
    );

    // Agrupar items por venta
    const itemsBySale = {};
    items.forEach(item => {
      if (!itemsBySale[item.sale_id]) {
        itemsBySale[item.sale_id] = [];
      }
      // Parsear modifiers si es string
      let modifiers = item.modifiers;
      if (typeof modifiers === 'string') {
        try {
          modifiers = JSON.parse(modifiers);
        } catch (e) {
          modifiers = []; // o null
        }
      }

      itemsBySale[item.sale_id].push({
        id: item.id,
        product_name: item.product_name,
        quantity: parseFloat(item.quantity),
        unit_price: parseFloat(item.unit_price),
        total: parseFloat(item.unit_price) * parseFloat(item.quantity),
        modifiers: modifiers
      });
    });

    const formattedDebts = debts.map((d) => {
        // Intentar usar items de la BD, si no hay, buscar en el objeto sale (legacy/embedded)
        let saleItems = itemsBySale[d.id] || [];
        
        // Soporte para items embebidos en el campo 'items' de la venta (si existe como JSON en BD)
        // Nota: En la estructura actual 'sales' no parece tener columna 'items' JSON, pero por si acaso o si se guardó así.
        // En el frontend vimos que a veces sale.items existe.
        // Si la columna no existe en MySQL, d.items será undefined.
        
        return {
            ...d, // Incluir todos los campos de la venta
            id: d.id,
            total: parseFloat(d.total),
            observation: d.observation,
            authorizedBy: d.authorized_by_name,
            shiftOpenedBy: d.shift_opened_by,
            createdAt: d.created_at,
            items: saleItems
        };
    });

    res.json({
      success: true,
      data: formattedDebts,
    });
  } catch (error) {
    console.error('Error obteniendo deudas:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo deudas',
    });
  }
}

/**
 * GET /api/reports/detailed-sales
 * Ventas detalladas para Excel
 */
async function getDetailedSales(req, res) {
  try {
    const { start_date, end_date, shift_id } = req.query;
    let whereClause = "WHERE s.status = 'completed'";
    const params = [];

    if (shift_id) {
      whereClause += ' AND s.shift_id = ?';
      params.push(shift_id);
    } else if (start_date && end_date) {
      whereClause += ' AND s.created_at BETWEEN ? AND ?';
      params.push(new Date(start_date), new Date(end_date));
    }

    const results = await query(
      `SELECT
        s.id as sale_id,
        s.created_at,
        s.payment_method,
        s.observation as sale_observation,
        si.product_name,
        si.quantity,
        si.unit_price,
        si.modifiers
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.id
       ${whereClause}
       ORDER BY s.created_at DESC`,
      params
    );

    res.json({
      success: true,
      data: results.map((r) => ({
        saleId: r.sale_id,
        date: r.created_at,
        paymentMethod: r.payment_method,
        observation: r.sale_observation,
        productName: r.product_name,
        quantity: parseFloat(r.quantity),
        unitPrice: parseFloat(r.unit_price),
        total: parseFloat(r.quantity) * parseFloat(r.unit_price),
        modifiers: r.modifiers,
      })),
    });
  } catch (error) {
    console.error('Error obteniendo ventas detalladas:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo ventas detalladas',
    });
  }
}

/**
 * GET /api/reports/low-rotation
 * Productos con baja rotación
 */
async function getLowRotationProducts(req, res) {
  try {
    const { limit = 10, start_date, end_date } = req.query;
    let dateFilter = '';
    const params = [];

    if (start_date && end_date) {
      dateFilter = 'AND s.created_at BETWEEN ? AND ?';
      params.push(new Date(start_date), new Date(end_date));
    }

    params.push(parseInt(limit));

    const results = await query(
      `SELECT
        p.id,
        p.name,
        COALESCE(SUM(si.quantity), 0) as total_quantity
       FROM products p
       LEFT JOIN sale_items si ON p.id = si.product_id
       LEFT JOIN sales s ON si.sale_id = s.id AND s.status = 'completed' ${dateFilter}
       GROUP BY p.id, p.name
       ORDER BY total_quantity ASC
       LIMIT ?`,
      params
    );

    res.json({
      success: true,
      data: results.map((r) => ({
        id: r.id,
        name: r.name,
        quantity: parseFloat(r.total_quantity),
      })),
    });
  } catch (error) {
    console.error('Error obteniendo productos baja rotación:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo productos baja rotación',
    });
  }
}

/**
 * GET /api/reports/expenses-detailed
 * Gastos detallados
 */
async function getExpensesDetailed(req, res) {
  try {
    const { start_date, end_date, limit = 50, shift_id } = req.query;
    let whereClause = "WHERE type = 'gasto'";
    const params = [];

    if (shift_id) {
        whereClause += ' AND shift_id = ?';
        params.push(shift_id);
    } else if (start_date && end_date) {
      whereClause += ' AND created_at BETWEEN ? AND ?';
      params.push(new Date(start_date), new Date(end_date));
    }

    params.push(parseInt(limit));

    const results = await query(
      `SELECT * FROM movements
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ?`,
      params
    );

    res.json({
      success: true,
      data: results.map((m) => ({
        id: m.id,
        amount: parseFloat(m.amount),
        description: m.description,
        createdAt: m.created_at,
        shiftId: m.shift_id,
      })),
    });
  } catch (error) {
    console.error('Error obteniendo gastos detallados:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo gastos detallados',
    });
  }
}

module.exports = {
  getSalesSummary,
  getSalesByDay,
  getTopProducts,
  getShiftsHistory,
  getShiftDetail,
  getPendingDebts,
  getDetailedSales,
  getLowRotationProducts,
  getExpensesDetailed,
};
