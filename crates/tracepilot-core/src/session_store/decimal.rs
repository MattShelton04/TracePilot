//! Exact arithmetic for recorded billing values.
//!
//! The Copilot session store records a request charge in nano AI units and,
//! separately, the billing entries that composed it. Reproducing the charge
//! from those entries is `tokenCount * costPerBatch / batchSize`, summed — a
//! calculation that goes wrong in binary floating point for exactly the large
//! integers this feature exists to explain.
//!
//! So the item arithmetic runs over [`Rational`] (an `i128` fraction kept in
//! lowest terms) and only becomes an [`ExactDecimal`] at the edges, where a
//! value is stored or displayed. Both types are checked: overflow returns
//! `None` rather than wrapping, because a wrapped charge is worse than a
//! missing one.

use std::fmt;

use serde::de::{Error as DeError, Unexpected};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Largest fractional scale a decimal keeps. Nano units are already 1e-9 of a
/// credit, so nine more digits is well past anything the source records.
pub const MAX_SCALE: u32 = 18;

/// A decimal number as `mantissa * 10^-scale`, exact within `i128`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExactDecimal {
    mantissa: i128,
    scale: u32,
}

impl ExactDecimal {
    pub const ZERO: Self = Self {
        mantissa: 0,
        scale: 0,
    };

    pub fn from_i64(value: i64) -> Self {
        Self {
            mantissa: i128::from(value),
            scale: 0,
        }
    }

    /// Build from a mantissa and scale, normalising trailing zeros away so
    /// that equality is value equality rather than representation equality.
    pub fn new(mantissa: i128, scale: u32) -> Option<Self> {
        if scale > MAX_SCALE {
            return None;
        }
        Some(Self { mantissa, scale }.normalized())
    }

    fn normalized(self) -> Self {
        let mut mantissa = self.mantissa;
        let mut scale = self.scale;
        if mantissa == 0 {
            return Self::ZERO;
        }
        while scale > 0 && mantissa % 10 == 0 {
            mantissa /= 10;
            scale -= 1;
        }
        Self { mantissa, scale }
    }

    /// Parse a plain decimal string. Exponent notation is rejected: the source
    /// never writes it, and accepting it would hide a value we did not expect.
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim();
        if text.is_empty() {
            return None;
        }
        let first = *text.as_bytes().first()?;
        let (negative, digits) = match first {
            b'-' => (true, &text[1..]),
            b'+' => (false, &text[1..]),
            _ => (false, text),
        };
        let (int_part, frac_part) = match digits.split_once('.') {
            Some((int_part, frac_part)) => (int_part, frac_part),
            None => (digits, ""),
        };
        if int_part.is_empty() && frac_part.is_empty() {
            return None;
        }
        if !int_part.bytes().all(|b| b.is_ascii_digit())
            || !frac_part.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        let scale = u32::try_from(frac_part.len()).ok()?;
        if scale > MAX_SCALE {
            return None;
        }
        let mut mantissa: i128 = 0;
        for byte in int_part.bytes().chain(frac_part.bytes()) {
            mantissa = mantissa.checked_mul(10)?;
            mantissa = mantissa.checked_add(i128::from(byte - b'0'))?;
        }
        if negative {
            mantissa = mantissa.checked_neg()?;
        }
        Self::new(mantissa, scale)
    }

    /// Convert a SQLite `REAL` cell. Rust's shortest round-trip formatting is
    /// what makes this trustworthy: it reproduces the literal the writer most
    /// plausibly meant rather than the full binary expansion.
    pub fn from_f64(value: f64) -> Option<Self> {
        if !value.is_finite() {
            return None;
        }
        Self::parse(&format!("{value}"))
            .or_else(|| Self::parse(&format!("{value:.*}", MAX_SCALE as usize)))
    }

    pub fn is_zero(self) -> bool {
        self.mantissa == 0
    }

    pub fn is_negative(self) -> bool {
        self.mantissa < 0
    }

    pub fn scale(self) -> u32 {
        self.scale
    }

    pub fn mantissa(self) -> i128 {
        self.mantissa
    }

    pub fn checked_add(self, other: Self) -> Option<Self> {
        let (left, right, scale) = align(self, other)?;
        Self::new(left.checked_add(right)?, scale)
    }

    /// Divide by a power of ten — the nano-AIU to credits conversion.
    pub fn checked_div_pow10(self, exponent: u32) -> Option<Self> {
        Self::new(self.mantissa, self.scale.checked_add(exponent)?)
    }

    pub fn to_f64(self) -> f64 {
        self.mantissa as f64 / 10f64.powi(self.scale as i32)
    }

    pub fn to_rational(self) -> Option<Rational> {
        Rational::new(self.mantissa, pow10(self.scale)?)
    }
}

fn align(left: ExactDecimal, right: ExactDecimal) -> Option<(i128, i128, u32)> {
    let scale = left.scale.max(right.scale);
    let left_value = left.mantissa.checked_mul(pow10(scale - left.scale)?)?;
    let right_value = right.mantissa.checked_mul(pow10(scale - right.scale)?)?;
    Some((left_value, right_value, scale))
}

fn pow10(exponent: u32) -> Option<i128> {
    if exponent > 38 {
        return None;
    }
    10i128.checked_pow(exponent)
}

impl fmt::Display for ExactDecimal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.scale == 0 {
            return write!(f, "{}", self.mantissa);
        }
        let negative = self.mantissa < 0;
        let digits = self.mantissa.unsigned_abs().to_string();
        let scale = self.scale as usize;
        let (int_part, frac_part) = if digits.len() > scale {
            let split = digits.len() - scale;
            (digits[..split].to_string(), digits[split..].to_string())
        } else {
            ("0".to_string(), format!("{digits:0>scale$}"))
        };
        if negative {
            f.write_str("-")?;
        }
        write!(f, "{int_part}.{frac_part}")
    }
}

/// Decimals travel as strings, never as JSON numbers.
///
/// A nano-AIU total is routinely larger than `Number.MAX_SAFE_INTEGER`, and a
/// rate is routinely a value binary floating point cannot hold. Serialising as
/// a number would corrupt both on the way to the UI, which then has to display
/// the exact figure this feature exists to explain.
impl Serialize for ExactDecimal {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for ExactDecimal {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        Self::parse(&text)
            .ok_or_else(|| D::Error::invalid_value(Unexpected::Str(&text), &"a plain decimal"))
    }
}

/// An `i128` fraction kept in lowest terms with a positive denominator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rational {
    numerator: i128,
    denominator: i128,
}

impl Rational {
    pub const ZERO: Self = Self {
        numerator: 0,
        denominator: 1,
    };

    pub fn new(numerator: i128, denominator: i128) -> Option<Self> {
        if denominator == 0 {
            return None;
        }
        let (numerator, denominator) = if denominator < 0 {
            (numerator.checked_neg()?, denominator.checked_neg()?)
        } else {
            (numerator, denominator)
        };
        let divisor = gcd(numerator.unsigned_abs(), denominator.unsigned_abs());
        let divisor = i128::try_from(divisor.max(1)).ok()?;
        Some(Self {
            numerator: numerator / divisor,
            denominator: denominator / divisor,
        })
    }

    pub fn from_i128(value: i128) -> Self {
        Self {
            numerator: value,
            denominator: 1,
        }
    }

    pub fn is_zero(self) -> bool {
        self.numerator == 0
    }

    pub fn is_negative(self) -> bool {
        self.numerator < 0
    }

    pub fn checked_add(self, other: Self) -> Option<Self> {
        let left = self.numerator.checked_mul(other.denominator)?;
        let right = other.numerator.checked_mul(self.denominator)?;
        Self::new(
            left.checked_add(right)?,
            self.denominator.checked_mul(other.denominator)?,
        )
    }

    pub fn checked_mul(self, other: Self) -> Option<Self> {
        // Cross-reduce before multiplying: the token-count x cost-per-batch
        // product overflows `i128` far sooner without it.
        let left = Self::new(self.numerator, other.denominator)?;
        let right = Self::new(other.numerator, self.denominator)?;
        Self::new(
            left.numerator.checked_mul(right.numerator)?,
            left.denominator.checked_mul(right.denominator)?,
        )
    }

    pub fn checked_div(self, other: Self) -> Option<Self> {
        if other.numerator == 0 {
            return None;
        }
        self.checked_mul(Self {
            numerator: other.denominator,
            denominator: other.numerator,
        })
    }

    pub fn to_f64(self) -> f64 {
        self.numerator as f64 / self.denominator as f64
    }

    /// Exact decimal form, or `None` when the denominator has a prime factor
    /// other than 2 and 5 (or the result needs more than [`MAX_SCALE`] digits).
    /// Callers that must show something anyway use [`Self::to_decimal_rounded`].
    pub fn to_exact_decimal(self) -> Option<ExactDecimal> {
        let mut denominator = self.denominator;
        let mut twos = 0u32;
        while denominator % 2 == 0 && twos <= MAX_SCALE {
            denominator /= 2;
            twos += 1;
        }
        let mut fives = 0u32;
        while denominator % 5 == 0 && fives <= MAX_SCALE {
            denominator /= 5;
            fives += 1;
        }
        if denominator != 1 {
            return None;
        }
        let scale = twos.max(fives);
        if scale > MAX_SCALE {
            return None;
        }
        let factor = pow10(scale)?;
        let mantissa = self.numerator.checked_mul(factor / self.denominator)?;
        ExactDecimal::new(mantissa, scale)
    }

    /// Half-away-from-zero rounding to `scale` fractional digits. Used only to
    /// display a value that is genuinely not a finite decimal.
    pub fn to_decimal_rounded(self, scale: u32) -> Option<ExactDecimal> {
        let scale = scale.min(MAX_SCALE);
        let factor = pow10(scale)?;
        let scaled = self.numerator.checked_mul(factor)?;
        let quotient = scaled / self.denominator;
        let remainder = scaled % self.denominator;
        let rounded = if remainder.unsigned_abs() * 2 >= self.denominator.unsigned_abs() {
            quotient.checked_add(if self.numerator < 0 { -1 } else { 1 })?
        } else {
            quotient
        };
        ExactDecimal::new(rounded, scale)
    }
}

fn gcd(mut left: u128, mut right: u128) -> u128 {
    while right != 0 {
        let next = left % right;
        left = right;
        right = next;
    }
    left
}
