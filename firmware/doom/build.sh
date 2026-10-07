#!/usr/bin/env bash
# Builds DOOM for the kitchen computer: a bare-metal RV32IM ELF, written to
# apps/client/src/computer/assets/doom.elf. The ELF is committed, because the
# site's build (Vercel) has no RISC-V toolchain.
#
# Needs LLVM with the RISC-V target and lld. On macOS:
#   brew install llvm lld
# Override the tools with CC=..., LD=..., STRIP=... if they live elsewhere.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
firmware="$(dirname "$here")"
root="$(dirname "$firmware")"
out="$root/apps/client/src/computer/assets/doom.elf"
build="$here/build"

llvm="$(brew --prefix llvm 2>/dev/null || echo /usr)/bin"
lld="$(brew --prefix lld 2>/dev/null || echo /usr)/bin"
CC="${CC:-$llvm/clang}"
LD="${LD:-$lld/ld.lld}"
STRIP="${STRIP:-$llvm/llvm-strip}"
SIZE="${SIZE:-$llvm/llvm-size}"

target=(--target=riscv32-unknown-elf -march=rv32im -mabi=ilp32)
# -nostdlibinc keeps clang's own freestanding headers (stdint.h, stdarg.h,
# limits.h, ...) and drops the host's; firmware/libc supplies the rest.
common=("${target[@]}" -O2 -flto -ffreestanding -nostdlib -nostdlibinc
  -fno-common -ffunction-sections -fdata-sections
  -I"$firmware/include" -I"$firmware/libc/include")
# CMAP256 makes doomgeneric hand over palette indices, 64000 bytes a frame.
doom=(-DCMAP256 -DDOOMGENERIC_RESX=320 -DDOOMGENERIC_RESY=200 -DNORMALUNIX
  -I"$here/doomgeneric" -w)
ours=(-std=c11 -Wall -Wextra -Werror)

rm -rf "$build"
mkdir -p "$build"

objects=()
compile() {
  local src="$1" obj
  shift
  obj="$build/$(basename "${src%.*}").o"
  "$CC" "${common[@]}" "$@" -c "$src" -o "$obj"
  objects+=("$obj")
}

compile "$firmware/rt/crt0.S"
for src in "$firmware"/libc/*.c; do
  compile "$src" "${ours[@]}"
done
compile "$here/dg_kitchen.c" "${doom[@]}"
for src in "$here"/doomgeneric/*.c; do
  compile "$src" "${doom[@]}"
done

"$LD" -m elf32lriscv --nmagic -T "$firmware/rt/link.ld" --gc-sections \
  --Map="$build/doom.map" -o "$build/doom.elf" "${objects[@]}"
"$STRIP" --strip-all -o "$out" "$build/doom.elf"
"$SIZE" "$build/doom.elf"
ls -l "$out"
