#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* printf and scanf, as much of them as DOOM uses: integers in every base and
   size, strings, characters, pointers, %f, flags, width and precision. */

typedef struct {
    char *buf;    /* NULL: write to `file` */
    size_t size;  /* capacity of buf, terminator included */
    size_t count; /* characters produced so far */
    FILE *file;
} sink_t;

static void emit(sink_t *s, char c)
{
    if (s->buf) {
        if (s->count + 1 < s->size) s->buf[s->count] = c;
    } else {
        fputc(c, s->file);
    }
    s->count++;
}

static void emit_padding(sink_t *s, char c, int n)
{
    while (n-- > 0) emit(s, c);
}

enum { LEFT = 1, PLUS = 2, SPACE = 4, ALT = 8, ZERO = 16 };

/* One converted field: sign/prefix, zeros, digits, then padding. */
static void emit_field(sink_t *s, const char *prefix, const char *digits, int ndigits,
                       int precision, int width, int flags)
{
    int nprefix = (int)strlen(prefix);
    int zeros = precision > ndigits ? precision - ndigits : 0;
    int pad = width - nprefix - zeros - ndigits;

    if ((flags & ZERO) && !(flags & LEFT) && precision < 0) {
        zeros += pad > 0 ? pad : 0;
        pad = 0;
    }
    if (!(flags & LEFT)) emit_padding(s, ' ', pad);
    while (*prefix) emit(s, *prefix++);
    emit_padding(s, '0', zeros);
    for (int i = 0; i < ndigits; i++) emit(s, digits[i]);
    if (flags & LEFT) emit_padding(s, ' ', pad);
}

static int utoa(char *out, uint64_t value, unsigned base, int upper)
{
    const char *set = upper ? "0123456789ABCDEF" : "0123456789abcdef";
    char tmp[24];
    int n = 0;

    do {
        tmp[n++] = set[value % base];
        value /= base;
    } while (value);
    for (int i = 0; i < n; i++) out[i] = tmp[n - 1 - i];
    return n;
}

/* %f without floating-point instructions (the CPU has none): split the
   double into its integer mantissa and binary exponent and do the decimal
   conversion in 64-bit integers. Exact for the values a config file holds. */
static int ftoa(char *out, double value, int precision, int *negative)
{
    union {
        double d;
        uint64_t u;
    } bits = {value};
    int exponent = (int)((bits.u >> 52) & 0x7ff);
    uint64_t mantissa = bits.u & ((1ull << 52) - 1);
    uint64_t whole, frac, one;
    int shift, fbits = 0, n;
    char fraction[9];

    *negative = (int)(bits.u >> 63);
    if (exponent == 0x7ff) {
        memcpy(out, mantissa ? "nan" : "inf", 3);
        return 3;
    }
    if (exponent) mantissa |= 1ull << 52;
    else exponent = 1;
    shift = exponent - 1075; /* value = mantissa * 2^shift */
    if (precision > 9) precision = 9;

    if (shift >= 0) {
        whole = shift < 11 ? mantissa << shift : UINT64_MAX;
        frac = 0;
    } else {
        /* At most 54 fractional bits, so frac * 10 cannot overflow. */
        int drop = -shift > 54 ? -shift - 54 : 0;
        fbits = -shift - drop;
        mantissa = drop >= 64 ? 0 : mantissa >> drop;
        whole = fbits >= 64 ? 0 : mantissa >> fbits;
        frac = mantissa & ((1ull << fbits) - 1);
    }
    one = 1ull << fbits;

    for (int i = 0; i < precision; i++) {
        frac *= 10;
        fraction[i] = (char)('0' + (frac >> fbits));
        frac &= one - 1;
    }
    if (frac * 2 >= one && frac) {
        int i = precision - 1;
        for (; i >= 0 && fraction[i] == '9'; i--) fraction[i] = '0';
        if (i >= 0) fraction[i]++;
        else whole++;
    }

    n = utoa(out, whole, 10, 0);
    if (precision > 0) {
        out[n++] = '.';
        memcpy(out + n, fraction, (size_t)precision);
        n += precision;
    }
    return n;
}

static int format(sink_t *s, const char *fmt, va_list args)
{
    for (; *fmt; fmt++) {
        int flags = 0, width = 0, precision = -1, size = 0;
        char digits[40];
        char prefix[3] = {0};
        int n;

        if (*fmt != '%') {
            emit(s, *fmt);
            continue;
        }
        for (;; fmt++) {
            int c = fmt[1];
            if (c == '-') flags |= LEFT;
            else if (c == '+') flags |= PLUS;
            else if (c == ' ') flags |= SPACE;
            else if (c == '#') flags |= ALT;
            else if (c == '0') flags |= ZERO;
            else break;
        }
        fmt++;
        if (*fmt == '*') {
            width = va_arg(args, int);
            if (width < 0) {
                flags |= LEFT;
                width = -width;
            }
            fmt++;
        } else {
            while (isdigit((unsigned char)*fmt)) width = width * 10 + *fmt++ - '0';
        }
        if (*fmt == '.') {
            fmt++;
            precision = 0;
            if (*fmt == '*') {
                precision = va_arg(args, int);
                fmt++;
            } else {
                while (isdigit((unsigned char)*fmt)) precision = precision * 10 + *fmt++ - '0';
            }
        }
        /* size: -2 hh, -1 h, 0 int, 1 long, 2 long long */
        for (;; fmt++) {
            if (*fmt == 'h') size--;
            else if (*fmt == 'l') size++;
            else if (*fmt == 'z' || *fmt == 't' || *fmt == 'j') size = *fmt == 'j' ? 2 : 1;
            else break;
        }

        switch (*fmt) {
        case 'd':
        case 'i': {
            int64_t v = size >= 2 ? va_arg(args, long long) : size == 1 ? va_arg(args, long) : va_arg(args, int);
            uint64_t mag;
            if (size == -1) v = (short)v;
            if (size <= -2) v = (signed char)v;
            mag = v < 0 ? 0 - (uint64_t)v : (uint64_t)v;
            prefix[0] = v < 0 ? '-' : (flags & PLUS) ? '+' : (flags & SPACE) ? ' ' : 0;
            n = precision == 0 && !mag ? 0 : utoa(digits, mag, 10, 0);
            emit_field(s, prefix, digits, n, precision, width, flags);
            break;
        }
        case 'u':
        case 'x':
        case 'X':
        case 'o':
        case 'p': {
            uint64_t v;
            unsigned base = *fmt == 'u' ? 10 : *fmt == 'o' ? 8 : 16;
            if (*fmt == 'p') {
                v = (uintptr_t)va_arg(args, void *);
                flags |= ALT;
            } else {
                v = size >= 2 ? va_arg(args, unsigned long long) : size == 1 ? va_arg(args, unsigned long) : va_arg(args, unsigned);
                if (size == -1) v = (unsigned short)v;
                if (size <= -2) v = (unsigned char)v;
            }
            n = precision == 0 && !v ? 0 : utoa(digits, v, base, *fmt == 'X');
            if ((flags & ALT) && v) {
                if (base == 16) {
                    prefix[0] = '0';
                    prefix[1] = *fmt == 'X' ? 'X' : 'x';
                } else if (base == 8 && digits[0] != '0') {
                    prefix[0] = '0';
                }
            }
            emit_field(s, prefix, digits, n, precision, width, flags);
            break;
        }
        case 'f':
        case 'F':
        case 'g':
        case 'e': {
            int negative;
            n = ftoa(digits, va_arg(args, double), precision < 0 ? 6 : precision, &negative);
            prefix[0] = negative ? '-' : (flags & PLUS) ? '+' : (flags & SPACE) ? ' ' : 0;
            emit_field(s, prefix, digits, n, -1, width, flags);
            break;
        }
        case 'c':
            digits[0] = (char)va_arg(args, int);
            emit_field(s, "", digits, 1, -1, width, flags & LEFT);
            break;
        case 's': {
            const char *str = va_arg(args, const char *);
            if (!str) str = "(null)";
            n = precision >= 0 ? (int)strnlen(str, (size_t)precision) : (int)strlen(str);
            if (!(flags & LEFT)) emit_padding(s, ' ', width - n);
            for (int i = 0; i < n; i++) emit(s, str[i]);
            if (flags & LEFT) emit_padding(s, ' ', width - n);
            break;
        }
        case 'n':
            *va_arg(args, int *) = (int)s->count;
            break;
        case '%':
            emit(s, '%');
            break;
        default:
            if (!*fmt) return (int)s->count;
            emit(s, '%');
            emit(s, *fmt);
            break;
        }
    }
    return (int)s->count;
}

int vsnprintf(char *restrict buf, size_t size, const char *restrict fmt, va_list args)
{
    sink_t s = {buf ? buf : (char *)"", buf ? size : 0, 0, NULL};
    int n = format(&s, fmt, args);

    if (buf && size) buf[s.count < size ? s.count : size - 1] = 0;
    return n;
}

int vsprintf(char *restrict buf, const char *restrict fmt, va_list args)
{
    return vsnprintf(buf, SIZE_MAX, fmt, args);
}

int vfprintf(FILE *restrict f, const char *restrict fmt, va_list args)
{
    sink_t s = {NULL, 0, 0, f};

    return format(&s, fmt, args);
}

int vprintf(const char *restrict fmt, va_list args)
{
    return vfprintf(stdout, fmt, args);
}

int snprintf(char *restrict buf, size_t size, const char *restrict fmt, ...)
{
    va_list args;
    int n;

    va_start(args, fmt);
    n = vsnprintf(buf, size, fmt, args);
    va_end(args);
    return n;
}

int sprintf(char *restrict buf, const char *restrict fmt, ...)
{
    va_list args;
    int n;

    va_start(args, fmt);
    n = vsprintf(buf, fmt, args);
    va_end(args);
    return n;
}

int fprintf(FILE *restrict f, const char *restrict fmt, ...)
{
    va_list args;
    int n;

    va_start(args, fmt);
    n = vfprintf(f, fmt, args);
    va_end(args);
    return n;
}

int printf(const char *restrict fmt, ...)
{
    va_list args;
    int n;

    va_start(args, fmt);
    n = vfprintf(stdout, fmt, args);
    va_end(args);
    return n;
}

/* Scanning, over [s, end). *consumed reports how far it read. */
int kitchen_vsscanf_bounded(const char *s, const char *end, const char *fmt, va_list args,
                            size_t *consumed)
{
    const char *start = s;
    int assigned = 0;

#define PEEK() (s < end ? (unsigned char)*s : 0)

    for (; *fmt; fmt++) {
        int suppress = 0, width = 0, size = 0;

        if (isspace((unsigned char)*fmt)) {
            while (isspace(PEEK())) s++;
            continue;
        }
        if (*fmt != '%' || fmt[1] == '%') {
            if (*fmt == '%') fmt++;
            if (PEEK() != (unsigned char)*fmt) break;
            s++;
            continue;
        }
        fmt++;
        if (*fmt == '*') {
            suppress = 1;
            fmt++;
        }
        while (isdigit((unsigned char)*fmt)) width = width * 10 + *fmt++ - '0';
        for (;; fmt++) {
            if (*fmt == 'h') size--;
            else if (*fmt == 'l') size++;
            else break;
        }
        if (!width) width = 0x7fffffff;

        if (*fmt == 'n') {
            if (!suppress) *va_arg(args, int *) = (int)(s - start);
            continue;
        }
        if (*fmt != 'c' && *fmt != '[')
            while (isspace(PEEK())) s++;
        if (!PEEK()) {
            if (!assigned) assigned = EOF;
            break;
        }

        switch (*fmt) {
        case 'd':
        case 'i':
        case 'u':
        case 'x':
        case 'X':
        case 'o': {
            int base = *fmt == 'x' || *fmt == 'X' ? 16 : *fmt == 'o' ? 8 : *fmt == 'i' ? 0 : 10;
            int negative = 0, any = 0;
            unsigned long long v = 0;
            if ((PEEK() == '-' || PEEK() == '+') && width > 1) {
                negative = *s++ == '-';
                width--;
            }
            if ((base == 0 || base == 16) && PEEK() == '0' && width > 2 && s + 1 < end &&
                (s[1] | 32) == 'x') {
                s += 2;
                width -= 2;
                base = 16;
            } else if (base == 0) {
                base = PEEK() == '0' ? 8 : 10;
            }
            for (; width > 0; width--, s++, any = 1) {
                int c = PEEK(), d;
                if (isdigit(c)) d = c - '0';
                else if (isalpha(c)) d = (c | 32) - 'a' + 10;
                else break;
                if (d >= base) break;
                v = v * (unsigned)base + (unsigned)d;
            }
            if (!any) goto done;
            if (negative) v = 0 - v;
            if (!suppress) {
                if (size >= 2) *va_arg(args, long long *) = (long long)v;
                else if (size == 1) *va_arg(args, long *) = (long)v;
                else if (size == -1) *va_arg(args, short *) = (short)v;
                else if (size <= -2) *va_arg(args, char *) = (char)v;
                else *va_arg(args, int *) = (int)v;
                assigned++;
            }
            break;
        }
        case 's': {
            char *out = suppress ? NULL : va_arg(args, char *);
            for (; width > 0 && PEEK() && !isspace(PEEK()); width--, s++)
                if (out) *out++ = *s;
            if (out) {
                *out = 0;
                assigned++;
            }
            break;
        }
        case 'c': {
            char *out = suppress ? NULL : va_arg(args, char *);
            if (width == 0x7fffffff) width = 1;
            if (end - s < width) goto done;
            if (out) {
                memcpy(out, s, (size_t)width);
                assigned++;
            }
            s += width;
            break;
        }
        case '[': {
            char set[256] = {0};
            int invert = 0;
            char *out = suppress ? NULL : va_arg(args, char *);
            const char *p;
            fmt++;
            if (*fmt == '^') {
                invert = 1;
                fmt++;
            }
            if (*fmt == ']') set[(unsigned char)*fmt++] = 1;
            for (; *fmt && *fmt != ']'; fmt++) {
                if (fmt[1] == '-' && fmt[2] && fmt[2] != ']') {
                    for (int c = (unsigned char)fmt[0]; c <= (unsigned char)fmt[2]; c++) set[c] = 1;
                    fmt += 2;
                } else {
                    set[(unsigned char)*fmt] = 1;
                }
            }
            p = s;
            for (; width > 0 && PEEK() && set[PEEK()] != invert; width--, s++)
                if (out) *out++ = *s;
            if (s == p) goto done;
            if (out) {
                *out = 0;
                assigned++;
            }
            if (!*fmt) goto done;
            break;
        }
        default:
            goto done;
        }
    }
done:
    if (consumed) *consumed = (size_t)(s - start);
    return assigned;
#undef PEEK
}

int vsscanf(const char *restrict s, const char *restrict fmt, va_list args)
{
    return kitchen_vsscanf_bounded(s, s + strlen(s), fmt, args, NULL);
}

int sscanf(const char *restrict s, const char *restrict fmt, ...)
{
    va_list args;
    int n;

    va_start(args, fmt);
    n = vsscanf(s, fmt, args);
    va_end(args);
    return n;
}
