/* Memory layout of the kitchen computer; machine.h has the full map. */

ENTRY(_start)

STACK_TOP = 0x01000000;   /* MACHINE_STACK_TOP */
STACK_SIZE = 0x00100000;  /* MACHINE_STACK_SIZE */

SECTIONS
{
    /* The page below 0x1000 stays unmapped so null pointers fault. */
    . = 0x1000;

    /* Code alone in its own pages: the host compiles it to JavaScript and
       treats any store into it as self-modifying code. */
    .text : {
        KEEP(*(.text.start))
        *(.text .text.*)
    }
    __text_end = .;

    . = ALIGN(4096);
    .rodata : { *(.rodata .rodata.*) *(.srodata .srodata.*) }

    . = ALIGN(16);
    .data : { *(.data .data.*) }
    .sdata : {
        __global_pointer$ = . + 0x800;
        *(.sdata .sdata.*)
    }

    . = ALIGN(16);
    .bss (NOLOAD) : {
        __bss_start = .;
        *(.sbss .sbss.*)
        *(.bss .bss.*)
        *(COMMON)
        . = ALIGN(16);
        __bss_end = .;
    }

    __heap_start = .;
    __heap_end = STACK_TOP - STACK_SIZE;
    ASSERT(__heap_start < __heap_end, "program does not fit below the stack")

    /DISCARD/ : { *(.comment) *(.riscv.attributes) *(.note .note.*) *(.eh_frame*) }
}
