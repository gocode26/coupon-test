import pool from '../db.js';

/**
 * Look up a coupon's current state.
 * @param {string} code
 * @returns {Promise<{code: string, discountType: string, discountValue: number,
 *   minSpend: number, expiresAt: string, usageLimit: number, timesUsed: number,
 *   maxDiscountAmount: number|null, usageLimitPerUser: number|null}>}
 * @throws {Error} if the coupon doesn't exist
 */
export async function getCoupon(code) {
  const { rows } = await pool.query(
    `SELECT code, discount_type, discount_value, min_spend, expires_at,
            usage_limit, times_used, max_discount_amount, usage_limit_per_user
     FROM coupons
     WHERE code = $1`,
    [code]
  );

  if (rows.length === 0) {
    throw new Error(`Coupon ${code} not found`);
  }

  const c = rows[0];
  return {
    code: c.code,
    discountType: c.discount_type,
    discountValue: Number(c.discount_value),
    minSpend: Number(c.min_spend),
    expiresAt: c.expires_at,
    usageLimit: c.usage_limit,
    timesUsed: c.times_used,
    maxDiscountAmount: c.max_discount_amount != null ? Number(c.max_discount_amount) : null,
    usageLimitPerUser: c.usage_limit_per_user,
  };
}
