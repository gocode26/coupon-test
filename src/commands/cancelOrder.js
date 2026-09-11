import pool from '../db.js';


export async function cancelOrder(orderId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (rows.length === 0) {
      throw new Error(`Order ${orderId} not found`);
    }
    const order = rows[0];
    if (order.status === 'cancelled') {
      throw new Error(`Order ${orderId} is already cancelled`);
    }

    await client.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [orderId]);


    const { rows: appliedCoupons } = await client.query(
      'SELECT code FROM order_coupons WHERE order_id = $1 ORDER BY code',
      [orderId]
    );
    for (const { code } of appliedCoupons) {
      await client.query('SELECT 1 FROM coupons WHERE code = $1 FOR UPDATE', [code]);
      await client.query('UPDATE coupons SET times_used = times_used - 1 WHERE code = $1', [code]);
    }

    await client.query('COMMIT');
    return `Cancelled order ${orderId}`;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
