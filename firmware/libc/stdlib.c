#include <assert.h>
#include <ctype.h>
#include <errno.h>
#include <kitchen.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

int errno;

static int digit_value(int c)
{
    if (isdigit(c)) return c - '0';
    if (isalpha(c)) return (c | 32) - 'a' + 10;
    return 99;
}

/* The shared part of strtol and strtoul: magnitude in *out, sign returned. */
static int parse_integer(const char *s, char **end, int base, unsigned long *out)
{
    const char *p = s;
    unsigned long value = 0;
    int negative = 0, any = 0, overflow = 0;

    while (isspace((unsigned char)*p)) p++;
    if (*p == '+' || *p == '-') negative = *p++ == '-';
    if ((base == 0 || base == 16) && p[0] == '0' && (p[1] | 32) == 'x' && isxdigit((unsigned char)p[2])) {
        p += 2;
        base = 16;
    } else if (base == 0) {
        base = *p == '0' ? 8 : 10;
    }
    for (;; p++, any = 1) {
        int d = digit_value((unsigned char)*p);
        if (d >= base) break;
        if (value > (ULONG_MAX - d) / base) overflow = 1;
        value = value * base + d;
    }
    if (end) *end = (char *)(any ? p : s);
    if (overflow) {
        errno = ERANGE;
        value = ULONG_MAX;
    }
    *out = value;
    return negative;
}

long strtol(const char *restrict s, char **restrict end, int base)
{
    unsigned long magnitude;
    int negative = parse_integer(s, end, base, &magnitude);

    if (negative) {
        if (magnitude > (unsigned long)LONG_MAX + 1) {
            errno = ERANGE;
            return LONG_MIN;
        }
        return (long)(0 - magnitude);
    }
    if (magnitude > LONG_MAX) {
        errno = ERANGE;
        return LONG_MAX;
    }
    return (long)magnitude;
}

unsigned long strtoul(const char *restrict s, char **restrict end, int base)
{
    unsigned long magnitude;
    int negative = parse_integer(s, end, base, &magnitude);

    return negative ? 0 - magnitude : magnitude;
}

int atoi(const char *s)
{
    return (int)strtol(s, NULL, 10);
}

long atol(const char *s)
{
    return strtol(s, NULL, 10);
}

double atof(const char *s)
{
    double value = 0, scale = 1;
    int negative = 0;

    while (isspace((unsigned char)*s)) s++;
    if (*s == '+' || *s == '-') negative = *s++ == '-';
    for (; isdigit((unsigned char)*s); s++) value = value * 10 + (*s - '0');
    if (*s == '.')
        for (s++; isdigit((unsigned char)*s); s++) {
            scale /= 10;
            value += (*s - '0') * scale;
        }
    return negative ? -value : value;
}

double fabs(double x)
{
    return x < 0 ? -x : x;
}

int abs(int x)
{
    return x < 0 ? -x : x;
}

long labs(long x)
{
    return x < 0 ? -x : x;
}

/* There is no environment, no shell and no terminal. */

char *getenv(const char *name)
{
    (void)name;
    return NULL;
}

int system(const char *command)
{
    (void)command;
    return -1;
}

int isatty(int fd)
{
    (void)fd;
    return 0;
}

int mkdir(const char *path, mode_t mode)
{
    (void)path;
    (void)mode;
    return 0;
}

_Noreturn void exit(int status)
{
    fflush(stdout);
    MMIO_REG(MMIO_EXIT) = (unsigned)status;
    for (;;) {
    }
}

_Noreturn void abort(void)
{
    fputs("abort\n", stderr);
    exit(134);
}

_Noreturn void __assert_fail(const char *expr, const char *file, int line)
{
    fprintf(stderr, "%s:%d: assertion failed: %s\n", file, line, expr);
    abort();
}
