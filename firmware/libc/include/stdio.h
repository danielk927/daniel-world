#ifndef _STDIO_H
#define _STDIO_H

#include <stdarg.h>
#include <stddef.h>

/* Files live in memory (see kitchen.h): the console, the read-only disk
   image and whatever the program writes during this power cycle. */
typedef struct FILE FILE;

extern FILE *const stdin;
extern FILE *const stdout;
extern FILE *const stderr;

#define EOF (-1)
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2
#define BUFSIZ 1024
#define FILENAME_MAX 256

FILE *fopen(const char *restrict path, const char *restrict mode);
int fclose(FILE *f);
size_t fread(void *restrict buf, size_t size, size_t count, FILE *restrict f);
size_t fwrite(const void *restrict buf, size_t size, size_t count, FILE *restrict f);
int fseek(FILE *f, long offset, int whence);
long ftell(FILE *f);
int feof(FILE *f);
int ferror(FILE *f);
int fflush(FILE *f);
int fileno(FILE *f);
int fgetc(FILE *f);
char *fgets(char *restrict buf, int size, FILE *restrict f);
int fputc(int c, FILE *f);
int fputs(const char *restrict s, FILE *restrict f);
int putc(int c, FILE *f);
int putchar(int c);
int puts(const char *s);
int remove(const char *path);
int rename(const char *from, const char *to);

int printf(const char *restrict format, ...);
int fprintf(FILE *restrict f, const char *restrict format, ...);
int sprintf(char *restrict buf, const char *restrict format, ...);
int snprintf(char *restrict buf, size_t size, const char *restrict format, ...);
int vprintf(const char *restrict format, va_list args);
int vfprintf(FILE *restrict f, const char *restrict format, va_list args);
int vsprintf(char *restrict buf, const char *restrict format, va_list args);
int vsnprintf(char *restrict buf, size_t size, const char *restrict format, va_list args);

int sscanf(const char *restrict s, const char *restrict format, ...);
int vsscanf(const char *restrict s, const char *restrict format, va_list args);
int fscanf(FILE *restrict f, const char *restrict format, ...);

#endif
