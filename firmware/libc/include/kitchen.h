#ifndef _KITCHEN_H
#define _KITCHEN_H

#include <stddef.h>

#include "machine.h"

/* Make `size` bytes at `data` readable as the file `name`, without copying
   (the disk image, for one). Returns 0, or -1 when the file table is full. */
int kitchen_mount(const char *name, const void *data, size_t size);

#endif
