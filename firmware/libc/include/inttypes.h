#ifndef _INTTYPES_H
#define _INTTYPES_H

#include <stdint.h>

/* ILP32 RISC-V: int32_t is long, int64_t is long long. */
#define PRId8 "d"
#define PRId16 "d"
#define PRId32 "ld"
#define PRId64 "lld"
#define PRIi32 "li"
#define PRIu8 "u"
#define PRIu16 "u"
#define PRIu32 "lu"
#define PRIu64 "llu"
#define PRIx32 "lx"
#define PRIX32 "lX"
#define PRIx64 "llx"
#define PRIX64 "llX"

#endif
