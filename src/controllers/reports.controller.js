const { query } = require('../config/database');

/**
 * GET /api/reports/summary
 * Resumen general de ventas por período
 */
async function getSalesSummary(req, res) {
  try {
    const { start_date, end_date, period = 'day' } = req.query;

    let startDate, endDate;

    if (start_date && end_date) {
      startDate = new Date(start_date);
      endDate = new Date(end_date);
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
    }

    // Resumen de ventas
    const salesSummary = await query(
      `SELECT
        COUNT(*) AS total_transactions,
        COALESCE(SUM(CASE WHEN payment_method = 'efectivo' THEN total ELSE 0 END), 0) AS cash_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'transferencia' THEN total ELSE 0 END), 0) AS transfer_sales,
        COALESCE(SUM(total), 0) AS total_sales
       FROM sales
       WHERE status = 'completed'
         AND created_at BETWEEN ? AND ?`,
      [startDate, endDate]
    );

    // Resumen de gastos
    const expensesSummary = await query(
      `SELECT
        COUNT(*) AS total_expenses_count,
        COALESCE(SUM(amount), 0) AS total_expenses
       FROM movements
       WHERE type = 'gasto'
         AND created_at BETWEEN ? AND ?`,
      [startDate, endDate]
    );

    // Deudas pendientes
    const debtsSummary = await query(
      `SELECT
        COUNT(*) AS total_debts,
        COALESCE(SUM(total), 0) AS total_debt_amount
       FROM sales
       WHERE status = 'unpaid_debt'`
    );

    const sales = salesSummary[0];
    const expenses = expensesSummary[0];
    const debts = debtsSummary[0];

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
        netProfit: parseFloat(sales.total_sales) - parseFloat(expenses.total_expenses),
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
          parseFloat(s.initial_cash) + parseFloat(s.total_sales) - parseFloat(s.total_expenses),
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
          expectedCash: parseFloat(shift.initial_cash) + salesCash - totalExpenses,
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

    res.json({
      success: true,
      data: debts.map((d) => ({
        id: d.id,
        total: parseFloat(d.total),
        observation: d.observation,
        authorizedBy: d.authorized_by_name,
        shiftOpenedBy: d.shift_opened_by,
        createdAt: d.created_at,
      })),
    });
  } catch (error) {
    console.error('Error obteniendo deudas:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo deudas',
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
};
