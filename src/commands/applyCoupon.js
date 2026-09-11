import pool from '../db.js';
import { roundCurrency } from '../util/money.js';


export async function applyCoupon(cartTotal, code, userId = null) {
  if (!Number.isFinite(cartTotal) || cartTotal < 0) {
    throw new Error('cartTotal must be a number of 0 or greater');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    
    const { rows } = await client.query('SELECT * FROM coupons WHERE code = $1 FOR UPDATE', [code]);
    if (rows.length === 0) {
      throw new Error(`Coupon ${code} not found`);
    }
    const coupon = rows[0];

    if (new Date(coupon.expires_at).getTime() < Date.now()) {
      throw new Error(`Coupon ${code} has expired`);
    }
    if (cartTotal < Number(coupon.min_spend)) {
      throw new Error(`Cart total ${cartTotal} is below the minimum spend of ${coupon.min_spend} for coupon ${code}`);
    }
    if (coupon.times_used >= coupon.usage_limit) {
      throw new Error(`Coupon ${code} has reached its usage limit`);
    }
    if (coupon.usage_limit_per_user != null) {
      if (!userId) {
        throw new Error(`Coupon ${code} requires a userId (it has a per-user usage limit)`);
      }
      const { rows: userRows } = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM orders o
         JOIN order_coupons oc ON oc.order_id = o.id
         WHERE oc.code = $1 AND o.user_id = $2 AND o.status != 'cancelled'`,
        [code, userId]
      );
      if (userRows[0].count >= coupon.usage_limit_per_user) {
        throw new Error(`User ${userId} has already reached their usage limit for coupon ${code}`);
      }
    }

    let discount;
    if (coupon.discount_type === 'percent') {
      discount = cartTotal * (Number(coupon.discount_value) / 100);
      if (coupon.max_discount_amount != null) {
        discount = Math.min(discount, Number(coupon.max_discount_amount));
      }
    } else {
      discount = Number(coupon.discount_value);
    }
 
    discount = roundCurrency(Math.min(discount, cartTotal));
    const finalTotal = roundCurrency(cartTotal - discount);

    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (cart_total, coupon_code, discount_amount, final_total, status, user_id)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING id`,
      [cartTotal, code, discount, finalTotal, userId]
    );
    const orderId = orderRows[0].id;

    await client.query(
      'INSERT INTO order_coupons (order_id, code, discount_amount) VALUES ($1, $2, $3)',
      [orderId, code, discount]
    );
    await client.query('UPDATE coupons SET times_used = times_used + 1 WHERE code = $1', [code]);

    await client.query('COMMIT');
    return { orderId, discountAmount: discount, finalTotal };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
