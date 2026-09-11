import pool from '../db.js';

const VALID_TYPES = ['percent', 'flat'];

/**
 * Create a new coupon.
 * @param {string} code
 * @param {'percent'|'flat'} discountType
 * @param {number} discountValue
 * @param {number} minSpend
 * @param {string} expiresAt - ISO date string
 * @param {number} usageLimit
 * @param {number|null} [maxDiscountAmount] - bonus 1: cap on computed discount for percent coupons
 * @param {number|null} [usageLimitPerUser] - bonus 2: per-user redemption cap
 * @returns {Promise<string>} a result message
 * @throws {Error} on invalid input or duplicate code
 */
export async function createCoupon(
  code,
  discountType,
  discountValue,
  minSpend,
  expiresAt,
  usageLimit,
  maxDiscountAmount = null,
  usageLimitPerUser = null
) {
  if (!code || typeof code !== 'string') {
    throw new Error('code is required and must be a string');
  }
  if (!VALID_TYPES.includes(discountType)) {
    throw new Error(`discountType must be one of: ${VALID_TYPES.join(', ')}`);
  }
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    throw new Error('discountValue must be a number greater than 0');
  }
  if (!Number.isFinite(minSpend) || minSpend < 0) {
    throw new Error('minSpend must be a number of 0 or greater');
  }
  const expiresAtDate = new Date(expiresAt);
  if (Number.isNaN(expiresAtDate.getTime())) {
    throw new Error('expiresAt must be a valid ISO date string');
  }
  if (!Number.isInteger(usageLimit) || usageLimit <= 0) {
    throw new Error('usageLimit must be a positive integer');
  }
  if (maxDiscountAmount != null && (!Number.isFinite(maxDiscountAmount) || maxDiscountAmount <= 0)) {
    throw new Error('maxDiscountAmount must be a number greater than 0 when provided');
  }
  if (usageLimitPerUser != null && (!Number.isInteger(usageLimitPerUser) || usageLimitPerUser <= 0)) {
    throw new Error('usageLimitPerUser must be a positive integer when provided');
  }

  try {
    await pool.query(
      `INSERT INTO coupons
         (code, discount_type, discount_value, min_spend, expires_at, usage_limit,
          max_discount_amount, usage_limit_per_user)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        code,
        discountType,
        discountValue,
        minSpend,
        expiresAtDate.toISOString(),
        usageLimit,
        maxDiscountAmount,
        usageLimitPerUser,
      ]
    );
  } catch (err) {
    if (err.code === '23505') {
      // unique_violation on coupons.code
      throw new Error(`Coupon ${code} already exists`);
    }
    throw err;
  }

  return `Created coupon ${code}`;
}
