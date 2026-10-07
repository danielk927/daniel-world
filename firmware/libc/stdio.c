#include <errno.h>
#include <kitchen.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* A flat, in-memory file system. Mounted files point at memory the program
   already has (the disk image) and are read-only; files the program writes
   (DOOM's config and savegames) live on the heap until power off. */

#define MAX_NODES 32
#define MAX_OPEN 8
#define NAME_MAX 64

typedef struct node {
    char name[NAME_MAX];
    unsigned char *data;
    size_t size, capacity;
    int linked; /* has a name in the directory */
    int opens;  /* FILEs open on it: it outlives its name until the last closes */
    int mounted;
} node_t;

struct FILE {
    node_t *node; /* NULL for the console */
    size_t pos;
    int open, readable, writable, append, eof, error;
};

static node_t nodes[MAX_NODES];
static FILE files[MAX_OPEN + 3] = {
    {NULL, 0, 1, 0, 0, 0, 0, 0},
    {NULL, 0, 1, 0, 1, 0, 0, 0},
    {NULL, 0, 1, 0, 1, 0, 0, 0},
};

FILE *const stdin = &files[0];
FILE *const stdout = &files[1];
FILE *const stderr = &files[2];

static node_t *find(const char *name)
{
    for (int i = 0; i < MAX_NODES; i++)
        if (nodes[i].linked && !strcmp(nodes[i].name, name)) return &nodes[i];
    return NULL;
}

static node_t *create(const char *name)
{
    if (strlen(name) >= NAME_MAX) {
        errno = EINVAL;
        return NULL;
    }
    for (int i = 0; i < MAX_NODES; i++)
        if (!nodes[i].linked && !nodes[i].opens) {
            node_t *n = &nodes[i];
            memset(n, 0, sizeof(*n));
            strcpy(n->name, name);
            n->linked = 1;
            return n;
        }
    errno = ENOSPC;
    return NULL;
}

static void destroy(node_t *n)
{
    if (!n->mounted) free(n->data);
    n->data = NULL;
}

/* Takes the name away; the contents go once no FILE has them open. */
static void release(node_t *n)
{
    n->linked = 0;
    if (!n->opens) destroy(n);
}

int kitchen_mount(const char *name, const void *data, size_t size)
{
    node_t *n = find(name);

    if (n) release(n);
    n = create(name);
    if (!n) return -1;
    n->data = (unsigned char *)data;
    n->size = n->capacity = size;
    n->mounted = 1;
    return 0;
}

FILE *fopen(const char *restrict path, const char *restrict mode)
{
    int plus = strchr(mode, '+') != NULL;
    node_t *n = find(path);
    FILE *f = NULL;

    for (int i = 3; i < MAX_OPEN + 3; i++)
        if (!files[i].open) {
            f = &files[i];
            break;
        }
    if (!f) {
        errno = ENFILE;
        return NULL;
    }
    if (mode[0] == 'r') {
        if (!n) {
            errno = ENOENT;
            return NULL;
        }
    } else if (mode[0] == 'w' || mode[0] == 'a') {
        if (n && n->mounted) {
            errno = EROFS;
            return NULL;
        }
        if (!n && !(n = create(path))) return NULL;
        if (mode[0] == 'w') n->size = 0;
    } else {
        errno = EINVAL;
        return NULL;
    }
    if (n->mounted && plus) {
        errno = EROFS;
        return NULL;
    }

    memset(f, 0, sizeof(*f));
    f->node = n;
    f->open = 1;
    n->opens++;
    f->readable = mode[0] == 'r' || plus;
    f->writable = mode[0] != 'r' || plus;
    f->append = mode[0] == 'a';
    return f;
}

int fclose(FILE *f)
{
    node_t *n = f->node;

    if (!n || !f->open) return 0;
    f->open = 0;
    if (!--n->opens && !n->linked) destroy(n);
    return 0;
}

static void console_write(const unsigned char *s, size_t n)
{
    while (n--) MMIO_REG(MMIO_CONSOLE) = *s++;
}

size_t fread(void *restrict buf, size_t size, size_t count, FILE *restrict f)
{
    size_t want = size * count, left;

    if (!f->readable || !f->node || !size) return 0;
    left = f->pos < f->node->size ? f->node->size - f->pos : 0;
    if (want > left) {
        want = left - left % size;
        f->eof = 1;
    }
    memcpy(buf, f->node->data + f->pos, want);
    f->pos += want;
    return want / size;
}

size_t fwrite(const void *restrict buf, size_t size, size_t count, FILE *restrict f)
{
    size_t n = size * count, end;
    node_t *node = f->node;

    if (!f->writable || !size) return 0;
    if (!node) {
        console_write(buf, n);
        return count;
    }
    if (f->append) f->pos = node->size;
    end = f->pos + n;
    if (end > node->capacity) {
        size_t capacity = node->capacity ? node->capacity : 256;
        unsigned char *grown;
        while (capacity < end) capacity *= 2;
        grown = realloc(node->data, capacity);
        if (!grown) {
            f->error = 1;
            errno = ENOSPC;
            return 0;
        }
        node->data = grown;
        node->capacity = capacity;
    }
    if (f->pos > node->size) memset(node->data + node->size, 0, f->pos - node->size);
    memcpy(node->data + f->pos, buf, n);
    f->pos = end;
    if (end > node->size) node->size = end;
    return count;
}

int fseek(FILE *f, long offset, int whence)
{
    long base;

    if (!f->node) return -1;
    base = whence == SEEK_SET ? 0 : whence == SEEK_CUR ? (long)f->pos : (long)f->node->size;
    if (base + offset < 0) {
        errno = EINVAL;
        return -1;
    }
    f->pos = (size_t)(base + offset);
    f->eof = 0;
    return 0;
}

long ftell(FILE *f)
{
    return (long)f->pos;
}

int feof(FILE *f)
{
    return f->eof;
}

int ferror(FILE *f)
{
    return f->error;
}

int fflush(FILE *f)
{
    (void)f;
    return 0;
}

int fileno(FILE *f)
{
    return (int)(f - files);
}

int fgetc(FILE *f)
{
    unsigned char c;

    return fread(&c, 1, 1, f) ? c : EOF;
}

char *fgets(char *restrict buf, int size, FILE *restrict f)
{
    int i = 0;

    if (size < 1) return NULL;
    while (i < size - 1) {
        int c = fgetc(f);
        if (c == EOF) break;
        buf[i++] = (char)c;
        if (c == '\n') break;
    }
    if (!i && size > 1) return NULL; /* end of file before anything was read */
    buf[i] = 0;
    return buf;
}

int fputc(int c, FILE *f)
{
    unsigned char b = (unsigned char)c;

    return fwrite(&b, 1, 1, f) ? b : EOF;
}

int putc(int c, FILE *f)
{
    return fputc(c, f);
}

int putchar(int c)
{
    return fputc(c, stdout);
}

int fputs(const char *restrict s, FILE *restrict f)
{
    size_t n = strlen(s);

    return fwrite(s, 1, n, f) == n ? 0 : EOF;
}

int puts(const char *s)
{
    return fputs(s, stdout) || fputc('\n', stdout) == EOF ? EOF : 0;
}

int remove(const char *path)
{
    node_t *n = find(path);

    if (!n || n->mounted) {
        errno = n ? EROFS : ENOENT;
        return -1;
    }
    release(n);
    return 0;
}

int rename(const char *from, const char *to)
{
    node_t *n = find(from), *old = find(to);

    if (!n) {
        errno = ENOENT;
        return -1;
    }
    if (strlen(to) >= NAME_MAX) {
        errno = EINVAL;
        return -1;
    }
    if (old && old != n) release(old);
    strcpy(n->name, to);
    return 0;
}

/* Scanning a file reads the rest of it in place (files are memory). */
int kitchen_vsscanf_bounded(const char *s, const char *end, const char *format, va_list args,
                            size_t *consumed);

int fscanf(FILE *restrict f, const char *restrict format, ...)
{
    va_list args;
    size_t consumed = 0;
    int result;
    const char *start;

    if (!f->readable || !f->node || f->pos >= f->node->size) {
        f->eof = 1;
        return EOF;
    }
    start = (const char *)f->node->data + f->pos;
    va_start(args, format);
    result = kitchen_vsscanf_bounded(start, (const char *)f->node->data + f->node->size, format,
                                     args, &consumed);
    va_end(args);
    f->pos += consumed;
    return result;
}
