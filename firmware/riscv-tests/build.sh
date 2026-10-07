#!/usr/bin/env bash
# Builds the official RISC-V ISA tests for RV32I and M (riscv-tests, BSD
# licensed) against riscv_test.h, into apps/client/src/computer/testdata/.
# isa.test.ts runs every one on both execution engines. The ELFs are
# committed so the tests need no toolchain.
#
# fence_i is left out: it writes instructions into data memory and jumps to
# them, and this machine only fetches from the program's code segment.
#
# Needs LLVM with the RISC-V target and lld (brew install llvm lld), and git.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
firmware="$(dirname "$here")"
root="$(dirname "$firmware")"
out="$root/apps/client/src/computer/testdata/riscv-tests"
commit=bcffa2b3188b040c611f90dc0b6e422f54775a09
src="$here/build/riscv-tests"

llvm="$(brew --prefix llvm 2>/dev/null || echo /usr)/bin"
lld="$(brew --prefix lld 2>/dev/null || echo /usr)/bin"
CC="${CC:-$llvm/clang}"
LD="${LD:-$lld/ld.lld}"
STRIP="${STRIP:-$llvm/llvm-strip}"

if [ ! -d "$src/.git" ]; then
  rm -rf "$src"
  git clone --quiet https://github.com/riscv-software-src/riscv-tests.git "$src"
fi
git -C "$src" checkout --quiet "$commit"

rm -rf "$out"
mkdir -p "$out" "$here/build/obj"
cp "$src/LICENSE" "$out/LICENSE"

for suite in rv32ui rv32um; do
  for test in "$src/isa/$suite"/*.S; do
    name="$(basename "$test" .S)"
    [ "$name" = fence_i ] && continue
    obj="$here/build/obj/$suite-$name.o"
    "$CC" --target=riscv32-unknown-elf -march=rv32im -mabi=ilp32 -mno-relax \
      -I"$here" -I"$firmware/include" -I"$src/isa/macros/scalar" \
      -c "$test" -o "$obj"
    "$LD" -m elf32lriscv --nmagic -T "$firmware/rt/link.ld" -o "$obj.elf" "$obj"
    "$STRIP" --strip-all -o "$out/$suite-$name.elf" "$obj.elf"
  done
done
ls "$out" | wc -l
