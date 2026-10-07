#include <ctype.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

/* memcpy and memset move whole words when both ends allow it: DOOM copies a
   64000-byte frame and clears large tables, and on an emulated CPU every
   instruction saved counts. */

void *memcpy(void *restrict dst, const void *restrict src, size_t n)
{
    unsigned char *d = dst;
    const unsigned char *s = src;

    if ((((uintptr_t)d | (uintptr_t)s) & 3) == 0) {
        uint32_t *dw = (uint32_t *)d;
        const uint32_t *sw = (const uint32_t *)s;
        for (; n >= 16; n -= 16) {
            dw[0] = sw[0];
            dw[1] = sw[1];
            dw[2] = sw[2];
            dw[3] = sw[3];
            dw += 4;
            sw += 4;
        }
        for (; n >= 4; n -= 4) *dw++ = *sw++;
        d = (unsigned char *)dw;
        s = (const unsigned char *)sw;
    }
    while (n--) *d++ = *s++;
    return dst;
}

void *memmove(void *dst, const void *src, size_t n)
{
    unsigned char *d = dst;
    const unsigned char *s = src;

    if (d <= s || d >= s + n) return memcpy(dst, src, n);
    d += n;
    s += n;
    while (n--) *--d = *--s;
    return dst;
}

void *memset(void *dst, int c, size_t n)
{
    unsigned char *d = dst;

    if (((uintptr_t)d & 3) == 0) {
        uint32_t w = (unsigned char)c * 0x01010101u;
        uint32_t *dw = (uint32_t *)d;
        for (; n >= 16; n -= 16) {
            dw[0] = w;
            dw[1] = w;
            dw[2] = w;
            dw[3] = w;
            dw += 4;
        }
        for (; n >= 4; n -= 4) *dw++ = w;
        d = (unsigned char *)dw;
    }
    while (n--) *d++ = (unsigned char)c;
    return dst;
}

int memcmp(const void *a, const void *b, size_t n)
{
    const unsigned char *x = a, *y = b;

    for (; n; n--, x++, y++)
        if (*x != *y) return *x - *y;
    return 0;
}

void *memchr(const void *s, int c, size_t n)
{
    const unsigned char *p = s;

    for (; n; n--, p++)
        if (*p == (unsigned char)c) return (void *)p;
    return NULL;
}

size_t strlen(const char *s)
{
    const char *p = s;

    while (*p) p++;
    return p - s;
}

size_t strnlen(const char *s, size_t max)
{
    size_t n = 0;

    while (n < max && s[n]) n++;
    return n;
}

char *strcpy(char *restrict dst, const char *restrict src)
{
    char *d = dst;

    while ((*d++ = *src++)) {
    }
    return dst;
}

char *strncpy(char *restrict dst, const char *restrict src, size_t n)
{
    size_t i = 0;

    for (; i < n && src[i]; i++) dst[i] = src[i];
    for (; i < n; i++) dst[i] = 0;
    return dst;
}

char *strcat(char *restrict dst, const char *restrict src)
{
    strcpy(dst + strlen(dst), src);
    return dst;
}

char *strncat(char *restrict dst, const char *restrict src, size_t n)
{
    char *d = dst + strlen(dst);

    while (n-- && *src) *d++ = *src++;
    *d = 0;
    return dst;
}

int strcmp(const char *a, const char *b)
{
    while (*a && *a == *b) a++, b++;
    return (unsigned char)*a - (unsigned char)*b;
}

int strncmp(const char *a, const char *b, size_t n)
{
    for (; n; n--, a++, b++) {
        if (*a != *b) return (unsigned char)*a - (unsigned char)*b;
        if (!*a) break;
    }
    return 0;
}

int strcasecmp(const char *a, const char *b)
{
    while (*a && tolower((unsigned char)*a) == tolower((unsigned char)*b)) a++, b++;
    return tolower((unsigned char)*a) - tolower((unsigned char)*b);
}

int strncasecmp(const char *a, const char *b, size_t n)
{
    for (; n; n--, a++, b++) {
        int x = tolower((unsigned char)*a), y = tolower((unsigned char)*b);
        if (x != y) return x - y;
        if (!x) break;
    }
    return 0;
}

char *strchr(const char *s, int c)
{
    for (;; s++) {
        if (*s == (char)c) return (char *)s;
        if (!*s) return NULL;
    }
}

char *strrchr(const char *s, int c)
{
    const char *found = NULL;

    for (;; s++) {
        if (*s == (char)c) found = s;
        if (!*s) return (char *)found;
    }
}

char *strstr(const char *haystack, const char *needle)
{
    size_t n = strlen(needle);

    for (; *haystack; haystack++)
        if (!strncmp(haystack, needle, n)) return (char *)haystack;
    return n ? NULL : (char *)haystack;
}

char *strdup(const char *s)
{
    size_t n = strlen(s) + 1;
    char *copy = malloc(n);

    return copy ? memcpy(copy, s, n) : NULL;
}

char *strerror(int errnum)
{
    return errnum ? "error" : "no error";
}
