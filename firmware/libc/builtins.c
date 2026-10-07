#include <stdint.h>

/* Compiler support routines. RV32IM divides 32-bit numbers in hardware, but
   64-bit division is a library call, and DOOM's FixedDiv makes one for every
   wall column it scales. */

static int clz32(uint32_t x)
{
    int n = 0;

    if (!(x & 0xffff0000u)) n += 16, x <<= 16;
    if (!(x & 0xff000000u)) n += 8, x <<= 8;
    if (!(x & 0xf0000000u)) n += 4, x <<= 4;
    if (!(x & 0xc0000000u)) n += 2, x <<= 2;
    if (!(x & 0x80000000u)) n += 1;
    return n;
}

/* (u1:u0) / v for u1 < v, with two hardware divisions (Hacker's Delight,
   divlu): normalize v, then find the quotient one 16-bit digit at a time. */
static uint32_t divlu(uint32_t u1, uint32_t u0, uint32_t v, uint32_t *r)
{
    const uint32_t b = 65536;
    int s = clz32(v);
    uint32_t vn1, vn0, un32, un10, un1, un0, q1, q0, un21, rhat;

    v <<= s;
    vn1 = v >> 16;
    vn0 = v & 0xffff;
    un32 = s ? (u1 << s) | (u0 >> (32 - s)) : u1;
    un10 = u0 << s;
    un1 = un10 >> 16;
    un0 = un10 & 0xffff;

    q1 = un32 / vn1;
    rhat = un32 - q1 * vn1;
    while (q1 >= b || q1 * vn0 > b * rhat + un1) {
        q1--;
        rhat += vn1;
        if (rhat >= b) break;
    }
    un21 = un32 * b + un1 - q1 * v;

    q0 = un21 / vn1;
    rhat = un21 - q0 * vn1;
    while (q0 >= b || q0 * vn0 > b * rhat + un0) {
        q0--;
        rhat += vn1;
        if (rhat >= b) break;
    }
    *r = (un21 * b + un0 - q0 * v) >> s;
    return q1 * b + q0;
}

static uint64_t udivmod(uint64_t n, uint64_t d, uint64_t *rem)
{
    uint32_t nh = (uint32_t)(n >> 32), nl = (uint32_t)n, r;

    if (!(d >> 32)) {
        uint32_t dl = (uint32_t)d, qh = 0, ql;
        if (!dl) {
            /* Like the hardware: x / 0 is all ones, x % 0 is x. */
            *rem = n;
            return UINT64_MAX;
        }
        if (nh >= dl) {
            qh = nh / dl;
            nh -= qh * dl;
        }
        ql = divlu(nh, nl, dl, &r);
        *rem = r;
        return ((uint64_t)qh << 32) | ql;
    }

    /* Divisor of 33 bits or more: the quotient fits in 32 bits. */
    {
        uint64_t q = 0, rr = 0;
        for (int i = 63; i >= 0; i--) {
            rr = (rr << 1) | ((n >> i) & 1);
            if (rr >= d) {
                rr -= d;
                q |= 1ull << i;
            }
        }
        *rem = rr;
        return q;
    }
}

uint64_t __udivdi3(uint64_t n, uint64_t d)
{
    uint64_t r;

    return udivmod(n, d, &r);
}

uint64_t __umoddi3(uint64_t n, uint64_t d)
{
    uint64_t r;

    udivmod(n, d, &r);
    return r;
}

int64_t __divdi3(int64_t a, int64_t b)
{
    uint64_t r, q = udivmod(a < 0 ? 0 - (uint64_t)a : (uint64_t)a,
                            b < 0 ? 0 - (uint64_t)b : (uint64_t)b, &r);

    return (a < 0) != (b < 0) ? (int64_t)(0 - q) : (int64_t)q;
}

int64_t __moddi3(int64_t a, int64_t b)
{
    uint64_t r;

    udivmod(a < 0 ? 0 - (uint64_t)a : (uint64_t)a, b < 0 ? 0 - (uint64_t)b : (uint64_t)b, &r);
    return a < 0 ? (int64_t)(0 - r) : (int64_t)r;
}
