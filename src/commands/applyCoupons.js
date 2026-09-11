import pool from '../db.js';
import { roundCurrency } from '../util/money.js';

export async function applyCoupons(cartTotal, codes, userId = null) {
  if (!Array.isArray(codes) || codes.length < 1 || codes.length > 2) {
    throw new Error('codes must be an array of 1 or 2 coupon codes');
  }
  if (new Set(codes).size !== codes.length) {
    throw new Error('the same coupon code was passed twice');
  }
  if (!Number.isFinite(cartTotal) || cartTotal < 0) {
    throw new Error('cartTotal must be a number of 0 or greater');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sortedCodes = [...codes].sort();
    const couponsByCode = new Map();
    for (const code of sortedCodes) {
      const { rows } = await client.query('SELECT * FROM coupons WHERE code = $1 FOR UPDATE', [code]);
      if (rows.length === 0) {
        throw new Error(`Coupon ${code} not found`);
      }
      couponsByCode.set(code, rows[0]);
    }
    const coupons = codes.map((c) => couponsByCode.get(c));

    if (coupons.length === 2 && coupons[0].discount_type === coupons[1].discount_type) {
      throw new Error('cannot stack two coupons of the same discount_type');
    }

    for (const coupon of coupons) {
      if (new Date(coupon.expires_at).getTime() < Date.now()) {
        throw new Error(`Coupon ${coupon.code} has expired`);
      }
      if (cartTotal < Number(coupon.min_spend)) {
        throw new Error(
          `Cart total ${cartTotal} is below the minimum spend of ${coupon.min_spend} for coupon ${coupon.code}`
        );
      }
      if (coupon.times_used >= coupon.usage_limit) {
        throw new Error(`Coupon ${coupon.code} has reached its usage limit`);
      }
      if (coupon.usage_limit_per_user != null) {
        if (!userId) {
          throw new Error(`Coupon ${coupon.code} requires a userId (it has a per-user usage limit)`);
        }
        const { rows: userRows } = await client.query(
          `SELECT COUNT(*)::int AS count
           FROM orders o
           JOIN order_coupons oc ON oc.order_id = o.id
           WHERE oc.code = $1 AND o.user_id = $2 AND o.status != 'cancelled'`,
          [coupon.code, userId]
        );
        if (userRows[0].count >= coupon.usage_limit_per_user) {
          throw new Error(`User ${userId} has already reached their usage limit for coupon ${coupon.code}`);
        }
      }
    }

    const percentCoupon = coupons.find((c) => c.discount_type === 'percent');
    const flatCoupon = coupons.find((c) => c.discount_type === 'flat');
    const discounts = new Map(); // code -> discount amount
    let remaining = cartTotal;

    if (percentCoupon) {
      let d = remaining * (Number(percentCoupon.discount_value) / 100);
      if (percentCoupon.max_discount_amount != null) {
        d = Math.min(d, Number(percentCoupon.max_discount_amount));
      }
      d = roundCurrency(Math.min(d, remaining));
      discounts.set(percentCoupon.code, d);
      remaining = roundCurrency(remaining - d);
    }
    if (flatCoupon) {
      const d = roundCurrency(Math.min(Number(flatCoupon.discount_value), remaining));
      discounts.set(flatCoupon.code, d);
      remaining = roundCurrency(remaining - d);
    }

    const totalDiscount = roundCurrency([...discounts.values()].reduce((a, b) => a + b, 0));
    const finalTotal = Math.max(0, roundCurrency(cartTotal - totalDiscount));

    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (cart_total, coupon_code, discount_amount, final_total, status, user_id)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING id`,
      [cartTotal, null, totalDiscount, finalTotal, userId]
    );
    const orderId = orderRows[0].id;

    for (const coupon of coupons) {
      await client.query(
        'INSERT INTO order_coupons (order_id, code, discount_amount) VALUES ($1, $2, $3)',
        [orderId, coupon.code, discounts.get(coupon.code)]
      );
      await client.query('UPDATE coupons SET times_used = times_used + 1 WHERE code = $1', [coupon.code]);
    }

    await client.query('COMMIT');
    return {
      orderId,
      discountAmount: totalDiscount,
      finalTotal,
      appliedCodes: coupons.map((c) => c.code),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
