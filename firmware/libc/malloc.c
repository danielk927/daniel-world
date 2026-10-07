#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* The classic K&R allocator over the heap the linker script sets aside:
   one address-ordered circular free list, first fit, blocks merged with
   their neighbours on free. DOOM does most of its allocation in its own
   zone (one big malloc at boot), so this sees little traffic. */

typedef union header {
    struct {
        union header *next; /* next free block (free blocks only) */
        size_t units;       /* block size in headers, this one included */
    } s;
    long long align; /* blocks start 8-byte aligned, like max_align_t */
} header_t;

extern char __heap_start[], __heap_end[];

static header_t base;
static header_t *freep;

static void init(void)
{
    header_t *heap = (header_t *)__heap_start;

    heap->s.units = (size_t)(__heap_end - __heap_start) / sizeof(header_t);
    heap->s.next = &base;
    base.s.next = heap;
    base.s.units = 0;
    freep = &base;
}

void *malloc(size_t size)
{
    header_t *prev, *p;
    size_t units;

    if (!freep) init();
    if (size > (size_t)(__heap_end - __heap_start)) {
        errno = ENOMEM;
        return NULL;
    }
    units = (size + sizeof(header_t) - 1) / sizeof(header_t) + 1;

    prev = freep;
    for (p = prev->s.next;; prev = p, p = p->s.next) {
        if (p->s.units >= units) {
            if (p->s.units == units) {
                prev->s.next = p->s.next;
            } else {
                /* Hand out the tail, so the free block stays where it is. */
                p->s.units -= units;
                p += p->s.units;
                p->s.units = units;
            }
            freep = prev;
            return p + 1;
        }
        if (p == freep) {
            errno = ENOMEM;
            return NULL;
        }
    }
}

void free(void *ptr)
{
    header_t *b, *p;

    if (!ptr) return;
    b = (header_t *)ptr - 1;
    for (p = freep; !(b > p && b < p->s.next); p = p->s.next)
        if (p >= p->s.next && (b > p || b < p->s.next)) break; /* at either end */

    if (b + b->s.units == p->s.next) {
        b->s.units += p->s.next->s.units;
        b->s.next = p->s.next->s.next;
    } else {
        b->s.next = p->s.next;
    }
    if (p + p->s.units == b) {
        p->s.units += b->s.units;
        p->s.next = b->s.next;
    } else {
        p->s.next = b;
    }
    freep = p;
}

void *calloc(size_t count, size_t size)
{
    void *p;

    if (size && count > SIZE_MAX / size) {
        errno = ENOMEM;
        return NULL;
    }
    p = malloc(count * size);
    return p ? memset(p, 0, count * size) : NULL;
}

void *realloc(void *ptr, size_t size)
{
    size_t have;
    void *grown;

    if (!ptr) return malloc(size);
    if (!size) {
        free(ptr);
        return NULL;
    }
    have = (((header_t *)ptr - 1)->s.units - 1) * sizeof(header_t);
    if (size <= have) return ptr;
    grown = malloc(size);
    if (!grown) return NULL;
    memcpy(grown, ptr, have);
    free(ptr);
    return grown;
}
