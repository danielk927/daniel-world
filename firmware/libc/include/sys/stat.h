#ifndef _SYS_STAT_H
#define _SYS_STAT_H

#include <sys/types.h>

/* The file system is flat, so directories always "exist". */
int mkdir(const char *path, mode_t mode);

#endif
