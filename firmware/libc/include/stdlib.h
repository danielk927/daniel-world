#ifndef _STDLIB_H
#define _STDLIB_H

#include <stddef.h>

#define EXIT_SUCCESS 0
#define EXIT_FAILURE 1
#define RAND_MAX 0x7fffffff

void *malloc(size_t size);
void *calloc(size_t count, size_t size);
void *realloc(void *ptr, size_t size);
void free(void *ptr);

int atoi(const char *s);
long atol(const char *s);
double atof(const char *s);
long strtol(const char *restrict s, char **restrict end, int base);
unsigned long strtoul(const char *restrict s, char **restrict end, int base);

int abs(int x);
long labs(long x);

int rand(void);
void srand(unsigned seed);

void qsort(void *base, size_t count, size_t size, int (*compare)(const void *, const void *));

char *getenv(const char *name);
int system(const char *command);

_Noreturn void exit(int status);
_Noreturn void abort(void);

#endif
