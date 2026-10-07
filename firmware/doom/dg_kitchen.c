/*
 * doomgeneric platform layer for the kitchen computer: every DG_ hook is a
 * load or store to one of the machine's registers (machine.h).
 */

#include <kitchen.h>
#include <stdio.h>
#include <stdlib.h>

#include "doomgeneric.h"
#include "doomtype.h"
#include "i_video.h"

/* i_video.c keeps the palette DOOM last set, gamma applied, and flags
   changes so it only crosses the bus when it does change. */
extern boolean palette_changed;

#define IWAD_NAME "doom1.wad"

void DG_Init(void)
{
    /* Built with CMAP256 at 320x200, DG_ScreenBuffer holds exactly the frame
       the display scans out: one palette index per pixel. */
    MMIO_REG(MMIO_FB_ADDR) = (unsigned)(uintptr_t)DG_ScreenBuffer;
}

void DG_DrawFrame(void)
{
    if (palette_changed) {
        for (int i = 0; i < 256; i++)
            MMIO_REG(MMIO_PALETTE + 4 * i) = (unsigned)colors[i].r << 16 |
                                             (unsigned)colors[i].g << 8 | colors[i].b;
        palette_changed = false;
    }
    MMIO_REG(MMIO_FB_PRESENT) = 1;
}

void DG_SleepMs(uint32_t ms)
{
    MMIO_REG(MMIO_SLEEP_MS) = ms;
}

uint32_t DG_GetTicksMs(void)
{
    return MMIO_REG(MMIO_TIME_MS);
}

/* Read by i_input.c for the event's typed character. */
unsigned char DG_TypedChar;

int DG_GetKey(int *pressed, unsigned char *key)
{
    unsigned event = MMIO_REG(MMIO_KEY);

    if (!event) return 0;
    *pressed = (event & MMIO_KEY_PRESSED) != 0;
    *key = (unsigned char)event;
    DG_TypedChar = (unsigned char)(event >> 16);
    return 1;
}

void DG_SetWindowTitle(const char *title)
{
    (void)title;
}

/* The host's extra arguments, split in place on spaces ("-timedemo demo1"
   for the benchmark). */
static int add_host_args(char **argv, int argc, int max)
{
    char *p = (char *)(uintptr_t)MMIO_REG(MMIO_ARGS);

    while (p && *p && argc < max) {
        while (*p == ' ') *p++ = 0;
        if (!*p) break;
        argv[argc++] = p;
        while (*p && *p != ' ') p++;
    }
    return argc;
}

int main(void)
{
    static char *argv[16] = {"doom", "-iwad", IWAD_NAME};
    const void *disk = (const void *)(uintptr_t)MMIO_REG(MMIO_DISK_ADDR);
    size_t disk_size = MMIO_REG(MMIO_DISK_SIZE);
    int argc = add_host_args(argv, 3, 15);

    if (!disk_size) {
        puts("no disk");
        return 1;
    }
    kitchen_mount(IWAD_NAME, disk, disk_size);

    doomgeneric_Create(argc, argv);
    for (;;) doomgeneric_Tick();
}
